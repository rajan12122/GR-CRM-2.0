require('dotenv').config();
const originalToLocaleDateString = Date.prototype.toLocaleDateString;
Date.prototype.toLocaleDateString = function(locale, options) {
  if (locale === 'en-IN' && !options) {
    const day = String(this.getDate()).padStart(2, '0');
    const month = String(this.getMonth() + 1).padStart(2, '0');
    const year = this.getFullYear();
    return `${day}/${month}/${year}`;
  }
  return originalToLocaleDateString.call(this, locale, options);
};

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { syncToSheets, syncFromSheets, syncFromSheetsIncremental, syncToSheetsManual, getSheetsConfig, getSheetsClient, getSpreadsheetSheets, getSheetHeaders, executeImportWithMapping, processSyncQueue } = require('./services/sheetsService');

const app = express();
const PORT = process.env.PORT || 5000;
if (!process.env.JWT_SECRET) {
  console.error("CRITICAL CONFIGURATION ERROR: JWT_SECRET environment variable is not defined!");
  console.error("For security reasons, the server cannot start without a configured JWT_SECRET.");
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;


// Lightweight memory-based IP rate limiter
const ipRequests = {};
function ipRateLimiter(windowMs, maxRequests) {
  return (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    if (!ipRequests[ip]) {
      ipRequests[ip] = [];
    }
    ipRequests[ip] = ipRequests[ip].filter(time => now - time < windowMs);
    if (ipRequests[ip].length >= maxRequests) {
      return res.status(429).json({ success: false, message: 'Too many requests from this network. Please try again in 15 minutes.' });
    }
    ipRequests[ip].push(now);
    next();
  };
}

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const {
  metadataPath,
  initializeMetadata,
  readMetadata,
  writeMetadata,
  runTransaction,
  generateNextId: generateNextIdAsync,
  handlePropertyDealerAssociation,
  getRecords,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  loadTransactionDb,
  syncDbChangesToPostgres,
  pool
} = require('./services/dbService');

const getTodayDateString = () => {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

const formatToInDate = (dateStr) => {
  if (!dateStr) return getTodayDateString();
  let dateOnly = String(dateStr).split(' ')[0];
  if (dateOnly.includes('-')) {
    const parts = dateOnly.split('-');
    if (parts[0].length === 4) {
      const year = parts[0];
      const month = parts[1].padStart(2, '0');
      const day = parts[2].padStart(2, '0');
      return `${day}/${month}/${year}`;
    }
  }
  const parts = dateOnly.split('/');
  if (parts.length === 3) {
    const d = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const y = parts[2];
    return `${d}/${m}/${y}`;
  }
  return dateOnly;
};

let uniqueSuffixCounter = 0;
function generateUniqueId(prefix) {
  uniqueSuffixCounter = (uniqueSuffixCounter + 1) % 10000;
  const timePart = Date.now();
  const randPart = Math.floor(Math.random() * 1000);
  const counterPart = String(uniqueSuffixCounter).padStart(4, '0');
  return `${prefix}-${timePart}-${randPart}-${counterPart}`;
}

function generateNextId(db, moduleName, prefix) {
  db.idCounters = db.idCounters || {};
  const prefixMap = {
    employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
    projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
    tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
    daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
    property_pitch_history: 'PITCH', dealer_calls: 'CALL',
    dealers: 'DEAL'
  };
  const effPrefix = prefix || prefixMap[moduleName] || String(moduleName).substring(0, 4).toUpperCase();

  if (db.idCounters[moduleName] === undefined) {
    const list = db[moduleName] || [];
    let maxNum = 0;
    list.forEach(rec => {
      if (rec && rec.id && String(rec.id).startsWith(`${effPrefix}-`)) {
        const parts = String(rec.id).split('-');
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > maxNum) {
          maxNum = num;
        }
      }
    });
    db.idCounters[moduleName] = maxNum;
  }

  db.idCounters[moduleName]++;
  const nextNum = db.idCounters[moduleName];
  return `${effPrefix}-${String(nextNum).padStart(3, '0')}`;
}

let dbCache = null;

function readDb() {
  if (!dbCache) {
    console.warn("readDb called before cache was initialized!");
    return {};
  }
  return dbCache;
}

async function getModuleRecordsForServer(moduleName, client = null) {
  const migratedModules = ['employees', 'attendance', 'location_logs', 'active_paths'];
  if (migratedModules.includes(moduleName)) {
    return await getRecords(moduleName, client);
  } else {
    if (!dbCache) return [];
    return dbCache[moduleName] || [];
  }
}

async function writeDb(db) {
  dbCache = db;
  try {
    await runTransaction(async (client) => {
      const dbBefore = await loadTransactionDb(client);
      await syncDbChangesToPostgres(dbBefore, db, client);
    });
  } catch (err) {
    console.error('Error writing dbCache back to PostgreSQL:', err);
  }
}

function updateGlobalReferences(db, oldId, newId) {
  Object.keys(db).forEach(mod => {
    if (!Array.isArray(db[mod])) return;
    db[mod].forEach(rec => {
      Object.keys(rec).forEach(key => {
        if (rec[key] === oldId) {
          rec[key] = newId;
        } else if (Array.isArray(rec[key])) {
          rec[key] = rec[key].map(item => {
            if (item && typeof item === 'object') {
              Object.keys(item).forEach(k => {
                if (item[k] === oldId) item[k] = newId;
              });
              return item;
            }
            return item === oldId ? newId : item;
          });
        } else if (typeof rec[key] === 'string') {
          if (rec[key].includes(oldId)) {
            rec[key] = rec[key].split(',').map(s => s.trim() === oldId ? newId : s.trim()).join(', ');
          }
        }
      });
    });
  });
}

function resequenceAllModules() {
  // IDs once assigned must NEVER be modified or re-sequenced to preserve reference & relationship integrity permanently.
  console.log('ID re-sequencer is disabled to protect assigned IDs and relationships.');
}

// Sync from Google Sheets on start if credentials exist
syncFromSheets().then(res => {
  if (res) console.log('Initial Google Sheets sync completed on boot.');
  else console.log('Running on local JSON database cache.');
});

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'Authentication token required.' });

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
    
    // Check session validity & token version from PostgreSQL
    getRecord('employees', decodedUser.id).then(employee => {
      if (!employee || employee.status !== 'Active' || (employee.tokenVersion !== undefined && String(employee.tokenVersion) !== String(decodedUser.tokenVersion))) {
        return res.status(403).json({ message: 'Session has expired or been revoked. Please log in again.' });
      }
      req.user = decodedUser;
      next();
    }).catch(err => {
      return res.status(500).json({ message: 'Session verification database error.' });
    });
  });
}

// Role-based Access Control Middleware
function checkPermission(moduleName, action) {
  return (req, res, next) => {
    if (moduleName === 'documents' || moduleName === 'activity_logs') {
      return next();
    }
    const metadata = readMetadata();
    const role = req.user.role;
    const userId = req.user.id;
    
    // Check specific user-level override permissions first
    if (userId && metadata.userPermissions && metadata.userPermissions[userId]) {
      const userModulePerms = metadata.userPermissions[userId][moduleName] || [];
      if (userModulePerms.includes(action) || role === 'Admin') {
        return next();
      }
      return res.status(403).json({ message: `Insufficient permissions to perform '${action}' on '${moduleName}' module.` });
    }
    
    const permissions = metadata.rolesPermissions[role];
    if (!permissions) {
      return res.status(403).json({ message: 'Role has no permissions configured.' });
    }

    const modulePerms = permissions[moduleName] || [];
    if (modulePerms.includes(action) || role === 'Admin') {
      return next();
    }

    return res.status(403).json({ message: `Insufficient permissions to perform '${action}' on '${moduleName}' module.` });
  };
}

// --- AUTHENTICATION ROUTES ---

app.post('/api/auth/login', ipRateLimiter(15 * 60 * 1000, 10), (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required.' });
  }

  pool.query('SELECT * FROM employees WHERE LOWER(email) = LOWER($1)', [email]).then(result => {
    const employee = result.rows[0];
    if (!employee) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    if (employee.status !== 'Active') {
      return res.status(403).json({ message: 'Employee account is inactive.' });
    }

    // Strictly check bcrypt hash
    const hash = employee.passwordHash;
    if (!hash) {
      return res.status(401).json({ message: 'Account is not configured with a login password. Please contact the Admin.' });
    }

    const isValidPassword = bcrypt.compareSync(password, hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    const tokenVersion = parseInt(employee.tokenVersion, 10) || 1;
    const token = jwt.sign(
      { id: employee.id, name: employee.name, email: employee.email, role: employee.role, tokenVersion },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    const sanitizedUser = {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      role: employee.role,
      status: employee.status
    };

    res.json({ token, user: sanitizedUser });
  }).catch(err => {
    console.error('Login database error:', err);
    res.status(500).json({ message: 'Database error during login.' });
  });
});

app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const employee = await getRecord('employees', req.user.id);
    if (!employee) return res.status(404).json({ message: 'Profile not found.' });
    res.json(employee);
  } catch (err) {
    console.error('Get profile database error:', err);
    res.status(500).json({ message: 'Database error fetching profile.' });
  }
});

app.post('/api/auth/admin/reset-password', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ message: 'Access denied: Only Admins can set or reset employee passwords.' });
  }

  const { employeeId, password, confirmPassword } = req.body;
  if (!employeeId || !password || !confirmPassword) {
    return res.status(400).json({ message: 'Employee ID, password, and confirm password fields are required.' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ message: 'Passwords do not match.' });
  }

  const strengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!strengthRegex.test(password)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character.' });
  }

  try {
    const employee = await getRecord('employees', employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee account not found.' });
    }

    const salt = bcrypt.genSaltSync(12);
    const hash = bcrypt.hashSync(password, salt);
    const newTokenVersion = (parseInt(employee.tokenVersion, 10) || 1) + 1;

    await runTransaction(async (client) => {
      await client.query(
        'UPDATE employees SET "passwordHash" = $1, "tokenVersion" = $2 WHERE id = $3',
        [hash, newTokenVersion, employeeId]
      );

      const auditLog = {
        id: generateUniqueId('LOG-AUD'),
        employeeName: req.user.name,
        action: `Reset password for employee: ${employee.name} (${employee.id})`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', auditLog, client);
    });

    // Synchronously write-through to dbCache.employees
    if (dbCache && dbCache.employees) {
      const emp = dbCache.employees.find(e => String(e.id) === String(employeeId));
      if (emp) {
        emp.passwordHash = hash;
        emp.tokenVersion = newTokenVersion;
      }
    }

    res.json({ success: true, message: `Password for employee ${employee.name} updated successfully. Active sessions revoked.` });
  } catch (err) {
    console.error('Reset password database error:', err);
    res.status(500).json({ message: 'Database error resetting password: ' + err.message });
  }
});

// --- METADATA ROUTES (Schema changes) ---

app.get('/api/metadata', authenticateToken, (req, res) => {
  const metadata = readMetadata();
  const { role } = req.user;

  // Filter modules based on role's custom field permissions
  if (role !== 'Admin' && metadata.fieldPermissions && metadata.fieldPermissions[role]) {
    const roleFieldPerms = metadata.fieldPermissions[role];
    const filteredMetadata = JSON.parse(JSON.stringify(metadata));
    
    Object.keys(filteredMetadata.modules).forEach(moduleName => {
      const allowedFields = roleFieldPerms[moduleName];
      if (allowedFields) {
        const moduleObj = filteredMetadata.modules[moduleName];
        moduleObj.fields = moduleObj.fields.filter(f => allowedFields.includes(f.name));
      }
    });
    return res.json(filteredMetadata);
  }

  res.json(metadata);
});

app.post('/api/metadata', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const newMetadata = req.body;
    const oldMetadata = readMetadata();
    
    // 1. Detect chip value renames
    const oldChips = oldMetadata.chips || {};
    const newChips = newMetadata.chips || {};
    const chipRenames = [];

    Object.keys(oldChips).forEach(group => {
      const oldList = oldChips[group] || [];
      const newList = newChips[group] || [];
      const removed = oldList.filter(o => !newList.some(n => n.value === o.value));
      const added = newList.filter(n => !oldList.some(o => o.value === n.value));
      
      if (removed.length === 1 && added.length === 1) {
        chipRenames.push({
          group,
          oldValue: removed[0].value,
          newValue: added[0].value
        });
      }
    });

    // 2. Detect field/column renames
    const fieldRenames = [];
    Object.keys(oldMetadata.modules).forEach(moduleKey => {
      const oldModule = oldMetadata.modules[moduleKey];
      const newModule = newMetadata.modules[moduleKey];
      if (newModule) {
        const oldFields = oldModule.fields || [];
        const newFields = newModule.fields || [];
        
        oldFields.forEach((oldField, idx) => {
          const newField = newFields[idx];
          if (newField && oldField.name !== newField.name) {
            fieldRenames.push({
              moduleKey,
              oldName: oldField.name,
              newName: newField.name
            });
          }
        });
      }
    });

    await runTransaction(async (client) => {
      // Apply column renames in PostgreSQL
      for (const rename of fieldRenames) {
        const { moduleKey, oldName, newName } = rename;
        
        // Rename column in PostgreSQL table
        await client.query(
          `ALTER TABLE "${moduleKey}" RENAME COLUMN "${oldName}" TO "${newName}"`
        );

        // Rename key in in-memory dbCache
        if (dbCache && dbCache[moduleKey]) {
          dbCache[moduleKey].forEach(rec => {
            if (rec[oldName] !== undefined) {
              rec[newName] = rec[oldName];
              delete rec[oldName];
            }
          });
        }
      }

      // Apply chip renames in PostgreSQL
      for (const rename of chipRenames) {
        const { group, oldValue, newValue } = rename;
        
        for (const moduleKey of Object.keys(newMetadata.modules)) {
          const mod = newMetadata.modules[moduleKey];
          const fields = mod.fields || [];
          for (const f of fields) {
            if (f.chipGroup === group) {
              const columnName = f.name;
              
              // 1. Run update query in PostgreSQL case-insensitively
              await client.query(
                `UPDATE "${moduleKey}" SET "${columnName}" = $1 WHERE LOWER("${columnName}") = LOWER($2)`,
                [newValue, oldValue]
              );

              // 2. Update in-memory dbCache case-insensitively
              if (dbCache && dbCache[moduleKey]) {
                dbCache[moduleKey].forEach(rec => {
                  if (rec[columnName] && String(rec[columnName]).toLowerCase() === oldValue.toLowerCase()) {
                    rec[columnName] = newValue;
                  }
                });
              }
            }
          }
        }
      }

      await writeMetadata(newMetadata);
    });

    notifyAllUsers('metadata-updated', { message: 'Metadata schema has been updated.' });
    res.json({ success: true, message: 'Metadata schema saved successfully and database records updated.' });
  } catch (error) {
    console.error('Failed to save metadata or update database records:', error);
    res.status(500).json({ message: 'Failed to write metadata: ' + error.message });
  }
});

// Manual One-Way Incremental Import Route (Sheet -> CRM)
app.post('/api/sync/import-from-sheet', authenticateToken, async (req, res) => {
  try {
    const { module: targetModule } = req.body || {};
    const summary = await syncFromSheetsIncremental(targetModule || null);
    res.json({
      success: true,
      message: `Sync complete! Imported ${summary.added} new row(s) from Google Sheet (${summary.skipped} existing row(s) skipped).`,
      summary
    });
  } catch (err) {
    console.error('Incremental Import Error:', err.message);
    res.status(500).json({ success: false, message: 'Sheet Import Failed: ' + err.message });
  }
});

// Manual Export / Push Route (CRM -> Google Sheet)
app.post('/api/sync/export-to-sheet', authenticateToken, async (req, res) => {
  try {
    const { module: targetModule } = req.body || {};
    const result = await syncToSheetsManual(targetModule || null);
    res.json({
      success: true,
      message: `Push to Sheet complete! Enqueued and exported ${result.count} module(s) to Google Sheets.`,
      result
    });
  } catch (err) {
    console.error('Manual Push Error:', err.message);
    res.status(500).json({ success: false, message: 'Push to Sheet Failed: ' + err.message });
  }
});

// GET all spreadsheet sheet tabs
app.get('/api/sync/sheets', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const config = getSheetsConfig();
    const sheets = await getSpreadsheetSheets(config);
    res.json({ success: true, sheets });
  } catch (err) {
    console.error('Failed to list sheets:', err.message);
    res.status(500).json({ success: false, message: 'Failed to list spreadsheet tabs: ' + err.message });
  }
});

// GET headers from a specific sheet tab
app.get('/api/sync/sheets/:tabName/headers', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const { tabName } = req.params;
    const config = getSheetsConfig();
    const headers = await getSheetHeaders(config, tabName);
    res.json({ success: true, headers });
  } catch (err) {
    console.error('Failed to fetch headers:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch sheet headers: ' + err.message });
  }
});

// POST test mapping validation dry-run
app.post('/api/sync/mappings/test', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const mapping = req.body;
    if (!mapping || !mapping.module || !mapping.sheetName || !mapping.headerMap) {
      return res.status(400).json({ success: false, message: 'Invalid mapping configuration payload.' });
    }
    const config = getSheetsConfig();
    const result = await executeImportWithMapping(config, mapping, true); // dryRun = true
    res.json(result);
  } catch (err) {
    console.error('Mapping test failure:', err.message);
    res.status(500).json({ success: false, message: 'Mapping test simulation failed: ' + err.message });
  }
});

// POST run actual import using mapping configuration
app.post('/api/sync/import-with-mapping', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const mapping = req.body;
    if (!mapping || !mapping.module || !mapping.sheetName || !mapping.headerMap) {
      return res.status(400).json({ success: false, message: 'Invalid mapping configuration payload.' });
    }
    const config = getSheetsConfig();
    const result = await executeImportWithMapping(config, mapping, false); // dryRun = false

    // Synchronize the memory dbCache after successful imports
    if (result.success) {
      const client = await pool.connect();
      try {
        dbCache = await loadTransactionDb(client);
        console.log('Successfully re-synchronized dbCache after mapping import.');
      } finally {
        client.release();
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Import mapping failure:', err.message);
    res.status(500).json({ success: false, message: 'Import with mapping failed: ' + err.message });
  }
});

// --- AUTOMATION TRIGGERS ---

function handleAutomatedPitchLogging(rec, db, req) {
  if (!rec.pitchedPropertyId) return;
  
  db.property_pitch_history = db.property_pitch_history || [];
  
  const custId = rec.customerId || rec.id;
  const cust = (db.customers || []).find(c => String(c.id) === String(custId)) || (db.leads || []).find(l => String(l.id) === String(custId));
  const custName = cust ? (cust.name || cust.person_name || 'Client') : 'Client';
  
  const exists = db.property_pitch_history.some(p => String(p.customerId) === String(custId) && String(p.propertyId) === String(rec.pitchedPropertyId));
  if (!exists) {
    const pitchId = generateNextId(db, 'property_pitch_history', 'PITCH');
    const empName = req.user ? req.user.name : (rec.created_by || 'Sales Executive');
    const newPitch = {
      id: pitchId,
      customerId: custId,
      customerName: custName,
      propertyId: rec.pitchedPropertyId,
      employeeId: rec.assignedEmployeeId || (req.user ? req.user.id : 'EMP-001'),
      employeeName: empName,
      pitchMethod: 'Call',
      interestLevel: 'Interested',
      quotedPrice: Number(rec.pitchPrice || 0),
      remarks: rec.pitchRemarks || 'Automatically logged from lead/follow-up entry.',
      pitchDate: new Date().toLocaleDateString('en-IN')
    };
    db.property_pitch_history.push(newPitch);

    // Automatically update customer / lead pipeline stage/status
    if (cust) {
      if (String(custId).startsWith('LEAD-')) {
        cust.status = 'In-Progress';
      } else {
        cust.stage = 'Interested';
      }
      writeDb(db);
      try {
        if (String(custId).startsWith('LEAD-')) syncToSheets('leads');
        else syncToSheets('customers');
      } catch(e) {}
    }

    // Automatically update active non-approved queries stage to Property Matching
    const queries = (db.queries || []).filter(q => String(q.customerId) === String(custId) && q.status !== 'Approved');
    if (queries.length > 0) {
      queries.forEach(q => {
        q.stage = 'Property Matching';
      });
      writeDb(db);
      try { syncToSheets('queries'); } catch(e) {}
    }
    
    db.activity_logs = db.activity_logs || [];
    db.activity_logs.unshift({
      id: generateUniqueId('LOG'),
      employeeName: empName,
      action: `Automatically logged pitch ${pitchId} for Property ${rec.pitchedPropertyId} matching Client ${custId}`,
      dateTime: new Date().toLocaleString()
    });
  }
}

function handleQueryStageChange(q, db, req) {
  if (!q.id) return;
  const isInventoryAdded = q.queryType === 'Sell Property' && (q.status === 'Approved' || q.stage === 'Inventory Added' || q.stage === 'Available For Sale');
  if (isInventoryAdded) {
    if (q.status === 'Approved' && q.stage !== 'Inventory Added' && q.stage !== 'Available For Sale') {
      q.stage = 'Inventory Added';
    }
    db.properties = db.properties || [];
    const propExists = db.properties.some(p => p.linkedQueryId === q.id);
    if (!propExists) {
      const propId = generateNextId(db, 'properties', 'PROP');
      const cust = (db.customers || []).find(c => String(c.id) === String(q.customerId)) ||
                   (db.leads || []).find(l => String(l.id) === String(q.customerId));
      const ownerName = cust ? (cust.name || cust.person_name) : 'Unknown Owner';
      const ownerPhone = cust ? cust.phone : '';
      
      const newProperty = {
        id: propId,
        status: 'Available',
        date: new Date().toISOString().split('T')[0],
        contact_person_name: ownerName,
        contact_number: ownerPhone,
        dealer_owner_booked: 'Direct',
        r_c_i: q.r_c_i || 'Residential',
        propertyType: q.propertyType || 'Villa',
        locality: q.locality || '',
        sector_block: q.sector_block || '',
        address_number: '',
        size: q.size || '',
        demand: q.demand || '',
        linkedQueryId: q.id,
        current_owner_id: q.customerId,
        owner_history: [],
        timeline: [
          {
            date: new Date().toLocaleDateString('en-IN'),
            event: 'Property Added to Inventory',
            details: `Property Added to Inventory — Automatically created from Sell Property Query ${q.id}.`
          }
        ]
      };
      db.properties.push(newProperty);
      
      if (q.assignedEmployeeId) {
        setTimeout(() => {
          notifyUser(q.assignedEmployeeId, 'new-property-matched', {
            propertyId: propId,
            message: `Property ${propId} added automatically from Sell Query ${q.id}.`
          });
        }, 500);
      }
      
      db.activity_logs = db.activity_logs || [];
      db.activity_logs.unshift({
        id: generateUniqueId('LOG'),
        employeeName: req.user ? req.user.name : 'System',
        action: `Automatically created Property ${propId} in inventory from Query ${q.id}`,
        dateTime: new Date().toLocaleString()
      });
      
      writeDb(db);
      try { syncToSheets('properties'); } catch(e) {}
    }
  }
}

function handleDealerCallInsertion(c, db) {
  if (!c.dealerId) return;
  db.dealers = db.dealers || [];
  const dealer = db.dealers.find(d => String(d.id) === String(c.dealerId));
  if (dealer) {
    dealer.remarks = c.remarks || '';
    dealer.callOutcome = c.callOutcome || '';
    // Automatically trigger sync to dealers sheet
    writeDb(db);
    try { syncToSheets('dealers'); } catch(e) {}
  }
}

function handleDealerVisitAssignment(payload, db, req, oldPayload = null) {
  if (payload.assignedEmployeeId) {
    const hasChanged = !oldPayload || String(oldPayload.assignedEmployeeId) !== String(payload.assignedEmployeeId);
    if (hasChanged) {
      payload.visitStatus = payload.visitStatus || 'Assigned';
      
      // Notify the employee
      setTimeout(() => {
        notifyUser(payload.assignedEmployeeId, 'visit-assigned', {
          visitId: payload.id,
          message: `New Dealer Visit Assigned: ${payload.person_name || 'Dealer'} (${payload.firm_name || 'No Firm'})`
        });
      }, 500);

      // Create an activity log
      db.activity_logs = db.activity_logs || [];
      db.activity_logs.unshift({
        id: generateUniqueId('LOG'),
        employeeName: req.user ? req.user.name : 'System',
        action: `Assigned Dealer ${payload.id} to Employee ${payload.assignedEmployeeId} for a visit`,
        dateTime: new Date().toLocaleString()
      });
    }
  }
}

