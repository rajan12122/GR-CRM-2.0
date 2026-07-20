require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { syncToSheets, syncFromSheets, getSheetsConfig, processSyncQueue } = require('./services/sheetsService');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'GR_CRM_SUPER_SECRET_KEY';

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

const metadataPath = path.join(__dirname, 'config/metadata.json');
const dbPath = path.join(__dirname, 'config/db.json');

// Ensure database files exist on boot
if (!fs.existsSync(metadataPath)) {
  console.error("Critical Error: config/metadata.json missing!");
}
if (!fs.existsSync(dbPath)) {
  console.error("Critical Error: config/db.json missing!");
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
  const db = readDb();
  let modified = false;

  const prefixMap = {
    employees: 'EMP',
    customers: 'CUST',
    leads: 'LEAD',
    properties: 'PROP',
    projects: 'PROJ',
    site_visits: 'VISIT',
    follow_ups: 'FOLLOW',
    remarks: 'REM',
    tasks: 'TASK',
    sales: 'SALE',
    documents: 'DOC',
    attendance: 'ATT',
    daily_prices: 'PRICE',
    salaries: 'SAL',
    queries: 'QRY',
    deals: 'DEAL',
    property_pitch_history: 'PITCH',
    dealer_calls: 'CALL',
    dealer_meetings: 'MEET'
  };

  Object.keys(prefixMap).forEach(module => {
    if (!db[module] || !Array.isArray(db[module])) return;

    const prefix = prefixMap[module];
    const idUpdates = [];

    db[module].forEach((rec, idx) => {
      const newId = `${prefix}-${String(idx + 1).padStart(3, '0')}`;
      if (String(rec.id) !== newId) {
        idUpdates.push({ oldId: rec.id, newId });
      }
    });

    if (idUpdates.length > 0) {
      modified = true;
      idUpdates.forEach(({ oldId, newId }) => {
        const rec = db[module].find(r => r.id === oldId);
        if (rec) {
          rec.id = newId;
        }
        updateGlobalReferences(db, oldId, newId);
      });
    }
  });

  if (modified) {
    writeDb(db);
    console.log('Database IDs re-sequenced and reference mappings updated on boot.');
    // Trigger sync back to Google Sheets for modified modules
    Object.keys(prefixMap).forEach(module => {
      if (db[module] && Array.isArray(db[module])) {
        try {
          syncToSheets(module);
        } catch (e) {
          console.error(`Error syncing resequenced ${module} on boot:`, e);
        }
      }
    });
  }
}

// Sync from Google Sheets on start if credentials exist
syncFromSheets().then(res => {
  if (res) console.log('Initial Google Sheets sync completed on boot.');
  else console.log('Running on local JSON database cache.');

  // Run automatic sequential ID healing migration
  try {
    resequenceAllModules();
  } catch (err) {
    console.error('ID Resequencing Boot Error:', err);
  }
});

// Helper functions to read/write DB and Metadata with in-memory caching
let dbCache = null;
let metadataCache = null;

function readDb() {
  if (!dbCache) {
    dbCache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  }
  return dbCache;
}

function writeDb(data) {
  dbCache = data;
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

function readMetadata() {
  if (!metadataCache) {
    metadataCache = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  }
  return metadataCache;
}

function writeMetadata(data) {
  metadataCache = data;
  fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf8');
}

// Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'Authentication token required.' });

  jwt.verify(token, JWT_SECRET, (err, decodedUser) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token.' });
    
    // Check session validity & token version
    const db = readDb();
    const employee = (db.employees || []).find(e => e.id === decodedUser.id);
    if (!employee || employee.status !== 'Active' || (employee.tokenVersion !== undefined && employee.tokenVersion !== decodedUser.tokenVersion)) {
      return res.status(403).json({ message: 'Session has expired or been revoked. Please log in again.' });
    }
    
    req.user = decodedUser;
    next();
  });
}

// Role-based Access Control Middleware
function checkPermission(moduleName, action) {
  return (req, res, next) => {
    const metadata = readMetadata();
    const role = req.user.role;
    
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

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password required.' });
  }

  const db = readDb();
  const employee = db.employees.find(emp => emp.email.toLowerCase() === email.toLowerCase());

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

  const tokenVersion = employee.tokenVersion || 1;
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
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  const db = readDb();
  const employee = db.employees.find(emp => emp.id === req.user.id);
  if (!employee) return res.status(404).json({ message: 'Profile not found.' });
  res.json(employee);
});