async function convertLeadToCustomer(leadId, dbOrClient, remarks = '') {
  if (!leadId || !leadId.startsWith('LEAD-')) return null;

  const isOuterTransaction = !!dbOrClient;
  const client = dbOrClient || (await pool.connect());
  
  if (!isOuterTransaction) {
    await client.query('BEGIN');
  }

  try {
    const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    const lead = leadRes.rows[0];
    if (!lead) {
      if (!isOuterTransaction) await client.query('ROLLBACK');
      return null;
    }

    const cleanPhone = String(lead.phone || '').trim();
    const custRes = await client.query('SELECT * FROM customers WHERE phone = $1', [cleanPhone]);
    let existingCust = custRes.rows[0];

    const cacheMutations = [];

    if (!existingCust) {
      const custId = await generateNextIdAsync(client, 'customers');
      const newCust = {
        id: custId,
        leadId: leadId,
        name: lead.name,
        email: lead.email || '',
        phone: lead.phone,
        stage: 'Converted Buyer Deal Closed',
        assignedEmployeeId: lead.assignedEmployeeId || 'EMP-001',
        budget: lead.budget || '',
        city: lead.locality || '',
        requirements: lead.remarks || remarks || `Converted from Lead ${leadId}`,
        dateAdded: new Date().toISOString().split('T')[0]
      };
      
      const insertedCust = await insertRecord('customers', newCust, client);
      existingCust = insertedCust;

      cacheMutations.push(() => {
        if (dbCache) {
          if (!dbCache.customers) dbCache.customers = [];
          dbCache.customers.push(insertedCust);
        }
      });
    }

    await updateRecord('leads', leadId, { status: 'Converted' }, client);
    cacheMutations.push(() => {
      if (dbCache && dbCache.leads) {
        const cachedLead = dbCache.leads.find(l => String(l.id) === String(leadId));
        if (cachedLead) cachedLead.status = 'Converted';
      }
    });

    const newCustId = existingCust.id;

    await client.query('UPDATE follow_ups SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);
    cacheMutations.push(() => {
      if (dbCache && dbCache.follow_ups) {
        dbCache.follow_ups.forEach(f => {
          if (String(f.customerId) === String(leadId)) f.customerId = newCustId;
        });
      }
    });

    await client.query('UPDATE queries SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);
    cacheMutations.push(() => {
      if (dbCache && dbCache.queries) {
        dbCache.queries.forEach(q => {
          if (String(q.customerId) === String(leadId)) q.customerId = newCustId;
        });
      }
    });

    await client.query('UPDATE site_visits SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);
    cacheMutations.push(() => {
      if (dbCache && dbCache.site_visits) {
        dbCache.site_visits.forEach(sv => {
          if (String(sv.customerId) === String(leadId)) sv.customerId = newCustId;
        });
      }
    });

    await client.query('UPDATE sales SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);
    cacheMutations.push(() => {
      if (dbCache && dbCache.sales) {
        dbCache.sales.forEach(s => {
          if (String(s.customerId) === String(leadId)) s.customerId = newCustId;
        });
      }
    });

    await client.query('UPDATE property_pitch_history SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);
    cacheMutations.push(() => {
      if (dbCache && dbCache.property_pitch_history) {
        dbCache.property_pitch_history.forEach(p => {
          if (String(p.customerId) === String(leadId)) p.customerId = newCustId;
        });
      }
    });

    await client.query('UPDATE properties SET current_owner_id = $1 WHERE current_owner_id = $2', [newCustId, leadId]);
    cacheMutations.push(() => {
      if (dbCache && dbCache.properties) {
        dbCache.properties.forEach(p => {
          if (String(p.current_owner_id) === String(leadId)) p.current_owner_id = newCustId;
        });
      }
    });

    if (!isOuterTransaction) {
      await client.query('COMMIT');
    }

    cacheMutations.forEach(mutate => mutate());

    try { syncToSheets('customers'); } catch(e) {}
    try { syncToSheets('leads'); } catch(e) {}
    try { syncToSheets('follow_ups'); } catch(e) {}
    try { syncToSheets('queries'); } catch(e) {}
    try { syncToSheets('site_visits'); } catch(e) {}
    try { syncToSheets('sales'); } catch(e) {}
    try { syncToSheets('property_pitch_history'); } catch(e) {}
    try { syncToSheets('properties'); } catch(e) {}

    return existingCust;
  } catch (err) {
    if (!isOuterTransaction) {
      await client.query('ROLLBACK');
    }
    throw err;
  } finally {
    if (!isOuterTransaction) {
      client.release();
    }
  }
}

async function handleDealStatusChange(d, dbOrClient, req, cacheMutations) {
  if (!d.id || d.status !== 'Closed') return;
  
  const client = dbOrClient || pool;
  
  if (d.customerId && String(d.customerId).startsWith('LEAD-')) {
    const cust = await convertLeadToCustomer(d.customerId, client, `Converted via Closed Deal ${d.id}`);
    if (cust) {
      d.customerId = cust.id;
    }
  }

  const propRes = await client.query('SELECT * FROM properties WHERE id = $1', [d.propertyId]);
  const prop = propRes.rows[0];
  if (prop) {
    const prevOwnerId = prop.current_owner_id || d.sellerCustomerId || '';
    const prevOwnerName = prop.contact_person_name || '';
    
    let buyerName = d.customerId || 'Unknown';
    const buyerRes = await client.query('SELECT name FROM customers WHERE id = $1', [d.customerId]);
    if (buyerRes.rows[0]) {
      buyerName = buyerRes.rows[0].name;
    }
    
    let empName = 'Unknown Employee';
    const empRes = await client.query('SELECT name FROM employees WHERE id = $1', [d.employeeId]);
    if (empRes.rows[0]) {
      empName = empRes.rows[0].name;
    }
    
    const ownerHistory = prop.owner_history || [];
    if (prevOwnerId || prevOwnerName) {
      const hasHistory = ownerHistory.some(h => String(h.dealId) === String(d.id));
      if (!hasHistory) {
        ownerHistory.push({
          dealId: d.id,
          ownerId: prevOwnerId || 'N/A',
          ownerName: prevOwnerName || 'Previous Owner',
          purchaseDate: prop.date || '',
          purchasePrice: prop.demand || '',
          saleDate: d.registrationDate || new Date().toISOString().split('T')[0],
          salePrice: d.purchasePrice || '',
          soldByEmployeeId: d.employeeId || '',
          soldByEmployeeName: empName
        });
      }
    }
    
    const ownershipDocuments = prop.ownership_documents || { old_owner: [], new_owner: [] };
    if (ownershipDocuments.new_owner && ownershipDocuments.new_owner.length > 0) {
      ownershipDocuments.old_owner = [
        ...(ownershipDocuments.old_owner || []),
        ...ownershipDocuments.new_owner
      ];
    }
    
    ownershipDocuments.new_owner = [];
    if (d.documents) {
      ownershipDocuments.new_owner = Array.isArray(d.documents) 
        ? d.documents 
        : [d.documents];
    }
    
    const timeline = prop.timeline || [];
    timeline.push({
      date: new Date().toLocaleDateString('en-IN'),
      event: 'Ownership Changed (Deal Closed)',
      details: `Sold by ${prevOwnerName || 'Unknown'} to ${buyerName} for ₹${d.purchasePrice} (Closed by Employee: ${empName})`
    });
    
    await client.query(
      'UPDATE properties SET current_owner_id = $1, status = $2, ownership_documents = $3, owner_history = $4, timeline = $5 WHERE id = $6',
      [d.customerId, 'Property Registered/Sold Out', JSON.stringify(ownershipDocuments), JSON.stringify(ownerHistory), JSON.stringify(timeline), d.propertyId]
    );

    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.properties) {
          const pIdx = dbCache.properties.findIndex(x => String(x.id) === String(d.propertyId));
          if (pIdx !== -1) {
            dbCache.properties[pIdx] = {
              ...dbCache.properties[pIdx],
              current_owner_id: d.customerId,
              status: 'Property Registered/Sold Out',
              ownership_documents: ownershipDocuments,
              owner_history: ownerHistory,
              timeline: timeline
            };
          }
        }
      });
    }
    
    if (d.employeeId) {
      setTimeout(() => {
        notifyUser(d.employeeId, 'deal-closed-notif', {
          dealId: d.id,
          message: `Deal ${d.id} for Property ${d.propertyId} has been closed and ownership updated.`
        });
      }, 500);
    }
    
    const log = {
      id: generateUniqueId('LOG'),
      employeeName: req.user ? req.user.name : 'System',
      action: `Deal ${d.id} closed. Ownership of Property ${d.propertyId} transferred to Customer ${d.customerId}.`,
      dateTime: new Date().toLocaleString()
    };
    await insertRecord('activity_logs', log, client);
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }
      });
    }
    
    try { syncToSheets('properties'); } catch(e) {}
  }
}


function parsePriceToNumeric(priceStr) {
  if (!priceStr) return 0;
  if (typeof priceStr === 'number') return priceStr;
  let clean = String(priceStr).toLowerCase().replace(/,/g, '').trim();
  
  let multiplier = 1;
  if (clean.includes('cr') || clean.includes('crore')) {
    multiplier = 10000000;
    clean = clean.replace(/(cr|crore)/g, '');
  } else if (clean.includes('lakh') || clean.includes('lac') || clean.includes('l')) {
    multiplier = 100000;
    clean = clean.replace(/(lakh|lac|l)/g, '');
  } else if (clean.includes('k')) {
    multiplier = 1000;
    clean = clean.replace(/k/g, '');
  }
  const match = clean.match(/[0-9.]+/);
  if (!match) return 0;
  const parsed = parseFloat(match[0]);
  return isNaN(parsed) ? 0 : parsed * multiplier;
}

async function handlePitchStatusChange(p, dbOrClient, req, cacheMutations) {
  if (!p.id) return;
  const client = dbOrClient || pool;

  if (p.propertyId && p.propertyStatus) {
    await client.query('UPDATE properties SET status = $1 WHERE id = $2', [p.propertyStatus, p.propertyId]);
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.properties) {
          const idx = dbCache.properties.findIndex(pr => String(pr.id) === String(p.propertyId));
          if (idx !== -1) {
            dbCache.properties[idx].status = p.propertyStatus;
          }
        }
      });
    }
  }

  // Auto-complete call follow-up if pitched via call
  if (p.pitchMethod === 'Call') {
    await client.query(
      `UPDATE follow_ups SET status = $1, remarks = concat(remarks, $2::text) WHERE "customerId" = $3 AND status <> $4`,
      ['Completed', `\n[System: Auto-completed call follow-up via logged Call Pitch ${p.id}]`, p.customerId, 'Completed']
    );
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.follow_ups) {
          dbCache.follow_ups.forEach(f => {
            if (String(f.customerId) === String(p.customerId) && f.status !== 'Completed') {
              f.status = 'Completed';
              f.remarks = (f.remarks || '') + `\n[System: Auto-completed call follow-up via logged Call Pitch ${p.id}]`;
            }
          });
        }
      });
    }
  }

  // Auto-update follow-up and query pipeline stage matching keywords/meanings
  const mapPitchStatusToPipelineAction = (statusVal) => {
    if (!statusVal) return null;
    const s = String(statusVal).toLowerCase().trim();
    if (s.includes('closed') || s.includes('won') || s.includes('sold out')) return 'Closed';
    if (s.includes('visit') || s.includes('showing') || s.includes('scheduled')) return 'Site Visit';
    if (s.includes('negotiation') || s.includes('token') || s.includes('part payment') || s.includes('agreement') || s.includes('noc')) return 'Negotiation';
    if (s.includes('interested')) return 'Interested';
    if (s.includes('pitched') || s.includes('offered')) return 'Contacted';
    if (s.includes('rejected') || s.includes('lost') || s.includes('no interest')) return 'Lost';
    return null;
  };

  const mappedStage = mapPitchStatusToPipelineAction(p.status) || mapPitchStatusToPipelineAction(p.propertyStatus) || 'Contacted';
  
  if (p.linkedFollowUpId) {
    const fRes = await client.query('SELECT * FROM follow_ups WHERE id = $1', [p.linkedFollowUpId]);
    const targetF = fRes.rows[0];
    if (targetF) {
      targetF.pipelineAction = mappedStage;
      targetF.pitchedPropertyId = p.propertyId || targetF.pitchedPropertyId;
      targetF.pitchPrice = p.quotedPrice || targetF.pitchPrice;
      targetF.pitchRemarks = p.remarks || targetF.pitchRemarks;
      
      const updatedF = await updateRecord('follow_ups', targetF.id, {
        pipelineAction: targetF.pipelineAction,
        pitchedPropertyId: targetF.pitchedPropertyId,
        pitchPrice: targetF.pitchPrice,
        pitchRemarks: targetF.pitchRemarks
      }, client);

      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.follow_ups) {
            const idx = dbCache.follow_ups.findIndex(f => String(f.id) === String(p.linkedFollowUpId));
            if (idx !== -1) {
              dbCache.follow_ups[idx] = updatedF;
            }
          }
        });
      }

      await handleFollowUpPipelineAction(updatedF, client, req, cacheMutations);

      if (targetF.queryId) {
        const qStatus = mappedStage === 'Closed' ? 'Closed' : undefined;
        const updates = { stage: mappedStage };
        if (qStatus) updates.status = qStatus;
        
        const updatedQ = await updateRecord('queries', targetF.queryId, updates, client);
        if (cacheMutations) {
          cacheMutations.push(() => {
            if (dbCache && dbCache.queries) {
              const idx = dbCache.queries.findIndex(q => String(q.id) === String(targetF.queryId));
              if (idx !== -1) {
                dbCache.queries[idx] = updatedQ;
              }
            }
          });
        }
      }
    }
  } else if (p.linkedQueryId) {
    const qStatus = mappedStage === 'Closed' ? 'Closed' : undefined;
    const updates = { stage: mappedStage };
    if (qStatus) updates.status = qStatus;

    const updatedQ = await updateRecord('queries', p.linkedQueryId, updates, client);
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.queries) {
          const idx = dbCache.queries.findIndex(q => String(q.id) === String(p.linkedQueryId));
          if (idx !== -1) {
            dbCache.queries[idx] = updatedQ;
          }
        }
      });
    }

    const fupRes = await client.query('SELECT * FROM follow_ups WHERE "queryId" = $1', [p.linkedQueryId]);
    for (const f of fupRes.rows) {
      if (f.status !== 'Completed' && f.status !== 'Call Done') {
        const updatedF = await updateRecord('follow_ups', f.id, {
          pipelineAction: mappedStage,
          pitchedPropertyId: p.propertyId || f.pitchedPropertyId,
          pitchPrice: p.quotedPrice || f.pitchPrice,
          pitchRemarks: p.remarks || f.pitchRemarks
        }, client);
        if (cacheMutations) {
          cacheMutations.push(() => {
            if (dbCache && dbCache.follow_ups) {
              const idx = dbCache.follow_ups.findIndex(x => String(x.id) === String(f.id));
              if (idx !== -1) dbCache.follow_ups[idx] = updatedF;
            }
          });
        }
        await handleFollowUpPipelineAction(updatedF, client, req, cacheMutations);
      }
    }
  } else {
    // Fallback: match by customerId
    const fupRes = await client.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [p.customerId]);
    for (const f of fupRes.rows) {
      if (f.status !== 'Completed' && f.status !== 'Call Done') {
        const updatedF = await updateRecord('follow_ups', f.id, {
          pipelineAction: mappedStage,
          pitchedPropertyId: p.propertyId || f.pitchedPropertyId,
          pitchPrice: p.quotedPrice || f.pitchPrice,
          pitchRemarks: p.remarks || f.pitchRemarks
        }, client);
        if (cacheMutations) {
          cacheMutations.push(() => {
            if (dbCache && dbCache.follow_ups) {
              const idx = dbCache.follow_ups.findIndex(x => String(x.id) === String(f.id));
              if (idx !== -1) dbCache.follow_ups[idx] = updatedF;
            }
          });
        }
        await handleFollowUpPipelineAction(updatedF, client, req, cacheMutations);
      }
    }

    const qRes = await client.query('SELECT * FROM queries WHERE "customerId" = $1', [p.customerId]);
    for (const q of qRes.rows) {
      const qStatus = mappedStage === 'Closed' ? 'Closed' : undefined;
      const updates = { stage: mappedStage };
      if (qStatus) updates.status = qStatus;

      const updatedQ = await updateRecord('queries', q.id, updates, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.queries) {
            const idx = dbCache.queries.findIndex(x => String(x.id) === String(q.id));
            if (idx !== -1) dbCache.queries[idx] = updatedQ;
          }
        });
      }
    }
  }

  // Sync to site_visits directly
  const isSiteVisitStage = mappedStage === 'Site Visit';
  if (isSiteVisitStage) {
    const targetDate = formatToInDate(p.followUpDate || p.pitchDate);
    const visitRes = await client.query(
      'SELECT * FROM site_visits WHERE "linkedPitchId" = $1 OR ("customerId" = $2 AND "propertyId" = $3 AND date = $4)',
      [p.id, p.customerId, p.propertyId || 'PROP-001', targetDate]
    );
    const existingVisit = visitRes.rows[0];

    if (existingVisit) {
      const updatedVisit = await updateRecord('site_visits', existingVisit.id, {
        linkedPitchId: p.id,
        date: targetDate,
        propertyId: p.propertyId,
        employeeId: p.employeeId || existingVisit.employeeId,
        remarks: p.remarks || existingVisit.remarks
      }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.site_visits) {
            const idx = dbCache.site_visits.findIndex(sv => String(sv.id) === String(existingVisit.id));
            if (idx !== -1) dbCache.site_visits[idx] = updatedVisit;
          }
        });
      }
    } else {
      const visitId = await generateNextIdAsync(client, 'site_visits');
      const newVisit = {
        id: visitId,
        customerId: p.customerId,
        propertyId: p.propertyId || 'PROP-001',
        employeeId: p.employeeId || 'EMP-001',
        date: targetDate,
        time: '12:00 PM',
        result: 'Scheduled',
        remarks: p.remarks || `Automatically created from Pitch ${p.id} stage: ${p.status}.`,
        linkedPitchId: p.id
      };
      const insertedVisit = await insertRecord('site_visits', newVisit, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache) {
            if (!dbCache.site_visits) dbCache.site_visits = [];
            dbCache.site_visits.push(insertedVisit);
          }
        });
      }
    }
  } else {
    await client.query('DELETE FROM site_visits WHERE "linkedPitchId" = $1', [p.id]);
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.site_visits) {
          dbCache.site_visits = dbCache.site_visits.filter(sv => sv.linkedPitchId !== p.id);
        }
      });
    }
  }

  const isDealClosed = p.status === 'Deal Closed' || 
                       p.status === 'Property Registered/Sold Out' || 
                       p.propertyStatus === 'Property Registered/Sold Out';

  if (!isDealClosed) return;

  // Convert Lead to Customer if Pitch closed for a Lead ID
  let finalCustomerId = p.customerId;
  if (p.customerId && String(p.customerId).startsWith('LEAD-')) {
    const cust = await convertLeadToCustomer(p.customerId, client, `Converted via Closed Pitch ${p.id}`);
    if (cust) {
      p.customerId = cust.id;
      finalCustomerId = cust.id;
    }
  }

  // Create or retrieve corresponding Deal record
  const dealRes = await client.query(
    'SELECT * FROM deals WHERE "propertyId" = $1 AND "customerId" = $2',
    [p.propertyId, finalCustomerId]
  );
  let existingDeal = dealRes.rows[0];

  if (!existingDeal) {
    const dealId = await generateNextIdAsync(client, 'deals');
    const propRes = await client.query('SELECT demand, current_owner_id FROM properties WHERE id = $1', [p.propertyId]);
    const prop = propRes.rows[0];
    const sellerId = prop ? (prop.current_owner_id || '') : '';
    const finalPrice = p.closingPrice || p.quotedPrice || '';

    existingDeal = {
      id: dealId,
      customerId: finalCustomerId,
      sellerCustomerId: sellerId || finalCustomerId,
      propertyId: p.propertyId,
      employeeId: p.employeeId || 'EMP-001',
      registrationDate: new Date().toISOString().split('T')[0],
      purchasePrice: finalPrice || (prop ? (prop.demand || '') : ''),
      brokerage: '',
      commission: '',
      status: 'Closed',
      associatedPitchId: p.id
    };
    
    const insertedDeal = await insertRecord('deals', existingDeal, client);
    existingDeal = insertedDeal;

    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache) {
          if (!dbCache.deals) dbCache.deals = [];
          dbCache.deals.push(insertedDeal);
        }
      });
    }
  } else {
    let updated = false;
    const updates = {};
    if (!existingDeal.associatedPitchId) {
      updates.associatedPitchId = p.id;
      updated = true;
    }
    if (!existingDeal.sellerCustomerId) {
      const propRes = await client.query('SELECT current_owner_id FROM properties WHERE id = $1', [p.propertyId]);
      const prop = propRes.rows[0];
      const sellerId = prop ? (prop.current_owner_id || '') : '';
      updates.sellerCustomerId = sellerId || finalCustomerId;
      updated = true;
    }
    if (updated) {
      const updatedDeal = await updateRecord('deals', existingDeal.id, updates, client);
      existingDeal = updatedDeal;
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.deals) {
            const idx = dbCache.deals.findIndex(d => String(d.id) === String(existingDeal.id));
            if (idx !== -1) dbCache.deals[idx] = updatedDeal;
          }
        });
      }
    }
  }

  // Invoke the master deal status change helper
  await handleDealStatusChange(existingDeal, client, req, cacheMutations);

  // Auto convert follow-ups for this client to Call Done / Closed
  await client.query(
    'UPDATE follow_ups SET status = $1, "pipelineAction" = $2 WHERE "customerId" = $3 OR "customerId" = $4',
    ['Call Done', 'Property Registered/Sold Out', p.customerId, finalCustomerId]
  );
  if (cacheMutations) {
    cacheMutations.push(() => {
      if (dbCache && dbCache.follow_ups) {
        dbCache.follow_ups.forEach(f => {
          if (String(f.customerId) === String(p.customerId) || String(f.customerId) === String(finalCustomerId)) {
            f.status = 'Call Done';
            f.pipelineAction = 'Property Registered/Sold Out';
          }
        });
      }
    });
  }
}

async function handleLeadStatusChange(lead, dbOrClient, req, cacheMutations) {
  if (lead.leadType === 'Seller') {
    const client = dbOrClient || pool;
    const cleanPhone = String(lead.phone || '').trim();
    
    let custRes;
    if (lead.id) {
      custRes = await client.query('SELECT * FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\')', [lead.id, cleanPhone]);
    } else {
      custRes = await client.query('SELECT * FROM customers WHERE phone = $1 AND $1 <> \'\'', [cleanPhone]);
    }
    let existingCust = custRes.rows[0];
    const leadDemand = lead.demand || lead.budget || '';

    if (!existingCust) {
      const custId = await generateNextIdAsync(client, 'customers');
      existingCust = {
        id: custId,
        leadId: lead.id,
        name: lead.name,
        email: lead.email || '',
        phone: lead.phone,
        stage: 'Active Seller',
        assignedEmployeeId: lead.assignedEmployeeId || 'EMP-001',
        budget: leadDemand,
        city: lead.locality || '',
        requirements: lead.remarks || 'Converted direct property seller.',
        dateAdded: new Date().toISOString().split('T')[0]
      };
      const insertedCust = await insertRecord('customers', existingCust, client);
      existingCust = insertedCust;

      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache) {
            if (!dbCache.customers) dbCache.customers = [];
            dbCache.customers.push(insertedCust);
          }
        });
      }
    } else {
      const updatedCust = await updateRecord('customers', existingCust.id, {
        budget: leadDemand,
        city: lead.locality || existingCust.city || ''
      }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.customers) {
            const idx = dbCache.customers.findIndex(x => String(x.id) === String(existingCust.id));
            if (idx !== -1) dbCache.customers[idx] = updatedCust;
          }
        });
      }
    }

    let existingProp = null;
    if (lead.propertyId) {
      const propRes = await client.query('SELECT * FROM properties WHERE id = $1', [lead.propertyId]);
      existingProp = propRes.rows[0];
    }
    if (!existingProp) {
      const propRes = await client.query('SELECT * FROM properties WHERE "linkedLeadId" = $1 OR "booked_by_customer_id" = $2', [lead.id, existingCust.id]);
      existingProp = propRes.rows[0];
    }

    if (existingProp) {
      const updatedProp = await updateRecord('properties', existingProp.id, {
        current_owner_id: existingCust.id,
        booked_by_customer_id: existingCust.id,
        linkedLeadId: lead.id,
        demand: leadDemand || existingProp.demand || '',
        locality: lead.locality || existingProp.locality || '',
        sector_block: lead.sector_block || existingProp.sector_block || '',
        size: lead.size || existingProp.size || '',
        propertyType: lead.propertyType || existingProp.propertyType || '',
        r_c_i: lead.r_c_i || existingProp.r_c_i || 'Residential'
      }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.properties) {
            const idx = dbCache.properties.findIndex(x => String(x.id) === String(existingProp.id));
            if (idx !== -1) dbCache.properties[idx] = updatedProp;
          }
        });
      }
    } else {
      const propId = await generateNextIdAsync(client, 'properties');
      const newProp = {
        id: propId,
        linkedLeadId: lead.id,
        status: 'Available',
        date: new Date().toLocaleDateString('en-IN'),
        contact_person_name: lead.name,
        contact_number: lead.phone,
        dealer_owner_booked: 'Direct',
        booked_by_customer_id: existingCust.id,
        current_owner_id: existingCust.id,
        r_c_i: lead.r_c_i || 'Residential',
        propertyType: lead.propertyType || '',
        locality: lead.locality || '',
        sector_block: lead.sector_block || '',
        size: lead.size || '',
        demand: leadDemand,
        lead_source: lead.source || 'Direct',
        initial_notes: lead.remarks || 'Auto-created from seller lead'
      };
      const insertedProp = await insertRecord('properties', newProp, client);
      lead.propertyId = propId;
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache) {
            if (!dbCache.properties) dbCache.properties = [];
            dbCache.properties.push(insertedProp);
          }
        });
      }
    }
  }
}

async function syncPropertyDetailsUniversally(propId, dbOrClient, cacheMutations) {
  const client = dbOrClient || pool;
  const propRes = await client.query('SELECT * FROM properties WHERE id = $1', [propId]);
  const prop = propRes.rows[0];
  if (!prop) return;

  const fieldsToSync = {
    r_c_i: prop.r_c_i || '',
    propertyType: prop.propertyType || '',
    locality: prop.locality || '',
    sector_block: prop.sector_block || '',
    size: prop.size || '',
    demand: prop.demand || ''
  };

  await client.query(
    'UPDATE leads SET r_c_i = $1, "propertyType" = $2, locality = $3, sector_block = $4, size = $5, demand = $6, budget = $6 WHERE "propertyId" = $7 OR id = $8',
    [fieldsToSync.r_c_i, fieldsToSync.propertyType, fieldsToSync.locality, fieldsToSync.sector_block, fieldsToSync.size, fieldsToSync.demand, propId, prop.linkedLeadId]
  );
  if (cacheMutations) {
    cacheMutations.push(() => {
      if (dbCache && dbCache.leads) {
        dbCache.leads.forEach(l => {
          if (String(l.propertyId) === String(propId) || String(l.id) === String(prop.linkedLeadId)) {
            l.r_c_i = fieldsToSync.r_c_i;
            l.propertyType = fieldsToSync.propertyType;
            l.locality = fieldsToSync.locality;
            l.sector_block = fieldsToSync.sector_block;
            l.size = fieldsToSync.size;
            l.demand = fieldsToSync.demand;
            l.budget = fieldsToSync.demand;
          }
        });
      }
    });
  }

  await client.query(
    'UPDATE customers SET city = $1, budget = $2 WHERE id = $3 OR id = $4',
    [fieldsToSync.locality, fieldsToSync.demand, prop.current_owner_id, prop.booked_by_customer_id]
  );
  if (cacheMutations) {
    cacheMutations.push(() => {
      if (dbCache && dbCache.customers) {
        dbCache.customers.forEach(c => {
          if (String(c.id) === String(prop.current_owner_id) || String(c.id) === String(prop.booked_by_customer_id)) {
            c.city = fieldsToSync.locality;
            c.budget = fieldsToSync.demand;
          }
        });
      }
    });
  }

  await client.query(
    'UPDATE queries SET r_c_i = $1, "propertyType" = $2, locality = $3, sector_block = $4, size = $5, demand = $6, budget = $6 WHERE "propertyId" = $7',
    [fieldsToSync.r_c_i, fieldsToSync.propertyType, fieldsToSync.locality, fieldsToSync.sector_block, fieldsToSync.size, fieldsToSync.demand, propId]
  );
  if (cacheMutations) {
    cacheMutations.push(() => {
      if (dbCache && dbCache.queries) {
        dbCache.queries.forEach(q => {
          if (String(q.propertyId) === String(propId)) {
            q.r_c_i = fieldsToSync.r_c_i;
            q.propertyType = fieldsToSync.propertyType;
            q.locality = fieldsToSync.locality;
            q.sector_block = fieldsToSync.sector_block;
            q.size = fieldsToSync.size;
            q.demand = fieldsToSync.demand;
            q.budget = fieldsToSync.demand;
          }
        });
      }
    });
  }

  await client.query(
    'UPDATE follow_ups SET "pitchPrice" = $1 WHERE "pitchedPropertyId" = $2',
    [fieldsToSync.demand, propId]
  );
  if (cacheMutations) {
    cacheMutations.push(() => {
      if (dbCache && dbCache.follow_ups) {
        dbCache.follow_ups.forEach(f => {
          if (String(f.pitchedPropertyId) === String(propId)) {
            f.pitchPrice = fieldsToSync.demand;
          }
        });
      }
    });
  }
}

async function syncAssignedEmployeeUniversally(sourceModule, recordId, newEmployeeId, dbOrClient, cacheMutations) {
  if (!newEmployeeId) return;

  const client = dbOrClient || pool;
  let lead = null;
  let customer = null;
  
  if (sourceModule === 'leads') {
    const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [recordId]);
    lead = leadRes.rows[0];
    if (lead) {
      const custRes = await client.query('SELECT * FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\')', [lead.id, lead.phone]);
      customer = custRes.rows[0];
    }
  } else if (sourceModule === 'customers') {
    const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [recordId]);
    customer = custRes.rows[0];
    if (customer) {
      const leadRes = await client.query('SELECT * FROM leads WHERE id = $1 OR (phone = $2 AND $2 <> \'\')', [customer.leadId, customer.phone]);
      lead = leadRes.rows[0];
    }
  } else if (sourceModule === 'follow_ups') {
    const fupRes = await client.query('SELECT "customerId" FROM follow_ups WHERE id = $1', [recordId]);
    const fup = fupRes.rows[0];
    if (fup) {
      const targetId = fup.customerId;
      if (targetId.startsWith('LEAD-')) {
        const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [targetId]);
        lead = leadRes.rows[0];
        if (lead) {
          const custRes = await client.query('SELECT * FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\')', [lead.id, lead.phone]);
          customer = custRes.rows[0];
        }
      } else if (targetId.startsWith('CUST-')) {
        const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [targetId]);
        customer = custRes.rows[0];
        if (customer) {
          const leadRes = await client.query('SELECT * FROM leads WHERE id = $1 OR (phone = $2 AND $2 <> \'\')', [customer.leadId, customer.phone]);
          lead = leadRes.rows[0];
        }
      }
    }
  }

  const leadId = lead ? lead.id : '';
  const custId = customer ? customer.id : '';
  const phones = [];
  if (lead && lead.phone) phones.push(lead.phone.trim());
  if (customer && customer.phone) phones.push(customer.phone.trim());
  
  if (!leadId && !custId && phones.length === 0) return;

  if (leadId || phones.length > 0) {
    await client.query(
      'UPDATE leads SET "assignedEmployeeId" = $1 WHERE id = $2 OR (phone = ANY($3) AND $3 <> \'{}\')',
      [newEmployeeId, leadId, phones]
    );
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.leads) {
          dbCache.leads.forEach(l => {
            if (l.id === leadId || (l.phone && phones.includes(String(l.phone).trim()))) {
              l.assignedEmployeeId = newEmployeeId;
            }
          });
        }
      });
    }
  }

  if (custId || leadId || phones.length > 0) {
    await client.query(
      'UPDATE customers SET "assignedEmployeeId" = $1 WHERE id = $2 OR "leadId" = $3 OR (phone = ANY($4) AND $4 <> \'{}\')',
      [newEmployeeId, custId, leadId, phones]
    );
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.customers) {
          dbCache.customers.forEach(c => {
            if (c.id === custId || c.leadId === leadId || (c.phone && phones.includes(String(c.phone).trim()))) {
              c.assignedEmployeeId = newEmployeeId;
            }
          });
        }
      });
    }
  }

  if (custId || leadId) {
    await client.query(
      'UPDATE follow_ups SET "employeeId" = $1 WHERE "customerId" = $2 OR "customerId" = $3',
      [newEmployeeId, custId, leadId]
    );
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.follow_ups) {
          dbCache.follow_ups.forEach(f => {
            if (f.customerId === custId || f.customerId === leadId) {
              f.employeeId = newEmployeeId;
            }
          });
        }
      });
    }
  }

  if (custId || leadId) {
    await client.query(
      'UPDATE queries SET "assignedEmployeeId" = $1 WHERE "customerId" = $2 OR "customerId" = $3',
      [newEmployeeId, custId, leadId]
    );
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.queries) {
          dbCache.queries.forEach(q => {
            if (q.customerId === custId || q.customerId === leadId) {
              q.assignedEmployeeId = newEmployeeId;
            }
          });
        }
      });
    }
  }

  if (custId || leadId) {
    await client.query(
      'UPDATE site_visits SET "employeeId" = $1 WHERE "customerId" = $2 OR "customerId" = $3',
      [newEmployeeId, custId, leadId]
    );
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.site_visits) {
          dbCache.site_visits.forEach(s => {
            if (s.customerId === custId || s.customerId === leadId) {
              s.employeeId = newEmployeeId;
            }
          });
        }
      });
    }
  }
}

async function handleFollowUpPipelineAction(f, dbOrClient, req, cacheMutations) {
  if (!f.pipelineAction) return;

  const action = f.pipelineAction;
  const customerId = f.customerId; 
  const queryId = f.queryId;
  const client = dbOrClient || pool;

  const isSiteVisitStage = action === 'Site Visit Arranged' || action === 'Site Visit' || action === 'Site Visit Scheduled' || action === 'Lead_VisitScheduled';
  if (isSiteVisitStage) {
    const visitRes = await client.query(
      'SELECT * FROM site_visits WHERE "linkedFollowUpId" = $1 OR ("customerId" = $2 AND "propertyId" = $3 AND date = $4)',
      [f.id, customerId, f.pitchedPropertyId || 'PROP-001', f.date || new Date().toLocaleDateString('en-IN')]
    );
    const existingVisit = visitRes.rows[0];
    
    if (existingVisit) {
      const updatedVisit = await updateRecord('site_visits', existingVisit.id, {
        date: f.date || existingVisit.date,
        propertyId: f.pitchedPropertyId || 'PROP-001',
        employeeId: f.employeeId || existingVisit.employeeId
      }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.site_visits) {
            const idx = dbCache.site_visits.findIndex(x => String(x.id) === String(existingVisit.id));
            if (idx !== -1) dbCache.site_visits[idx] = updatedVisit;
          }
        });
      }
    } else {
      const visitId = await generateNextIdAsync(client, 'site_visits');
      const newVisit = {
        id: visitId,
        customerId: customerId,
        propertyId: f.pitchedPropertyId || 'PROP-001',
        employeeId: f.employeeId || 'EMP-001',
        date: f.date || new Date().toLocaleDateString('en-IN'),
        time: f.time || '12:00 PM',
        result: 'Scheduled',
        remarks: f.remarks || `Automatically created from Follow-Up ${f.id} stage: ${action}.`,
        linkedFollowUpId: f.id
      };
      const insertedVisit = await insertRecord('site_visits', newVisit, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache) {
            if (!dbCache.site_visits) dbCache.site_visits = [];
            dbCache.site_visits.push(insertedVisit);
          }
        });
      }
    }
  } else {
    await client.query('DELETE FROM site_visits WHERE "linkedFollowUpId" = $1', [f.id]);
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache && dbCache.site_visits) {
          dbCache.site_visits = dbCache.site_visits.filter(sv => sv.linkedFollowUpId !== f.id);
        }
      });
    }
  }

  const isClosedDeal = action === 'Closed' || action === 'Booked' || action === 'Query_ClosedWon' || action === 'Deal Closed' || action === 'Property Registered/Sold Out' || action === 'Property Booked';

  if (isClosedDeal) {
    let finalCustomerId = customerId;
    if (customerId && String(customerId).startsWith('LEAD-')) {
      const cust = await convertLeadToCustomer(customerId, client, `Converted via Follow-Up close action.`);
      if (cust) {
        finalCustomerId = cust.id;
      }
    }

    const propId = f.pitchedPropertyId || 'PROP-001';
    
    const dealRes = await client.query(
      'SELECT * FROM deals WHERE "propertyId" = $1 AND "customerId" = $2',
      [propId, finalCustomerId]
    );
    const existingDeal = dealRes.rows[0];

    if (!existingDeal) {
      const dealId = await generateNextIdAsync(client, 'deals');
      const propRes = await client.query('SELECT demand, current_owner_id FROM properties WHERE id = $1', [propId]);
      const prop = propRes.rows[0];
      const sellerId = prop ? (prop.current_owner_id || '') : '';
      
      const newDeal = {
        id: dealId,
        customerId: finalCustomerId,
        sellerCustomerId: sellerId || finalCustomerId,
        propertyId: propId,
        employeeId: f.employeeId || 'EMP-001',
        status: 'Closed',
        purchasePrice: f.pitchPrice || (prop ? (prop.demand || '') : ''),
        registrationDate: new Date().toISOString().split('T')[0]
      };
      
      const insertedDeal = await insertRecord('deals', newDeal, client);
      
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache) {
            if (!dbCache.deals) dbCache.deals = [];
            dbCache.deals.push(insertedDeal);
          }
        });
      }
      
      await handleDealStatusChange(insertedDeal, client, req, cacheMutations);
    } else {
      await handleDealStatusChange(existingDeal, client, req, cacheMutations);
    }
  }

  if (queryId) {
    const qRes = await client.query('SELECT * FROM queries WHERE id = $1', [queryId]);
    const q = qRes.rows[0];
    if (q) {
      q.stage = action;
      if (action === 'Closed' || action === 'Deal Closed' || action === 'Property Registered/Sold Out' || action === 'Query_ClosedWon') {
        q.status = 'Closed';
      } else if (action === 'Requirement Verified' || action === 'Query_Approved') {
        q.status = 'Approved';
      }
      
      const updatedQ = await updateRecord('queries', q.id, { stage: q.stage, status: q.status }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.queries) {
            const idx = dbCache.queries.findIndex(x => String(x.id) === String(q.id));
            if (idx !== -1) dbCache.queries[idx] = updatedQ;
          }
        });
      }
      
      await handleQueryStageChange(updatedQ, client, req, cacheMutations);
    }
  } else if (customerId && String(customerId).startsWith('LEAD-')) {
    const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [customerId]);
    const lead = leadRes.rows[0];
    if (lead) {
      let leadStatus = lead.status;
      if (action === 'Lost' || action === 'Lost Lead') {
        leadStatus = 'Junk';
      } else if (action === 'Closed' || action === 'Deal Closed' || action === 'Property Registered/Sold Out' || action === 'Booked' || action === 'Property Booked') {
        leadStatus = 'Converted';
      } else {
        leadStatus = action;
      }
      
      const updatedLead = await updateRecord('leads', lead.id, { status: leadStatus }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.leads) {
            const idx = dbCache.leads.findIndex(x => String(x.id) === String(lead.id));
            if (idx !== -1) dbCache.leads[idx] = updatedLead;
          }
        });
      }
    }
  } else if (customerId && String(customerId).startsWith('CUST-')) {
    const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    const cust = custRes.rows[0];
    if (cust) {
      const updatedCust = await updateRecord('customers', cust.id, { stage: action }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.customers) {
            const idx = dbCache.customers.findIndex(x => String(x.id) === String(cust.id));
            if (idx !== -1) dbCache.customers[idx] = updatedCust;
          }
        });
      }
    }
  }
}

function generateDynamicTimeline(moduleName, id, db) {
  const timeline = [];
  const allRemarks = db.remarks || [];
  const allSiteVisits = db.site_visits || [];
  const allFollowUps = db.follow_ups || [];
  const allQueries = db.queries || [];
  const allDeals = db.deals || [];
  const allPitches = db.property_pitch_history || [];
  const allLeads = db.leads || [];

  if (moduleName === 'customers') {
    const cust = (db.customers || []).find(c => String(c.id) === String(id));
    if (cust) {
      timeline.push({
        date: cust.dateAdded || '',
        event: 'Customer Profile Created',
        details: `Customer ${cust.name} added to master record.`,
        icon: 'UserCheck'
      });
      const cleanPhone = String(cust.phone).trim();
      const cleanEmail = String(cust.email || '').trim().toLowerCase();
      allLeads.forEach(l => {
        const leadPhone = String(l.phone).trim();
        const leadEmail = String(l.email || '').trim().toLowerCase();
        if (leadPhone === cleanPhone || (cleanEmail && leadEmail === cleanEmail)) {
          timeline.push({
            date: l.dateAdded || '',
            event: `Lead Created (${l.id})`,
            details: `Source: ${l.source} • Status: ${l.status}`,
            icon: 'Magnet'
          });
        }
      });
      allQueries.forEach(q => {
        if (String(q.customerId) === String(id)) {
          timeline.push({
            date: q.date || '',
            event: `Query Created (${q.id})`,
            details: `Type: ${q.queryType} • Status: ${q.status} • Stage: ${q.stage}`,
            icon: 'HelpCircle'
          });
        }
      });
      allSiteVisits.forEach(v => {
        if (String(v.customerId) === String(id)) {
          timeline.push({
            date: v.date || '',
            event: `Site Visit Scheduled/Done (${v.id})`,
            details: `Property: ${v.propertyId} • Result: ${v.result}`,
            icon: 'Eye'
          });
        }
      });
      allFollowUps.forEach(f => {
        if (String(f.customerId) === String(id)) {
          timeline.push({
            date: f.date || '',
            event: `Follow-Up Scheduled (${f.id})`,
            details: `Status: ${f.status} • Assigned Exec: ${f.employeeId}`,
            icon: 'PhoneCall'
          });
        }
      });
      allPitches.forEach(p => {
        if (String(p.customerId) === String(id)) {
          timeline.push({
            date: p.pitchDate ? p.pitchDate.split(' ')[0] : '',
            event: `Property Pitched (${p.id})`,
            details: `Property: ${p.propertyId} pitched by ${p.employeeName} via ${p.pitchMethod}`,
            icon: 'Send'
          });
        }
      });
      allDeals.forEach(d => {
        if (String(d.customerId) === String(id) || String(d.sellerCustomerId) === String(id)) {
          const role = String(d.customerId) === String(id) ? 'Buyer' : 'Seller';
          timeline.push({
            date: d.registrationDate || '',
            event: `Deal ${d.status} (${d.id})`,
            details: `Customer role: ${role} • Property: ${d.propertyId} • Price: ₹${d.purchasePrice}`,
            icon: 'Handshake'
          });
        }
      });
    }
  } else if (moduleName === 'properties') {
    const prop = (db.properties || []).find(p => String(p.id) === String(id));
    if (prop) {
      timeline.push({
        date: prop.date || '',
        event: 'Property Added to Inventory',
        details: `Status: ${prop.status} • Locality: ${prop.locality} • Price/Demand: ₹${prop.demand}`,
        icon: 'Home'
      });
      allSiteVisits.forEach(v => {
        if (String(v.propertyId) === String(id)) {
          timeline.push({
            date: v.date || '',
            event: `Site Visit Showcased (${v.id})`,
            details: `Customer: ${v.customerId} • Result: ${v.result}`,
            icon: 'Eye'
          });
        }
      });
      allPitches.forEach(p => {
        if (String(p.propertyId) === String(id)) {
          timeline.push({
            date: p.pitchDate ? p.pitchDate.split(' ')[0] : '',
            event: `Pitched to Customer (${p.id})`,
            details: `Pitched to ${p.customerName} by ${p.employeeName}`,
            icon: 'Send'
          });
        }
      });
      allDeals.forEach(d => {
        if (String(d.propertyId) === String(id)) {
          timeline.push({
            date: d.registrationDate || '',
            event: `Deal ${d.status} (${d.id})`,
            details: `Buyer: ${d.customerId} • Seller: ${d.sellerCustomerId} • Price: ₹${d.purchasePrice}`,
            icon: 'Handshake'
          });
        }
      });
      if (prop.owner_history) {
        prop.owner_history.forEach(h => {
          timeline.push({
            date: h.saleDate || '',
            event: 'Ownership Transferred',
            details: `Sold by ${h.ownerName} on ${h.saleDate} for ₹${h.salePrice}`,
            icon: 'User'
          });
        });
      }
    }
  } else if (moduleName === 'leads') {
    const lead = (db.leads || []).find(l => String(l.id) === String(id));
    if (lead) {
      timeline.push({
        date: lead.dateAdded || '',
        event: 'Lead Created',
        details: `Source: ${lead.source} • Budget: ₹${lead.budget}`,
        icon: 'Magnet'
      });
    }
  } else if (moduleName === 'queries') {
    const q = (db.queries || []).find(r => String(r.id) === String(id));
    if (q) {
      timeline.push({
        date: q.date || '',
        event: 'Query Created',
        details: `Type: ${q.queryType} • Status: ${q.status} • Stage: ${q.stage}`,
        icon: 'HelpCircle'
      });
    }
  } else if (moduleName === 'deals') {
    const d = (db.deals || []).find(r => String(r.id) === String(id));
    if (d) {
      timeline.push({
        date: d.registrationDate || '',
        event: 'Deal Created',
        details: `Status: ${d.status} • Price: ₹${d.purchasePrice}`,
        icon: 'Handshake'
      });
    }
  } else if (moduleName === 'dealers') {
    const dealer = (db.dealers || []).find(r => String(r.id) === String(id));
    if (dealer) {
      timeline.push({
        date: new Date().toLocaleDateString('en-IN'),
        event: 'Dealer Created',
        details: `Firm: ${dealer.firm_name} • Contact: ${dealer.person_name}`,
        icon: 'Building'
      });
      
      const calls = (db.dealer_calls || []).filter(c => String(c.dealerId) === String(id));
      calls.forEach(c => {
        timeline.push({
          date: c.date || '',
          event: `Outreach Call logged`,
          details: `Outcome: ${c.remarks} • Followup: ${c.followUpDate || 'None'} • By: ${c.employeeName}`,
          icon: 'PhoneCall'
        });
      });

      const meetings = (db.dealer_meetings || []).filter(m => String(m.dealerId) === String(id));
      meetings.forEach(m => {
        timeline.push({
          date: m.meetingDate || '',
          event: `Meeting ${m.status}`,
          details: `Purpose: ${m.purpose} • Result: ${m.outcome || 'Awaiting Report'}`,
          icon: 'Calendar'
        });
      });
    }
  }

  allRemarks.forEach(r => {
    if (r.targetModule === moduleName && String(r.targetId) === String(id)) {
      timeline.push({
        date: r.dateTime ? r.dateTime.split(' ')[0] : '',
        event: `Remark by ${r.employeeName}`,
        details: r.comment,
        icon: 'MessageSquare'
      });
    }
  });

  timeline.sort((a, b) => {
    const parseDate = (dStr) => {
      if (!dStr) return new Date(0);
      if (dStr.includes('-')) return new Date(dStr);
      const pts = dStr.split('/');
      if (pts.length === 3) return new Date(pts[2], pts[1] - 1, pts[0]);
      return new Date(dStr);
    };
    return parseDate(b.date) - parseDate(a.date);
  });

  return timeline;
}

app.get('/api/data/:module', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  
  if (module === 'activity_logs' || module === 'documents') {
    return next();
  }

  const metadata = readMetadata();
  if (!metadata.modules[module]) {
    return res.status(404).json({ message: `Module '${module}' does not exist.` });
  }
  next();
}, (req, res, next) => {
  const { module } = req.params;
  if (module === 'activity_logs' || module === 'documents') {
    return next();
  }
  checkPermission(module, 'view')(req, res, next);
}, async (req, res) => {
  const { module } = req.params;
  const { role } = req.user;
  
  try {
    let records = await getRecords(module);
    
    if (role !== 'Admin') {
      if (module === 'wanted_properties' && role !== 'Manager') {
        records = records.filter(r => String(r.assignedEmployeeId) === String(req.user.id));
      } else if (module === 'leads') {
        const followUps = await getRecords('follow_ups');
        const siteVisits = await getRecords('site_visits');
        const pitches = await getRecords('property_pitch_history');
        
        const myFollowUpCustomerIds = followUps
          .filter(f => String(f.employeeId) === String(req.user.id))
          .map(f => String(f.customerId));
        const mySiteVisitCustomerIds = siteVisits
          .filter(sv => String(sv.employeeId) === String(req.user.id))
          .map(sv => String(sv.customerId));
        const myPitchCustomerIds = pitches
          .filter(p => String(p.employeeId) === String(req.user.id))
          .map(p => String(p.customerId));
        
        records = records.filter(r => 
          String(r.assignedEmployeeId) === String(req.user.id) ||
          myFollowUpCustomerIds.includes(String(r.id)) ||
          mySiteVisitCustomerIds.includes(String(r.id)) ||
          myPitchCustomerIds.includes(String(r.id))
        );
      } else if (module === 'follow_ups') {
        records = records.filter(r => String(r.employeeId) === String(req.user.id));
      } else if (module === 'queries') {
        const followUps = await getRecords('follow_ups');
        const myFollowUpQueryIds = followUps
          .filter(f => String(f.employeeId) === String(req.user.id))
          .map(f => String(f.queryId));
        records = records.filter(r => 
          String(r.assignedEmployeeId) === String(req.user.id) ||
          myFollowUpQueryIds.includes(String(r.id))
        );
      } else if (module === 'property_pitch_history') {
        records = records.filter(r => String(r.employeeId) === String(req.user.id));
      } else if (module === 'site_visits') {
        records = records.filter(r => String(r.employeeId) === String(req.user.id));
      } else if (module === 'salaries') {
        records = records.filter(r => String(r.employeeId) === String(req.user.id));
      } else if (module === 'tasks') {
        records = records.filter(r => String(r.assignedTo) === String(req.user.id));
      }
    }
    
    // Apply field-level filtering for non-Admin roles
    const metadata = readMetadata();
    if (role !== 'Admin' && metadata.fieldPermissions && metadata.fieldPermissions[role]) {
      const allowedFields = metadata.fieldPermissions[role][module];
      if (allowedFields) {
        const filteredRecords = records.map(record => {
          const filteredRecord = {};
          allowedFields.forEach(field => {
            if (record[field] !== undefined) {
              filteredRecord[field] = record[field];
            }
          });
          if (record.id) {
            filteredRecord.id = record.id;
          }
          return filteredRecord;
        });
        return res.json(filteredRecords);
      }
    }

    res.json(records);
  } catch (err) {
    console.error('Error fetching data for module:', module, err);
    res.status(500).json({ message: 'Database error fetching module data.' });
  }
});