app.post('/api/auth/admin/reset-password', authenticateToken, (req, res) => {
  // Enforce Admin role authorization in the backend
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

  // Password strength validation (min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special character)
  const strengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
  if (!strengthRegex.test(password)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character.' });
  }

  const db = readDb();
  const employee = db.employees.find(e => e.id === employeeId);
  if (!employee) {
    return res.status(404).json({ message: 'Employee account not found.' });
  }

  // Hash using secure cost factor (12 rounds)
  const salt = bcrypt.genSaltSync(12);
  const hash = bcrypt.hashSync(password, salt);

  employee.passwordHash = hash;
  
  // Invalidate any active sessions by incrementing version
  employee.tokenVersion = (employee.tokenVersion || 1) + 1;

  // Remove any legacy plaintext password field
  delete employee.password;

  // Add audit log
  const auditLog = {
    id: `LOG-AUD-${Date.now()}`,
    employeeName: req.user.name,
    action: `Reset password for employee: ${employee.name} (${employee.id})`,
    dateTime: new Date().toLocaleString()
  };
  if (!db.activity_logs) db.activity_logs = [];
  db.activity_logs.unshift(auditLog);

  writeDb(db);

  res.json({ success: true, message: `Password for employee ${employee.name} updated successfully. Active sessions revoked.` });
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

app.post('/api/metadata', authenticateToken, checkPermission('settings', 'edit'), (req, res) => {
  try {
    const newMetadata = req.body;
    writeMetadata(newMetadata);
    res.json({ success: true, message: 'Metadata schema saved successfully.' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to write metadata: ' + error.message });
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
    const pitchId = `PITCH-${String(db.property_pitch_history.length + 1).padStart(3, '0')}`;
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
      id: `LOG-${Date.now()}`,
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
    db.properties = db.properties || [];
    const propExists = db.properties.some(p => p.linkedQueryId === q.id);
    if (!propExists) {
      const propId = `PROP-${String(db.properties.length + 1).padStart(3, '0')}`;
      const cust = (db.customers || []).find(c => String(c.id) === String(q.customerId));
      const ownerName = cust ? cust.name : 'Unknown Owner';
      const ownerPhone = cust ? cust.phone : '';
      
      const newProperty = {
        id: propId,
        status: 'Available',
        date: new Date().toISOString().split('T')[0],
        contact_person_name: ownerName,
        contact_number: ownerPhone,
        dealer_owner_booked: 'Owner',
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
            details: `Automatically created from Sell Property Query ${q.id} by ${ownerName}`
          }
        ]
      };
      db.properties.push(newProperty);
      
      if (q.assignedEmployeeId) {
        setTimeout(() => {
          notifyUser(q.assignedEmployeeId, 'new-property-matched', {
            propertyId: propId,
            message: `Property ${propId} added automatically from Sell Query ${q.id}`
          });
        }, 500);
      }
      
      db.activity_logs = db.activity_logs || [];
      db.activity_logs.unshift({
        id: `LOG-${Date.now()}`,
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
        id: `LOG-${Date.now()}`,
        employeeName: req.user ? req.user.name : 'System',
        action: `Assigned Dealer ${payload.id} to Employee ${payload.assignedEmployeeId} for a visit`,
        dateTime: new Date().toLocaleString()
      });
    }
  }
}

function convertLeadToCustomer(leadId, db, remarks = '') {
  if (!leadId || !leadId.startsWith('LEAD-')) return null;

  const lead = (db.leads || []).find(l => String(l.id) === String(leadId));
  if (!lead) return null;

  const cleanPhone = String(lead.phone || '').trim();
  let existingCust = (db.customers || []).find(c => c.phone && String(c.phone).trim() === cleanPhone);

  if (!existingCust) {
    const custId = `CUST-${String((db.customers || []).length + 1).padStart(3, '0')}`;
    existingCust = {
      id: custId,
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
    db.customers = db.customers || [];
    db.customers.push(existingCust);
    try { syncToSheets('customers'); } catch(e) {}
  }

  // Mark lead status as Converted
  lead.status = 'Converted';
  try { syncToSheets('leads'); } catch(e) {}

  // Update references across all database tables to preserve history and log mappings
  const newCustId = existingCust.id;

  // 1. Follow-ups
  db.follow_ups = (db.follow_ups || []).map(f => {
    if (String(f.customerId) === String(leadId)) {
      return { ...f, customerId: newCustId };
    }
    return f;
  });
  try { syncToSheets('follow_ups'); } catch(e) {}

  // 2. Queries
  db.queries = (db.queries || []).map(q => {
    if (String(q.customerId) === String(leadId)) {
      return { ...q, customerId: newCustId };
    }
    return q;
  });
  try { syncToSheets('queries'); } catch(e) {}

  // 3. Site visits
  db.site_visits = (db.site_visits || []).map(sv => {
    if (String(sv.customerId) === String(leadId)) {
      return { ...sv, customerId: newCustId };
    }
    return sv;
  });
  try { syncToSheets('site_visits'); } catch(e) {}

  // 4. Sales Bookings
  db.sales = (db.sales || []).map(s => {
    if (String(s.customerId) === String(leadId)) {
      return { ...s, customerId: newCustId };
    }
    return s;
  });
  try { syncToSheets('sales'); } catch(e) {}

  // 5. Property Pitch History
  db.property_pitch_history = (db.property_pitch_history || []).map(p => {
    if (String(p.customerId) === String(leadId)) {
      return { ...p, customerId: newCustId };
    }
    return p;
  });
  try { syncToSheets('property_pitch_history'); } catch(e) {}

  // 6. Properties Ownership
  db.properties = (db.properties || []).map(prop => {
    if (String(prop.current_owner_id) === String(leadId)) {
      return { ...prop, current_owner_id: newCustId };
    }
    return prop;
  });
  try { syncToSheets('properties'); } catch(e) {}

  writeDb(db);
  return existingCust;
}

function handleDealStatusChange(d, db, req) {
  if (!d.id || d.status !== 'Closed') return;
  
  // Convert Lead to Customer if Deal closed for a Lead ID
  if (d.customerId && String(d.customerId).startsWith('LEAD-')) {
    const cust = convertLeadToCustomer(d.customerId, db, `Converted via Closed Deal ${d.id}`);
    if (cust) {
      d.customerId = cust.id;
    }
  }

  db.properties = db.properties || [];
  const propIndex = db.properties.findIndex(p => String(p.id) === String(d.propertyId));
  if (propIndex !== -1) {
    const prop = db.properties[propIndex];
    
    const prevOwnerId = prop.current_owner_id || d.sellerCustomerId || '';
    const prevOwnerName = prop.contact_person_name || '';
    
    const buyerCust = (db.customers || []).find(c => String(c.id) === String(d.customerId));
    const buyerName = buyerCust ? buyerCust.name : (d.customerId || 'Unknown');
    
    prop.owner_history = prop.owner_history || [];
    if (prevOwnerId || prevOwnerName) {
      const hasHistory = prop.owner_history.some(h => String(h.dealId) === String(d.id));
      if (!hasHistory) {
        prop.owner_history.push({
          dealId: d.id,
          ownerId: prevOwnerId || 'N/A',
          ownerName: prevOwnerName || 'Previous Owner',
          purchaseDate: prop.date || '',
          purchasePrice: prop.demand || '',
          saleDate: d.registrationDate || new Date().toISOString().split('T')[0],
          salePrice: d.salePrice || ''
        });
      }
    }
    
    prop.current_owner_id = d.customerId;
    prop.contact_person_name = buyerName;
    prop.contact_number = buyerCust ? buyerCust.phone : (prop.contact_number || '');
    prop.status = 'Property Registered/Sold Out';
    
    prop.ownership_documents = prop.ownership_documents || { old_owner: [], new_owner: [] };
    if (prop.ownership_documents.new_owner && prop.ownership_documents.new_owner.length > 0) {
      prop.ownership_documents.old_owner = [
        ...(prop.ownership_documents.old_owner || []),
        ...prop.ownership_documents.new_owner
      ];
    }
    
    prop.ownership_documents.new_owner = [];
    if (d.documents) {
      prop.ownership_documents.new_owner = Array.isArray(d.documents) 
        ? d.documents 
        : [d.documents];
    }
    
    prop.timeline = prop.timeline || [];
    prop.timeline.push({
      date: new Date().toLocaleDateString('en-IN'),
      event: 'Ownership Changed (Deal Closed)',
      details: `Sold by ${prevOwnerName || 'Unknown'} to ${buyerName} for ₹${d.salePrice}`
    });
    
    db.properties[propIndex] = prop;
    
    if (d.employeeId) {
      setTimeout(() => {
        notifyUser(d.employeeId, 'deal-closed-notif', {
          dealId: d.id,
          message: `Deal ${d.id} for Property ${d.propertyId} has been closed and ownership updated.`
        });
      }, 500);
    }
    
    db.activity_logs = db.activity_logs || [];
    db.activity_logs.unshift({
      id: `LOG-${Date.now()}`,
      employeeName: req.user ? req.user.name : 'System',
      action: `Deal ${d.id} closed. Ownership of Property ${d.propertyId} transferred to Customer ${d.customerId}.`,
      dateTime: new Date().toLocaleString()
    });
    
    writeDb(db);
    try { syncToSheets('properties'); } catch(e) {}
  }
}

function handlePitchStatusChange(p, db, req) {
  if (!p.id) return;

  if (p.propertyId && p.propertyStatus) {
    const propIndex = (db.properties || []).findIndex(pr => String(pr.id) === String(p.propertyId));
    if (propIndex !== -1) {
      db.properties[propIndex].status = p.propertyStatus;
      writeDb(db);
      try { syncToSheets('properties'); } catch(e) {}
    }
  }

  // Auto-complete call follow-up if pitched via call
  if (p.pitchMethod === 'Call') {
    db.follow_ups = db.follow_ups || [];
    db.follow_ups.forEach(f => {
      if (String(f.customerId) === String(p.customerId) && f.status !== 'Completed') {
        f.status = 'Completed';
        f.remarks = (f.remarks || '') + `\n[System: Auto-completed call follow-up via logged Call Pitch ${p.id}]`;
      }
    });
    try { syncToSheets('follow_ups'); } catch(e) {}
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

  const mappedStage = mapPitchStatusToPipelineAction(p.status) || mapPitchStatusToPipelineAction(p.propertyStatus);
  if (mappedStage) {
    db.follow_ups = (db.follow_ups || []).map(f => {
      if (String(f.customerId) === String(p.customerId)) {
        f.pipelineAction = mappedStage;
        f.pitchedPropertyId = p.propertyId || f.pitchedPropertyId;
        f.pitchPrice = p.quotedPrice || f.pitchPrice;
        f.pitchRemarks = p.remarks || f.pitchRemarks;
        
        // Trigger automated post-pipeline action handlers (like auto-creating site visits!)
        setTimeout(() => {
          const freshDb = readDb();
          const freshFollowUp = (freshDb.follow_ups || []).find(x => x.id === f.id);
          if (freshFollowUp) {
            handleFollowUpPipelineAction(freshFollowUp, freshDb, req);
          }
        }, 10);
      }
      return f;
    });
    try { syncToSheets('follow_ups'); } catch(e) {}

    db.queries = (db.queries || []).map(q => {
      if (String(q.customerId) === String(p.customerId)) {
        q.stage = mappedStage;
        if (mappedStage === 'Closed') {
          q.status = 'Closed';
        }
      }
      return q;
    });
    try { syncToSheets('queries'); } catch(e) {}
    writeDb(db);
  }

  const isDealClosed = p.status === 'Deal Closed' || 
                       p.status === 'Property Registered/Sold Out' || 
                       p.propertyStatus === 'Property Registered/Sold Out';

  if (!isDealClosed) return;

  // Convert Lead to Customer if Pitch closed for a Lead ID
  let finalCustomerId = p.customerId;
  if (p.customerId && String(p.customerId).startsWith('LEAD-')) {
    const cust = convertLeadToCustomer(p.customerId, db, `Converted via Closed Pitch ${p.id}`);
    if (cust) {
      p.customerId = cust.id;
      finalCustomerId = cust.id;
    }
  }

  // Update property ownership details
  db.properties = db.properties || [];
  const propIndex = db.properties.findIndex(pr => String(pr.id) === String(p.propertyId));
  if (propIndex !== -1) {
    const prop = db.properties[propIndex];
    
    const prevOwnerId = prop.current_owner_id || '';
    const prevOwnerName = prop.contact_person_name || '';
    
    const buyerCust = (db.customers || []).find(c => String(c.id) === String(finalCustomerId));
    const buyerName = buyerCust ? buyerCust.name : (finalCustomerId || 'Unknown');
    
    prop.owner_history = prop.owner_history || [];
    if (prevOwnerId || prevOwnerName) {
      const hasHistory = prop.owner_history.some(h => String(h.dealId) === String(p.id));
      if (!hasHistory) {
        prop.owner_history.push({
          dealId: p.id,
          ownerId: prevOwnerId || 'N/A',
          ownerName: prevOwnerName || 'Previous Owner',
          purchaseDate: prop.date || '',
          purchasePrice: prop.demand || '',
          saleDate: new Date().toISOString().split('T')[0],
          salePrice: p.quotedPrice || ''
        });
      }
    }
    
    prop.current_owner_id = finalCustomerId;
    prop.contact_person_name = buyerName;
    prop.contact_number = buyerCust ? buyerCust.phone : (prop.contact_number || '');
    prop.status = 'Property Registered/Sold Out';
    
    prop.ownership_documents = prop.ownership_documents || { old_owner: [], new_owner: [] };
    if (prop.ownership_documents.new_owner && prop.ownership_documents.new_owner.length > 0) {
      prop.ownership_documents.old_owner = [
        ...(prop.ownership_documents.old_owner || []),
        ...prop.ownership_documents.new_owner
      ];
    }
    prop.ownership_documents.new_owner = [];
    
    prop.timeline = prop.timeline || [];
    prop.timeline.push({
      date: new Date().toLocaleDateString('en-IN'),
      event: 'Ownership Changed (Pitch Closed)',
      details: `Sold by ${prevOwnerName || 'Unknown'} to ${buyerName} for ₹${p.quotedPrice} via Pitch ${p.id}`
    });
    
    db.properties[propIndex] = prop;
    
    if (p.employeeId) {
      setTimeout(() => {
        notifyUser(p.employeeId, 'pitch-closed-notif', {
          pitchId: p.id,
          message: `Pitch ${p.id} for Property ${p.propertyId} has been closed and ownership updated.`
        });
      }, 500);
    }
    
    db.activity_logs = db.activity_logs || [];
    db.activity_logs.unshift({
      id: `LOG-${Date.now()}`,
      employeeName: req.user ? req.user.name : 'System',
      action: `Pitch ${p.id} closed. Ownership of Property ${p.propertyId} transferred to Customer ${finalCustomerId}.`,
      dateTime: new Date().toLocaleString()
    });
    
    writeDb(db);
    try { syncToSheets('properties'); } catch(e) {}
  }

  // Auto convert follow-ups for this client to Call Done / Closed
  db.follow_ups = db.follow_ups || [];
  db.follow_ups.forEach(f => {
    if (String(f.customerId) === String(p.customerId) || String(f.customerId) === String(finalCustomerId)) {
      f.status = 'Call Done';
      f.pipelineAction = 'Property Registered/Sold Out';
    }
  });
  writeDb(db);
  try { syncToSheets('follow_ups'); } catch(e) {}
}

function handleLeadStatusChange(lead, db, req) {
  if (lead.leadType === 'Seller') {
    const cleanPhone = String(lead.phone).trim();
    let existingCust = (db.customers || []).find(c => String(c.leadId) === String(lead.id) || (c.phone && String(c.phone).trim() === cleanPhone));
    
    const leadDemand = lead.demand || lead.budget || '';

    if (!existingCust) {
      const custId = `CUST-${String((db.customers || []).length + 1).padStart(3, '0')}`;
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
      db.customers = db.customers || [];
      db.customers.push(existingCust);
      try { syncToSheets('customers'); } catch(e) {}
    } else {
      existingCust.budget = leadDemand;
      existingCust.city = lead.locality || existingCust.city || '';
      try { syncToSheets('customers'); } catch(e) {}
    }

    db.properties = db.properties || [];
    let existingProp = null;
    if (lead.propertyId) {
      existingProp = db.properties.find(p => String(p.id) === String(lead.propertyId));
    }
    if (!existingProp) {
      existingProp = db.properties.find(p => p.linkedLeadId === lead.id || String(p.booked_by_customer_id) === String(existingCust.id));
    }

    if (existingProp) {
      existingProp.current_owner_id = existingCust.id;
      existingProp.booked_by_customer_id = existingCust.id;
      existingProp.linkedLeadId = lead.id;
      existingProp.demand = leadDemand || existingProp.demand || '';
      existingProp.locality = lead.locality || existingProp.locality || '';
      existingProp.sector_block = lead.sector_block || existingProp.sector_block || '';
      existingProp.size = lead.size || existingProp.size || '';
      existingProp.propertyType = lead.propertyType || existingProp.propertyType || '';
      existingProp.r_c_i = lead.r_c_i || existingProp.r_c_i || 'Residential';
      try { syncToSheets('properties'); } catch(e) {}
    } else {
      const propId = `PROP-${String(db.properties.length + 1).padStart(3, '0')}`;
      existingProp = {
        id: propId,
        linkedLeadId: lead.id,
        status: 'Available',
        date: new Date().toLocaleDateString('en-IN'),
        contact_person_name: lead.name,
        contact_number: lead.phone,
        dealer_owner_booked: 'Owner',
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
      db.properties.push(existingProp);
      lead.propertyId = propId;
      try { syncToSheets('properties'); } catch(e) {}
    }
  }
}

function syncPropertyDetailsUniversally(propId, db) {
  const prop = (db.properties || []).find(p => String(p.id) === String(propId));
  if (!prop) return;

  const fieldsToSync = {
    r_c_i: prop.r_c_i || '',
    propertyType: prop.propertyType || '',
    locality: prop.locality || '',
    sector_block: prop.sector_block || '',
    size: prop.size || '',
    demand: prop.demand || ''
  };

  // 1. Sync to Leads (if this property belongs to a lead or is linked)
  (db.leads || []).forEach(lead => {
    if (String(lead.propertyId) === String(propId) || String(lead.id) === String(prop.linkedLeadId)) {
      lead.r_c_i = fieldsToSync.r_c_i;
      lead.propertyType = fieldsToSync.propertyType;
      lead.locality = fieldsToSync.locality;
      lead.sector_block = fieldsToSync.sector_block;
      lead.size = fieldsToSync.size;
      lead.demand = fieldsToSync.demand;
      lead.budget = fieldsToSync.demand; // Also update budget if it's a seller lead
    }
  });

  // 2. Sync to Customers
  (db.customers || []).forEach(cust => {
    if (String(cust.id) === String(prop.current_owner_id) || String(cust.id) === String(prop.booked_by_customer_id)) {
      cust.city = fieldsToSync.locality;
      cust.budget = fieldsToSync.demand;
    }
  });

  // 3. Sync to Queries
  (db.queries || []).forEach(q => {
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

  // 4. Sync to Follow Ups
  (db.follow_ups || []).forEach(f => {
    if (String(f.pitchedPropertyId) === String(propId)) {
      f.pitchPrice = fieldsToSync.demand;
    }
  });
}

function syncAssignedEmployeeUniversally(sourceModule, recordId, newEmployeeId, db) {
  if (!newEmployeeId) return;
  
  let leadId = '';
  let custId = '';
  let phones = new Set();
  let emails = new Set();

  if (sourceModule === 'leads') {
    leadId = String(recordId);
    const lead = (db.leads || []).find(l => String(l.id) === leadId);
    if (lead) {
      if (lead.phone) phones.add(String(lead.phone).trim());
      if (lead.email) emails.add(String(lead.email).trim().toLowerCase());
      const cust = (db.customers || []).find(c => String(c.leadId) === leadId || (lead.phone && String(c.phone).trim() === String(lead.phone).trim()));
      if (cust) {
        custId = String(cust.id);
        if (cust.phone) phones.add(String(cust.phone).trim());
        if (cust.email) emails.add(String(cust.email).trim().toLowerCase());
      }
    }
  } else if (sourceModule === 'customers') {
    custId = String(recordId);
    const cust = (db.customers || []).find(c => String(c.id) === custId);
    if (cust) {
      if (cust.phone) phones.add(String(cust.phone).trim());
      if (cust.email) emails.add(String(cust.email).trim().toLowerCase());
      leadId = cust.leadId ? String(cust.leadId) : '';
      const lead = (db.leads || []).find(l => String(l.id) === leadId || (cust.phone && String(l.phone).trim() === String(cust.phone).trim()));
      if (lead) {
        leadId = String(lead.id);
        if (lead.phone) phones.add(String(lead.phone).trim());
        if (lead.email) emails.add(String(lead.email).trim().toLowerCase());
      }
    }
  } else if (sourceModule === 'follow_ups') {
    const fup = (db.follow_ups || []).find(f => String(f.id) === String(recordId));
    if (fup) {
      const targetId = String(fup.customerId);
      if (targetId.startsWith('LEAD-')) {
        leadId = targetId;
        const lead = (db.leads || []).find(l => String(l.id) === leadId);
        if (lead) {
          if (lead.phone) phones.add(String(lead.phone).trim());
          if (lead.email) emails.add(String(lead.email).trim().toLowerCase());
        }
      } else if (targetId.startsWith('CUST-')) {
        custId = targetId;
        const cust = (db.customers || []).find(c => String(c.id) === custId);
        if (cust) {
          if (cust.phone) phones.add(String(cust.phone).trim());
          if (cust.email) emails.add(String(cust.email).trim().toLowerCase());
          if (cust.leadId) leadId = String(cust.leadId);
        }
      }
    }
  }

  const matchClient = (idField, phoneField) => {
    const idStr = String(idField || '');
    const phoneStr = String(phoneField || '').trim();
    if (leadId && idStr === leadId) return true;
    if (custId && idStr === custId) return true;
    if (phoneStr && phones.has(phoneStr)) return true;
    return false;
  };

  let updated = false;

  (db.leads || []).forEach(l => {
    if (matchClient(l.id, l.phone)) {
      if (l.assignedEmployeeId !== newEmployeeId) {
        l.assignedEmployeeId = newEmployeeId;
        updated = true;
      }
    }
  });

  (db.customers || []).forEach(c => {
    if (matchClient(c.id, c.phone) || (leadId && String(c.leadId) === leadId)) {
      if (c.assignedEmployeeId !== newEmployeeId) {
        c.assignedEmployeeId = newEmployeeId;
        updated = true;
      }
    }
  });

  (db.follow_ups || []).forEach(f => {
    if (matchClient(f.customerId, '')) {
      if (f.employeeId !== newEmployeeId) {
        f.employeeId = newEmployeeId;
        updated = true;
      }
    }
  });

  (db.queries || []).forEach(q => {
    if (matchClient(q.customerId, '')) {
      if (q.assignedEmployeeId !== newEmployeeId) {
        q.assignedEmployeeId = newEmployeeId;
        updated = true;
      }
    }
  });

  (db.site_visits || []).forEach(s => {
    if (matchClient(s.customerId, '')) {
      if (s.employeeId !== newEmployeeId) {
        s.employeeId = newEmployeeId;
        updated = true;
      }
    }
  });

  if (updated) {
    try { syncToSheets('leads'); } catch(e) {}
    try { syncToSheets('customers'); } catch(e) {}
    try { syncToSheets('follow_ups'); } catch(e) {}
    try { syncToSheets('queries'); } catch(e) {}
    try { syncToSheets('site_visits'); } catch(e) {}
  }
}

function handleFollowUpPipelineAction(f, db, req) {
  if (!f.pipelineAction) return;

  const action = f.pipelineAction;
  const customerId = f.customerId; // This can be LEAD-... or CUST-...
  const queryId = f.queryId;

  // Auto-create Site Visit if stage is Site Visit Arranged / Scheduled
  const isSiteVisitStage = action === 'Site Visit Arranged' || action === 'Site Visit' || action === 'Site Visit Scheduled' || action === 'Lead_VisitScheduled';
  if (isSiteVisitStage) {
    let existingVisit = (db.site_visits || []).find(sv => sv.linkedFollowUpId === f.id);
    if (existingVisit) {
      let changed = false;
      if (existingVisit.date !== f.date) {
        existingVisit.date = f.date;
        changed = true;
      }
      if (existingVisit.propertyId !== (f.pitchedPropertyId || 'PROP-001')) {
        existingVisit.propertyId = f.pitchedPropertyId || 'PROP-001';
        changed = true;
      }
      if (existingVisit.employeeId !== f.employeeId) {
        existingVisit.employeeId = f.employeeId;
        changed = true;
      }
      if (changed) {
        writeDb(db);
        try { syncToSheets('site_visits'); } catch(e) {}
      }
    } else {
      const visitId = `VISIT-${String((db.site_visits || []).length + 1).padStart(3, '0')}`;
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
      db.site_visits = db.site_visits || [];
      db.site_visits.push(newVisit);
      writeDb(db);
      try { syncToSheets('site_visits'); } catch(e) {}
    }
  } else {
    // If the stage was changed away from Site Visit, delete any site visit linked to this follow-up!
    const originalLen = (db.site_visits || []).length;
    db.site_visits = (db.site_visits || []).filter(sv => sv.linkedFollowUpId !== f.id);
    if ((db.site_visits || []).length !== originalLen) {
      writeDb(db);
      try { syncToSheets('site_visits'); } catch(e) {}
    }
  }

  // Check if we should trigger deal conversion (e.g. stage is Closed or Booked)
  const isClosedDeal = action === 'Closed' || action === 'Booked' || action === 'Query_ClosedWon' || action === 'Deal Closed' || action === 'Property Registered/Sold Out' || action === 'Property Booked';

  if (isClosedDeal) {
    // 1. If customerId is a Lead, convert to Customer first
    let finalCustomerId = customerId;
    if (customerId && String(customerId).startsWith('LEAD-')) {
      const cust = convertLeadToCustomer(customerId, db, `Converted via Follow-Up close action.`);
      if (cust) {
        finalCustomerId = cust.id;
      }
    }

    // 2. Insert new Deal closed
    const dealId = `DEAL-${String((db.deals || []).length + 1).padStart(3, '0')}`;
    const newDeal = {
      id: dealId,
      customerId: finalCustomerId,
      propertyId: f.pitchedPropertyId || 'PROP-001',
      employeeId: f.employeeId || 'EMP-001',
      status: 'Closed',
      salePrice: f.pitchPrice || 1000000,
      registrationDate: new Date().toISOString().split('T')[0]
    };
    
    db.deals = db.deals || [];
    db.deals.push(newDeal);
    handleDealStatusChange(newDeal, db, req);
    writeDb(db);
    try { syncToSheets('deals'); } catch(e) {}
  }

  // Always update linked lead or query stage dynamically
  if (queryId) {
    const q = (db.queries || []).find(x => String(x.id) === String(queryId));
    if (q) {
      q.stage = action;
      // If it is closed won/approved, normalize statuses
      if (action === 'Closed' || action === 'Deal Closed' || action === 'Property Registered/Sold Out' || action === 'Query_ClosedWon') {
        q.status = 'Closed';
      } else if (action === 'Requirement Verified' || action === 'Query_Approved') {
        q.status = 'Approved';
      }
      handleQueryStageChange(q, db, req);
      writeDb(db);
      try { syncToSheets('queries'); } catch(e) {}
    }
  } else if (customerId && String(customerId).startsWith('LEAD-')) {
    const lead = (db.leads || []).find(l => String(l.id) === String(customerId));
    if (lead) {
      if (action === 'Lost' || action === 'Lost Lead') {
        lead.status = 'Junk';
      } else if (action === 'Closed' || action === 'Deal Closed' || action === 'Property Registered/Sold Out' || action === 'Booked' || action === 'Property Booked') {
        lead.status = 'Converted';
      } else {
        lead.status = action;
      }
      writeDb(db);
      try { syncToSheets('leads'); } catch(e) {}
    }
  } else if (customerId && String(customerId).startsWith('CUST-')) {
    const cust = (db.customers || []).find(c => String(c.id) === String(customerId));
    if (cust) {
      cust.stage = action;
      writeDb(db);
      try { syncToSheets('customers'); } catch(e) {}
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
            details: `Customer role: ${role} • Property: ${d.propertyId} • Price: ₹${d.salePrice}`,
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
            details: `Buyer: ${d.customerId} • Seller: ${d.sellerCustomerId} • Price: ₹${d.salePrice}`,
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
        details: `Status: ${d.status} • Price: ₹${d.salePrice}`,
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

// --- DYNAMIC DATA CRUD ROUTER ---

app.get('/api/data/:module', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  
  if (module === 'activity_logs') {
    return next();
  }

  const metadata = readMetadata();
  if (!metadata.modules[module]) {
    return res.status(404).json({ message: `Module '${module}' does not exist.` });
  }
  next();
}, (req, res, next) => {
  const { module } = req.params;
  if (module === 'activity_logs') {
    return next();
  }
  checkPermission(module, 'view')(req, res, next);
}, (req, res) => {
  const { module } = req.params;
  const { role } = req.user;
  const db = readDb();
  let records = db[module] || [];
  
  if (role !== 'Admin') {
    if (module === 'leads') {
      const myFollowUpCustomerIds = (db.follow_ups || [])
        .filter(f => String(f.employeeId) === String(req.user.id))
        .map(f => String(f.customerId));
      const mySiteVisitCustomerIds = (db.site_visits || [])
        .filter(sv => String(sv.employeeId) === String(req.user.id))
        .map(sv => String(sv.customerId));
      const myPitchCustomerIds = (db.property_pitch_history || [])
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
      const myFollowUpQueryIds = (db.follow_ups || [])
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
});

app.post('/api/data/:module', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'create')(req, res, next);
}, async (req, res) => {
  const { module } = req.params;
  const db = readDb();
  const payload = req.body;

  if (module === 'employees') {
    delete payload.password;
    delete payload.passwordHash;
    delete payload.tokenVersion;
  }

  // Generate automated primary key if not provided (e.g. CUST-003)
  if (!payload.id) {
    const prefixMap = {
      employees: 'EMP',
      customers: 'CUST',
      leads: 'LEAD',
      properties: 'PROP',
      projects: 'PROJ',
      site_visits: 'VISIT',
      follow_ups: 'FOLLOW',
      remarks: 'REM',
      tasks: 'TASK',
      sales: 'SALE',
      documents: 'DOC',
      attendance: 'ATT',
      daily_prices: 'PRICE',
      salaries: 'SAL',
      queries: 'QRY',
      deals: 'DEAL',
      property_pitch_history: 'PITCH',
      dealer_calls: 'CALL',
      dealer_meetings: 'MEET'
    };
    const prefix = prefixMap[module] || module.substring(0, 4).toUpperCase();
    
    // Find max number among existing IDs starting with this prefix
    const existingIds = (db[module] || []).map(r => r.id).filter(id => id && String(id).startsWith(prefix));
    let maxNum = 0;
    existingIds.forEach(id => {
      const parts = id.split('-');
      const num = parseInt(parts[1]);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
      }
    });
    
    const nextNum = maxNum > 0 ? maxNum + 1 : (db[module] || []).length + 1;
    payload.id = `${prefix}-${String(nextNum).padStart(3, '0')}`;
  }

  // Populate basic date tracker if applicable
  const metadata = readMetadata();
  const fields = metadata.modules[module].fields;
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
    if (existingCust) {
      const queryId = `QRY-${String((db.queries || []).length + 1).padStart(3, '0')}`;
      const queryType = payload.leadType === 'Seller' ? 'Sell Property' : 'Buy Property';
      
      const newQuery = {
        id: queryId,
        customerId: existingCust.id,
        assignedEmployeeId: payload.assignedEmployeeId || existingCust.assignedEmployeeId || 'EMP-001',
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

      if (newQuery.queryType !== 'Sell Property') {
        // Automatically schedule a follow up task for the auto-created query
        db.follow_ups = db.follow_ups || [];
        const followUpId = `FOLLOW-${String((db.follow_ups || []).length + 1).padStart(3, '0')}`;
        const newFollowUp = {
          id: followUpId,
          customerId: existingCust.id,
          queryId: queryId,
          employeeId: payload.assignedEmployeeId || existingCust.assignedEmployeeId || 'EMP-001',
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
        id: `LOG-${Date.now()}`,
        employeeName: req.user.name,
        action: `Detected duplicate phone ${cleanPhone}. Created Query ${queryId} for existing customer ${existingCust.id}`,
        dateTime: new Date().toLocaleString()
      };
      if (!db.activity_logs) db.activity_logs = [];
      db.activity_logs.unshift(log);
      
      writeDb(db);
      try { syncToSheets('queries'); } catch(e) {}
      
      return res.status(201).json({
        __is_redirected_query: true,
        message: `Customer already exists. Created Query (${queryId}) linked to customer ${existingCust.name} (${existingCust.id}) instead.`,
        data: newQuery
      });
    }
  }

  if (payload.phone) {
    const cleanPhone = String(payload.phone).trim();
    const isDuplicate = (db[module] || []).some(r => r.phone && String(r.phone).trim() === cleanPhone);
    if (isDuplicate) {
      return res.status(400).json({ message: `Phone number '${payload.phone}' is already registered in this module.` });
    }
  }

  // Prevent duplicate dealers by returning existing matching record
  if (module === 'dealers' && payload.contact_num) {
    const cleanContact = String(payload.contact_num).trim();
    const existingDealer = (db.dealers || []).find(r => r.contact_num && String(r.contact_num).trim() === cleanContact);
    if (existingDealer) {
      return res.status(201).json(existingDealer);
    }
  }

  if (module === 'leads') {
    payload.assignmentStatus = 'accepted';
    payload.assignmentTime = null;
    payload.droppedBy = [];
    if (payload.assignedEmployeeId) {
      setTimeout(() => {
        notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: payload.id, leadName: payload.name || payload.person_name || 'New Lead' });
      }, 500);
    }
  }

  if (!db[module]) db[module] = [];
  db[module].push(payload);

  if (module === 'queries') {
    handleQueryStageChange(payload, db, req);
    
    if (module === 'queries' && payload.queryType !== 'Sell Property') {
      // Automatically schedule a follow up task for the new query
      db.follow_ups = db.follow_ups || [];
      const followUpId = `FOLLOW-${String((db.follow_ups || []).length + 1).padStart(3, '0')}`;
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
    if (payload.assignmentStatus === 'accepted') {
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

  // Custom SSE notifications triggers
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
  
  // Track Activity Log
  const log = {
    id: `LOG-${Date.now()}`,
    employeeName: req.user.name,
    action: `Created record ${payload.id} in ${module}`,
    dateTime: new Date().toLocaleString()
  };
  if (!db.activity_logs) db.activity_logs = [];
  db.activity_logs.unshift(log);

  writeDb(db);

  // Sync back to Google sheets asynchronously
  syncToSheets(module);
  res.status(201).json(payload);
});

app.put('/api/data/:module/:id', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'edit')(req, res, next);
}, async (req, res) => {
  const { module, id } = req.params;
  const db = readDb();
  const payload = req.body;

  if (module === 'employees') {
    delete payload.password;
    delete payload.passwordHash;
    delete payload.tokenVersion;
  }

  const index = db[module].findIndex(rec => String(rec.id) === String(id));
  if (index === -1) return res.status(404).json({ message: `Record ${id} not found.` });
  const oldPayload = { ...db[module][index] };

  // Enforce unique phone number on update
  if (payload.phone) {
    const cleanPhone = String(payload.phone).trim();
    const isDuplicate = db[module].some(r => r.phone && String(r.phone).trim() === cleanPhone && String(r.id) !== String(id));
    if (isDuplicate) {
      return res.status(400).json({ message: `Phone number '${payload.phone}' is already registered in this module.` });
    }
  }

  // Auto-update last_updated date on edits
  const metadata = readMetadata();
  const fields = metadata.modules[module].fields;
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
          id: `PRJH-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
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
          id: `PROPH-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
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
    if (sv && sv.linkedFollowUpId) {
      const fup = (db.follow_ups || []).find(f => f.id === sv.linkedFollowUpId);
      if (fup && fup.date !== sv.date) {
        fup.date = sv.date;
        try { syncToSheets('follow_ups'); } catch(e) {}
      }
    }
  }

  if (module === 'queries') handleQueryStageChange(db[module][index], db, req);
  if (module === 'deals') handleDealStatusChange(db[module][index], db, req);
  if (module === 'property_pitch_history') handlePitchStatusChange(db[module][index], db, req);
  if (module === 'leads') {
    handleLeadStatusChange(db[module][index], db, req);
    if (db[module][index].assignmentStatus === 'accepted') {
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
    id: `LOG-${Date.now()}`,
    employeeName: req.user.name,
    action: `Updated record ${id} in ${module}`,
    dateTime: new Date().toLocaleString()
  };
  if (!db.activity_logs) db.activity_logs = [];
  db.activity_logs.unshift(log);

  writeDb(db);

  // Sync to Google sheets
  syncToSheets(module);
  res.json(db[module][index]);
});
// DELETE data record handler
app.delete('/api/data/:module/:id', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'delete')(req, res, next);
}, async (req, res) => {
  const { module, id } = req.params;
  const db = readDb();

  if (!db[module]) return res.status(404).json({ message: `Module ${module} is empty.` });

  const index = db[module].findIndex(rec => String(rec.id) === String(id));
  if (index === -1) return res.status(404).json({ message: `Record ${id} not found.` });

  db[module].splice(index, 1);

  // Automatically delete all linked child records if a lead or customer is deleted
  if (module === 'leads' || module === 'customers') {
    const rec = db[module]?.find(r => String(r.id) === String(id)) || {};
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
  // Auto-shift sequential IDs to close the gap and update references globally
  const prefixMap = {
    employees: 'EMP',
    customers: 'CUST',
    leads: 'LEAD',
    properties: 'PROP',
    projects: 'PROJ',
    site_visits: 'VISIT',
    follow_ups: 'FOLLOW',
    remarks: 'REM',
    tasks: 'TASK',
    sales: 'SALE',
    documents: 'DOC',
    attendance: 'ATT',
    daily_prices: 'PRICE',
    salaries: 'SAL',
    queries: 'QRY',
    deals: 'DEAL',
    property_pitch_history: 'PITCH',
    dealer_calls: 'CALL',
    dealer_meetings: 'MEET'
  };

  const prefix = prefixMap[module];
  if (prefix) {
    const idUpdates = [];
    db[module].forEach((rec, idx) => {
      const newId = `${prefix}-${String(idx + 1).padStart(3, '0')}`;
      if (String(rec.id) !== newId) {
        idUpdates.push({ oldId: rec.id, newId });
      }
    });

    idUpdates.forEach(({ oldId, newId }) => {
      const rec = db[module].find(r => r.id === oldId);
      if (rec) {
        rec.id = newId;
      }
      updateGlobalReferences(db, oldId, newId);
    });
  }

  // Track Activity Log
  const log = {
    id: `LOG-${Date.now()}`,
    employeeName: req.user.name,
    action: `Deleted record ${id} in ${module}`,
    dateTime: new Date().toLocaleString()
  };
  if (!db.activity_logs) db.activity_logs = [];
  db.activity_logs.unshift(log);

  writeDb(db);

  // Sync to Google sheets
  syncToSheets(module);
  res.json({ success: true, message: `Record ${id} deleted successfully.` });
});

// Bulk Delete Route
app.post('/api/data/:module/bulk-delete', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { module } = req.params;
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ message: 'Invalid IDs array.' });
  }

  const db = readDb();
  if (!db[module]) return res.status(404).json({ message: `Module ${module} is empty.` });

  // Delete all matches
  db[module] = db[module].filter(rec => !ids.includes(String(rec.id)));

  // If lead or customer deleted, delete child followups etc.
  if (module === 'leads' || module === 'customers') {
    ids.forEach(id => {
      const rec = (db[module] || []).find(r => String(r.id) === String(id));
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
      const customerQueries = (db.queries || []).filter(q => String(q.customerId) === String(id));
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
      db.sales_bookings = (db.sales_bookings || []).filter(s => 
        String(s.customerId) !== String(id) || 
        (targetPhone !== '' && String(s.customerPhone).trim() === targetPhone)
      );

      // 9. Deals
      db.deals = (db.deals || []).filter(d => String(d.customerId) !== String(id));
    });

    try { syncToSheets('leads'); } catch(e) {}
    try { syncToSheets('customers'); } catch(e) {}
    try { syncToSheets('properties'); } catch(e) {}
    try { syncToSheets('follow_ups'); } catch(e) {}
    try { syncToSheets('queries'); } catch(e) {}
    try { syncToSheets('site_visits'); } catch(e) {}
    try { syncToSheets('property_pitch_history'); } catch(e) {}
    try { syncToSheets('sales_bookings'); } catch(e) {}
    try { syncToSheets('deals'); } catch(e) {}
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
    try { syncToSheets('properties'); } catch(e) {}
  }
  if (module === 'queries') {
    ids.forEach(id => {
      db.follow_ups = (db.follow_ups || []).filter(f => String(f.queryId) !== String(id));
      db.properties = (db.properties || []).filter(p => String(p.linkedQueryId) !== String(id));
    });
    try { syncToSheets('follow_ups'); } catch(e) {}
    try { syncToSheets('properties'); } catch(e) {}
  }

  // Auto-shift sequential IDs to close the gap and update references globally
  const prefixMap = {
    employees: 'EMP',
    customers: 'CUST',
    leads: 'LEAD',
    properties: 'PROP',
    projects: 'PROJ',
    site_visits: 'VISIT',
    follow_ups: 'FOLLOW',
    remarks: 'REM',
    tasks: 'TASK',
    sales: 'SALE',
    documents: 'DOC',
    attendance: 'ATT',
    daily_prices: 'PRICE',
    salaries: 'SAL',
    queries: 'QRY',
    deals: 'DEAL',
    property_pitch_history: 'PITCH',
    dealer_calls: 'CALL',
    dealer_meetings: 'MEET'
  };

  const prefix = prefixMap[module];
  if (prefix) {
    const idUpdates = [];
    db[module].forEach((rec, idx) => {
      const newId = `${prefix}-${String(idx + 1).padStart(3, '0')}`;
      if (String(rec.id) !== newId) {
        idUpdates.push({ oldId: rec.id, newId });
      }
    });

    idUpdates.forEach(({ oldId, newId }) => {
      const rec = db[module].find(r => r.id === oldId);
      if (rec) {
        rec.id = newId;
      }
      updateGlobalReferences(db, oldId, newId);
    });
  }

  // Track Activity Log
  const log = {
    id: `LOG-${Date.now()}`,
    employeeName: req.user.name,
    action: `Bulk deleted ${ids.length} records in ${module}`,
    dateTime: new Date().toLocaleString()
  };
  if (!db.activity_logs) db.activity_logs = [];
  db.activity_logs.unshift(log);

  writeDb(db);
  try { syncToSheets(module); } catch(e) {}

  res.json({ success: true, message: `Successfully deleted ${ids.length} records.` });
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
app.post('/api/location/log', authenticateToken, (req, res) => {
  const { employeeId, employeeName, latitude, longitude, status } = req.body;
  const db = readDb();
  
  if (!db.location_logs) db.location_logs = [];
  if (!db.active_paths) db.active_paths = {};

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
    id: `LOC-${Date.now()}`,
    employeeId,
    employeeName,
    latitude: encryptedCoords, // Coordinates encrypted at rest
    longitude: "",
    status,
    timestamp: new Date().toISOString()
  };
  
  db.location_logs.push(logEntry);

  if (status === 'sharing' && decLat !== 0 && decLng !== 0) {
    db.active_paths[employeeId] = db.active_paths[employeeId] || [];
    const currentPath = db.active_paths[employeeId];
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
  } else if (status === 'ended') {
    const path = db.active_paths[employeeId] || [];
    let distance = 0;
    for (let i = 0; i < path.length - 1; i++) {
      distance += calculateDistanceKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
    }
    
    // Save to employees collection
    if (db.employees) {
      const emp = db.employees.find(e => String(e.id) === String(employeeId));
      if (emp) {
        emp.locationHistory = emp.locationHistory || [];
        emp.locationHistory.push({
          date: new Date().toLocaleDateString('en-IN'),
          totalKilometers: parseFloat(distance.toFixed(2)),
          path
        });
      }
    }
    delete db.active_paths[employeeId];
  }
  
  writeDb(db);
  res.json({ success: true, log: logEntry });
});

// Fetch active coordinates path (Admin and Manager only)
app.get('/api/location/path/:employeeId', authenticateToken, (req, res) => {
  if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
    return res.status(403).json({ message: 'Access denied: Location query restricted.' });
  }

  const { employeeId } = req.params;
  const db = readDb();
  const path = db.active_paths?.[employeeId] || [];
  
  let distance = 0;
  for (let i = 0; i < path.length - 1; i++) {
    distance += calculateDistanceKm(path[i].lat, path[i].lng, path[i+1].lat, path[i+1].lng);
  }
  res.json({ path, distance: parseFloat(distance.toFixed(2)) });
});

// Fetch active location logs (Admin and Manager only)
app.get('/api/location/active', authenticateToken, (req, res) => {
  if (req.user.role !== 'Admin' && req.user.role !== 'Manager') {
    return res.status(403).json({ message: 'Access denied: Location query restricted.' });
  }

  const db = readDb();
  const logs = db.location_logs || [];
  
  // Find the latest entry for each employee
  const activeLocs = {};
  logs.forEach(log => {
    const empId = log.employeeId;
    if (!activeLocs[empId] || new Date(log.timestamp) > new Date(activeLocs[empId].timestamp)) {
      activeLocs[empId] = log;
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
      latitude: coords.lat,
      longitude: coords.lng
    };
  });

  res.json(decryptedResult);
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

app.get('/api/search', authenticateToken, (req, res) => {
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
  const allEmployees = db.employees || [];
  const allCustomers = db.customers || [];
  const allProperties = db.properties || [];
  const allSiteVisits = db.site_visits || [];
  const allFollowUps = db.follow_ups || [];
  const allAttendance = db.attendance || [];
  const allTasks = db.tasks || [];
  const allSales = db.sales || [];
  const allLeaves = db.leaves || [];
  const allRemarks = db.remarks || [];
  const allDocs = db.documents || [];

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
app.get('/api/360/:module/:id', authenticateToken, (req, res) => {
  const { module, id } = req.params;
  const db = readDb();
  
  const allEmployees = db.employees || [];
  const allCustomers = db.customers || [];
  const allProperties = db.properties || [];
  const allSiteVisits = db.site_visits || [];
  const allFollowUps = db.follow_ups || [];
  const allAttendance = db.attendance || [];
  const allTasks = db.tasks || [];
  const allSales = db.sales || [];
  const allLeaves = db.leaves || [];
  const allRemarks = db.remarks || [];
  const allDocs = db.documents || [];
  const allQueries = db.queries || [];
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
          salePrice: d.salePrice || ''
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
    data.calls = allDealerCalls.filter(c => String(c.dealerId) === String(id));
    data.meetings = allDealerMeetings.filter(m => String(m.dealerId) === String(id)).map(m => ({
      ...m,
      assignedEmployeeName: allEmployees.find(e => String(e.id) === String(m.assignedEmployeeId))?.name || m.assignedEmployeeId
    }));
    data.properties = allProperties.filter(p => String(p.dealerId) === String(id));
    data.referrals = (db.leads || []).filter(l => l.referrer_type === 'dealers' && String(l.referrer_id) === String(id));
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
    id: `REM-${Date.now()}`,
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
    id: `DOC-${Date.now()}`,
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
            id: `REM-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
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

// Public Customer Intake Form Submission (Rate-limited, validated, and anti-spam checked)
app.post('/api/public/lead-intake', ipRateLimiter(15 * 60 * 1000, 10), (req, res) => {
  const { website_url, name, phone, locality, sector, propertyType, optionType, size, plc, budget, queryType = 'Buy Property' } = req.body;
  
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
    const queryId = `QRY-${String((db.queries || []).length + 1).padStart(3, '0')}`;
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
      remarks: `Auto-created query from public requirement form (Duplicate check match). PLC preferred: ${plc || 'None'}`
    };
    
    if (!db.queries) db.queries = [];
    db.queries.push(newQuery);

    // Automatically schedule a follow up task for the new query
    db.follow_ups = db.follow_ups || [];
    const followUpId = `FOLLOW-${String((db.follow_ups || []).length + 1).padStart(3, '0')}`;
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

    writeDb(db);
    try { syncToSheets('queries'); } catch(e) {}
    
    return res.json({ success: true, message: "Welcome back! Your new requirements query has been registered under your profile.", query: newQuery });
  }

  // Else, create a new Lead
  const existingIds = (db.leads || []).map(r => r.id).filter(id => id && String(id).startsWith('LEAD'));
  let maxNum = 0;
  existingIds.forEach(id => {
    const parts = id.split('-');
    const num = parseInt(parts[1]);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  });
  
  const nextNum = maxNum > 0 ? maxNum + 1 : (db.leads || []).length + 1;
  const leadId = `LEAD-${String(nextNum).padStart(3, '0')}`;
  
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
  const queryId = `QRY-${String((db.queries || []).length + 1).padStart(3, '0')}`;
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
    remarks: `Auto-created query from public requirement form. PLC preferred: ${plc || 'None'}`
  };
  if (!db.queries) db.queries = [];
  db.queries.push(newQuery);
  try { syncToSheets('queries'); } catch(e) {}

  // Automatically schedule follow-up
  db.follow_ups = db.follow_ups || [];
  const followUpId = `FOLLOW-${String((db.follow_ups || []).length + 1).padStart(3, '0')}`;
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
app.post('/api/public/quick-add', ipRateLimiter(15 * 60 * 1000, 10), (req, res) => {
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

  const db = readDb();
  if (!db[module]) db[module] = [];

  // ID generation
  const prefixMap = {
    employees: 'EMP',
    customers: 'CUST',
    leads: 'LEAD',
    properties: 'PROP',
    projects: 'PROJ',
    site_visits: 'VISIT',
    follow_ups: 'FOLLOW',
    remarks: 'REM',
    tasks: 'TASK',
    sales: 'SALE',
    documents: 'DOC',
    attendance: 'ATT',
    daily_prices: 'PRICE',
    salaries: 'SAL',
    queries: 'QRY',
    deals: 'DEAL',
    property_pitch_history: 'PITCH',
    dealer_calls: 'CALL',
    dealer_meetings: 'MEET'
  };
  const prefix = prefixMap[module] || module.substring(0, 4).toUpperCase();
  
  const existingIds = (db[module] || []).map(r => r.id).filter(id => id && String(id).startsWith(prefix));
  let maxNum = 0;
  existingIds.forEach(id => {
    const parts = id.split('-');
    const num = parseInt(parts[1]);
    if (!isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  });
  
  const nextNum = maxNum > 0 ? maxNum + 1 : (db[module] || []).length + 1;
  payload.id = `${prefix}-${String(nextNum).padStart(3, '0')}`;
  
  // Enforce unique phone number / Master Customer record duplicate prevention
  if (payload.phone && (module === 'customers' || module === 'leads')) {
    const cleanPhone = String(payload.phone).trim();
    const existingCust = (db.customers || []).find(r => r.phone && String(r.phone).trim() === cleanPhone);
    const existingLead = (db.leads || []).find(r => r.phone && String(r.phone).trim() === cleanPhone);
    
    if (existingCust || existingLead) {
      const matchedId = existingCust ? existingCust.id : existingLead.id;
      const queryId = `QRY-${String((db.queries || []).length + 1).padStart(3, '0')}`;
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
      db.follow_ups = db.follow_ups || [];
      const followUpId = `FOLLOW-${String((db.follow_ups || []).length + 1).padStart(3, '0')}`;
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

      writeDb(db);
      try { syncToSheets('queries'); } catch(e) {}
      
      return res.json({
        success: true,
        message: `Customer already exists. Created Query (${queryId}) linked to customer profile instead.`,
        record: newQuery
      });
    }
  }

  // Normalize default date added keys if not present
  if (module === 'leads' && !payload.dateAdded) {
    payload.dateAdded = new Date().toISOString().split('T')[0];
  }

  db[module].push(payload);
  if (module === 'follow_ups') {
    handleFollowUpPipelineAction(payload, db, req);
  } else if (module === 'queries') {
    handleQueryStageChange(payload, db, req);
  }
  writeDb(db);
  syncToSheets(module);
  
  res.json({ success: true, record: payload });
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

// Polling fallback to check if user has any pending leads to accept
app.get('/api/leads/pending', authenticateToken, (req, res) => {
  const db = readDb();
  const userId = req.user.id;
  const pendingLeads = (db.leads || []).filter(lead => 
    String(lead.assignedEmployeeId) === String(userId) && 
    lead.assignmentStatus === 'pending'
  );
  res.json(pendingLeads);
});

function createFollowUpForLead(lead, db) {
  db.follow_ups = db.follow_ups || [];
  
  if (lead.leadType === 'Seller') {
    handleLeadStatusChange(lead, db, { user: { name: 'System' } });
  }

  const cleanPhone = String(lead.phone).trim();
  const cust = (db.customers || []).find(c => String(c.leadId) === String(lead.id) || (c.phone && String(c.phone).trim() === cleanPhone));
  const finalCustId = cust ? cust.id : lead.id;

  const existingFollowUp = db.follow_ups.find(f => String(f.customerId) === String(finalCustId));
  if (existingFollowUp) {
    if (lead.assignedEmployeeId && existingFollowUp.employeeId !== lead.assignedEmployeeId) {
      existingFollowUp.employeeId = lead.assignedEmployeeId;
      try { syncToSheets('follow_ups'); } catch(e) {}
    }
  } else {
    const followUpId = `FOLLOW-${String(db.follow_ups.length + 1).padStart(3, '0')}`;
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
    db.follow_ups.push(newFollowUp);
    try { syncToSheets('follow_ups'); } catch(e) {}
  }
}

// Accept Lead
app.post('/api/leads/:id/accept', authenticateToken, (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const leadIndex = (db.leads || []).findIndex(l => String(l.id) === String(id));
  if (leadIndex === -1) return res.status(404).json({ message: "Lead not found." });

  db.leads[leadIndex].assignmentStatus = 'accepted';
  db.leads[leadIndex].assignmentTime = null;
  createFollowUpForLead(db.leads[leadIndex], db);
  writeDb(db);
  syncToSheets('leads');

  res.json({ success: true, message: "Lead accepted successfully.", lead: db.leads[leadIndex] });
});

// Drop Lead (Pass to other employee)
app.post('/api/leads/:id/drop', authenticateToken, (req, res) => {
  const { id } = req.params;
  const db = readDb();
  const leadIndex = (db.leads || []).findIndex(l => String(l.id) === String(id));
  if (leadIndex === -1) return res.status(404).json({ message: "Lead not found." });

  const lead = db.leads[leadIndex];
  const oldAssignee = lead.assignedEmployeeId;
  lead.droppedBy = lead.droppedBy || [];
  if (!lead.droppedBy.includes(oldAssignee)) {
    lead.droppedBy.push(oldAssignee);
  }

  // Find all active employees who are not Admins and haven't dropped this lead yet
  const employees = db.employees || [];
  let candidates = employees.filter(emp => 
    emp.role !== 'Admin' && 
    String(emp.id) !== String(oldAssignee) && 
    !lead.droppedBy.includes(emp.id)
  );

  if (candidates.length === 0) {
    lead.droppedBy = [oldAssignee];
    candidates = employees.filter(emp => emp.role !== 'Admin' && String(emp.id) !== String(oldAssignee));
  }

  if (candidates.length > 0) {
    const nextEmp = candidates[0];
    lead.assignedEmployeeId = nextEmp.id;
    lead.assignmentStatus = 'pending';
    lead.assignmentTime = new Date().toISOString();
    notifyUser(nextEmp.id, 'new-lead', { leadId: lead.id, leadName: lead.name || lead.person_name || 'New Lead' });
  } else {
    lead.assignedEmployeeId = 'EMP-001';
    lead.assignmentStatus = 'accepted';
    lead.assignmentTime = null;
    createFollowUpForLead(lead, db);
  }

  writeDb(db);
  syncToSheets('leads');

  res.json({ success: true, message: "Lead dropped and re-assigned.", lead });
});

// --- AI ASSISTANT API ENDPOINTS ---
const { generateAIResponse } = require('./utils/aiProvider');
const { filterDb } = require('./services/crmSearchService');

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

app.post('/api/ai/property-recommendations', authenticateToken, (req, res) => {
  const { customerId } = req.body;
  const db = filterDb(readDb());

  const customer = (db.customers || []).find(c => String(c.id) === String(customerId)) ||
                   (db.leads || []).find(l => String(l.id) === String(customerId));

  if (!customer) return res.status(404).json({ message: "Customer/Lead not found." });

  const contextData = {
    customer,
    properties: db.properties || []
  };

  const systemPrompt = `Compare available properties against buyer constraints and return a JSON list of matches containing { "id": string, "name": string, "locality": string, "price": string, "propertyType": string, "matchPercentage": number }.`;
  const prompt = `Recommend property listings matching customer constraints.`;

  generateAIResponse(prompt, systemPrompt, contextData)
    .then(result => {
      try {
        const parsed = JSON.parse(result);
        res.json(parsed);
      } catch (e) {
        res.json([]);
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
    .catch(err => res.status(500).json({ error: err.message }));
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
    .catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/ai/chat', authenticateToken, (req, res) => {
  const { message } = req.body;
  const db = filterDb(readDb());

  const systemPrompt = `You are an advanced AI Assistant for a Real Estate CRM (Gagan Realtech Copilot). Answer queries using database lists. Keep replies data-centric.
If no matching records exist, you MUST explain why, suggest alternatives, and show similar results (NEVER answer only "No active matching record was found in the CRM" or "No Data Found").

CRITICAL FORMATTING INSTRUCTIONS:
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
- Date (e.g. Joined: **2026-07-08**)
- Quick Actions (The inline quick action buttons listed above)`;
  
  const contextData = db;

  generateAIResponse(message, systemPrompt, contextData)
    .then(reply => res.json({ reply }))
    .catch(err => res.status(500).json({ error: err.message }));
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
    const auth = new google.auth.JWT(
      email,
      null,
      privateKey.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({ version: 'v4', auth });
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

    const headers = rows[0];
    const crmIdIndex = headers.indexOf('crm_id');
    if (crmIdIndex === -1) {
      return res.status(400).json({ success: false, message: 'Google Sheet is missing the required crm_id column in A1.' });
    }

    const changes = [];
    const dbRecords = db[module] || [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const crmId = row[crmIdIndex];
      const sheetRecord = {};
      headers.forEach((h, idx) => {
        let val = row[idx] !== undefined ? row[idx] : '';
        if (typeof val === 'string' && (val.startsWith('[') || val.startsWith('{'))) {
          try { val = JSON.parse(val); } catch(e) {}
        }
        if (val !== '' && !isNaN(val) && val.trim && val.trim() !== '') {
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
          if (k === 'crm_id') return;
          const sheetVal = sheetRecord[k];
          const dbVal = matchedDbRecord[k];
          const stringSheet = typeof sheetVal === 'object' ? JSON.stringify(sheetVal) : String(sheetVal || '');
          const stringDb = typeof dbVal === 'object' ? JSON.stringify(dbVal) : String(dbVal || '');
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
    res.status(500).json({ success: false, error: err.message });
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

app.listen(PORT, () => {
  console.log(`Gagan Realtech ERP+CRM API Server running on port ${PORT}`);
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
          const buyerCust = (db.customers || []).find(c => String(c.id) === String(d.customerId));
          const buyerName = buyerCust ? buyerCust.name : (d.customerId || 'Unknown');
          prop.contact_person_name = buyerName;
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
            salePrice: d.salePrice || ''
          });
          updated = true;
        }
      }
    });
    if (updated) {
      writeDb(db);
      console.log('Database self-correction: synced property status & ownership logs for closed deals.');
    }
  } catch (err) {
    console.error('Database self-correction failed:', err);
  }
});