app.post('/api/data/:module', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'create')(req, res, next);
}, async (req, res) => {
  const { module } = req.params;
  const payload = req.body;

  if (module === 'employees') {
    delete payload.password;
    delete payload.passwordHash;
    delete payload.tokenVersion;
  }

  if (module === 'employees' || module === 'attendance' || module === 'customers' || module === 'leads' || module === 'queries' || module === 'follow_ups' || module === 'property_pitch_history') {
    try {
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Created record ${payload.id || 'new'} in ${module}`,
        dateTime: new Date().toLocaleString()
      };

      const cacheMutations = [];

      const inserted = await runTransaction(async (client) => {
        if (!payload.id) {
          payload.id = await generateNextIdAsync(client, module);
        }
        log.action = `Created record ${payload.id} in ${module}`;

        // Lead specific pre-insert automation
        if (module === 'leads') {
          if (payload.propertyId && !payload.demand) {
            const propRes = await client.query('SELECT demand FROM properties WHERE id = $1', [payload.propertyId]);
            if (propRes.rows[0]) {
              payload.demand = propRes.rows[0].demand || '';
            }
          }
          if (payload.leadType === 'Seller') {
            payload.status = payload.status || 'Open';
            payload.assignmentStatus = 'accepted';
            payload.assignmentTime = null;
            payload.droppedBy = [];
          } else {
            payload.assignmentStatus = 'pending';
            payload.assignmentTime = new Date().toISOString();
            payload.droppedBy = [];
          }
          
          if (payload.assignedEmployeeId) {
            setTimeout(() => {
              notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: payload.id, leadName: payload.name || payload.person_name || 'New Lead' });
            }, 500);
          }
        }

        // Query specific pre-insert automation
        if (module === 'queries') {
          if (!payload.status) {
            payload.status = 'Pending Approval';
          }
          if (payload.assignedEmployeeId) {
            const currentStatus = payload.status;
            setTimeout(() => {
              if (currentStatus === 'Approved') {
                notifyUser(payload.assignedEmployeeId, 'query-approved', {
                  queryId: payload.id,
                  message: `Your Property Query ${payload.id} has been Approved.`
                });
              } else {
                notifyUser(payload.assignedEmployeeId, 'query-assigned', {
                  queryId: payload.id,
                  message: `New Query ${payload.id} assigned to you for approval.`
                });
              }
            }, 500);
          }
        }

        // Insert record
        const rec = await insertRecord(module, payload, client);

        // Query specific post-insert automation
        if (module === 'queries') {
          await handleQueryStageChange(payload, client, req, cacheMutations);

          if (payload.queryType === 'Buy Property' && String(payload.customerId).startsWith('LEAD')) {
            const followUpId = await generateNextIdAsync(client, 'follow_ups');
            const newFollowUp = {
              id: followUpId,
              customerId: payload.customerId,
              queryId: payload.id,
              employeeId: payload.assignedEmployeeId || 'EMP-001',
              date: new Date().toLocaleDateString('en-IN'),
              time: '12:00 PM',
              status: 'Pending Call',
              pipelineAction: 'Fresh Lead',
              remarks: `Auto-scheduled follow up for new Query ${payload.id}: ${payload.remarks || 'No notes'}`
            };
            const insertedFollowUp = await insertRecord('follow_ups', newFollowUp, client);
            cacheMutations.push(() => {
              if (dbCache) {
                if (!dbCache.follow_ups) dbCache.follow_ups = [];
                dbCache.follow_ups.push(insertedFollowUp);
              }
            });
            try { syncToSheets('follow_ups'); } catch(e) {}
          }
        }

        // Lead specific post-insert automation
        if (module === 'leads') {
          await handleLeadStatusChange(payload, client, req, cacheMutations);
          
          if (payload.assignmentStatus === 'accepted' && payload.leadType !== 'Seller') {
            await createFollowUpForLead(payload, client, cacheMutations);
          }
          if (payload.assignedEmployeeId) {
            await syncAssignedEmployeeUniversally('leads', payload.id, payload.assignedEmployeeId, client, cacheMutations);
          }
        }

        // Follow up specific post-insert automation
        if (module === 'follow_ups') {
          await handleFollowUpPipelineAction(rec, client, req, cacheMutations);
        }

        // Pitch specific post-insert automation
        if (module === 'property_pitch_history') {
          await handlePitchStatusChange(rec, client, req, cacheMutations);
        }

        await insertRecord('activity_logs', log, client);
        return rec;
      });

      if (dbCache) {
        if (!dbCache[module]) dbCache[module] = [];
        dbCache[module].push(inserted);
        if (dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }
      }

      cacheMutations.forEach(mutate => mutate());

      try { syncToSheets(module); } catch(e) {}
      res.status(201).json(inserted);
    } catch (err) {
      console.error(`Error inserting ${module}:`, err);
      res.status(400).json({ message: err.message });
    }
    return;
  }

  try {
    const result = await runTransaction(async (client) => {
      const dbBefore = await loadTransactionDb(client);
      const db = JSON.parse(JSON.stringify(dbBefore));
      // Generate automated primary key if not provided (e.g. CUST-003)
      if (!payload.id) {
        const prefixMap = {
          employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
          projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
          tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
          daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
          property_pitch_history: 'PITCH', dealer_calls: 'CALL', wanted_properties: 'WANT'
        };
        const prefix = prefixMap[module] || module.substring(0, 4).toUpperCase();
        payload.id = generateNextId(db, module, prefix);
      }

      if (module === 'wanted_properties') {
        const dealerContactNum = String(payload.dealerContactNum || '').trim();
        if (!dealerContactNum) {
          throw new Error('Dealer Contact Number is required.');
        }

        db.dealers = db.dealers || [];
        let dealer = db.dealers.find(d => {
          const num1 = String(d.contact_num || '').trim().replace(/[^0-9]/g, '');
          const num2 = dealerContactNum.replace(/[^0-9]/g, '');
          return num1 === num2 && num1 !== '';
        });

        if (dealer) {
          payload.dealerId = dealer.id;
          if (payload.dealerContactName) dealer.person_name = payload.dealerContactName;
          if (payload.dealerFirmName) dealer.firm_name = payload.dealerFirmName;
          if (payload.dealerAddress) dealer.address = payload.dealerAddress;
        } else {
          const nextDealerId = generateNextId(db, 'dealers', 'DEAL');
          const newDealer = {
            id: nextDealerId,
            contact_num: dealerContactNum,
            person_name: payload.dealerContactName || "Unverified — Auto-created from Wanted Property",
            firm_name: payload.dealerFirmName || "Unverified — Auto-created from Wanted Property",
            address: payload.dealerAddress || "",
            sector_block: "Auto-created",
            dateAdded: new Date().toISOString().split('T')[0]
          };
          db.dealers.push(newDealer);
          payload.dealerId = nextDealerId;

          const dealerLog = {
            id: generateUniqueId('LOG'),
            employeeName: req.user ? req.user.name : 'System',
            action: `Auto-created Dealer ${nextDealerId} for contact ${dealerContactNum} from Wanted Property`,
            dateTime: new Date().toLocaleString()
          };
          if (!db.activity_logs) db.activity_logs = [];
          db.activity_logs.unshift(dealerLog);
        }

        const linkLog = {
          id: generateUniqueId('LOG'),
          employeeName: req.user ? req.user.name : 'System',
          action: dealer 
            ? `Linked Wanted Property ${payload.id} to existing Dealer ${dealer.id}`
            : `Linked Wanted Property ${payload.id} to auto-created Dealer ${payload.dealerId}`,
          dateTime: new Date().toLocaleString()
        };
        if (!db.activity_logs) db.activity_logs = [];
        db.activity_logs.unshift(linkLog);

        if (!payload.assignedEmployeeId && payload.locality) {
          const reqLocality = String(payload.locality).toLowerCase().trim();
          db.employees = db.employees || [];

          const matchingEmployees = db.employees.filter(emp => {
            const areas = String(emp.operatingAreas || '').split(',').map(s => s.toLowerCase().trim());
            return areas.some(area => area !== '' && (area.includes(reqLocality) || reqLocality.includes(area)));
          });

          let assignedEmpId = null;

          if (matchingEmployees.length === 1) {
            assignedEmpId = matchingEmployees[0].id;
          } else if (matchingEmployees.length > 1) {
            db.wanted_properties = db.wanted_properties || [];
            let minCount = Infinity;
            let bestEmp = null;

            for (const emp of matchingEmployees) {
              const openCount = db.wanted_properties.filter(wp => 
                String(wp.assignedEmployeeId) === String(emp.id) &&
                wp.status !== 'Closed' && wp.status !== 'Not Interested'
              ).length;

              if (openCount < minCount) {
                minCount = openCount;
                bestEmp = emp;
              }
            }
            if (bestEmp) {
              assignedEmpId = bestEmp.id;
            }
          }

          if (assignedEmpId) {
            payload.assignedEmployeeId = assignedEmpId;
            payload.status = 'Assigned';

            setTimeout(() => {
              notifyUser(assignedEmpId, 'new-wanted-requirement', {
                wantedId: payload.id,
                locality: payload.locality || '',
                budget: payload.budget || ''
              });
            }, 500);
          } else {
            payload.status = payload.status || 'New';
          }
        } else {
          payload.status = payload.status || (payload.assignedEmployeeId ? 'Assigned' : 'New');
        }
      }

      // Populate basic date tracker if applicable
      const metadata = readMetadata();
      const fields = (metadata.modules[module] && metadata.modules[module].fields) || [];
      fields.forEach(f => {
        if (f.name === 'dateAdded' && !payload[f.name]) {
          payload[f.name] = new Date().toISOString().split('T')[0];
        }
        if (f.name === 'last_updated') {
          payload[f.name] = new Date().toLocaleString('en-IN');
        }
        if (f.name === 'created_by' && !payload[f.name]) {
          payload[f.name] = req.user.name;
        }
        if (f.name === 'date' && !payload[f.name]) {
          payload[f.name] = new Date().toLocaleDateString('en-IN');
        }
        if (f.name === 'pipelineAction' && !payload[f.name] && module === 'follow_ups') {
          payload[f.name] = 'Fresh Lead';
        }
        if (f.name === 'stage' && !payload[f.name] && module === 'queries') {
          payload[f.name] = 'New Query';
        }
        if (f.name === 'status' && !payload[f.name] && module === 'property_pitch_history') {
          payload[f.name] = 'Pitched';
        }
        if (f.name === 'pitchDate' && !payload[f.name] && module === 'property_pitch_history') {
          payload[f.name] = new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN');
        }
        if (f.name === 'employeeName' && !payload[f.name] && (module === 'property_pitch_history' || module === 'dealer_calls')) {
          payload[f.name] = req.user.name;
        }
        if (f.name === 'employeeId' && !payload[f.name] && module === 'property_pitch_history') {
          payload[f.name] = req.user.id;
        }
        if (f.name === 'assignedEmployeeId' && !payload[f.name] && module === 'dealer_meetings') {
          payload[f.name] = req.user.id;
        }
      });

      // Enforce unique phone number / Master Customer record duplicate prevention
      if (payload.phone && (module === 'customers' || module === 'leads')) {
        const cleanPhone = String(payload.phone).trim();
        const existingCust = (db.customers || []).find(r => r.phone && String(r.phone).trim() === cleanPhone);
        const existingLead = (db.leads || []).find(r => r.phone && String(r.phone).trim() === cleanPhone);
        if (existingCust || existingLead) {
          const existingPerson = existingCust || existingLead;
          const queryId = generateNextId(db, 'queries', 'QRY');
          const queryType = payload.leadType === 'Seller' ? 'Sell Property' : 'Buy Property';
          
          const newQuery = {
            id: queryId,
            customerId: existingPerson.id,
            assignedEmployeeId: payload.assignedEmployeeId || existingPerson.assignedEmployeeId || 'EMP-001',
            date: new Date().toLocaleDateString('en-IN'),
            status: 'Pending Approval',
            queryType: queryType,
            stage: 'New Query',
            budget: payload.budget || '',
            demand: payload.demand || '',
            r_c_i: payload.r_c_i || '',
            propertyType: payload.propertyType || '',
            locality: payload.locality || '',
            sector_block: payload.sector_block || '',
            size: payload.size || '',
            remarks: payload.remarks || payload.initial_notes || 'Auto-created query due to duplicate lead/customer submission.'
          };
          
          if (!db.queries) db.queries = [];
          db.queries.push(newQuery);

          if (newQuery.queryType === 'Buy Property' && String(existingPerson.id).startsWith('LEAD')) {
            // Automatically schedule a follow up task for the auto-created query
            db.follow_ups = db.follow_ups || [];
            const followUpId = generateNextId(db, 'follow_ups', 'FOLLOW');
            const newFollowUp = {
              id: followUpId,
              customerId: existingPerson.id,
              queryId: queryId,
              employeeId: payload.assignedEmployeeId || existingPerson.assignedEmployeeId || 'EMP-001',
              date: new Date().toLocaleDateString('en-IN'),
              time: '12:00 PM',
              status: 'Pending Call',
              pipelineAction: 'Fresh Lead',
              remarks: `Auto-scheduled follow up for auto-created duplicate check Query ${queryId}.`
            };
            db.follow_ups.push(newFollowUp);
            try { syncToSheets('follow_ups'); } catch(e) {}
          }
          
          const log = {
            id: generateUniqueId('LOG'),
            employeeName: req.user ? req.user.name : 'System',
            action: `Detected duplicate phone ${cleanPhone}. Created Query ${queryId} for existing ${existingPerson.id.startsWith('LEAD') ? 'lead' : 'customer'} ${existingPerson.id}`,
            dateTime: new Date().toLocaleString()
          };
          if (!db.activity_logs) db.activity_logs = [];
          db.activity_logs.unshift(log);
          
          try { syncToSheets('queries'); } catch(e) {}
          
          await syncDbChangesToPostgres(dbBefore, db, client);
          dbCache = db;

          return {
            __is_redirected_query: true,
            message: `Customer/Lead already exists. Created Query (${queryId}) linked to customer profile instead.`,
            data: newQuery
          };
        }
      }

      // Duplicate phone check bypassed to allow duplicates across modules
      /*
      if (payload.phone) {
        const cleanPhone = String(payload.phone).trim();
        const isDuplicate = (db[module] || []).some(r => r.phone && String(r.phone).trim() === cleanPhone);
        if (isDuplicate) {
          throw new Error(`Phone number '${payload.phone}' is already registered in this module.`);
        }
      }
      */

      if (module === 'properties') {
        await handlePropertyDealerAssociation(payload, client);
      }

      // Prevent duplicate dealers by returning existing matching record
      if (module === 'dealers' && payload.contact_num) {
        const cleanContact = String(payload.contact_num).trim();
        const existingDealer = (db.dealers || []).find(r => r.contact_num && String(r.contact_num).trim() === cleanContact);
        if (existingDealer) {
          return existingDealer;
        }
      }

      if (module === 'properties') {
        if (payload.dealer_owner_booked === 'Direct' || payload.dealer_owner_booked === 'Owner' || !payload.dealer_owner_booked) {
          payload.dealer_owner_booked = 'Direct';
          const ownerName = payload.contact_person_name || 'Direct Property Owner';
          const ownerPhone = payload.contact_number ? String(payload.contact_number).trim() : '';

          if ((ownerName || ownerPhone) && !payload.current_owner_id) {
            db.customers = db.customers || [];
            let cust = null;
            if (ownerPhone) {
              cust = db.customers.find(c => c.phone && String(c.phone).trim() === ownerPhone);
            }
            if (!cust && ownerName) {
              cust = db.customers.find(c => c.name && c.name.toLowerCase() === ownerName.toLowerCase());
            }
            if (!cust) {
              const custId = generateNextId(db, 'customers', 'CUST');
              cust = {
                id: custId,
                name: ownerName,
                phone: ownerPhone,
                stage: 'Active Seller',
                assignedEmployeeId: payload.assignedEmployeeId || (req.user ? req.user.id : 'EMP-001'),
                city: payload.locality || '',
                requirements: `Direct Property Owner for Property ${payload.id || ''}`,
                source: payload.source || 'Direct Property Seller',
                dateAdded: new Date().toISOString().split('T')[0]
              };
              db.customers.push(cust);
              try { syncToSheets('customers'); } catch(e) {}
            }
            if (cust) {
              payload.current_owner_id = cust.id;
              payload.booked_by_customer_id = cust.id;
            }
          }
        }
      }

      if (module === 'leads') {
        if (payload.propertyId && !payload.demand) {
          db.properties = db.properties || [];
          const assocProp = db.properties.find(p => String(p.id) === String(payload.propertyId));
          if (assocProp) {
            payload.demand = assocProp.demand || '';
          }
        }
        if (payload.leadType === 'Seller') {
          payload.status = payload.status || 'Open';
          payload.assignmentStatus = 'accepted';
          payload.assignmentTime = null;
          payload.droppedBy = [];
        } else {
          payload.assignmentStatus = 'pending';
          payload.assignmentTime = new Date().toISOString();
          payload.droppedBy = [];
        }
        if (payload.assignedEmployeeId) {
          setTimeout(() => {
            notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: payload.id, leadName: payload.name || payload.person_name || 'New Lead' });
          }, 500);
        }
      }

      if (module === 'queries') {
        if (!payload.status) {
          payload.status = 'Pending Approval';
        }
        if (payload.assignedEmployeeId) {
          setTimeout(() => {
            if (payload.status === 'Approved') {
              notifyUser(payload.assignedEmployeeId, 'query-approved', {
                queryId: payload.id,
                message: `Your Property Query ${payload.id} has been Approved.`
              });
            } else {
              notifyUser(payload.assignedEmployeeId, 'query-assigned', {
                queryId: payload.id,
                message: `New Query ${payload.id} assigned to you for approval.`
              });
            }
          }, 500);
        }
      }

      if (!db[module]) db[module] = [];
      db[module].push(payload);

      if (module === 'queries') {
        handleQueryStageChange(payload, db, req);
        
        if (payload.queryType === 'Buy Property' && String(payload.customerId).startsWith('LEAD')) {
          db.follow_ups = db.follow_ups || [];
          const followUpId = generateNextId(db, 'follow_ups', 'FOLLOW');
          const newFollowUp = {
            id: followUpId,
            customerId: payload.customerId,
            queryId: payload.id,
            employeeId: payload.assignedEmployeeId || 'EMP-001',
            date: new Date().toLocaleDateString('en-IN'),
            time: '12:00 PM',
            status: 'Pending Call',
            pipelineAction: 'Fresh Lead',
            remarks: `Auto-scheduled follow up for new Query ${payload.id}: ${payload.remarks || 'No notes'}`
          };
          db.follow_ups.push(newFollowUp);
          try { syncToSheets('follow_ups'); } catch(e) {}
        }
      }
      if (module === 'deals') handleDealStatusChange(payload, db, req);
      if (module === 'property_pitch_history') handlePitchStatusChange(payload, db, req);
      if (module === 'leads') {
        handleLeadStatusChange(payload, db, req);
        if (payload.assignmentStatus === 'accepted' && payload.leadType !== 'Seller') {
          createFollowUpForLead(payload, db);
        }
        if (payload.assignedEmployeeId) {
          syncAssignedEmployeeUniversally('leads', payload.id, payload.assignedEmployeeId, db);
        }
      }
      if (module === 'customers' && payload.assignedEmployeeId) {
        syncAssignedEmployeeUniversally('customers', payload.id, payload.assignedEmployeeId, db);
      }
      if (module === 'follow_ups' && payload.employeeId) {
        syncAssignedEmployeeUniversally('follow_ups', payload.id, payload.employeeId, db);
      }
      if (module === 'follow_ups') handleFollowUpPipelineAction(payload, db, req);
      if (module === 'dealer_calls') handleDealerCallInsertion(payload, db);
      if (module === 'dealers') handleDealerVisitAssignment(payload, db, req);
      if ((module === 'leads' || module === 'follow_ups' || module === 'queries') && payload.pitchedPropertyId) {
        handleAutomatedPitchLogging(payload, db, req);
      }

      if (module === 'site_visits') {
        if (payload.result === 'Completed') {
          const targetPitches = (db.property_pitch_history || []).filter(p => 
            (payload.linkedPitchId && String(p.id) === String(payload.linkedPitchId)) ||
            (!payload.linkedPitchId && String(p.customerId) === String(payload.customerId) && String(p.propertyId) === String(payload.propertyId) && p.status === 'Site Visit Scheduled')
          );
          targetPitches.forEach(pitch => {
            if (pitch.status === 'Site Visit Scheduled' || pitch.interestLevel === 'Site Visit Scheduled') {
              pitch.status = 'Site Visit Completed';
              pitch.interestLevel = 'Site Visit Completed';
              handlePitchStatusChange(pitch, db, req);
              try { syncToSheets('property_pitch_history'); } catch(e) {}
            }
          });
        }
      }

      if (module === 'site_visits' && payload.employeeId) {
        notifyUser(payload.employeeId, 'visit-assigned', {
          visitId: payload.id,
          message: `New Site Visit ${payload.id} scheduled/assigned to you.`
        });
      }
      if (module === 'dealer_meetings' && payload.assignedEmployeeId) {
        notifyUser(payload.assignedEmployeeId, 'meeting-assigned', {
          meetingId: payload.id,
          message: `New Dealer Meeting ${payload.id} assigned to you.`
        });
      }
      if (module === 'queries' && payload.assignedEmployeeId && payload.status === 'Approved') {
        notifyUser(payload.assignedEmployeeId, 'query-approved', {
          queryId: payload.id,
          message: `Your Property Query ${payload.id} has been Approved.`
        });
      }
      if (module === 'documents') {
        notifyUser('EMP-001', 'pending-docs-alert', {
          docId: payload.id,
          message: `New document "${payload.name}" uploaded. Verification pending.`
        });
      }
      
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Created record ${payload.id} in ${module}`,
        dateTime: new Date().toLocaleString()
      };
      if (!db.activity_logs) db.activity_logs = [];
      db.activity_logs.unshift(log);

      // Sync changes back to Postgres
      await syncDbChangesToPostgres(dbBefore, db, client);
      dbCache = db;
      return payload;
    });

    syncToSheets(module);
    if (module === 'properties') {
      try { syncToSheets('dealers'); } catch (e) {}
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/data/:module/:id', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'edit')(req, res, next);
}, async (req, res) => {
  const { module, id } = req.params;
  const payload = req.body;

  if (module === 'employees') {
    delete payload.password;
    delete payload.passwordHash;
    delete payload.tokenVersion;
  }

  if (module === 'employees' || module === 'attendance' || module === 'customers' || module === 'leads' || module === 'queries' || module === 'follow_ups' || module === 'property_pitch_history') {
    try {
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Updated record ${id} in ${module}`,
        dateTime: new Date().toLocaleString()
      };

      const cacheMutations = [];

      const updated = await runTransaction(async (client) => {
        const recordExists = await getRecord(module, id, client);
        if (!recordExists) {
          throw new Error(`Record ${id} not found.`);
        }

        const metadata = readMetadata();
        const fields = (metadata.modules[module] && metadata.modules[module].fields) || [];
        fields.forEach(f => {
          if (f.name === 'last_updated') {
            payload[f.name] = new Date().toLocaleString('en-IN');
          }
        });

        if (module === 'leads') {
          if (payload.assignedEmployeeId && payload.assignedEmployeeId !== recordExists.assignedEmployeeId) {
            payload.assignmentStatus = 'accepted';
            payload.assignmentTime = null;
            payload.droppedBy = [];
            setTimeout(() => {
              notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: id, leadName: payload.name || payload.person_name || 'New Lead' });
            }, 500);
          }
        }

        const rec = await updateRecord(module, id, payload, client);

        if (module === 'queries') {
          await handleQueryStageChange(rec, client, req, cacheMutations);
        }

        if (module === 'leads') {
          await handleLeadStatusChange(rec, client, req, cacheMutations);
          if (rec.assignmentStatus === 'accepted' && rec.leadType !== 'Seller') {
            await createFollowUpForLead(rec, client, cacheMutations);
          }
          if (rec.assignedEmployeeId) {
            await syncAssignedEmployeeUniversally('leads', id, rec.assignedEmployeeId, client, cacheMutations);
          }
        }

        if (module === 'follow_ups') {
          await handleFollowUpPipelineAction(rec, client, req, cacheMutations);
        }

        if (module === 'property_pitch_history') {
          await handlePitchStatusChange(rec, client, req, cacheMutations);
        }

        await insertRecord('activity_logs', log, client);
        return rec;
      });

      if (dbCache && dbCache[module]) {
        const idx = dbCache[module].findIndex(x => String(x.id) === String(id));
        if (idx !== -1) {
          dbCache[module][idx] = updated;
        }
        if (dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }
      }

      cacheMutations.forEach(mutate => mutate());

      try { syncToSheets(module); } catch(e) {}
      res.json(updated);
    } catch (err) {
      if (err.message.includes('not found')) {
        res.status(404).json({ message: err.message });
      } else {
        res.status(400).json({ message: err.message });
      }
    }
    return;
  }

  try {
    const result = await runTransaction(async (client) => {
      const dbBefore = await loadTransactionDb(client);
      const db = JSON.parse(JSON.stringify(dbBefore));
      const index = db[module].findIndex(rec => String(rec.id) === String(id));
      if (index === -1) {
        throw new Error(`Record ${id} not found.`);
      }
      const oldPayload = { ...db[module][index] };

      // Enforce unique phone number on update
      // Duplicate phone check bypassed to allow updates with duplicate phones
      /*
      if (payload.phone) {
        const cleanPhone = String(payload.phone).trim();
        const isDuplicate = db[module].some(r => r.phone && String(r.phone).trim() === cleanPhone && String(r.id) !== String(id));
        if (isDuplicate) {
          throw new Error(`Phone number '${payload.phone}' is already registered in this module.`);
        }
      }
      */

      if (module === 'properties') {
        await handlePropertyDealerAssociation(payload, client);
      }

      if (module === 'wanted_properties') {
        const dealerContactNum = String(payload.dealerContactNum || '').trim();
        if (dealerContactNum) {
          db.dealers = db.dealers || [];
          let dealer = db.dealers.find(d => {
            const num1 = String(d.contact_num || '').trim().replace(/[^0-9]/g, '');
            const num2 = dealerContactNum.replace(/[^0-9]/g, '');
            return num1 === num2 && num1 !== '';
          });

          if (dealer) {
            payload.dealerId = dealer.id;
            if (payload.dealerContactName) dealer.person_name = payload.dealerContactName;
            if (payload.dealerFirmName) dealer.firm_name = payload.dealerFirmName;
            if (payload.dealerAddress) dealer.address = payload.dealerAddress;
          } else {
            const nextDealerId = generateNextId(db, 'dealers', 'DEAL');
            const newDealer = {
              id: nextDealerId,
              contact_num: dealerContactNum,
              person_name: payload.dealerContactName || "Unverified — Auto-created from Wanted Property",
              firm_name: payload.dealerFirmName || "Unverified — Auto-created from Wanted Property",
              address: payload.dealerAddress || "",
              sector_block: "Auto-created",
              dateAdded: new Date().toISOString().split('T')[0]
            };
            db.dealers.push(newDealer);
            payload.dealerId = nextDealerId;
          }
        }
      }

      // Auto-update last_updated date on edits
      const metadata = readMetadata();
      const fields = (metadata.modules[module] && metadata.modules[module].fields) || [];
      fields.forEach(f => {
        if (f.name === 'last_updated') {
          payload[f.name] = new Date().toLocaleString('en-IN');
        }
      });

      if (module === 'leads') {
        const oldLead = db[module][index];
        if (payload.assignedEmployeeId && payload.assignedEmployeeId !== oldLead.assignedEmployeeId) {
          payload.assignmentStatus = 'accepted';
          payload.assignmentTime = null;
          payload.droppedBy = [];
          setTimeout(() => {
            notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: id, leadName: payload.name || payload.person_name || 'New Lead' });
          }, 500);
        }
      }

      if (module === 'projects') {
        const oldProj = db.projects[index];
        const trackFields = ['pricing_details', 'plc_percent', 'status', 'configurations_sizes', 'total_land_area'];
        const historyEntries = [];
        
        trackFields.forEach(f => {
          const oldVal = oldProj[f];
          const newVal = payload[f];
          if (newVal !== undefined && String(oldVal || '').trim() !== String(newVal || '').trim()) {
            historyEntries.push({
              id: generateUniqueId('PRJH'),
              projectId: id,
              field: f,
              fieldName: metadata.modules.projects.fields.find(field => field.name === f)?.label || f,
              oldValue: oldVal || 'None',
              newValue: newVal || 'None',
              date: new Date().toLocaleDateString('en-IN'),
              employeeName: req.user.name
            });
          }
        });
        
        if (historyEntries.length > 0) {
          db.project_history = db.project_history || [];
          db.project_history.push(...historyEntries);
        }
      }

      if (module === 'properties') {
        const oldProp = db.properties[index];
        const trackFields = ['demand', 'status', 'locality', 'sector_block', 'size', 'propertyType'];
        const historyEntries = [];
        
        trackFields.forEach(f => {
          const oldVal = oldProp[f];
          const newVal = payload[f];
          if (newVal !== undefined && String(oldVal || '').trim() !== String(newVal || '').trim()) {
            historyEntries.push({
              id: generateUniqueId('PROPH'),
              propertyId: id,
              field: f,
              fieldName: metadata.modules.properties.fields.find(field => field.name === f)?.label || f,
              oldValue: oldVal || 'None',
              newValue: newVal || 'None',
              date: new Date().toLocaleDateString('en-IN'),
              employeeName: req.user.name
            });
          }
        });
        
        if (historyEntries.length > 0) {
          db.property_history = db.property_history || [];
          db.property_history.push(...historyEntries);
        }
      }

      // Update record preserving fixed identifiers
      db[module][index] = { ...db[module][index], ...payload, id };

      if (module === 'properties') {
        syncPropertyDetailsUniversally(id, db);
        try { syncToSheets('leads'); } catch(e) {}
        try { syncToSheets('customers'); } catch(e) {}
        try { syncToSheets('queries'); } catch(e) {}
        try { syncToSheets('follow_ups'); } catch(e) {}
      }

      if (module === 'site_visits') {
        const sv = db[module][index];
        if (sv) {
          if (sv.linkedFollowUpId) {
            const fup = (db.follow_ups || []).find(f => f.id === sv.linkedFollowUpId);
            if (fup && fup.date !== sv.date) {
              fup.date = sv.date;
              try { syncToSheets('follow_ups'); } catch(e) {}
            }
          }
          if (payload.result === 'Completed') {
            const targetPitches = (db.property_pitch_history || []).filter(p => 
              (sv.linkedPitchId && String(p.id) === String(sv.linkedPitchId)) ||
              (!sv.linkedPitchId && String(p.customerId) === String(sv.customerId) && String(p.propertyId) === String(sv.propertyId) && p.status === 'Site Visit Scheduled')
            );
            targetPitches.forEach(pitch => {
              if (pitch.status === 'Site Visit Scheduled' || pitch.interestLevel === 'Site Visit Scheduled') {
                pitch.status = 'Site Visit Completed';
                pitch.interestLevel = 'Site Visit Completed';
                handlePitchStatusChange(pitch, db, req);
                try { syncToSheets('property_pitch_history'); } catch(e) {}
              }
            });
          }
        }
      }

      if (module === 'queries') handleQueryStageChange(db[module][index], db, req);
      if (module === 'deals') handleDealStatusChange(db[module][index], db, req);
      if (module === 'property_pitch_history') handlePitchStatusChange(db[module][index], db, req);
      if (module === 'leads') {
        handleLeadStatusChange(db[module][index], db, req);
        if (db[module][index].assignmentStatus === 'accepted' && db[module][index].leadType !== 'Seller') {
          createFollowUpForLead(db[module][index], db);
        }
        if (db[module][index].assignedEmployeeId) {
          syncAssignedEmployeeUniversally('leads', id, db[module][index].assignedEmployeeId, db);
        }
      }
      if (module === 'customers' && db[module][index].assignedEmployeeId) {
        syncAssignedEmployeeUniversally('customers', id, db[module][index].assignedEmployeeId, db);
      }
      if (module === 'follow_ups' && db[module][index].employeeId) {
        syncAssignedEmployeeUniversally('follow_ups', id, db[module][index].employeeId, db);
      }
      if (module === 'follow_ups') handleFollowUpPipelineAction(db[module][index], db, req);
      if (module === 'dealer_calls') handleDealerCallInsertion(db[module][index], db);
      if (module === 'dealers') handleDealerVisitAssignment(db[module][index], db, req, oldPayload);
      if ((module === 'leads' || module === 'follow_ups' || module === 'queries') && db[module][index].pitchedPropertyId) {
        handleAutomatedPitchLogging(db[module][index], db, req);
      }

      // Custom SSE notifications triggers
      const updatedRec = db[module][index];
      if (module === 'site_visits' && updatedRec.employeeId) {
        notifyUser(updatedRec.employeeId, 'visit-assigned', {
          visitId: updatedRec.id,
          message: `Site Visit ${updatedRec.id} has been updated/assigned to you.`
        });
      }
      if (module === 'dealer_meetings' && updatedRec.assignedEmployeeId) {
        notifyUser(updatedRec.assignedEmployeeId, 'meeting-assigned', {
          meetingId: updatedRec.id,
          message: `Dealer Meeting ${updatedRec.id} has been updated/assigned to you.`
        });
      }
      if (module === 'queries' && updatedRec.assignedEmployeeId && updatedRec.status === 'Approved') {
        notifyUser(updatedRec.assignedEmployeeId, 'query-approved', {
          queryId: updatedRec.id,
          message: `Your Property Query ${updatedRec.id} has been Approved.`
        });
      }
      if (module === 'documents') {
        notifyUser('EMP-001', 'pending-docs-alert', {
          docId: updatedRec.id,
          message: `Document "${updatedRec.name}" has been updated. Verification pending.`
        });
      }

      // Track Activity Log
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Updated record ${id} in ${module}`,
        dateTime: new Date().toLocaleString()
      };
      if (!db.activity_logs) db.activity_logs = [];
      db.activity_logs.unshift(log);

      // Sync changes back to Postgres
      await syncDbChangesToPostgres(dbBefore, db, client);
      dbCache = db;
      return db[module][index];
    });

    // Sync to Google sheets
    syncToSheets(module);
    if (module === 'properties') {
      try { syncToSheets('dealers'); } catch (e) {}
    }
    res.json(result);
  } catch (err) {
    if (err.message.includes('not found')) {
      res.status(404).json({ message: err.message });
    } else {
      res.status(400).json({ message: err.message });
    }
  }
});
// DELETE data record handler
app.delete('/api/data/:module/:id', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'delete')(req, res, next);
}, async (req, res) => {
  const { module, id } = req.params;

  if (module === 'employees' || module === 'attendance' || module === 'customers' || module === 'leads' || module === 'queries' || module === 'follow_ups' || module === 'property_pitch_history') {
    try {
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Deleted record ${id} in ${module}`,
        dateTime: new Date().toLocaleString()
      };

      const recordExists = await runTransaction(async (client) => {
        const rec = await getRecord(module, id, client);
        if (!rec) {
          throw new Error(`Record ${id} not found.`);
        }
        
        if (module === 'leads' || module === 'customers') {
          const targetPhone = String(rec.phone || '').trim();
          const targetEmail = String(rec.email || '').trim();
          
          if (module === 'leads') {
            await client.query('DELETE FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\') OR (email = $3 AND $3 <> \'\')', [id, targetPhone, targetEmail]);
          } else {
            const leadIdVal = rec.leadId || '';
            await client.query('DELETE FROM leads WHERE id = $1 OR (phone = $2 AND $2 <> \'\') OR (email = $3 AND $3 <> \'\')', [leadIdVal, targetPhone, targetEmail]);
          }

          const queriesRes = await client.query('SELECT id FROM queries WHERE "customerId" = $1', [id]);
          const queryIds = queriesRes.rows.map(q => q.id);

          if (queryIds.length > 0) {
            await client.query('DELETE FROM properties WHERE "booked_by_customer_id" = $1 OR "linkedQueryId" = ANY($2) OR (contact_number = $3 AND $3 <> \'\')', [id, queryIds, targetPhone]);
          } else {
            await client.query('DELETE FROM properties WHERE "booked_by_customer_id" = $1 OR (contact_number = $2 AND $2 <> \'\')', [id, targetPhone]);
          }

          if (queryIds.length > 0) {
            await client.query('DELETE FROM follow_ups WHERE "customerId" = $1 OR "queryId" = ANY($2)', [id, queryIds]);
          } else {
            await client.query('DELETE FROM follow_ups WHERE "customerId" = $1', [id]);
          }

          await client.query('DELETE FROM queries WHERE "customerId" = $1', [id]);
          await client.query('DELETE FROM site_visits WHERE "customerId" = $1', [id]);
          await client.query('DELETE FROM property_pitch_history WHERE "customerId" = $1', [id]);
          await client.query('DELETE FROM sales WHERE "customerId" = $1', [id]);
          await client.query('DELETE FROM deals WHERE "customerId" = $1', [id]);
        }

        await deleteRecord(module, id, client);
        await insertRecord('activity_logs', log, client);
        return rec;
      });

      if (dbCache) {
        dbCache[module] = (dbCache[module] || []).filter(x => String(x.id) !== String(id));
        if (dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }

        if (module === 'leads' || module === 'customers') {
          const rec = recordExists;
          const targetPhone = String(rec.phone || '').trim();
          const targetEmail = String(rec.email || '').trim();

          if (module === 'leads') {
            dbCache.customers = (dbCache.customers || []).filter(c => 
              String(c.leadId) !== String(id) && 
              (targetPhone === '' || String(c.phone).trim() !== targetPhone) && 
              (targetEmail === '' || String(c.email).trim() !== targetEmail)
            );
          } else {
            dbCache.leads = (dbCache.leads || []).filter(l => 
              String(l.id) !== String(rec.leadId) && 
              (targetPhone === '' || String(l.phone).trim() !== targetPhone) && 
              (targetEmail === '' || String(l.email).trim() !== targetEmail)
            );
          }

          const customerQueries = (dbCache.queries || []).filter(q => String(q.customerId) === String(id));
          const customerQueryIds = new Set(customerQueries.map(q => String(q.id)));

          dbCache.properties = (dbCache.properties || []).filter(p => {
            if (String(p.booked_by_customer_id) === String(id)) return false;
            if (p.linkedQueryId && customerQueryIds.has(String(p.linkedQueryId))) return false;
            if (targetPhone !== '' && String(p.contact_number).trim() === targetPhone) return false;
            return true;
          });

          dbCache.follow_ups = (dbCache.follow_ups || []).filter(f => 
            String(f.customerId) !== String(id) && 
            (!f.queryId || !customerQueryIds.has(String(f.queryId)))
          );

          dbCache.queries = (dbCache.queries || []).filter(q => String(q.customerId) !== String(id));
          dbCache.site_visits = (dbCache.site_visits || []).filter(s => String(s.customerId) !== String(id));
          dbCache.property_pitch_history = (dbCache.property_pitch_history || []).filter(p => String(p.customerId) !== String(id));
          dbCache.sales = (dbCache.sales || []).filter(s => String(s.customerId) !== String(id));
          dbCache.deals = (dbCache.deals || []).filter(d => String(d.customerId) !== String(id));
        }
      }

      if (module === 'leads' || module === 'customers') {
        try { syncToSheets('leads'); } catch(e) {}
        try { syncToSheets('customers'); } catch(e) {}
        try { syncToSheets('properties'); } catch(e) {}
        try { syncToSheets('follow_ups'); } catch(e) {}
        try { syncToSheets('queries'); } catch(e) {}
        try { syncToSheets('site_visits'); } catch(e) {}
        try { syncToSheets('property_pitch_history'); } catch(e) {}
        try { syncToSheets('sales'); } catch(e) {} 
        try { syncToSheets('deals'); } catch(e) {}
      } else {
        try { syncToSheets(module); } catch (e) {}
      }

      res.json({ success: true, message: `Record ${id} deleted successfully.` });
    } catch (err) {
      if (err.message.includes('not found')) {
        res.status(404).json({ message: err.message });
      } else {
        res.status(400).json({ message: err.message });
      }
    }
    return;
  }

  try {
    const result = await runTransaction(async (client) => {
      const dbBefore = await loadTransactionDb(client);
      const db = JSON.parse(JSON.stringify(dbBefore));
      if (!db[module]) {
        throw new Error(`Module ${module} is empty.`);
      }

      const index = db[module].findIndex(rec => String(rec.id) === String(id));
      if (index === -1) {
        throw new Error(`Record ${id} not found.`);
      }

      const rec = db[module][index] || {};
      db[module].splice(index, 1);

      // Automatically delete all linked child records if a lead or customer is deleted
      if (module === 'leads' || module === 'customers') {
        const targetPhone = String(rec.phone || '').trim();
        const targetEmail = String(rec.email || '').trim();

        // 1. Cross-delete client/lead
        if (module === 'leads') {
          db.customers = (db.customers || []).filter(c => 
            String(c.leadId) !== String(id) && 
            (targetPhone === '' || String(c.phone).trim() !== targetPhone) && 
            (targetEmail === '' || String(c.email).trim() !== targetEmail)
          );
          try { syncToSheets('customers'); } catch(e) {}
        } else {
          db.leads = (db.leads || []).filter(l => 
            String(l.id) !== String(rec.leadId) && 
            (targetPhone === '' || String(l.phone).trim() !== targetPhone) && 
            (targetEmail === '' || String(l.email).trim() !== targetEmail)
          );
          try { syncToSheets('leads'); } catch(e) {}
        }

        // 2. Find all query IDs for this customer/lead
        const customerQueries = (db.queries || []).filter(q => String(q.customerId) === String(id));
        const customerQueryIds = new Set(customerQueries.map(q => String(q.id)));

        // 3. Delete properties linked via queryId, booked_by_customer_id, or phone
        db.properties = (db.properties || []).filter(p => {
          if (String(p.booked_by_customer_id) === String(id)) return false;
          if (p.linkedQueryId && customerQueryIds.has(String(p.linkedQueryId))) return false;
          if (targetPhone !== '' && String(p.contact_number).trim() === targetPhone) return false;
          return true;
        });
        try { syncToSheets('properties'); } catch(e) {}

        // 4. Delete follow_ups
        db.follow_ups = (db.follow_ups || []).filter(f => 
          String(f.customerId) !== String(id) && 
          (!f.queryId || !customerQueryIds.has(String(f.queryId)))
        );
        try { syncToSheets('follow_ups'); } catch(e) {}

        // 5. Delete queries
        db.queries = (db.queries || []).filter(q => String(q.customerId) !== String(id));
        try { syncToSheets('queries'); } catch(e) {}

        // 6. Delete site_visits
        db.site_visits = (db.site_visits || []).filter(s => String(s.customerId) !== String(id));
        try { syncToSheets('site_visits'); } catch(e) {}

        // 7. Delete property_pitch_history
        db.property_pitch_history = (db.property_pitch_history || []).filter(p => String(p.customerId) !== String(id));
        try { syncToSheets('property_pitch_history'); } catch(e) {}

        // 8. Delete sales bookings
        db.sales_bookings = (db.sales_bookings || []).filter(s => 
          String(s.customerId) !== String(id) || 
          (targetPhone !== '' && String(s.customerPhone).trim() === targetPhone)
        );
        try { syncToSheets('sales_bookings'); } catch(e) {}

        // 9. Delete deals
        db.deals = (db.deals || []).filter(d => String(d.customerId) !== String(id));
        try { syncToSheets('deals'); } catch(e) {}
      }
      if (module === 'property_pitch_history') {
        db.site_visits = (db.site_visits || []).filter(sv => sv.linkedPitchId !== id);
        try { syncToSheets('site_visits'); } catch(e) {}
      }
      if (module === 'deals') {
        db.properties = db.properties || [];
        db.properties.forEach(p => {
          if (p.owner_history) {
            p.owner_history = p.owner_history.filter(h => String(h.dealId) !== String(id));
          }
        });
        try { syncToSheets('properties'); } catch(e) {}
      }
      if (module === 'queries') {
        db.follow_ups = (db.follow_ups || []).filter(f => String(f.queryId) !== String(id));
        db.properties = (db.properties || []).filter(p => String(p.linkedQueryId) !== String(id));
        try { syncToSheets('follow_ups'); } catch(e) {}
        try { syncToSheets('properties'); } catch(e) {}
      }

      // Track Activity Log
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Deleted record ${id} in ${module}`,
        dateTime: new Date().toLocaleString()
      };
      if (!db.activity_logs) db.activity_logs = [];
      db.activity_logs.unshift(log);

      // Sync changes back to Postgres
      await syncDbChangesToPostgres(dbBefore, db, client);
      dbCache = db;
      return true;
    });

    // Sync to Google sheets
    syncToSheets(module);
    res.json({ success: true, message: `Record ${id} deleted successfully.` });
  } catch (err) {
    if (err.message.includes('empty') || err.message.includes('not found')) {
      res.status(404).json({ message: err.message });
    } else {
      res.status(400).json({ message: err.message });
    }
  }
});

// Bulk Delete Route
app.post('/api/data/:module/bulk-delete', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { module } = req.params;
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ message: 'Invalid IDs array.' });
  }

  if (module === 'employees' || module === 'attendance' || module === 'customers' || module === 'leads' || module === 'queries' || module === 'follow_ups' || module === 'property_pitch_history') {
    try {
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Bulk deleted ${ids.length} records in ${module}`,
        dateTime: new Date().toLocaleString()
      };

      const deletedRecords = await runTransaction(async (client) => {
        const records = [];
        
        for (const id of ids) {
          const rec = await getRecord(module, id, client);
          if (!rec) continue;

          records.push(rec);

          if (module === 'leads' || module === 'customers') {
            const targetPhone = String(rec.phone || '').trim();
            const targetEmail = String(rec.email || '').trim();
            
            if (module === 'leads') {
              await client.query('DELETE FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\') OR (email = $3 AND $3 <> \'\')', [id, targetPhone, targetEmail]);
            } else {
              const leadIdVal = rec.leadId || '';
              await client.query('DELETE FROM leads WHERE id = $1 OR (phone = $2 AND $2 <> \'\') OR (email = $3 AND $3 <> \'\')', [leadIdVal, targetPhone, targetEmail]);
            }

            const queriesRes = await client.query('SELECT id FROM queries WHERE "customerId" = $1', [id]);
            const queryIds = queriesRes.rows.map(q => q.id);

            if (queryIds.length > 0) {
              await client.query('DELETE FROM properties WHERE "booked_by_customer_id" = $1 OR "linkedQueryId" = ANY($2) OR (contact_number = $3 AND $3 <> \'\')', [id, queryIds, targetPhone]);
            } else {
              await client.query('DELETE FROM properties WHERE "booked_by_customer_id" = $1 OR (contact_number = $2 AND $2 <> \'\')', [id, targetPhone]);
            }

            if (queryIds.length > 0) {
              await client.query('DELETE FROM follow_ups WHERE "customerId" = $1 OR "queryId" = ANY($2)', [id, queryIds]);
            } else {
              await client.query('DELETE FROM follow_ups WHERE "customerId" = $1', [id]);
            }

            await client.query('DELETE FROM queries WHERE "customerId" = $1', [id]);
            await client.query('DELETE FROM site_visits WHERE "customerId" = $1', [id]);
            await client.query('DELETE FROM property_pitch_history WHERE "customerId" = $1', [id]);
            await client.query('DELETE FROM sales WHERE "customerId" = $1', [id]);
            await client.query('DELETE FROM deals WHERE "customerId" = $1', [id]);
          }

          await deleteRecord(module, id, client);
        }

        await insertRecord('activity_logs', log, client);
        return records;
      });

      if (dbCache) {
        dbCache[module] = (dbCache[module] || []).filter(rec => !ids.includes(String(rec.id)));
        if (dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }

        deletedRecords.forEach(rec => {
          if (module === 'leads' || module === 'customers') {
            const id = rec.id;
            const targetPhone = String(rec.phone || '').trim();
            const targetEmail = String(rec.email || '').trim();

            if (module === 'leads') {
              dbCache.customers = (dbCache.customers || []).filter(c => 
                String(c.leadId) !== String(id) && 
                (targetPhone === '' || String(c.phone).trim() !== targetPhone) && 
                (targetEmail === '' || String(c.email).trim() !== targetEmail)
              );
            } else {
              dbCache.leads = (dbCache.leads || []).filter(l => 
                String(l.id) !== String(rec.leadId) && 
                (targetPhone === '' || String(l.phone).trim() !== targetPhone) && 
                (targetEmail === '' || String(l.email).trim() !== targetEmail)
              );
            }

            const customerQueries = (dbCache.queries || []).filter(q => String(q.customerId) === String(id));
            const customerQueryIds = new Set(customerQueries.map(q => String(q.id)));

            dbCache.properties = (dbCache.properties || []).filter(p => {
              if (String(p.booked_by_customer_id) === String(id)) return false;
              if (p.linkedQueryId && customerQueryIds.has(String(p.linkedQueryId))) return false;
              if (targetPhone !== '' && String(p.contact_number).trim() === targetPhone) return false;
              return true;
            });

            dbCache.follow_ups = (dbCache.follow_ups || []).filter(f => 
              String(f.customerId) !== String(id) && 
              (!f.queryId || !customerQueryIds.has(String(f.queryId)))
            );

            dbCache.queries = (dbCache.queries || []).filter(q => String(q.customerId) !== String(id));
            dbCache.site_visits = (dbCache.site_visits || []).filter(s => String(s.customerId) !== String(id));
            dbCache.property_pitch_history = (dbCache.property_pitch_history || []).filter(p => String(p.customerId) !== String(id));
            dbCache.sales = (dbCache.sales || []).filter(s => String(s.customerId) !== String(id));
            dbCache.deals = (dbCache.deals || []).filter(d => String(d.customerId) !== String(id));
          }
        });
      }

      if (module === 'leads' || module === 'customers') {
        try { syncToSheets('leads'); } catch(e) {}
        try { syncToSheets('customers'); } catch(e) {}
        try { syncToSheets('properties'); } catch(e) {}
        try { syncToSheets('follow_ups'); } catch(e) {}
        try { syncToSheets('queries'); } catch(e) {}
        try { syncToSheets('site_visits'); } catch(e) {}
        try { syncToSheets('property_pitch_history'); } catch(e) {}
        try { syncToSheets('sales'); } catch(e) {} 
        try { syncToSheets('deals'); } catch(e) {}
      } else {
        try { syncToSheets(module); } catch (e) {}
      }

      res.json({ success: true, message: `Bulk deleted ${ids.length} records.` });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
    return;
  }

  try {
    await runTransaction(async (client) => {
      const dbBefore = await loadTransactionDb(client);
      const db = JSON.parse(JSON.stringify(dbBefore));
      
      if (!db[module]) throw new Error(`Module ${module} is empty.`);

      // Delete all matches
      db[module] = db[module].filter(rec => !ids.includes(String(rec.id)));

      // If lead or customer deleted, delete child followups etc.
      if (module === 'leads' || module === 'customers') {
        ids.forEach(id => {
          const rec = (dbBefore[module] || []).find(r => String(r.id) === String(id));
          if (!rec) return;

          const targetPhone = String(rec.phone || '').trim();
          const targetEmail = String(rec.email || '').trim();

          // 1. Cross-delete client/lead
          if (module === 'leads') {
            db.customers = (db.customers || []).filter(c => 
              String(c.leadId) !== String(id) && 
              (targetPhone === '' || String(c.phone).trim() !== targetPhone) && 
              (targetEmail === '' || String(c.email).trim() !== targetEmail)
            );
          } else {
            db.leads = (db.leads || []).filter(l => 
              String(l.id) !== String(rec.leadId) && 
              (targetPhone === '' || String(l.phone).trim() !== targetPhone) && 
              (targetEmail === '' || String(l.email).trim() !== targetEmail)
            );
          }

          // 2. Query IDs
          const customerQueries = (dbBefore.queries || []).filter(q => String(q.customerId) === String(id));
          const customerQueryIds = new Set(customerQueries.map(q => String(q.id)));

          // 3. Properties
          db.properties = (db.properties || []).filter(p => {
            if (String(p.booked_by_customer_id) === String(id)) return false;
            if (p.linkedQueryId && customerQueryIds.has(String(p.linkedQueryId))) return false;
            if (targetPhone !== '' && String(p.contact_number).trim() === targetPhone) return false;
            return true;
          });

          // 4. Follow ups
          db.follow_ups = (db.follow_ups || []).filter(f => 
            String(f.customerId) !== String(id) && 
            (!f.queryId || !customerQueryIds.has(String(f.queryId)))
          );

          // 5. Queries
          db.queries = (db.queries || []).filter(q => String(q.customerId) !== String(id));

          // 6. Site visits
          db.site_visits = (db.site_visits || []).filter(s => String(s.customerId) !== String(id));

          // 7. Pitches
          db.property_pitch_history = (db.property_pitch_history || []).filter(p => String(p.customerId) !== String(id));

          // 8. Sales bookings
          db.sales = (db.sales || []).filter(s => 
            String(s.customerId) !== String(id) || 
            (targetPhone !== '' && String(s.customerPhone).trim() === targetPhone)
          );

          // 9. Deals
          db.deals = (db.deals || []).filter(d => String(d.customerId) !== String(id));
        });
      }
      if (module === 'deals') {
        ids.forEach(id => {
          db.properties = db.properties || [];
          db.properties.forEach(p => {
            if (p.owner_history) {
              p.owner_history = p.owner_history.filter(h => String(h.dealId) !== String(id));
            }
          });
        });
      }
      if (module === 'queries') {
        ids.forEach(id => {
          db.follow_ups = (db.follow_ups || []).filter(f => String(f.queryId) !== String(id));
          db.properties = (db.properties || []).filter(p => String(p.linkedQueryId) !== String(id));
        });
      }
      if (module === 'property_pitch_history') {
        db.site_visits = (db.site_visits || []).filter(sv => !ids.includes(String(sv.linkedPitchId)));
        try { syncToSheets('site_visits'); } catch(e) {}
      }

      // Track Activity Log
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Bulk deleted ${ids.length} records in ${module}`,
        dateTime: new Date().toLocaleString()
      };
      if (!db.activity_logs) db.activity_logs = [];
      db.activity_logs.unshift(log);

      // Sync changes back to Postgres
      await syncDbChangesToPostgres(dbBefore, db, client);
      dbCache = db;
    });

    try { syncToSheets(module); } catch(e) {}
    if (module === 'leads' || module === 'customers') {
      try { syncToSheets('leads'); } catch(e) {}
      try { syncToSheets('customers'); } catch(e) {}
      try { syncToSheets('properties'); } catch(e) {}
      try { syncToSheets('follow_ups'); } catch(e) {}
      try { syncToSheets('queries'); } catch(e) {}
      try { syncToSheets('site_visits'); } catch(e) {}
      try { syncToSheets('property_pitch_history'); } catch(e) {}
      try { syncToSheets('sales'); } catch(e) {}
      try { syncToSheets('deals'); } catch(e) {}
    }
    if (module === 'deals') {
      try { syncToSheets('properties'); } catch(e) {}
    }
    if (module === 'queries') {
      try { syncToSheets('follow_ups'); } catch(e) {}
      try { syncToSheets('properties'); } catch(e) {}
    }

    res.json({ success: true, message: `Successfully deleted ${ids.length} records.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function decryptLegacyXOR(hash) {
  if (!hash) return "";
  const LEGACY_KEY = "GAGAN_REALTECH_SECURE_LOCATION_KEY_2026";
  try {
    let str = hash;
    try {
      str = Buffer.from(hash, 'base64').toString('binary');
    } catch (e) {}
    let result = "";
    for (let i = 0; i < str.length; i++) {
      const charCode = str.charCodeAt(i);
      const keyChar = LEGACY_KEY.charCodeAt(i % LEGACY_KEY.length);
      result += String.fromCharCode(charCode ^ keyChar);
    }
    return result;
  } catch (e) {
    return "";
  }
}

function encryptLocation(latitude, longitude) {
  const keyHex = process.env.DB_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    return `${latitude}:${longitude}`;
  }
  try {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const data = JSON.stringify({ lat: Number(latitude), lng: Number(longitude) });
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (e) {
    return `${latitude}:${longitude}`;
  }
}

function decryptLocation(encryptedString) {
  const keyHex = process.env.DB_ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    const parts = String(encryptedString).split(':');
    return { lat: parseFloat(parts[0]) || 0, lng: parseFloat(parts[1]) || 0 };
  }
  try {
    const parts = String(encryptedString).split(':');
    if (parts.length < 3) {
      return { lat: parseFloat(parts[0]) || 0, lng: parseFloat(parts[1]) || 0 };
    }
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const payload = parts[2];
    const key = Buffer.from(keyHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(payload, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch (e) {
    const parts = String(encryptedString).split(':');
    return { lat: parseFloat(parts[0]) || 0, lng: parseFloat(parts[1]) || 0 };
  }
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Log location entry
app.post('/api/location/log', authenticateToken, async (req, res) => {
  const { employeeId, employeeName, latitude, longitude, status } = req.body;
  
  try {
    // Support direct floats or legacy XOR strings
    let decLat = parseFloat(latitude);
    let decLng = parseFloat(longitude);

    if (isNaN(decLat) || isNaN(decLng)) {
      decLat = parseFloat(decryptLegacyXOR(latitude)) || 0;
      decLng = parseFloat(decryptLegacyXOR(longitude)) || 0;
    }

    // Encrypt at rest in db using AES-256-GCM
    const encryptedCoords = encryptLocation(decLat, decLng);

    const logEntry = {
      id: generateUniqueId('LOC'),
      employeeId,
      employeeName,
      latitude: encryptedCoords, // Coordinates encrypted at rest
      longitude: "",
      status,
      timestamp: new Date().toISOString()
    };
    
    // 1. Insert directly to location_logs table
    await insertRecord('location_logs', logEntry);

    // 2. Handle active paths and employee location updates
    if (status === 'sharing' && decLat !== 0 && decLng !== 0) {
      const activePathRes = await pool.query('SELECT path FROM active_paths WHERE employee_id = $1', [employeeId]);
      let currentPath = activePathRes.rows[0] ? activePathRes.rows[0].path : null;
      if (!currentPath || !Array.isArray(currentPath)) {
        currentPath = [];
      }
      
      if (currentPath.length === 0) {
        currentPath.push({
          lat: decLat,
          lng: decLng,
          timestamp: logEntry.timestamp
        });
      } else {
        const lastPoint = currentPath[currentPath.length - 1];
        const dist = calculateDistanceKm(lastPoint.lat, lastPoint.lng, decLat, decLng);
        // Only capture when moved more than 10 meters (0.01 km) to avoid GPS drift
        if (dist >= 0.01) {
          currentPath.push({
            lat: decLat,
            lng: decLng,
            timestamp: logEntry.timestamp
          });
        }
      }
      
      await pool.query(
        'INSERT INTO active_paths (employee_id, path) VALUES ($1, $2) ON CONFLICT (employee_id) DO UPDATE SET path = EXCLUDED.path',
        [employeeId, JSON.stringify(currentPath)]
      );
    } else if (status === 'ended') {
      const activePathRes = await pool.query('SELECT path FROM active_paths WHERE employee_id = $1', [employeeId]);
      const path = activePathRes.rows[0] && Array.isArray(activePathRes.rows[0].path) ? activePathRes.rows[0].path : [];
      
      let distance = 0;
      for (let i = 0; i < path.length - 1; i++) {
        distance += calculateDistanceKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
      }
      
      // Update employee locationHistory directly in Postgres
      const emp = await getRecord('employees', employeeId);
      if (emp) {
        const locHistory = emp.locationHistory || [];
        locHistory.push({
          date: new Date().toLocaleDateString('en-IN'),
          totalKilometers: parseFloat(distance.toFixed(2)),
          path
        });
        await updateRecord('employees', employeeId, { locationHistory: locHistory });
        
        // Synchronously write-through to dbCache.employees
        if (dbCache && dbCache.employees) {
          const cachedEmp = dbCache.employees.find(e => String(e.id) === String(employeeId));
          if (cachedEmp) {
            cachedEmp.locationHistory = locHistory;
          }
        }
      }
      
      await pool.query('DELETE FROM active_paths WHERE employee_id = $1', [employeeId]);
    }
    
    // Also push the location log to dbCache.location_logs in memory if cached
    if (dbCache) {
      if (!dbCache.location_logs) dbCache.location_logs = [];
      dbCache.location_logs.push(logEntry);
    }

    res.json({ success: true, log: logEntry });
  } catch (err) {
    console.error('Error logging location:', err);
    res.status(500).json({ message: 'Error logging location: ' + err.message });
  }
});

// Fetch active coordinates path (Admin and Manager only)
app.get('/api/location/path/:employeeId', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
    return res.status(403).json({ message: 'Access denied: Location query restricted.' });
  }

  const { employeeId } = req.params;
  try {
    const activePathRes = await pool.query('SELECT path FROM active_paths WHERE employee_id = $1', [employeeId]);
    const path = activePathRes.rows[0] && Array.isArray(activePathRes.rows[0].path) ? activePathRes.rows[0].path : [];
    
    let distance = 0;
    for (let i = 0; i < path.length - 1; i++) {
      distance += calculateDistanceKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
    }
    res.json({ path, distance: parseFloat(distance.toFixed(2)) });
  } catch (err) {
    console.error('Error fetching location path:', err);
    res.status(500).json({ message: 'Database error fetching location path.' });
  }
});

// Fetch active location logs (Admin and Manager only)
app.get('/api/location/active', authenticateToken, async (req, res) => {
  if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
    return res.status(403).json({ message: 'Access denied: Location query restricted.' });
  }

  try {
    const logs = await getRecords('location_logs');
    
    // Find the latest entry for each employee
    const activeLocs = {};
    logs.forEach(log => {
      const empId = log.employeeId;
      if (empId) {
        if (!activeLocs[empId] || new Date(log.timestamp) > new Date(activeLocs[empId].timestamp)) {
          activeLocs[empId] = log;
        }
      }
    });
    
    // Only return those who are actively 'sharing' and have pinged in the last 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const result = Object.values(activeLocs).filter(loc => 
      loc.status === 'sharing' && new Date(loc.timestamp) > fiveMinutesAgo
    );

    // Decrypt latitude/longitude for client
    const decryptedResult = result.map(loc => {
      const coords = decryptLocation(loc.latitude);
      return {
        ...loc,
        employeeName: loc.employeeName || 'Unknown Employee',
        latitude: coords.lat,
        longitude: coords.lng
      };
    });

    res.json(decryptedResult);
  } catch (err) {
    console.error('Error fetching active locations:', err);
    res.status(500).json({ message: 'Database error fetching active locations.' });
  }
});

// Fetch set message templates config
app.get('/api/templates', authenticateToken, (req, res) => {
  const db = readDb();
  const defaultTemplates = {
    whatsapp: "Hi [Client Name], based on your requirements, here is a matching listing: [Property Name] (Price: ₹[Price]). Let me know when you'd like to visit!",
    email_subject: "Matching Property Listing - Gagan Realtech",
    email_body: "Hi [Client Name],\n\nBased on your requirements, here is a property listing you might like:\n\nProperty Name: [Property Name]\nPrice: ₹[Price]\nLocality: [Locality]\nSector: [Sector]\n\nBest regards,\nGagan Realtech Team",
    sms: "Hi [Client Name], matching listing found: [Property Name] (Price: ₹[Price]) in [Locality]. Contact us!"
  };
  res.json(db.templates || defaultTemplates);
});

// Update message templates config
app.post('/api/templates', authenticateToken, (req, res) => {
  const db = readDb();
  db.templates = req.body;
  writeDb(db);
  res.json({ success: true, templates: db.templates });
});

// --- GLOBAL 360° SEARCH ENGINE ---

app.get('/api/search', authenticateToken, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim() === '') {
    return res.json({ results: {}, connections: {} });
  }

  const query = q.toLowerCase().trim();
  const keywords = query.split(/\s+/).filter(word => word.length > 0);
  const db = readDb();
  const metadata = readMetadata();
  const results = {};

  // 1. Search all dynamic tables
  Object.keys(metadata.modules).forEach(moduleName => {
    // Check if role has access to this module
    const userRole = req.user.role;
    const permissions = metadata.rolesPermissions[userRole] || {};
    const modulePerms = permissions[moduleName] || [];
    if (userRole !== 'Admin' && !modulePerms.includes('view')) {
      return; // Skip search if role cannot view this module
    }

    const records = db[moduleName] || [];
    
    // Filter matching records (only search inside allowed fields)
    const matchedRecords = records.filter(rec => {
      return keywords.every(word => {
        return Object.keys(rec).some(key => {
          if (userRole !== 'Admin' && metadata.fieldPermissions && metadata.fieldPermissions[userRole]) {
            const allowed = metadata.fieldPermissions[userRole][moduleName];
            if (allowed && !allowed.includes(key)) return false;
          }
          const val = rec[key];
          if (val === undefined || val === null) return false;
          return String(val).toLowerCase().includes(word);
        });
      });
    });

    if (matchedRecords.length > 0) {
      // Filter out restricted keys from search results
      let filtered = matchedRecords;
      if (userRole !== 'Admin' && metadata.fieldPermissions && metadata.fieldPermissions[userRole]) {
        const allowed = metadata.fieldPermissions[userRole][moduleName];
        if (allowed) {
          filtered = matchedRecords.map(rec => {
            const resRec = {};
            allowed.forEach(f => {
              if (rec[f] !== undefined) resRec[f] = rec[f];
            });
            if (rec.id) resRec.id = rec.id;
            return resRec;
          });
        }
      }
      results[moduleName] = filtered;
    }
  });

  // 1.5. Interconnect search results
  const matchedCustomerIds = new Set();
  const matchedPropertyIds = new Set();
  const matchedDealIds = new Set();
  const matchedDealerIds = new Set();

  if (results.customers) {
    results.customers.forEach(c => matchedCustomerIds.add(c.id));
  }
  if (results.leads) {
    results.leads.forEach(l => {
      if (l.phone) {
        const cleanP = String(l.phone).trim();
        const cust = (db.customers || []).find(c => c.phone && String(c.phone).trim() === cleanP);
        if (cust) matchedCustomerIds.add(cust.id);
      }
    });
  }
  if (results.properties) {
    results.properties.forEach(p => matchedPropertyIds.add(p.id));
  }
  if (results.deals) {
    results.deals.forEach(d => matchedDealIds.add(d.id));
  }
  if (results.sales) {
    results.sales.forEach(s => matchedDealIds.add(s.id));
  }
  if (results.dealers) {
    results.dealers.forEach(d => matchedDealerIds.add(d.id));
  }

  // Expand results to include linked records
  if (matchedCustomerIds.size > 0) {
    results.queries = results.queries || [];
    (db.queries || []).forEach(q => {
      if (matchedCustomerIds.has(q.customerId) && !results.queries.some(r => r.id === q.id)) {
        results.queries.push(q);
      }
    });

    results.deals = results.deals || [];
    (db.deals || []).forEach(d => {
      if ((matchedCustomerIds.has(d.customerId) || matchedCustomerIds.has(d.sellerCustomerId)) && !results.deals.some(r => r.id === d.id)) {
        results.deals.push(d);
      }
    });

    results.site_visits = results.site_visits || [];
    (db.site_visits || []).forEach(v => {
      if (matchedCustomerIds.has(v.customerId) && !results.site_visits.some(r => r.id === v.id)) {
        results.site_visits.push(v);
      }
    });

    results.properties = results.properties || [];
    (db.properties || []).forEach(p => {
      if (matchedCustomerIds.has(p.current_owner_id) && !results.properties.some(r => r.id === p.id)) {
        results.properties.push(p);
      }
    });
  }

  if (matchedPropertyIds.size > 0) {
    results.deals = results.deals || [];
    (db.deals || []).forEach(d => {
      if (matchedPropertyIds.has(d.propertyId) && !results.deals.some(r => r.id === d.id)) {
        results.deals.push(d);
      }
    });

    results.site_visits = results.site_visits || [];
    (db.site_visits || []).forEach(v => {
      if (matchedPropertyIds.has(v.propertyId) && !results.site_visits.some(r => r.id === v.id)) {
        results.site_visits.push(v);
      }
    });

    results.customers = results.customers || [];
    (db.properties || []).forEach(p => {
      if (matchedPropertyIds.has(p.id) && p.current_owner_id) {
        const owner = (db.customers || []).find(c => String(c.id) === String(p.current_owner_id));
        if (owner && !results.customers.some(r => r.id === owner.id)) {
          results.customers.push(owner);
        }
      }
    });
  }

  // Remove empty arrays from results
  Object.keys(results).forEach(k => {
    if (results[k].length === 0) {
      delete results[k];
    }
  });

  // 2. Resolve Relationships for 360 view if exactly one entity matches, or a detailed query matches
  // Let's build a unified connection profile if there is a primary query focus (e.g. employeeId, propertyId, customerId)
  // Or just query related sub-tables:
  const connections = {};
  
  // Find connected records for properties, customers, employees if searched
  const allEmployees = await getModuleRecordsForServer('employees');
  const allCustomers = await getModuleRecordsForServer('customers');
  const allProperties = await getModuleRecordsForServer('properties');
  const allSiteVisits = await getModuleRecordsForServer('site_visits');
  const allFollowUps = await getModuleRecordsForServer('follow_ups');
  const allAttendance = await getModuleRecordsForServer('attendance');
  const allTasks = await getModuleRecordsForServer('tasks');
  const allSales = await getModuleRecordsForServer('sales');
  const allLeaves = await getModuleRecordsForServer('leaves');
  const allRemarks = await getModuleRecordsForServer('remarks');
  const allDocs = await getModuleRecordsForServer('documents');

  // Helper to link records
  const getConnectedData = (type, id) => {
    const data = {};
    if (type === 'employees') {
      data.attendance = allAttendance.filter(a => a.employeeId === id);
      data.leaves = allLeaves.filter(l => l.employeeId === id);
      data.customers = allCustomers.filter(c => c.assignedEmployeeId === id);
      data.properties = allProperties.filter(p => p.assignedEmployeeId === id);
      data.tasks = allTasks.filter(t => t.assignedTo === id);
      data.remarks = allRemarks.filter(r => r.targetModule === 'employees' && r.targetId === id);
      data.documents = allDocs.filter(d => d.targetModule === 'employees' && d.targetId === id);
    } else if (type === 'customers') {
      const cust = allCustomers.find(c => String(c.id) === String(id));
      data.employee = allEmployees.find(e => String(e.id) === String(cust && cust.assignedEmployeeId));
      data.site_visits = allSiteVisits.filter(s => String(s.customerId) === String(id)).map(sv => ({
        ...sv,
        property: allProperties.find(p => String(p.id) === String(sv.propertyId))
      }));
      data.follow_ups = allFollowUps.filter(f => String(f.customerId) === String(id));
      data.tasks = allTasks.filter(t => t.title.toLowerCase().includes(String(id).toLowerCase()) || (t.description && t.description.toLowerCase().includes(String(id).toLowerCase())));
      data.sales = allSales.filter(s => String(s.customerId) === String(id)).map(sa => ({
        ...sa,
        property: allProperties.find(p => String(p.id) === String(sa.propertyId))
      }));
      data.remarks = allRemarks.filter(r => r.targetModule === 'customers' && String(r.targetId) === String(id));
      data.documents = allDocs.filter(d => d.targetModule === 'customers' && String(d.targetId) === String(id));
    } else if (type === 'properties') {
      const prop = allProperties.find(p => String(p.id) === String(id));
      data.employee = allEmployees.find(e => String(e.id) === String(prop && prop.assignedEmployeeId));
      data.site_visits = allSiteVisits.filter(s => String(s.propertyId) === String(id)).map(sv => ({
        ...sv,
        customer: allCustomers.find(c => String(c.id) === String(sv.customerId))
      }));
      data.sales = allSales.filter(s => String(s.propertyId) === String(id));
      data.remarks = allRemarks.filter(r => r.targetModule === 'properties' && String(r.targetId) === String(id));
      data.documents = allDocs.filter(d => d.targetModule === 'properties' && String(d.targetId) === String(id));
      // Track views (represented by distinct site visits + customer expressions)
      data.viewsCount = data.site_visits.length;
      data.viewedBy = data.site_visits.map(v => v.customer).filter(Boolean);
    }
    return data;
  };

  // If search matches are small, pre-resolve their relations
  const firstModule = Object.keys(results)[0];
  if (firstModule && ['employees', 'customers', 'properties'].includes(firstModule) && results[firstModule].length === 1) {
    const record = results[firstModule][0];
    connections[record.id] = getConnectedData(firstModule, record.id);
  }

  res.json({ results, connections });
});

// GET Relationship Data for Single Record Details Page (Salesforce 360 style)
app.get('/api/360/:module/:id', authenticateToken, async (req, res) => {
  const { module, id } = req.params;
  const db = readDb();
  
  const allEmployees = await getModuleRecordsForServer('employees');
  const allCustomers = await getModuleRecordsForServer('customers');
  const allProperties = await getModuleRecordsForServer('properties');
  const allSiteVisits = await getModuleRecordsForServer('site_visits');
  const allFollowUps = await getModuleRecordsForServer('follow_ups');
  const allAttendance = await getModuleRecordsForServer('attendance');
  const allTasks = await getModuleRecordsForServer('tasks');
  const allSales = await getModuleRecordsForServer('sales');
  const allLeaves = await getModuleRecordsForServer('leaves');
  const allRemarks = await getModuleRecordsForServer('remarks');
  const allDocs = await getModuleRecordsForServer('documents');
  const allQueries = await getModuleRecordsForServer('queries');
  const allDeals = db.deals || [];
  const allPitches = db.property_pitch_history || [];
  const allDealerCalls = db.dealer_calls || [];
  const allDealerMeetings = db.dealer_meetings || [];

  const data = {};
  
  // Consolidate dynamic timeline
  data.timeline = generateDynamicTimeline(module, id, db);

  if (module === 'employees') {
    data.attendance = allAttendance.filter(a => String(a.employeeId) === String(id));
    data.leaves = allLeaves.filter(l => String(l.employeeId) === String(id));
    data.customers = allCustomers.filter(c => String(c.assignedEmployeeId) === String(id));
    data.properties = allProperties.filter(p => String(p.assignedEmployeeId) === String(id));
    data.tasks = allTasks.filter(t => String(t.assignedTo) === String(id));
    data.remarks = allRemarks.filter(r => r.targetModule === 'employees' && String(r.targetId) === String(id));
    data.documents = allDocs.filter(d => d.targetModule === 'employees' && String(d.targetId) === String(id));
    data.salaries = (db.salaries || []).filter(s => String(s.employeeId) === String(id));
    data.referrals = (db.leads || []).filter(l => l.referrer_type === 'employees' && String(l.referrer_id) === String(id));
  } else if (module === 'customers') {
    const cust = allCustomers.find(c => String(c.id) === String(id));
    data.employee = allEmployees.find(e => String(e.id) === String(cust && cust.assignedEmployeeId));
    data.site_visits = allSiteVisits.filter(s => String(s.customerId) === String(id)).map(sv => ({
      ...sv,
      property: allProperties.find(p => String(p.id) === String(sv.propertyId))
    }));
    data.follow_ups = allFollowUps.filter(f => String(f.customerId) === String(id));
    data.sales = allSales.filter(s => String(s.customerId) === String(id)).map(sa => ({
      ...sa,
      property: allProperties.find(p => String(p.id) === String(sa.propertyId))
    }));
    data.remarks = allRemarks.filter(r => r.targetModule === 'customers' && String(r.targetId) === String(id));
    data.documents = allDocs.filter(d => d.targetModule === 'customers' && String(d.targetId) === String(id));
    
    // Extended ERP connections
    const cleanPhone = String(cust ? cust.phone : '').trim();
    const cleanEmail = String(cust ? cust.email : '').trim().toLowerCase();
    data.leads = (db.leads || []).filter(l => {
      const p = String(l.phone).trim();
      const e = String(l.email || '').trim().toLowerCase();
      return p === cleanPhone || (cleanEmail && e === cleanEmail);
    });
    data.queries = allQueries.filter(q => String(q.customerId) === String(id));
    data.properties = allProperties.filter(p => String(p.current_owner_id) === String(id));
    data.propertiesOwned = data.properties;
    data.deals = allDeals.filter(d => String(d.customerId) === String(id) || String(d.sellerCustomerId) === String(id));
    data.purchaseHistory = allDeals.filter(d => String(d.customerId) === String(id) && d.status === 'Closed');
    data.saleHistory = allDeals.filter(d => String(d.sellerCustomerId) === String(id) && d.status === 'Closed');
    data.pitches = allPitches.filter(p => {
      if (String(p.customerId) !== String(id)) return false;
      const propExists = allProperties.some(pr => String(pr.id) === String(p.propertyId));
      const projExists = (db.projects || []).some(pj => String(pj.id) === String(p.propertyId));
      return propExists || projExists;
    });
    data.referrals = (db.leads || []).filter(l => l.referrer_type === 'customers' && String(l.referrer_id) === String(id));
    data.payments = []; // No payment module exists in GR CRM metadata
  } else if (module === 'properties') {
    const prop = allProperties.find(p => String(p.id) === String(id));
    data.employee = allEmployees.find(e => String(e.id) === String(prop && prop.assignedEmployeeId));
    data.site_visits = allSiteVisits.filter(s => String(s.propertyId) === String(id)).map(sv => ({
      ...sv,
      customer: allCustomers.find(c => String(c.id) === String(sv.customerId))
    }));
    data.sales = allSales.filter(s => String(s.propertyId) === String(id));
    data.remarks = allRemarks.filter(r => r.targetModule === 'properties' && String(r.targetId) === String(id));
    data.documents = allDocs.filter(d => d.targetModule === 'properties' && String(d.targetId) === String(id));
    
    // Add ownership documents from prop fields
    if (prop && prop.ownership_documents) {
      const oldOwnerDocs = (prop.ownership_documents.old_owner || []).map(d => ({ ...d, uploadedBy: 'System', dateAdded: prop.date, id: `DOC-OLD-${d.name}` }));
      const newOwnerDocs = (prop.ownership_documents.new_owner || []).map(d => ({ ...d, uploadedBy: 'System', dateAdded: prop.date, id: `DOC-NEW-${d.name}` }));
      data.documents = [...data.documents, ...oldOwnerDocs, ...newOwnerDocs];
    }
    
    data.viewsCount = data.site_visits.length;
    data.viewedBy = data.site_visits.map(v => v.customer).filter(Boolean);
    
    // Extended ERP connections
    data.currentOwner = allCustomers.find(c => String(c.id) === String(prop && prop.current_owner_id));
    data.ownerHistory = prop ? [...(prop.owner_history || [])] : [];
    const closedDeals = allDeals.filter(d => String(d.propertyId) === String(id) && d.status === 'Closed');
    closedDeals.forEach(d => {
      const alreadyLogged = data.ownerHistory.some(h => 
        String(h.saleDate) === String(d.registrationDate)
      );
      if (!alreadyLogged) {
        const sellerCust = allCustomers.find(c => String(c.id) === String(d.sellerCustomerId));
        const sellerName = sellerCust ? sellerCust.name : (d.sellerCustomerId || prop.contact_person_name || 'Previous Owner');
        data.ownerHistory.push({
          ownerId: d.sellerCustomerId || 'N/A',
          ownerName: sellerName,
          purchaseDate: '',
          purchasePrice: '',
          saleDate: d.registrationDate || new Date().toISOString().split('T')[0],
          salePrice: d.purchasePrice || ''
        });
      }
    });
    data.deals = allDeals.filter(d => String(d.propertyId) === String(id));
    data.buyerHistory = data.deals.map(d => allCustomers.find(c => String(c.id) === String(d.customerId))).filter(Boolean);
    data.sellerHistory = data.deals.map(d => allCustomers.find(c => String(c.id) === String(d.sellerCustomerId))).filter(Boolean);
    data.pitches = allPitches.filter(p => String(p.propertyId) === String(id)).map(p => ({
      ...p,
      customer: allCustomers.find(c => String(c.id) === String(p.customerId)) || (db.leads || []).find(l => String(l.id) === String(p.customerId))
    }));
    data.history = (db.property_history || []).filter(h => String(h.propertyId) === String(id));
  } else if (module === 'dealers') {
    data.remarks = allRemarks.filter(r => r.targetModule === 'dealers' && String(r.targetId) === String(id));
    data.documents = allDocs.filter(d => d.targetModule === 'dealers' && String(d.targetId) === String(id));
    data.calls = allDealerCalls.filter(c => String(c.dealerId) === String(id)).reverse();
    data.meetings = allDealerMeetings.filter(m => String(m.dealerId) === String(id)).map(m => ({
      ...m,
      assignedEmployeeName: allEmployees.find(e => String(e.id) === String(m.assignedEmployeeId))?.name || m.assignedEmployeeId
    }));
    data.properties = allProperties.filter(p => String(p.dealerId) === String(id));
    data.referrals = (db.leads || []).filter(l => l.referrer_type === 'dealers' && String(l.referrer_id) === String(id));
    data.pitches = allPitches.filter(p => String(p.dealerId) === String(id));
    data.wanted_properties = (db.wanted_properties || []).filter(wp => String(wp.dealerId) === String(id)).reverse();
  } else if (module === 'wanted_properties') {
    const wp = (db.wanted_properties || []).find(r => String(r.id) === String(id));
    data.wanted_property = wp;
    data.remarks = allRemarks.filter(r => r.targetModule === 'wanted_properties' && String(r.targetId) === String(id));
    data.documents = allDocs.filter(d => d.targetModule === 'wanted_properties' && String(d.targetId) === String(id));
    if (wp) {
      data.dealer = (db.dealers || []).find(d => String(d.id) === String(wp.dealerId));
      data.employee = allEmployees.find(e => String(e.id) === String(wp.assignedEmployeeId));
      data.property = allProperties.find(p => String(p.id) === String(wp.matchedPropertyId));
    }
  } else if (module === 'dealer_meetings') {
    const meeting = allDealerMeetings.find(m => String(m.id) === String(id));
    data.meeting = meeting;
    if (meeting) {
      const dealerId = meeting.dealerId;
      data.dealer = (db.dealers || []).find(d => String(d.id) === String(dealerId));
      data.calls = allDealerCalls.filter(c => String(c.dealerId) === String(dealerId));
      data.remarks = allRemarks.filter(r => (r.targetModule === 'dealers' && String(r.targetId) === String(dealerId)) || (r.targetModule === 'dealer_meetings' && String(r.targetId) === String(id)));
      data.documents = allDocs.filter(d => (d.targetModule === 'dealers' && String(d.targetId) === String(dealerId)) || (d.targetModule === 'dealer_meetings' && String(d.targetId) === String(id)));
    }
  } else if (module === 'projects') {
    const proj = (db.projects || []).find(p => String(p.id) === String(id));
    data.project = proj;
    data.remarks = allRemarks.filter(r => r.targetModule === 'projects' && String(r.targetId) === String(id));
    data.documents = allDocs.filter(d => d.targetModule === 'projects' && String(d.targetId) === String(id));
    data.pitches = allPitches.filter(p => String(p.propertyId) === String(id)).map(p => ({
      ...p,
      customer: allCustomers.find(c => String(c.id) === String(p.customerId)) || (db.leads || []).find(l => String(l.id) === String(p.customerId))
    }));
    data.history = (db.project_history || []).filter(h => String(h.projectId) === String(id));
  } else {
    data.remarks = allRemarks.filter(r => r.targetModule === module && r.targetId === id);
    data.documents = allDocs.filter(d => d.targetModule === module && d.targetId === id);
    
    if (module === 'follow_ups' || module === 'queries' || module === 'leads') {
      const rec = (db[module] || []).find(r => String(r.id) === String(id));
      if (rec) {
        const custId = rec.customerId || rec.id;
        data.pitches = allPitches.filter(p => {
          if (String(p.customerId) !== String(custId)) return false;
          const propExists = allProperties.some(pr => String(pr.id) === String(p.propertyId));
          const projExists = (db.projects || []).some(pj => String(pj.id) === String(p.propertyId));
          return propExists || projExists;
        }).map(p => ({
          ...p,
          property: allProperties.find(pr => String(pr.id) === String(p.propertyId))
        }));
        data.site_visits = allSiteVisits.filter(sv => String(sv.customerId) === String(custId)).map(sv => ({
          ...sv,
          property: allProperties.find(pr => String(pr.id) === String(sv.propertyId))
        }));
      }
    }
  }

  res.json(data);
});

// --- REMARKS TIMELINE SYSTEM ---

app.get('/api/remarks/:module/:id', authenticateToken, (req, res) => {
  const { module, id } = req.params;
  const db = readDb();
  const remarks = (db.remarks || []).filter(rem => rem.targetModule === module && rem.targetId === id);
  res.json(remarks);
});

app.post('/api/remarks', authenticateToken, async (req, res) => {
  const { targetModule, targetId, comment } = req.body;
  if (!targetModule || !targetId || !comment) {
    return res.status(400).json({ message: 'Target module, record ID and comment text are required.' });
  }

  const db = readDb();
  const newRemark = {
    id: generateUniqueId('REM'),
    targetModule,
    targetId,
    employeeName: req.user.name,
    dateTime: new Date().toLocaleString(),
    comment
  };

  if (!db.remarks) db.remarks = [];
  db.remarks.push(newRemark);
  writeDb(db);

  // Sync to sheets
  syncToSheets('remarks');
  res.status(201).json(newRemark);
});

// --- DOCUMENT SYSTEM ---

app.post('/api/upload', authenticateToken, (req, res) => {
  const { fileName, base64Data } = req.body;
  if (!fileName || !base64Data) {
    return res.status(400).json({ message: 'fileName and base64Data required.' });
  }

  try {
    const base64Clean = base64Data.replace(/^data:.*?;base64,/, "");
    const buffer = Buffer.from(base64Clean, 'base64');
    
    const ext = path.extname(fileName) || '.bin';
    const baseName = path.basename(fileName, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueFileName = `${baseName}_${Date.now()}${ext}`;
    
    const filePath = path.join(uploadsDir, uniqueFileName);
    fs.writeFileSync(filePath, buffer);

    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${uniqueFileName}`;
    res.json({ success: true, fileUrl, fileName: uniqueFileName });
  } catch (err) {
    console.error('File write failed:', err);
    res.status(500).json({ message: 'File upload failed.' });
  }
});

app.post('/api/documents', authenticateToken, (req, res) => {
  const { targetModule, targetId, name, fileUrl } = req.body;
  if (!targetModule || !targetId || !name) {
    return res.status(400).json({ message: 'Target module, record ID, and document name required.' });
  }

  const db = readDb();
  const newDoc = {
    id: generateUniqueId('DOC'),
    targetModule,
    targetId,
    name,
    fileUrl: fileUrl || '/uploads/sample_doc.pdf',
    uploadedBy: req.user.name,
    dateAdded: new Date().toISOString().split('T')[0]
  };

  if (!db.documents) db.documents = [];
  db.documents.push(newDoc);
  writeDb(db);

  syncToSheets('documents');
  res.status(201).json(newDoc);
});

// --- SETTINGS / SHEET CONTROL ---

app.post('/api/settings/test-sheets', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    const success = await syncFromSheets();
    if (success) {
      res.json({ success: true, message: 'Google Sheets sync successful! Data pulled successfully.' });
    } else {
      res.status(400).json({ message: 'Failed to sync. Make sure spreadsheet ID and API Credentials are correct and Sheet Sync is active.' });
    }
  } catch (err) {
    res.status(500).json({ message: 'Error checking sheets: ' + err.message });
  }
});

app.post('/api/settings/sync-now', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  try {
    // 1. Pull data from sheets
    await syncFromSheets();
    
    // 2. Push all local changes back
    const metadata = readMetadata();
    const modulesToSync = Object.keys(metadata.modules);
    
    for (const mod of modulesToSync) {
      await syncToSheets(mod);
    }
    
    // Sync special shared tables
    await syncToSheets('remarks');
    await syncToSheets('documents');

    res.json({ success: true, message: 'Full bidirectional Google Sheets sync finished.' });
  } catch (err) {
    res.status(500).json({ message: 'Failed full sync: ' + err.message });
  }
});

// --- LEAD ROTATION AUTO-REASSIGNMENT SCHEDULER ---
const rotateLeadsTask = () => {
  try {
    const metadata = readMetadata();
    const config = metadata.automationConfig || { leadRotationActive: false, rotationHours: 24 };
    
    // Check if lead rotation engine is active
    if (!config.leadRotationActive) return;

    const db = readDb();
    const leads = db.leads || [];
    // Only assign to active employees with 'Sales' or 'Employee' roles
    const employees = (db.employees || []).filter(e => e.status === 'Active' && (e.role === 'Sales' || e.role === 'Employee'));
    if (employees.length === 0) return;
    
    const remarks = db.remarks || [];
    const now = Date.now();
    
    // Inactivity rotation threshold (read dynamically from config)
    const rotationHours = parseFloat(config.rotationHours) || 24;
    const ROTATION_TIMEOUT = rotationHours * 60 * 60 * 1000; 
    const rotatedSources = config.rotatedSources || [];
    
    let dbChanged = false;
    
    leads.forEach(lead => {
      // Skip finalized leads
      if (lead.status === 'Won' || lead.status === 'Closed' || lead.status === 'Lost') return;
      
      // Skip if rotation is explicitly disabled for this specific lead
      if (lead.enableRotation === false) return;
      
      // Skip rotation if this source is not enabled in preferences
      if (rotatedSources.length > 0 && !rotatedSources.includes(lead.source)) return;
      
      // Calculate baseline activity time
      let lastActionTime = new Date(lead.dateAdded || new Date()).getTime();
      
      // Find latest remark follow-up
      const leadRemarks = remarks.filter(r => r.targetModule === 'leads' && String(r.targetId) === String(lead.id));
      if (leadRemarks.length > 0) {
        const latestRemark = leadRemarks.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date))[0];
        lastActionTime = new Date(latestRemark.timestamp || latestRemark.date).getTime();
      }
      
      if (now - lastActionTime > ROTATION_TIMEOUT) {
        // Filter rotation assignment pool by lead's preferred employees list if set
        let pool = employees;
        if (lead.preferredEmployees) {
          const preferredIds = String(lead.preferredEmployees).split(',').map(id => id.trim()).filter(Boolean);
          if (preferredIds.length > 0) {
            const eligibleEmps = employees.filter(e => preferredIds.includes(String(e.id)));
            if (eligibleEmps.length > 0) {
              pool = eligibleEmps;
            }
          }
        }

        const currentEmpId = lead.assignedEmployeeId;
        const currentIndex = pool.findIndex(e => String(e.id) === String(currentEmpId));
        
        // Find next employee index from the pool
        const nextIndex = (currentIndex + 1) % pool.length;
        const nextEmp = pool[nextIndex];
        
        if (nextEmp && String(nextEmp.id) !== String(currentEmpId)) {
          lead.assignedEmployeeId = nextEmp.id;
          
          // Append system audit remark noting the rotation
          if (!db.remarks) db.remarks = [];
          db.remarks.push({
            id: generateUniqueId('REM'),
            targetModule: 'leads',
            targetId: lead.id,
            comment: `System: Lead rotated automatically from ${pool[currentIndex]?.name || 'unassigned'} to ${nextEmp.name} due to inactivity.`,
            author: 'System Rotation Engine',
            date: new Date().toLocaleDateString('en-IN'),
            timestamp: new Date().toISOString()
          });
          
          // Log recent activity update
          if (!db.activity_logs) db.activity_logs = [];
          db.activity_logs.unshift({
            user: 'System',
            action: `Auto-rotated Lead "${lead.name}" to ${nextEmp.name} (inactivity)`,
            timestamp: new Date().toISOString()
          });
          
          dbChanged = true;
        }
      }
    });
    
    if (dbChanged) {
      writeDb(db);
    }
  } catch (err) {
    console.error('Lead Rotation Scheduler Error:', err);
  }
};


// Public App Update check endpoint
app.get('/api/public/update-check', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config/update-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return res.json(config);
    }
    res.status(404).json({ error: "Update configuration not found." });
  } catch (err) {
    res.status(500).json({ error: "Failed to load update configuration." });
  }
});

// Expose APK file public download
app.get('/public/app-debug.apk', (req, res) => {
  try {
    const apkPath = path.join(__dirname, '../app-debug.apk');
    if (fs.existsSync(apkPath)) {
      return res.sendFile(apkPath);
    }
    res.status(404).json({ error: "APK file not found on server." });
  } catch (err) {
    res.status(500).json({ error: "Failed to download APK file." });
  }
});

// Public Metadata endpoint for Quick-Add portal
app.get('/api/public/metadata', (req, res) => {
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const publicMetadata = {
      modules: metadata.modules,
      chips: metadata.chips
    };
    res.json(publicMetadata);
  } catch (err) {
    res.status(500).json({ error: "Failed to load metadata" });
  }
});

// Public lookup endpoint for dropdown selections in Quick-Add portal
app.get('/api/public/lookup/:module', (req, res) => {
  try {
    const { module } = req.params;

    // Security Allowlist: only allow lookup for public-facing/customer-facing modules
    const allowedLookupModules = ['dealers', 'customers', 'projects', 'properties'];
    if (!allowedLookupModules.includes(module)) {
      return res.status(403).json({ error: "Access denied. Public lookup not allowed for this module." });
    }

    const db = readDb();
    if (!db[module] || !Array.isArray(db[module])) {
      return res.json([]);
    }
    // Return only ID and Name of the records to prevent sensitive leakage
    const lookupList = db[module].map(rec => ({
      id: rec.id,
      name: rec.name || rec.contact_person_name || rec.contactName || rec.title || rec.id
    }));
    res.json(lookupList);
  } catch (err) {
    res.status(500).json({ error: "Failed to load lookup list." });
  }
});

// Public Customer Intake Form Submission (Rate-limited, validated, and anti-spam checked)
app.post('/api/public/lead-intake', ipRateLimiter(15 * 60 * 1000, 10), (req, res) => {
  const { website_url, name, phone, locality, sector, propertyType, optionType, size, plc, budget, queryType = 'Buy Property', landType } = req.body;
  
  // 1. Honeypot check (Bots fill this invisible input)
  if (website_url) {
    console.warn(`[Anti-Spam] Honeypot triggered from IP: ${req.ip}`);
    return res.status(200).json({ success: true, message: "Welcome back! Your new requirements query has been registered." });
  }

  // 2. Strict inputs validation
  if (!name || String(name).trim().length < 2) {
    return res.status(400).json({ message: 'Name must be at least 2 characters long.' });
  }

  const cleanPhone = String(phone || '').trim();
  if (!cleanPhone || cleanPhone.length !== 10 || isNaN(Number(cleanPhone))) {
    return res.status(400).json({ message: 'Phone number must be exactly 10 digits.' });
  }

  // Block potential XSS/spam content injections
  const spamPattern = /<[^>]*>|http|https|www\./i;
  if (spamPattern.test(name) || spamPattern.test(locality) || spamPattern.test(sector)) {
    console.warn(`[Anti-Spam] Suspicious content blocked from IP: ${req.ip}`);
    return res.status(400).json({ message: 'Invalid characters or links detected in submission.' });
  }

  const db = readDb();
  if (!db.leads) db.leads = [];
  
  const existingCust = (db.customers || []).find(c => c.phone && String(c.phone).trim() === cleanPhone);
  const existingLead = (db.leads || []).find(l => l.phone && String(l.phone).trim() === cleanPhone);
  
  if (existingCust || existingLead) {
    const matchedId = existingCust ? existingCust.id : existingLead.id;
    const queryId = generateNextId(db, 'queries', 'QRY');
    const newQuery = {
      id: queryId,
      customerId: matchedId,
      assignedEmployeeId: existingCust ? (existingCust.assignedEmployeeId || 'EMP-001') : (existingLead.assignedEmployeeId || 'EMP-001'),
      date: new Date().toLocaleDateString('en-IN'),
      status: 'Pending Approval',
      queryType: queryType,
      stage: 'New Query',
      budget: budget || '',
      demand: '',
      r_c_i: propertyType || '',
      propertyType: optionType || '',
      locality: locality || '',
      sector_block: sector || '',
      size: size || '',
      remarks: `Auto-created query from public requirement form (Duplicate check match). PLC preferred: ${plc || 'None'}${landType ? ` • Land Type: ${landType}` : ''}`
    };
    
    if (!db.queries) db.queries = [];
    db.queries.push(newQuery);

    // Automatically schedule a follow up task for the new query if it's a lead
    if (String(matchedId).startsWith('LEAD')) {
      db.follow_ups = db.follow_ups || [];
      const followUpId = generateNextId(db, 'follow_ups', 'FOLLOW');
      const newFollowUp = {
        id: followUpId,
        customerId: matchedId,
        queryId: queryId,
        employeeId: existingCust ? (existingCust.assignedEmployeeId || 'EMP-001') : (existingLead.assignedEmployeeId || 'EMP-001'),
        date: new Date().toLocaleDateString('en-IN'),
        time: '12:00 PM',
        status: 'Pending Call',
        pipelineAction: 'Fresh Lead',
        remarks: `Auto-scheduled follow up for requirements form Query ${queryId}.`
      };
      db.follow_ups.push(newFollowUp);
      try { syncToSheets('follow_ups'); } catch(e) {}
    }

    writeDb(db);
    try { syncToSheets('queries'); } catch(e) {}
    
    return res.json({ success: true, message: "Welcome back! Your new requirements query has been registered under your profile.", query: newQuery });
  }

  // Else, create a new Lead
  const leadId = generateNextId(db, 'leads', 'LEAD');
  
  const newLead = {
    id: leadId,
    name,
    phone: cleanPhone,
    locality,
    sector_block: sector,
    propertyType: optionType,
    r_c_i: propertyType,
    size,
    budget,
    status: 'Open',
    leadType: queryType === 'Sell Property' ? 'Seller' : 'Buyer',
    assignedEmployeeId: 'EMP-001',
    dateAdded: new Date().toISOString().split('T')[0]
  };
  
  db.leads.push(newLead);
  try { syncToSheets('leads'); } catch(e) {}

  // Automatically create a Query for the new lead
  const queryId = generateNextId(db, 'queries', 'QRY');
  const newQuery = {
    id: queryId,
    customerId: leadId,
    assignedEmployeeId: 'EMP-001',
    date: new Date().toLocaleDateString('en-IN'),
    status: 'Pending Approval',
    queryType: queryType,
    stage: 'New Query',
    budget: budget || '',
    demand: '',
    r_c_i: propertyType || '',
    propertyType: optionType || '',
    locality: locality || '',
    sector_block: sector || '',
    size: size || '',
    remarks: `Auto-created query from public requirement form. PLC preferred: ${plc || 'None'}${landType ? ` • Land Type: ${landType}` : ''}`
  };
  if (!db.queries) db.queries = [];
  db.queries.push(newQuery);
  try { syncToSheets('queries'); } catch(e) {}

  // Automatically schedule follow-up
  db.follow_ups = db.follow_ups || [];
  const followUpId = generateNextId(db, 'follow_ups', 'FOLLOW');
  const newFollowUp = {
    id: followUpId,
    customerId: leadId,
    queryId: queryId,
    employeeId: 'EMP-001',
    date: new Date().toLocaleDateString('en-IN'),
    time: '12:00 PM',
    status: 'Pending Call',
    pipelineAction: 'Fresh Lead',
    remarks: `Auto-scheduled follow up for requirement form Lead/Query ${queryId}.`
  };
  db.follow_ups.push(newFollowUp);
  try { syncToSheets('follow_ups'); } catch(e) {}

  writeDb(db);
  res.json({ success: true, lead: newLead, query: newQuery });
});

// Public Employee Quick-Add Intake Portal Form Submission
app.post('/api/public/quick-add', ipRateLimiter(15 * 60 * 1000, 10), async (req, res) => {
  const { website_url, module, payload, key } = req.body;

  // 1. Honeypot check
  if (website_url) {
    return res.status(200).json({ success: true, message: "Record added successfully." });
  }

  if (key !== 'gagan_employee_intake_2026') {
    return res.status(403).json({ error: "Invalid access token." });
  }

  // 2. Whitelist allowed modules to block backend backdoors
  const allowedModules = ['leads', 'customers', 'properties', 'queries'];
  if (!allowedModules.includes(module)) {
    return res.status(403).json({ error: "Access denied. Action not allowed on this module from the public intake portal." });
  }

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: "Invalid payload." });
  }

  // Sanitize payload from security fields
  delete payload.password;
  delete payload.passwordHash;
  delete payload.tokenVersion;

  // Enforce phone validation if phone present
  if (payload.phone) {
    const cleanPhone = String(payload.phone).trim();
    if (cleanPhone.length > 0 && (cleanPhone.length !== 10 || isNaN(Number(cleanPhone)))) {
      return res.status(400).json({ error: "Phone number must be exactly 10 digits." });
    }
  }

  try {
    const result = await runTransaction(async (client) => {
      const dbBefore = await loadTransactionDb(client);
      const db = JSON.parse(JSON.stringify(dbBefore));
      
      if (!db[module]) db[module] = [];

      // ID generation using shared helper
      const prefixMap = {
        employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
        projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
        tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
        daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
        property_pitch_history: 'PITCH', dealer_calls: 'CALL'
      };
      const prefix = prefixMap[module] || module.substring(0, 4).toUpperCase();
      payload.id = await generateNextIdAsync(client, module, prefix);

      // Enforce unique phone number / Master Customer record duplicate prevention
      if (payload.phone && (module === 'customers' || module === 'leads')) {
        const cleanPhone = String(payload.phone).trim();
        const existingCust = (db.customers || []).find(r => r.phone && String(r.phone).trim() === cleanPhone);
        const existingLead = (db.leads || []).find(r => r.phone && String(r.phone).trim() === cleanPhone);
        
        if (existingCust || existingLead) {
          const matchedId = existingCust ? existingCust.id : existingLead.id;
          const queryId = await generateNextIdAsync(client, 'queries', 'QRY');
          const queryType = payload.leadType === 'Seller' ? 'Sell Property' : 'Buy Property';
          
          const newQuery = {
            id: queryId,
            customerId: matchedId,
            assignedEmployeeId: payload.assignedEmployeeId || (existingCust ? existingCust.assignedEmployeeId : existingLead.assignedEmployeeId) || 'EMP-001',
            date: new Date().toLocaleDateString('en-IN'),
            status: 'Pending Approval',
            queryType: queryType,
            stage: 'New Query',
            budget: payload.budget || '',
            demand: payload.demand || '',
            r_c_i: payload.r_c_i || '',
            propertyType: payload.propertyType || '',
            locality: payload.locality || '',
            sector_block: payload.sector_block || '',
            size: payload.size || '',
            remarks: payload.remarks || payload.initial_notes || 'Auto-created query due to duplicate lead/customer submission via Quick-Add portal.'
          };
          
          if (!db.queries) db.queries = [];
          db.queries.push(newQuery);

          // Automatically schedule a follow up task for the new query
          if (String(matchedId).startsWith('LEAD')) {
            db.follow_ups = db.follow_ups || [];
            const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
            const newFollowUp = {
              id: followUpId,
              customerId: matchedId,
              queryId: queryId,
              employeeId: payload.assignedEmployeeId || (existingCust ? existingCust.assignedEmployeeId : existingLead.assignedEmployeeId) || 'EMP-001',
              date: new Date().toLocaleDateString('en-IN'),
              time: '12:00 PM',
              status: 'Pending Call',
              pipelineAction: 'Fresh Lead',
              remarks: `Auto-scheduled follow up for Quick-Add Query ${queryId}.`
            };
            db.follow_ups.push(newFollowUp);
            try { syncToSheets('follow_ups'); } catch(e) {}
          }
          try { syncToSheets('queries'); } catch(e) {}
          
          return {
            __is_redirected_query: true,
            message: `Customer already exists. Created Query (${queryId}) linked to customer profile instead.`,
            record: newQuery
          };
        }
      }

      if (module === 'properties') {
        await handlePropertyDealerAssociation(payload, client);
      }

      // Normalize default date added keys if not present
      if (module === 'leads') {
        if (!payload.dateAdded) {
          payload.dateAdded = new Date().toISOString().split('T')[0];
        }
        if (payload.leadType === 'Seller') {
          payload.status = 'Converted';
          payload.assignmentStatus = 'accepted';
          payload.assignmentTime = null;
          payload.droppedBy = [];
        } else {
          payload.assignmentStatus = 'pending';
          payload.assignmentTime = new Date().toISOString();
          payload.droppedBy = [];
        }
        if (payload.assignedEmployeeId) {
          setTimeout(() => {
            notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: payload.id, leadName: payload.name || payload.person_name || 'New Lead' });
          }, 500);
        }
      }
      if (module === 'queries') {
        if (!payload.status) {
          payload.status = 'Pending Approval';
        }
        if (payload.assignedEmployeeId) {
          setTimeout(() => {
            notifyUser(payload.assignedEmployeeId, 'query-assigned', { queryId: payload.id, message: `New Query ${payload.id} assigned to you for approval.` });
          }, 500);
        }
      }

      db[module].push(payload);
      if (module === 'follow_ups') {
        handleFollowUpPipelineAction(payload, db, req);
      } else if (module === 'queries') {
        handleQueryStageChange(payload, db, req);
        if (String(payload.customerId).startsWith('LEAD')) {
          db.follow_ups = db.follow_ups || [];
          const followUpId = generateNextId(db, 'follow_ups', 'FOLLOW');
          const newFollowUp = {
            id: followUpId,
            customerId: payload.customerId,
            queryId: payload.id,
            employeeId: payload.assignedEmployeeId || 'EMP-001',
            date: new Date().toLocaleDateString('en-IN'),
            time: '12:00 PM',
            status: 'Pending Call',
            pipelineAction: 'Fresh Lead',
            remarks: `Auto-scheduled follow up for new Query ${payload.id}: ${payload.remarks || 'No notes'}`
          };
          db.follow_ups.push(newFollowUp);
          try { syncToSheets('follow_ups'); } catch(e) {}
        }
      } else if (module === 'leads') {
        handleLeadStatusChange(payload, db, req);
        if (payload.assignmentStatus === 'accepted' && payload.leadType !== 'Seller') {
          createFollowUpForLead(payload, db);
        }
        if (payload.assignedEmployeeId) {
          syncAssignedEmployeeUniversally('leads', payload.id, payload.assignedEmployeeId, db);
        }
      }

      await syncDbChangesToPostgres(dbBefore, db, client);
      dbCache = db;

      return { record: payload };
    });

    if (result && !result.__is_redirected_query) {
      syncToSheets(module);
      if (module === 'properties') {
        try { syncToSheets('dealers'); } catch (e) {}
      }
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Start background task: Check immediately after 10 seconds, and run every 5 minutes
setTimeout(rotateLeadsTask, 10000);
setInterval(rotateLeadsTask, 5 * 60 * 1000);

// --- LEAD ASSIGNMENT REAL-TIME NOTIFICATION ENGINE (SSE) ---
let notificationClients = [];

function notifyUser(userId, eventType, data) {
  notificationClients.forEach(c => {
    if (String(c.userId) === String(userId)) {
      try {
        c.res.write(`event: ${eventType}\n`);
        c.res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        console.error("SSE write error:", err);
      }
    }
  });
}

function notifyAllUsers(eventType, data) {
  notificationClients.forEach(c => {
    try {
      c.res.write(`event: ${eventType}\n`);
      c.res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error("SSE write error:", err);
    }
  });
}

// Keep-alive heartbeat to prevent Render timeout
setInterval(() => {
  notificationClients.forEach(c => {
    try {
      c.res.write(': keep-alive\n\n');
    } catch (e) {}
  });
}, 15000);

app.get('/api/notifications/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.query.userId || 'anonymous';
  const newClient = { userId, res };
  notificationClients.push(newClient);

  req.on('close', () => {
    notificationClients = notificationClients.filter(c => c !== newClient);
  });
});

async function createFollowUpForLead(lead, dbOrClient, cacheMutations) {
  if (lead.leadType === 'Seller') return;
  const client = dbOrClient || pool;
  
  const cleanPhone = String(lead.phone || '').trim();
  const custRes = await client.query('SELECT * FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\')', [lead.id, cleanPhone]);
  const cust = custRes.rows[0];
  const finalCustId = cust ? cust.id : lead.id;

  const followUpRes = await client.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [finalCustId]);
  const existingFollowUp = followUpRes.rows[0];

  if (existingFollowUp) {
    if (lead.assignedEmployeeId && existingFollowUp.employeeId !== lead.assignedEmployeeId) {
      const updatedFollowUp = await updateRecord('follow_ups', existingFollowUp.id, { employeeId: lead.assignedEmployeeId }, client);
      if (cacheMutations) {
        cacheMutations.push(() => {
          if (dbCache && dbCache.follow_ups) {
            const idx = dbCache.follow_ups.findIndex(x => String(x.id) === String(existingFollowUp.id));
            if (idx !== -1) dbCache.follow_ups[idx] = updatedFollowUp;
          }
        });
      }
    }
  } else {
    const followUpId = await generateNextIdAsync(client, 'follow_ups');
    const newFollowUp = {
      id: followUpId,
      customerId: finalCustId,
      employeeId: lead.assignedEmployeeId || 'EMP-001',
      date: new Date().toLocaleDateString('en-IN'),
      time: '12:00 PM',
      status: 'Pending Call',
      pipelineAction: 'Fresh Lead',
      remarks: `Auto-scheduled follow up for accepted Lead ${lead.id}: ${lead.remarks || 'No notes'}`
    };
    const insertedFollowUp = await insertRecord('follow_ups', newFollowUp, client);
    if (cacheMutations) {
      cacheMutations.push(() => {
        if (dbCache) {
          if (!dbCache.follow_ups) dbCache.follow_ups = [];
          dbCache.follow_ups.push(insertedFollowUp);
        }
      });
    }
  }
}

// Polling fallback to check if user has any pending leads to accept
app.get('/api/leads/pending', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const resPending = await pool.query(
      'SELECT * FROM leads WHERE "assignedEmployeeId" = $1 AND "assignmentStatus" = $2',
      [userId, 'pending']
    );
    res.json(resPending.rows);
  } catch (err) {
    console.error('Error fetching pending leads:', err);
    res.status(500).json({ message: err.message });
  }
});

// Accept Lead
app.post('/api/leads/:id/accept', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const cacheMutations = [];
    const updatedLead = await runTransaction(async (client) => {
      const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [id]);
      const lead = leadRes.rows[0];
      if (!lead) throw new Error("Lead not found.");

      const updated = await updateRecord('leads', id, {
        assignmentStatus: 'accepted',
        assignmentTime: null
      }, client);

      await createFollowUpForLead(updated, client, cacheMutations);
      
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Accepted Lead ${id}`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', log, client);
      
      cacheMutations.push(() => {
        if (dbCache && dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }
      });

      return updated;
    });

    if (dbCache && dbCache.leads) {
      const idx = dbCache.leads.findIndex(l => String(l.id) === String(id));
      if (idx !== -1) {
        dbCache.leads[idx] = updatedLead;
      }
    }
    
    cacheMutations.forEach(mutate => mutate());
    try { syncToSheets('leads'); } catch(e) {}
    try { syncToSheets('follow_ups'); } catch(e) {}

    res.json({ success: true, message: "Lead accepted successfully.", lead: updatedLead });
  } catch (err) {
    console.error('Error accepting lead:', err);
    res.status(err.message.includes('not found') ? 404 : 400).json({ message: err.message });
  }
});

// Drop Lead (Pass to other employee)
app.post('/api/leads/:id/drop', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const cacheMutations = [];
    const updatedLead = await runTransaction(async (client) => {
      const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [id]);
      const lead = leadRes.rows[0];
      if (!lead) throw new Error("Lead not found.");

      const oldAssignee = lead.assignedEmployeeId;
      const droppedBy = lead.droppedBy || [];
      if (!droppedBy.includes(oldAssignee)) {
        droppedBy.push(oldAssignee);
      }

      const empRes = await client.query('SELECT * FROM employees');
      const employees = empRes.rows;

      let candidates = employees.filter(emp => 
        emp.role !== 'Admin' && 
        String(emp.id) !== String(oldAssignee) && 
        !droppedBy.includes(emp.id)
      );

      if (candidates.length === 0) {
        droppedBy.length = 0; 
        droppedBy.push(oldAssignee);
        candidates = employees.filter(emp => emp.role !== 'Admin' && String(emp.id) !== String(oldAssignee));
      }

      let nextEmpId = 'EMP-001';
      let assignmentStatus = 'accepted';
      let assignmentTime = null;

      if (candidates.length > 0) {
        const nextEmp = candidates[0];
        nextEmpId = nextEmp.id;
        assignmentStatus = 'pending';
        assignmentTime = new Date().toISOString();
        setTimeout(() => {
          notifyUser(nextEmp.id, 'new-lead', { leadId: lead.id, leadName: lead.name || lead.person_name || 'New Lead' });
        }, 500);
      }

      const updated = await updateRecord('leads', id, {
        assignedEmployeeId: nextEmpId,
        assignmentStatus,
        assignmentTime,
        droppedBy
      }, client);

      if (assignmentStatus === 'accepted') {
        await createFollowUpForLead(updated, client, cacheMutations);
      }

      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Dropped Lead ${id} (reassigned to ${nextEmpId})`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', log, client);
      
      cacheMutations.push(() => {
        if (dbCache && dbCache.activity_logs) {
          dbCache.activity_logs.unshift(log);
        }
      });

      return updated;
    });

    if (dbCache && dbCache.leads) {
      const idx = dbCache.leads.findIndex(l => String(l.id) === String(id));
      if (idx !== -1) {
        dbCache.leads[idx] = updatedLead;
      }
    }

    cacheMutations.forEach(mutate => mutate());
    try { syncToSheets('leads'); } catch(e) {}
    try { syncToSheets('follow_ups'); } catch(e) {}

    res.json({ success: true, message: "Lead dropped and re-assigned.", lead: updatedLead });
  } catch (err) {
    console.error('Error dropping lead:', err);
    res.status(err.message.includes('not found') ? 404 : 400).json({ message: err.message });
  }
});

// --- AI ASSISTANT API ENDPOINTS ---
const { generateAIResponse } = require('./utils/aiProvider');
const { filterDb, CRMSearchService } = require('./services/crmSearchService');

// Helper to resolve employee name
function getEmployeeName(empId, db) {
  const emp = (db.employees || []).find(e => String(e.id) === String(empId));
  return emp ? emp.name : 'Relationship Manager';
}

app.post('/api/ai/customer-summary', authenticateToken, (req, res) => {
  const { customerId } = req.body;
  const db = filterDb(readDb());
  
  const customer = (db.customers || []).find(c => String(c.id) === String(customerId)) ||
                   (db.leads || []).find(l => String(l.id) === String(customerId));
                   
  if (!customer) {
    return res.status(404).json({ message: "Customer/Lead not found." });
  }

  const cleanId = String(customer.id);
  const followups = (db.follow_ups || []).filter(f => String(f.customerId) === cleanId);
  const siteVisits = (db.site_visits || []).filter(v => String(v.customerId) === cleanId);
  const pitches = (db.property_pitch_history || []).filter(p => String(p.customerId) === cleanId);
  const deals = (db.deals || []).filter(d => String(d.customerId) === cleanId);
  const empName = getEmployeeName(customer.assignedEmployeeId || customer.employeeId, db);

  const contextData = {
    customer,
    followups,
    siteVisits,
    pitches,
    deals,
    employeeName: empName
  };

  const systemPrompt = `You are a Real Estate Sales Manager. Summarize the customer's profile, timelines, and journey. Use CRM data before writing. Output in plain text or standard markdown.`;
  const prompt = `Summarize customer details for ID ${cleanId}. Budget is ${customer.budget || 'N/A'}. Preferred locality: ${customer.locality || 'N/A'}.`;

  generateAIResponse(prompt, systemPrompt, contextData)
    .then(summary => {
      res.json({ summary });
    })
    .catch(err => {
      res.status(500).json({ message: "AI response failed", error: err.message });
    });
});

app.post('/api/ai/lead-scoring', authenticateToken, (req, res) => {
  const { customerId } = req.body;
  const db = filterDb(readDb());

  const customer = (db.customers || []).find(c => String(c.id) === String(customerId)) ||
                   (db.leads || []).find(l => String(l.id) === String(customerId));

  if (!customer) {
    return res.status(404).json({ message: "Lead/Customer not found." });
  }

  const cleanId = String(customer.id);
  const followups = (db.follow_ups || []).filter(f => String(f.customerId) === cleanId);
  const siteVisits = (db.site_visits || []).filter(v => String(v.customerId) === cleanId);

  const contextData = {
    customer,
    followups,
    siteVisits
  };

  const systemPrompt = `Analyze lead metrics to output a JSON object containing { "score": number, "label": "Very Hot" | "Hot" | "Warm" | "Cold", "reasons": string[] }. Do not include formatting marks like backticks.`;
  const prompt = `Evaluate lead conversion scoring for customer ID ${cleanId}.`;

  generateAIResponse(prompt, systemPrompt, contextData)
    .then(result => {
      try {
        const parsed = JSON.parse(result);
        res.json(parsed);
      } catch (e) {
        res.json({ score: 65, label: "Warm", reasons: ["Engagement is stable."] });
      }
    })
    .catch(err => res.status(500).json({ error: err.message }));
});



app.post('/api/ai/generate-content', authenticateToken, (req, res) => {
  const { type, customerId, projectName } = req.body;
  const db = filterDb(readDb());

  const customer = (db.customers || []).find(c => String(c.id) === String(customerId)) ||
                   (db.leads || []).find(l => String(l.id) === String(customerId));

  const empName = req.user.name;

  const contextData = {
    customerName: customer ? customer.name : "Client",
    projectName: projectName || "Gagan Realtech Listings",
    employeeName: empName
  };

  const systemPrompt = `Generate a customized ${type} message template. Use variables where applicable. Do not wrap in markdown or backticks unless requested.`;
  const prompt = `Generate ${type} text for client ${contextData.customerName} regarding project ${contextData.projectName}.`;

  generateAIResponse(prompt, systemPrompt, contextData)
    .then(text => {
      if (type === 'email') {
        try {
          const parsed = JSON.parse(text);
          res.json(parsed);
        } catch (e) {
          res.json({
            subject: `Updated Listings: ${projectName}`,
            body: text,
            cta: "Book Meeting"
          });
        }
      } else {
        res.json({ text });
      }
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/ai/daily-evening-summary', authenticateToken, (req, res) => {
  const { type } = req.body;
  const db = filterDb(readDb());

  const todayStr = new Date().toISOString().split('T')[0];
  const followups = (db.follow_ups || []).filter(f => f.date === new Date().toLocaleDateString('en-IN') || f.date === todayStr);
  const siteVisits = (db.site_visits || []).filter(v => v.date === new Date().toLocaleDateString('en-IN') || v.date === todayStr);
  const tasks = db.tasks || [];
  const employees = db.employees || [];
  const deals = (db.deals || []).filter(d => d.registrationDate === todayStr);

  const contextData = {
    followups,
    siteVisits,
    tasks,
    employees,
    deals
  };

  const systemPrompt = `Generate a JSON object for real estate managers summarizing daily briefings: { "todayFollowups": number, "todayVisits": number, "overdueTasks": number, "employeesOnLeave": number, "pendingSales": number, "expectedRevenue": string, "priorityCustomers": string[] } for morning; or achievements: { "callsCompleted": number, "visitsCompleted": number, "dealsClosed": number, "pendingTasks": number, "scheduleTomorrow": string } for evening.`;
  const prompt = `Generate CRM ${type} report summary.`;

  generateAIResponse(prompt, systemPrompt, contextData)
    .then(result => {
      try {
        const parsed = JSON.parse(result);
        res.json(parsed);
      } catch (e) {
        res.json({ error: "Failed to parse AI summary response." });
      }
    })
    .catch(err => {
      console.error("AI briefing failed:", err);
      const isNotConfigured = err.message.includes("not configured") || err.message.includes("apiKey");
      res.status(isNotConfigured ? 400 : 500).json({ error: isNotConfigured ? "AI provider not configured" : err.message });
    });
});

app.post('/api/ai/insights', authenticateToken, (req, res) => {
  const db = filterDb(readDb());
  const contextData = {
    leads: db.leads || [],
    deals: db.deals || [],
    properties: db.properties || [],
    followups: db.follow_ups || [],
    siteVisits: db.site_visits || []
  };

  const systemPrompt = `Generate a JSON list of 4 key insights regarding real estate marketing performance and RM conversions. Do not use markdown wrappers.`;
  const prompt = `Extract sales insights.`;

  generateAIResponse(prompt, systemPrompt, contextData)
    .then(result => {
      try {
        const parsed = JSON.parse(result);
        res.json(parsed);
      } catch (e) {
        res.json([
          "Facebook Ads continue to lead acquisition.",
          "Secondary site visit conversion is at 84%."
        ]);
      }
    })
    .catch(err => {
      console.error("AI insights failed:", err);
      const isNotConfigured = err.message.includes("not configured") || err.message.includes("apiKey");
      res.status(isNotConfigured ? 400 : 500).json({ error: isNotConfigured ? "AI provider not configured" : err.message });
    });
});

function filterDbForUser(db, user) {
  if (!user || user.role === 'Admin') return db;
  
  const userId = String(user.id);
  const filtered = { ...db };
  
  const followUps = db.follow_ups || [];
  const siteVisits = db.site_visits || [];
  const pitches = db.property_pitch_history || [];
  
  const myFollowUpCustomerIds = new Set(followUps.filter(f => String(f.employeeId) === userId).map(f => String(f.customerId)));
  const mySiteVisitCustomerIds = new Set(siteVisits.filter(sv => String(sv.employeeId) === userId).map(sv => String(sv.customerId)));
  const myPitchCustomerIds = new Set(pitches.filter(p => String(p.employeeId) === userId).map(p => String(p.customerId)));
  
  if (db.leads) {
    filtered.leads = db.leads.filter(r => 
      String(r.assignedEmployeeId) === userId ||
      myFollowUpCustomerIds.has(String(r.id)) ||
      mySiteVisitCustomerIds.has(String(r.id)) ||
      myPitchCustomerIds.has(String(r.id))
    );
  }
  
  if (db.customers) {
    filtered.customers = db.customers.filter(r => 
      String(r.assignedEmployeeId) === userId ||
      myFollowUpCustomerIds.has(String(r.id)) ||
      mySiteVisitCustomerIds.has(String(r.id)) ||
      myPitchCustomerIds.has(String(r.id))
    );
  }
  
  if (db.follow_ups) {
    filtered.follow_ups = db.follow_ups.filter(r => String(r.employeeId) === userId);
  }
  
  if (db.queries) {
    const myFollowUpQueryIds = new Set(followUps.filter(f => String(f.employeeId) === userId).map(f => String(f.queryId)));
    filtered.queries = db.queries.filter(r => 
      String(r.assignedEmployeeId) === userId ||
      myFollowUpQueryIds.has(String(r.id))
    );
  }
  
  if (db.property_pitch_history) {
    filtered.property_pitch_history = db.property_pitch_history.filter(r => String(r.employeeId) === userId);
  }
  
  if (db.site_visits) {
    filtered.site_visits = db.site_visits.filter(r => String(r.employeeId) === userId);
  }
  
  if (db.salaries) {
    filtered.salaries = db.salaries.filter(r => String(r.employeeId) === userId);
  }
  
  if (db.tasks) {
    filtered.tasks = db.tasks.filter(r => String(r.assignedTo) === userId);
  }
  
  return filtered;
}

app.post('/api/ai/parse-wanted-text', authenticateToken, async (req, res) => {
  const { rawText } = req.body;
  if (!rawText) {
    return res.json({ parseFailed: true, error: "No text provided" });
  }

  const systemPrompt = `You are a real estate parser AI. Extract wanted property requirements from raw WhatsApp messages.
Response must be a single valid JSON object with the following fields:
{
  "requirementType": "Buy Property" | "Sell Property" | "Rent" | null,
  "propertyType": "Plot" | "Villa" | "Apartment" | "Commercial" | "LOI" | null,
  "locality": string | null,
  "sizeRequired": string | null,
  "budget": string | null,
  "dealerContactNum": "10-digit phone number" | null,
  "dealerContactName": string | null,
  "dealerFirmName": string | null,
  "dealerAddress": string | null
}
Ensure no explanation, no markdown backticks, just the raw JSON object. If a field cannot be found, set it to null. Convert phone numbers to exactly 10 digits without spaces or country codes. Extract dealerContactName if a person name is mentioned, dealerFirmName if a company or agency name is mentioned (like "AB realtors" or "XYZ agency"), and dealerAddress if a dealer's office address is mentioned.`;

  try {
    const aiResponse = await generateAIResponse(
      `Parse this WhatsApp message:\n\n${rawText}`,
      systemPrompt
    );
    
    let cleaned = aiResponse.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(json)?/, '').replace(/```$/, '').trim();
    }
    
    const parsed = JSON.parse(cleaned);
    res.json(parsed);
  } catch (err) {
    console.error("Failed to parse wanted text using AI:", err);
    res.json({ parseFailed: true });
  }
});

app.post('/api/ai/chat', authenticateToken, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 1. Read and filter database for the logged-in user
    const rawDb = readDb();
    const cleanDb = filterDb(rawDb);
    const db = filterDbForUser(cleanDb, req.user);

    // 2. AI Intent Classification (Preliminary Step)
    const classificationSystemPrompt = `You are a classification assistant for a Real Estate CRM.
Your task is to analyze the user's query and extract their intent:
1. Which CRM module or modules are relevant to search? Choose only from the following list of allowed module keys:
   - "employees"
   - "attendance"
   - "salaries"
   - "leaves"
   - "leads"
   - "follow_ups"
   - "customers"
   - "properties"
   - "projects"
   - "deals"
   - "queries"
   - "daily_price_lists"
   - "employee_notices"
   - "documents"
   Note: Map "payments", "dues", "unpaid amount", "who has paid", "pending payments" to the "deals" module.
2. What search term or keyword (like a person's name, property ID, location name) is the user looking for?
3. Any specific filters (such as status: "Pending", "Closed", "Active", "Available", "Under Process") that should be applied.

You must output ONLY a valid JSON object matching the format below, with no markdown styling, no backticks, and no extra conversational text:
{
  "modules": ["deals"],
  "searchTerm": "",
  "filters": {
    "status": "Pending"
  },
  "intentSummary": "Search for pending or unpaid deals."
}`;

    let classification = { modules: [], searchTerm: "", filters: {} };
    try {
      const classificationRes = await generateAIResponse(message, classificationSystemPrompt);
      if (classificationRes) {
        const cleanRes = classificationRes.replace(/```json/i, '').replace(/```/g, '').trim();
        classification = JSON.parse(cleanRes);
      }
    } catch (e) {
      console.warn("AI intent classification failed or returned plain text. Falling back to heuristic mapping.");
    }

    // Heuristic Fallback if AI classification didn't return modules
    if (!classification.modules || classification.modules.length === 0) {
      const searchResult = CRMSearchService.search(message, db);
      if (searchResult.type === 'entity360') {
        classification.modules = [searchResult.data.moduleKey];
        classification.searchTerm = searchResult.data.record.name || searchResult.data.record.person_name || '';
      } else if (searchResult.type === 'multipleMatches') {
        classification.modules = [...new Set(searchResult.data.map(m => m.moduleKey))];
      } else if (searchResult.type === 'moduleList') {
        classification.modules = [searchResult.data.moduleKey];
      } else {
        // Broad default search if nothing matched
        classification.modules = ["employees", "leads", "customers", "properties", "deals", "follow_ups"];
      }
    }

    // Use classification intent to search & filter database
    const matchedRecords = [];
    const todayStr = new Date().toLocaleDateString('en-IN');
    const qWord = classification.searchTerm ? String(classification.searchTerm).toLowerCase().trim() : '';
    const filters = classification.filters || {};

    for (const mKey of classification.modules) {
      if (!db[mKey]) continue;
      let list = db[mKey];

      // Apply intent-based filters (status, date, reference IDs, etc.)
      if (Object.keys(filters).length > 0) {
        list = list.filter(rec => {
          for (const [fKey, fVal] of Object.entries(filters)) {
            if (fVal === undefined || fVal === null || fVal === '') continue;

            // Handle date filter
            if (fKey === 'date' && String(fVal).toLowerCase() === 'today') {
              if (rec.date && rec.date !== todayStr) return false;
              if (rec.registrationDate && rec.registrationDate !== new Date().toISOString().split('T')[0]) return false;
              continue;
            }

            // Handle status/stage filter
            if (fKey === 'status' || fKey === 'stage') {
              const recVal = rec.status || rec.stage;
              if (!recVal || String(recVal).toLowerCase() !== String(fVal).toLowerCase()) {
                // Support equivalent mappings (Pending <-> Under Process)
                const fValClean = String(fVal).toLowerCase();
                const recValClean = String(recVal).toLowerCase();
                if (fValClean === 'pending' && recValClean === 'under process') continue;
                if (fValClean === 'under process' && recValClean === 'pending') continue;
                if (fValClean === 'unpaid' && recValClean === 'pending') continue;
                return false;
              }
              continue;
            }

            // General field match
            if (rec[fKey] !== undefined) {
              if (String(rec[fKey]).toLowerCase() !== String(fVal).toLowerCase()) return false;
            }
          }
          return true;
        });
      }

      // Apply search term filter
      if (qWord) {
        list = list.filter(rec => {
          // Direct field check
          const directMatch = Object.keys(rec).some(k => {
            const val = rec[k];
            if (val === undefined || val === null) return false;
            return String(val).toLowerCase().includes(qWord);
          });
          if (directMatch) return true;

          // Reference checks (if property name, employee name, or customer name matched query)
          if (rec.customerId && db.customers) {
            const cust = db.customers.find(c => String(c.id) === String(rec.customerId));
            if (cust && (cust.name || cust.person_name || '').toLowerCase().includes(qWord)) return true;
          }
          if (rec.customerId && db.leads) {
            const lead = db.leads.find(l => String(l.id) === String(rec.customerId));
            if (lead && (lead.name || lead.person_name || '').toLowerCase().includes(qWord)) return true;
          }
          if (rec.employeeId && db.employees) {
            const emp = db.employees.find(e => String(e.id) === String(rec.employeeId));
            if (emp && (emp.name || '').toLowerCase().includes(qWord)) return true;
          }
          if (rec.propertyId && db.properties) {
            const prop = db.properties.find(p => String(p.id) === String(rec.propertyId));
            if (prop && (prop.propertyName || prop.name || '').toLowerCase().includes(qWord)) return true;
          }
          return false;
        });
      }

      for (const rec of list) {
        matchedRecords.push({ moduleKey: mKey, rec });
      }
    }

    // Populate context data for main AI prompt grounding
    const contextData = {};
    contextData.todaySummary = {
      todayDate: todayStr,
      followUpsToday: (db.follow_ups || []).filter(f => f.status !== 'Completed' && f.date === todayStr).length,
      tasksOverdue: (db.tasks || []).filter(t => t.status !== 'Completed').length,
      siteVisitsToday: (db.site_visits || []).filter(s => s.date === todayStr).length,
      totalActiveLeads: (db.leads || []).filter(l => l.status !== 'Dropped' && l.status !== 'Converted').length,
      totalPropertiesCount: (db.properties || []).filter(p => p.status === 'Available').length
    };

    if (matchedRecords.length > 0) {
      for (const item of matchedRecords) {
        if (!contextData[item.moduleKey]) {
          contextData[item.moduleKey] = [];
        }
        // Limit to max 15 records per module
        if (contextData[item.moduleKey].length < 15) {
          contextData[item.moduleKey].push(item.rec);
        }
      }
    } else {
      contextData.searchResults = [];
      contextData.note = "No matching records found for this query";
    }

    const systemPrompt = `You are an advanced AI Assistant for a Real Estate CRM (Gagan Realtech Copilot).
CRITICAL GROUNDING RULE: Never invent, imagine, or fabricate any record, ID, name, price, date, or status not present in the CRM Database Context below. If asked for an 'example,' politely explain you can only show real data from the CRM, not made-up examples.

If an EXACT match exists, show it normally. If NO exact match exists, you may show up to 3 closest alternative results, but you must clearly label them with the heading 'No exact match found. Closest alternatives:' before listing them — never present an approximate result as if it were an exact match. If there are zero results even approximately close, say so plainly and do not invent one.

If no button format is explicitly defined below for a type of record you are discussing, do not invent new button labels — only use the exact button formats listed below, or omit buttons entirely for that record type.

CRITICAL FORMATTING & STYLE INSTRUCTIONS:
- Answer the user's question in natural, conversational language first, in your own words, as a knowledgeable assistant would — then present the specific matching records below your explanation using the existing card format.
- Do not show scores, percentages, rankings, or any internal reasoning about how matches were found.
- Do not use asterisks or markdown headers for casual conversational replies — only use the structured card format when actually presenting record data.
- You must NEVER display plain text records when a corresponding page exists.
- Every record must be clickable and contain quick action buttons. Format them exactly using the markdown: [Button Label](file:///module/path) or [Button Label](https://...).
- Wrap all matching search keywords, names, statuses, and dates in double asterisks, e.g. **Rajan Gupta**, **Active**, **24/07/2026**.

QUICK ACTION BUTTONS BY ENTITY TYPE:
* Employee (e.g. EMP-002, Rajan Gupta):
  [Open Profile](file:///module/employees/EMP-002) [Attendance](file:///module/attendance?employeeId=EMP-002) [Payroll](file:///module/salary?employeeId=EMP-002) [Leave](file:///module/leaves?employeeId=EMP-002) [Assigned Leads](file:///module/leads?assignedEmployeeId=EMP-002) [Assigned Customers](file:///module/customers?relationshipManagerId=EMP-002) [Property Pitches](file:///module/property_pitch_history?employeeName=Rajan%20Gupta) [Meetings](file:///module/follow_ups?employeeId=EMP-002) [Performance](file:///module/employees/EMP-002)
  
* Lead (e.g. LEAD-001, Amit Pathak, phone: 9417094170):
  [Open Lead](file:///module/leads/LEAD-001) [Customer](file:///module/customers?leadId=LEAD-001) [Property Pitches](file:///module/property_pitch_history?customerId=LEAD-001) [Follow-ups](file:///module/follow_ups?customerId=LEAD-001) [Meetings](file:///module/follow_ups?customerId=LEAD-001) [Call History](file:///module/follow_ups?customerId=LEAD-001) [WhatsApp](https://wa.me/919417094170?text=Hi) [Documents](file:///module/documents?leadId=LEAD-001) [Booking](file:///module/sales_bookings?leadId=LEAD-001)
  
* Customer (e.g. CUST-001, Aman Sharma):
  [Open Customer](file:///module/customers/CUST-001) [Interested Properties](file:///module/properties?customerId=CUST-001) [Property Pitches](file:///module/property_pitch_history?customerId=CUST-001) [Payments](file:///module/deals?customerId=CUST-001) [Meetings](file:///module/follow_ups?customerId=CUST-001) [Documents](file:///module/documents?customerId=CUST-001) [Timeline](file:///module/customers/CUST-001)
  
* Property (e.g. PROP-001):
  [Open Property](file:///module/properties/PROP-001) [Project](file:///module/projects/PROJ-001) [Builder](file:///module/properties/PROP-001) [Property Pitch History](file:///module/property_pitch_history?propertyId=PROP-001) [Interested Customers](file:///module/customers?propertyId=PROP-001) [Assigned Employees](file:///module/employees?propertyId=PROP-001) [Follow-ups](file:///module/follow_ups?propertyId=PROP-001) [Site Visits](file:///module/site_visits?propertyId=PROP-001) [Documents](file:///module/documents?propertyId=PROP-001) [Booking](file:///module/sales_bookings?propertyId=PROP-001)

SEARCH RESULT CARD FORMAT:
Every search result must be separated by blank lines and show:
- Icon (e.g. 👤, 🏠, 📞, 🏗️)
- Title (e.g. **Gagan Chopra**)
- Status (e.g. Status: **Active**)
- Summary (e.g. Role: Admin, Phone: 1234567890)
- Size (whenever size exists on the record)
- Demand/Price (whenever demand or price exists on the record)
- Date (e.g. Joined: **2026-07-08**)
- Quick Actions (The inline quick action buttons listed above)`;

    // 3. Call AI dispatch routine with token callback writing directly to stream
    await generateAIResponse(
      message, 
      systemPrompt, 
      contextData, 
      (token) => {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      },
      history
    );

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error("AI chat error:", err);
    let errorMsg = err.message;
    let statusCode = 500;
    if (err.message.includes("not configured")) {
      errorMsg = "AI provider not configured — contact your admin";
      statusCode = 403;
    }
    res.write(`data: ${JSON.stringify({ error: errorMsg, code: statusCode })}\n\n`);
    res.end();
  }
});

// ==========================================
// GOOGLE SHEETS ASYNC SYNC DASHBOARD & IMPORT API
// ==========================================
const { google } = require('googleapis');
const crypto = require('crypto');

// Get overall metrics of sync queue
app.get('/api/sync/dashboard/metrics', authenticateToken, (req, res) => {
  const db = readDb();
  const jobs = db.sync_jobs || [];

  const metrics = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, { PENDING: 0, PROCESSING: 0, SUCCESS: 0, FAILED: 0 });

  res.json({ success: true, metrics });
});

// List sync jobs
app.get('/api/sync/dashboard/jobs', authenticateToken, (req, res) => {
  const db = readDb();
  const jobs = db.sync_jobs || [];
  
  // Sort descending by updated/created time
  const sortedJobs = [...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  
  res.json({ success: true, data: sortedJobs.slice(0, 100) });
});

// Trigger a retry for a specific failed job
app.post('/api/sync/dashboard/retry/:jobId', authenticateToken, (req, res) => {
  const { jobId } = req.params;
  const db = readDb();
  db.sync_jobs = db.sync_jobs || [];

  const job = db.sync_jobs.find(j => j.id === jobId);
  if (!job) {
    return res.status(404).json({ success: false, message: 'Sync job not found.' });
  }

  job.status = 'PENDING';
  job.attemptCount = 0;
  job.lastError = null;
  job.updatedAt = new Date().toISOString();
  job.nextAttemptAt = new Date().toISOString();

  writeDb(db);
  
  // Trigger processing immediately in background
  setImmediate(() => processSyncQueue());

  res.json({ success: true, message: 'Sync job enqueued for immediate retry.' });
});

// Explicit import preview from Google Sheets
app.post('/api/sync/dashboard/reconcile-preview/:module', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { module } = req.params;
  const db = readDb();

  const config = getSheetsConfig();
  const email = config.clientEmail;
  const privateKey = config.privateKey;
  const spreadsheetId = config.spreadsheetId;

  if (!email || !privateKey || !spreadsheetId) {
    return res.status(400).json({ success: false, message: 'Google Sheets sync configuration or environment variables are inactive.' });
  }

  try {
    const sheets = getSheetsClient(config);
    if (!sheets) {
      return res.status(400).json({ success: false, message: 'Google Sheets sync client failed to initialize.' });
    }
    const sheetName = `data_${module}`;

    // Read sheet values
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A1:Z10000`
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return res.json({ success: true, message: 'Sheet is empty or has only headers.', changes: [] });
    }

    const rawHeaders = rows[0] || [];
    const headers = rawHeaders.map(h => String(h).trim());
    const lowerHeaders = headers.map(h => h.toLowerCase());
    const crmIdIndex = lowerHeaders.indexOf('crm_id') !== -1 ? lowerHeaders.indexOf('crm_id') : lowerHeaders.indexOf('id');
    if (crmIdIndex === -1) {
      return res.status(400).json({ success: false, message: 'Google Sheet is missing the required crm_id/id column in A1.' });
    }

    const changes = [];
    const dbRecords = db[module] || [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const crmId = row[crmIdIndex] ? String(row[crmIdIndex]).trim() : '';
      const sheetRecord = {};
      headers.forEach((h, idx) => {
        let val = row[idx] !== undefined ? row[idx] : '';
        if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
          try { val = JSON.parse(val); } catch(e) {}
        }
        if (typeof val === 'string' && val.trim() !== '' && !isNaN(val)) {
          val = Number(val);
        }
        sheetRecord[h] = val;
      });

      // Match against CRM Database
      const matchedDbRecord = dbRecords.find(r => String(r.id) === String(crmId));
      let validationError = null;
      let conflictFields = [];

      // Validate references and field inputs
      if (sheetRecord.assignedEmployeeId) {
        const empExists = (db.employees || []).some(e => String(e.id) === String(sheetRecord.assignedEmployeeId));
        if (!empExists) {
          validationError = `Assigned Exec ID '${sheetRecord.assignedEmployeeId}' does not exist in CRM database.`;
        }
      }
      if (sheetRecord.phone) {
        const cleanPhone = String(sheetRecord.phone).trim();
        if (cleanPhone.length > 0 && (cleanPhone.length < 10 || isNaN(Number(cleanPhone)))) {
          validationError = `Invalid phone number format: '${sheetRecord.phone}'. Must be a 10-digit number.`;
        }
      }

      if (matchedDbRecord) {
        // Evaluate conflicts
        Object.keys(sheetRecord).forEach(k => {
          if (k === 'crm_id' || k === 'id') return;
          const sheetVal = sheetRecord[k];
          const dbVal = matchedDbRecord[k];
          const stringSheet = typeof sheetVal === 'object' ? JSON.stringify(sheetVal) : String(sheetVal !== undefined && sheetVal !== null ? sheetVal : '');
          const stringDb = typeof dbVal === 'object' ? JSON.stringify(dbVal) : String(dbVal !== undefined && dbVal !== null ? dbVal : '');
          if (stringSheet.trim() !== stringDb.trim()) {
            conflictFields.push({
              field: k,
              sheetValue: sheetVal,
              crmValue: dbVal
            });
          }
        });

        if (conflictFields.length > 0) {
          changes.push({
            type: 'CONFLICT',
            crmRecordId: crmId,
            name: matchedDbRecord.name || matchedDbRecord.person_name || matchedDbRecord.propertyName || crmId,
            conflicts: conflictFields,
            validationError,
            sheetRecord
          });
        }
      } else {
        // Unlinked row
        changes.push({
          type: 'UNLINKED_ROW',
          crmRecordId: crmId || 'New',
          name: sheetRecord.name || sheetRecord.person_name || sheetRecord.propertyName || 'New Record',
          conflicts: [],
          validationError: validationError || (crmId ? `Record ID '${crmId}' not found in CRM.` : 'Missing crm_id.'),
          sheetRecord
        });
      }
    }

    res.json({
      success: true,
      module,
      previewToken: `PREV-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      changes
    });

  } catch (err) {
    console.error('Reconcile Preview Error:', err);
    res.status(500).json({ success: false, message: 'Reconcile Error: ' + err.message });
  }
});

// Confirm import reconciliation changes
app.post('/api/sync/dashboard/reconcile-confirm/:module', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { module } = req.params;
  const { acceptedChanges } = req.body; // Array of sheetRecords that the admin accepted to overwrite CRM

  if (!acceptedChanges || !Array.isArray(acceptedChanges)) {
    return res.status(400).json({ success: false, message: 'Invalid accepted changes list.' });
  }

  const db = readDb();
  db[module] = db[module] || [];
  let updatedCount = 0;
  let createdCount = 0;

  acceptedChanges.forEach(sheetRec => {
    const crmId = sheetRec.crm_id;
    const dbIndex = db[module].findIndex(r => String(r.id) === String(crmId));

    // Strip out crm_id before saving in db.json
    const cleanedRec = { ...sheetRec };
    delete cleanedRec.crm_id;

    if (dbIndex !== -1) {
      // Overwrite CRM with Sheet record values
      db[module][dbIndex] = { ...db[module][dbIndex], ...cleanedRec };
      updatedCount++;
    } else if (cleanedRec.id) {
      // Add as a new record in CRM
      db[module].push(cleanedRec);
      createdCount++;
    }
  });

  if (updatedCount > 0 || createdCount > 0) {
    writeDb(db);
    // Enqueue outbound sync job to align Sheets correctly
    syncToSheets(module);
  }

  res.json({
    success: true,
    message: `Reconciliation successful. Updated ${updatedCount} records, created ${createdCount} records in CRM.`
  });
});

app.listen(PORT, async () => {
  console.log(`Gagan Realtech ERP+CRM API Server running on port ${PORT}`);
  try {
    const client = await pool.connect();
    try {
      // Clean up invalid test location logs that have NULL employeeIds or employeeNames from previous runs
      await client.query('DELETE FROM location_logs WHERE employee_id IS NULL OR employee_name IS NULL');
      dbCache = await loadTransactionDb(client);
      console.log('Successfully initialized dbCache from PostgreSQL.');
    } finally {
      client.release();
    }

    // Initialize metadataCache from PostgreSQL app_metadata table
    await initializeMetadata();
    console.log('CURRENT METADATA IN DATABASE:', JSON.stringify(readMetadata()));
  } catch (err) {
    console.error('Failed to initialize dbCache or metadata Cache from PostgreSQL:', err);
    process.exit(1);
  }

  try {
    const db = readDb();
    let updated = false;

    // Self-correct ghost converted leads (if customer is deleted, reset status to In-Progress)
    (db.leads || []).forEach(lead => {
      if (lead.status === 'Converted') {
        const cleanPhone = String(lead.phone || '').trim();
        const cleanEmail = String(lead.email || '').trim().toLowerCase();
        const hasCustomer = (db.customers || []).some(c => 
          String(c.leadId) === String(lead.id) ||
          (cleanPhone !== '' && String(c.phone || '').trim() === cleanPhone) ||
          (cleanEmail !== '' && String(c.email || '').trim().toLowerCase() === cleanEmail)
        );
        if (!hasCustomer) {
          lead.status = 'In-Progress';
          updated = true;
        }
      }
    });

    const closedDeals = (db.deals || []).filter(d => d.status === 'Closed');
    closedDeals.forEach(d => {
      const propIndex = (db.properties || []).findIndex(p => String(p.id) === String(d.propertyId));
      if (propIndex !== -1) {
        const prop = db.properties[propIndex];
        if (prop.status !== 'Property Registered/Sold Out') {
          prop.status = 'Property Registered/Sold Out';
          updated = true;
        }
        if (prop.current_owner_id !== d.customerId) {
          prop.current_owner_id = d.customerId;
          updated = true;
        }
        prop.owner_history = prop.owner_history || [];
        const hasHistory = prop.owner_history.some(h => 
          String(h.saleDate) === String(d.registrationDate)
        );
        if (!hasHistory) {
          const prevOwnerName = 'Previous Owner';
          prop.owner_history.push({
            ownerId: 'N/A',
            ownerName: prevOwnerName,
            purchaseDate: prop.date || '',
            purchasePrice: prop.demand || '',
            saleDate: d.registrationDate || new Date().toISOString().split('T')[0],
            salePrice: d.purchasePrice || ''
          });
          updated = true;
        }
      }
    });



    // Self-correct duplicate leads
    if (Array.isArray(db.leads)) {
      const seen = new Map();
      const idsToDelete = [];
      const sortedLeads = [...db.leads].sort((a, b) => {
        const idA = parseInt(String(a.id).split('-')[1]) || 0;
        const idB = parseInt(String(b.id).split('-')[1]) || 0;
        return idA - idB;
      });

      sortedLeads.forEach(lead => {
        const phone = lead.phone ? String(lead.phone).trim() : '';
        const email = lead.email ? String(lead.email).trim().toLowerCase() : '';
        
        if (!phone && !email) return;

        const key = phone ? `phone:${phone}` : `email:${email}`;
        if (!seen.has(key)) {
          seen.set(key, lead.id);
        } else {
          idsToDelete.push(lead.id);
        }
      });

      if (idsToDelete.length > 0) {
        console.log(`Self-correction: found ${idsToDelete.length} duplicate leads. Deleting:`, idsToDelete);
        db.leads = db.leads.filter(lead => !idsToDelete.includes(lead.id));
        updated = true;
      }
    }

    // Self-correct duplicate customers
    if (Array.isArray(db.customers)) {
      const seen = new Map();
      const idsToDelete = [];
      const sortedCusts = [...db.customers].sort((a, b) => {
        const idA = parseInt(String(a.id).split('-')[1]) || 0;
        const idB = parseInt(String(b.id).split('-')[1]) || 0;
        return idA - idB;
      });

      sortedCusts.forEach(cust => {
        const phone = cust.phone ? String(cust.phone).trim() : '';
        const email = cust.email ? String(cust.email).trim().toLowerCase() : '';
        
        if (!phone && !email) return;

        const key = phone ? `phone:${phone}` : `email:${email}`;
        if (!seen.has(key)) {
          seen.set(key, cust.id);
        } else {
          idsToDelete.push(cust.id);
        }
      });

      if (idsToDelete.length > 0) {
        console.log(`Self-correction: found ${idsToDelete.length} duplicate customers. Deleting:`, idsToDelete);
        db.customers = db.customers.filter(cust => !idsToDelete.includes(cust.id));
        updated = true;
      }
    }

    if (updated) {
      writeDb(db);
      console.log('Database self-correction: synced property status & ownership logs for closed deals and removed duplicates.');
      try { syncToSheets('properties'); } catch(e) {}
      try { syncToSheets('leads'); } catch(e) {}
      try { syncToSheets('customers'); } catch(e) {}
    }
  } catch (err) {
    console.error('Database self-correction failed:', err);
  }
});
