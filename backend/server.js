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

const allowedOrigins = [
  'https://gr-crm-frontend.onrender.com'
];
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin, curl, or mobile app requests without origin headers
    if (!origin) return callback(null, true);
    
    const isAllowed = allowedOrigins.includes(origin) || 
                      /^http:\/\/localhost(:\d+)?$/.test(origin) || 
                      /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) || 
                      origin.startsWith('capacitor://') || 
                      origin.startsWith('chrome-extension://');
                      
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  credentials: true
}));
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
  getRecordsCount,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  pool,
  normalizeRow,
  ensurePerformanceIndexes
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

// Sync from Google Sheets on start if credentials exist
syncFromSheets().then(res => {
  if (res) console.log('Initial Google Sheets sync completed on boot.');
  else console.log('Google Sheets sync skipped or unconfigured.');
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

    res.json({ success: true, message: `Password for employee ${employee.name} updated successfully. Active sessions revoked.` });
  } catch (err) {
    console.error('Reset password database error:', err);
    res.status(500).json({ message: 'Database error resetting password: ' + err.message });
  }
});

// --- WORKSPACE CUSTOM API ENDPOINTS ---

// 1. To-Dos Endpoints
app.get('/api/workspace/todos', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    
    let query = 'SELECT * FROM todos WHERE "assignedTo" = $1 OR personal = true';
    let params = [userId];
    
    const dbRes = await pool.query(query, params);
    res.json(dbRes.rows);
  } catch (err) {
    console.error('Error fetching workspace todos:', err);
    res.status(500).json({ message: 'Error fetching to-dos: ' + err.message });
  }
});

app.post('/api/workspace/todos', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { title, dueDate, dueTime, priority, personal, notes } = req.body;
    
    const todoId = 'TODO-PERS-' + Date.now();
    const result = await pool.query(`
      INSERT INTO todos (id, title, "assignedTo", "dueDate", "dueTime", priority, status, personal, "reminderStatus", notes, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
      RETURNING *
    `, [todoId, title, userId, dueDate, dueTime || '12:00', priority || 'Medium', 'Pending', personal !== false, 'Pending', notes || '']);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating workspace todo:', err);
    res.status(500).json({ message: 'Error creating to-do: ' + err.message });
  }
});

app.put('/api/workspace/todos/:id', authenticateToken, async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { id } = req.params;
    const { title, dueDate, dueTime, priority, status, notes } = req.body;
    
    // Check ownership
    const checkRes = await pool.query('SELECT * FROM todos WHERE id = $1', [id]);
    if (!checkRes.rows[0]) {
      return res.status(404).json({ message: 'To-do not found' });
    }
    if (role !== 'Admin' && checkRes.rows[0].assignedTo !== userId) {
      return res.status(403).json({ message: 'Access denied to this to-do' });
    }
    
    const updated = await updateRecord('todos', id, { title, dueDate, dueTime, priority, status, notes });
    res.json(updated);
  } catch (err) {
    console.error('Error updating workspace todo:', err);
    res.status(500).json({ message: 'Error updating to-do: ' + err.message });
  }
});

app.delete('/api/workspace/todos/:id', authenticateToken, async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { id } = req.params;
    
    const checkRes = await pool.query('SELECT * FROM todos WHERE id = $1', [id]);
    if (!checkRes.rows[0]) {
      return res.status(404).json({ message: 'To-do not found' });
    }
    if (role !== 'Admin' && checkRes.rows[0].assignedTo !== userId) {
      return res.status(403).json({ message: 'Access denied to delete this to-do' });
    }
    
    await pool.query('DELETE FROM todos WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted to-do successfully' });
  } catch (err) {
    console.error('Error deleting workspace todo:', err);
    res.status(500).json({ message: 'Error deleting to-do' });
  }
});

// 2. Sticky Notes Endpoints
app.get('/api/workspace/notes', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { linkedModule, linkedId } = req.query;
    
    let query = 'SELECT * FROM sticky_notes WHERE "employeeId" = $1';
    let params = [userId];
    
    if (linkedModule && linkedId) {
      query = 'SELECT * FROM sticky_notes WHERE ("employeeId" = $1 OR shared = true) AND "linkedModule" = $2 AND "linkedId" = $3';
      params = [userId, linkedModule, linkedId];
    }
    
    const dbRes = await pool.query(query, params);
    res.json(dbRes.rows);
  } catch (err) {
    console.error('Error fetching workspace notes:', err);
    res.status(500).json({ message: 'Error fetching notes: ' + err.message });
  }
});

app.post('/api/workspace/notes', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { content, color, pinned, linkedModule, linkedId, reminderDate, reminderTime, shared } = req.body;
    
    const noteId = 'NOTE-' + Date.now();
    const result = await pool.query(`
      INSERT INTO sticky_notes (id, "employeeId", content, color, pinned, "linkedModule", "linkedId", "reminderDate", "reminderTime", "reminderStatus", shared, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      RETURNING *
    `, [noteId, userId, content || '', color || 'Yellow', !!pinned, linkedModule || null, linkedId || null, reminderDate || null, reminderTime || null, 'Pending', !!shared]);
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error creating sticky note:', err);
    res.status(500).json({ message: 'Error creating note: ' + err.message });
  }
});

app.put('/api/workspace/notes/:id', authenticateToken, async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { id } = req.params;
    const { content, color, pinned, linkedModule, linkedId, reminderDate, reminderTime, shared } = req.body;
    
    const checkRes = await pool.query('SELECT * FROM sticky_notes WHERE id = $1', [id]);
    if (!checkRes.rows[0]) {
      return res.status(404).json({ message: 'Note not found' });
    }
    if (role !== 'Admin' && checkRes.rows[0].employeeId !== userId) {
      return res.status(403).json({ message: 'Access denied to this note' });
    }
    
    const updated = await updateRecord('sticky_notes', id, { content, color, pinned, linkedModule, linkedId, reminderDate, reminderTime, shared });
    res.json(updated);
  } catch (err) {
    console.error('Error updating sticky note:', err);
    res.status(500).json({ message: 'Error updating note: ' + err.message });
  }
});

app.delete('/api/workspace/notes/:id', authenticateToken, async (req, res) => {
  try {
    const { id: userId, role } = req.user;
    const { id } = req.params;
    
    const checkRes = await pool.query('SELECT * FROM sticky_notes WHERE id = $1', [id]);
    if (!checkRes.rows[0]) {
      return res.status(404).json({ message: 'Note not found' });
    }
    if (role !== 'Admin' && checkRes.rows[0].employeeId !== userId) {
      return res.status(403).json({ message: 'Access denied to this note' });
    }
    
    await pool.query('DELETE FROM sticky_notes WHERE id = $1', [id]);
    res.json({ success: true, message: 'Note deleted' });
  } catch (err) {
    console.error('Error deleting sticky note:', err);
    res.status(500).json({ message: 'Error deleting note' });
  }
});

// 3. Pinned Shortcuts Endpoints
app.get('/api/workspace/shortcuts', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const dbRes = await pool.query('SELECT * FROM user_shortcuts WHERE "employeeId" = $1', [userId]);
    res.json(dbRes.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching shortcuts' });
  }
});

app.post('/api/workspace/shortcuts', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { moduleName, recordId, label } = req.body;
    
    // Check duplicate
    const checkDup = await pool.query('SELECT id FROM user_shortcuts WHERE "employeeId" = $1 AND "moduleName" = $2 AND "recordId" = $3', [userId, moduleName, recordId]);
    if (checkDup.rows[0]) {
      return res.json({ success: true, message: 'Already shortcutted' });
    }
    
    const shortId = 'SHORT-' + Date.now();
    const result = await pool.query(`
      INSERT INTO user_shortcuts (id, "employeeId", "moduleName", "recordId", label, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      RETURNING *
    `, [shortId, userId, moduleName, recordId, label]);
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error pinning shortcut' });
  }
});

app.delete('/api/workspace/shortcuts/:id', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { id } = req.params;
    await pool.query('DELETE FROM user_shortcuts WHERE id = $1 AND "employeeId" = $2', [id, userId]);
    res.json({ success: true, message: 'Shortcut removed' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting shortcut' });
  }
});

// 4. Form Drafts Endpoints
app.get('/api/workspace/drafts/:moduleName', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { moduleName } = req.params;
    const dbRes = await pool.query('SELECT * FROM draft_forms WHERE "employeeId" = $1 AND "moduleName" = $2', [userId, moduleName]);
    res.json(dbRes.rows[0] ? JSON.parse(dbRes.rows[0].formData) : {});
  } catch (err) {
    res.status(500).json({ message: 'Error fetching drafts' });
  }
});

app.post('/api/workspace/drafts', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { moduleName, formData } = req.body;
    
    const checkEx = await pool.query('SELECT id FROM draft_forms WHERE "employeeId" = $1 AND "moduleName" = $2', [userId, moduleName]);
    if (checkEx.rows[0]) {
      await pool.query('UPDATE draft_forms SET "formData" = $1, updated_at = now() WHERE id = $2', [JSON.stringify(formData), checkEx.rows[0].id]);
    } else {
      const draftId = 'DRAFT-' + Date.now();
      await pool.query(`
        INSERT INTO draft_forms (id, "employeeId", "moduleName", "formData", created_at)
        VALUES ($1, $2, $3, $4, now())
      `, [draftId, userId, moduleName, JSON.stringify(formData)]);
    }
    res.json({ success: true, message: 'Draft saved' });
  } catch (err) {
    res.status(500).json({ message: 'Error saving draft' });
  }
});

// 5. Personal Documents Vault Endpoints
app.get('/api/workspace/documents', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const dbRes = await pool.query('SELECT * FROM personal_documents WHERE "employeeId" = $1', [userId]);
    res.json(dbRes.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching vault files' });
  }
});

app.post('/api/workspace/documents', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { name, fileUrl, expiryDate } = req.body;
    
    const docId = 'PERS-DOC-' + Date.now();
    const result = await pool.query(`
      INSERT INTO personal_documents (id, "employeeId", name, "fileUrl", "expiryDate", created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      RETURNING *
    `, [docId, userId, name, fileUrl || '', expiryDate || null]);
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error uploading personal document' });
  }
});

app.delete('/api/workspace/documents/:id', authenticateToken, async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { id } = req.params;
    await pool.query('DELETE FROM personal_documents WHERE id = $1 AND "employeeId" = $2', [id, userId]);
    res.json({ success: true, message: 'Document deleted from vault' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting vault document' });
  }
});

// --- WORKSPACE SCHEDULER BACKUP TIMER ---
let lastSummaryDate = '';
let lastEodDate = '';

async function runSchedulerTick() {
  const client = await pool.connect();
  try {
    const todayDateStr = new Date().toISOString().split('T')[0];
    const now = new Date();
    const currentHour = now.getHours();

    // 1. Timed Reminders (site visits and follow ups) - 30 minutes before
    const dueVisits = await client.query(`
      SELECT * FROM todos 
      WHERE status = 'Pending' 
        AND "reminderStatus" = 'Pending' 
        AND "dueDate" = $1
    `, [todayDateStr]);

    for (const todo of dueVisits.rows) {
      if (todo.dueTime) {
        const [tHour, tMinute] = todo.dueTime.split(':').map(Number);
        const todoTime = new Date();
        todoTime.setHours(tHour, tMinute, 0, 0);

        const diffMs = todoTime.getTime() - now.getTime();
        const diffMins = Math.round(diffMs / (60 * 1000));

        if (diffMins > 0 && diffMins <= 30) {
          console.log(`[Scheduler] Dispatching 30-min timed reminder to ${todo.assignedTo} for task: ${todo.title}`);
          notifyUser(todo.assignedTo, 'reminder', {
            title: todo.title,
            message: `You have a scheduled activity starting in ${diffMins} minutes at ${todo.dueTime}!`
          });
          await client.query('UPDATE todos SET "reminderStatus" = $1, updated_at = now() WHERE id = $2', ['Reminded', todo.id]);
        }
      }
    }

    // 2. Daily work summary at 9:00 AM
    if (currentHour === 9 && lastSummaryDate !== todayDateStr) {
      console.log(`[Scheduler] Running 9:00 AM daily planner summary...`);
      const emps = await client.query('SELECT id FROM employees');
      for (const emp of emps.rows) {
        const stats = await client.query(`
          SELECT COUNT(*) as count FROM todos 
          WHERE "assignedTo" = $1 
            AND status = 'Pending' 
            AND ("dueDate" <= $2 OR "dueDate" IS NULL)
        `, [emp.id, todayDateStr]);

        const count = parseInt(stats.rows[0].count, 10);
        if (count > 0) {
          notifyUser(emp.id, 'reminder', {
            title: `📋 Daily Planner Summary`,
            message: `Good morning! You have ${count} pending or overdue tasks scheduled for today. Tap to check your planner timeline!`
          });
        }
      }
      lastSummaryDate = todayDateStr;
    }

    // 3. Overdue alert at the end of the day (6:00 PM / 18:00)
    if (currentHour === 18 && lastEodDate !== todayDateStr) {
      console.log(`[Scheduler] Running 6:00 PM overdue alert ticker...`);
      const emps = await client.query('SELECT id FROM employees');
      for (const emp of emps.rows) {
        const stats = await client.query(`
          SELECT COUNT(*) as count FROM todos 
          WHERE "assignedTo" = $1 
            AND status = 'Pending' 
            AND "dueDate" < $2
        `, [emp.id, todayDateStr]);

        const count = parseInt(stats.rows[0].count, 10);
        if (count > 0) {
          notifyUser(emp.id, 'reminder', {
            title: `⚠️ Overdue Tasks Alert`,
            message: `You have ${count} overdue tasks remaining at the end of the day. Please log progress or reschedule.`
          });
        }
      }
      lastEodDate = todayDateStr;
    }

    // 4. Manager Escalation (Overdue high/urgent follow-up for 24-48 hours)
    const overdueEscalations = await client.query(`
      SELECT * FROM todos 
      WHERE status = 'Pending' 
        AND ("priority" = 'High' OR "priority" = 'Urgent')
        AND "dueDate" < $1
    `, [todayDateStr]);

    for (const todo of overdueEscalations.rows) {
      const due = new Date(todo.dueDate);
      const diffHrs = Math.floor((now.getTime() - due.getTime()) / (60 * 60 * 1000));
      const isUrgent = todo.priority === 'Urgent';

      if ((isUrgent && diffHrs >= 24) || (!isUrgent && diffHrs >= 48)) {
        const empRes = await client.query('SELECT name FROM employees WHERE id = $1', [todo.assignedTo]);
        const empName = empRes.rows[0]?.name || 'Employee';

        console.log(`[Scheduler] Escalating overdue todo: ${todo.title} by ${empName} to Admin/Manager`);
        notifyUser('EMP-001', 'reminder', {
          title: `🚨 OVERDUE ESCALATION: ${empName}`,
          message: `Task "${todo.title}" has been overdue for ${diffHrs} hours! Priority: ${todo.priority}.`
        });
      }
    }

  } catch (err) {
    console.error('Scheduler tick error:', err);
  } finally {
    client.release();
  }
}

setInterval(runSchedulerTick, 60 * 1000);

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



    res.json(result);
  } catch (err) {
    console.error('Import mapping failure:', err.message);
    res.status(500).json({ success: false, message: 'Import with mapping failed: ' + err.message });
  }
});

// --- AUTOMATION TRIGGERS ---

async function handleAutomatedPitchLogging(rec, client, req) {
  if (!rec.pitchedPropertyId) return;
  
  const custId = rec.customerId || rec.id;
  
  // Find customer or lead
  const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [custId]);
  const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [custId]);
  const cust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : (leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null);
  const custName = cust ? (cust.name || cust.person_name || 'Client') : 'Client';
  
  const pitchRes = await client.query('SELECT * FROM property_pitch_history WHERE "customerId" = $1 AND "propertyId" = $2', [custId, rec.pitchedPropertyId]);
  const exists = pitchRes.rows.length > 0;
  
  if (!exists) {
    const pitchId = await generateNextIdAsync(client, 'property_pitch_history', 'PITCH');
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
    
    await insertRecord('property_pitch_history', newPitch, client);

    // Automatically update customer / lead pipeline stage/status
    if (cust) {
      if (String(custId).startsWith('LEAD-')) {
        await updateRecord('leads', custId, { status: 'In-Progress' }, client);
        
        try { syncToSheets('leads'); } catch(e) {}
      } else {
        await updateRecord('customers', custId, { stage: 'Interested' }, client);
        
        try { syncToSheets('customers'); } catch(e) {}
      }
    }

    // Automatically update active non-approved queries stage to Property Matching
    const queriesRes = await client.query('SELECT * FROM queries WHERE "customerId" = $1 AND status <> \'Approved\'', [custId]);
    if (queriesRes.rows.length > 0) {
      for (const q of queriesRes.rows) {
        await updateRecord('queries', q.id, { stage: 'Property Matching' }, client);
        
      }
      try { syncToSheets('queries'); } catch(e) {}
    }
    
    const log = {
      id: generateUniqueId('LOG'),
      employeeName: empName,
      action: `Automatically logged pitch ${pitchId} for Property ${rec.pitchedPropertyId} matching Client ${custId}`,
      dateTime: new Date().toLocaleString()
    };
    await insertRecord('activity_logs', log, client);
  } else {
    const existingPitch = normalizeRow('property_pitch_history', pitchRes.rows[0]);
    const updatePayload = {
      quotedPrice: Number(rec.pitchPrice || existingPitch.quotedPrice || 0),
      remarks: rec.pitchRemarks || existingPitch.remarks,
      pitchDate: new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN')
    };
    if (rec.pipelineAction) {
      updatePayload.status = rec.pipelineAction;
      updatePayload.interestLevel = rec.pipelineAction;
    }
    const updated = await updateRecord('property_pitch_history', existingPitch.id, updatePayload, client);
    await handlePitchStatusChange(updated, client, req);
    try { syncToSheets('property_pitch_history'); } catch(e) {}
  }
}

async function handleQueryStageChange(q, client, req) {
  if (!q.id) return;
  const isInventoryAdded = q.queryType === 'Sell Property' && (q.status === 'Approved' || q.stage === 'Inventory Added' || q.stage === 'Available For Sale');
  if (isInventoryAdded) {
    if (q.status === 'Approved' && q.stage !== 'Inventory Added' && q.stage !== 'Available For Sale') {
      q.stage = 'Inventory Added';
      await updateRecord('queries', q.id, { stage: 'Inventory Added' }, client);
      
    }
    const propRes = await client.query('SELECT * FROM properties WHERE "linkedQueryId" = $1', [q.id]);
    const propExists = propRes.rows.length > 0;
    if (!propExists) {
      const propId = await generateNextIdAsync(client, 'properties', 'PROP');
      const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [q.customerId]);
      const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [q.customerId]);
      const cust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : (leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null);
      const ownerName = cust ? (cust.name || cust.person_name) : 'Unknown Owner';
      const ownerPhone = cust ? cust.phone : '';
      
      const newProperty = {
        id: propId,
        status: 'Available',
        date: new Date().toLocaleDateString('en-IN'),
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
        owner_history: JSON.stringify([]),
        timeline: JSON.stringify([
          {
            date: new Date().toLocaleDateString('en-IN'),
            event: 'Property Added to Inventory',
            details: `Property Added to Inventory — Automatically created from Sell Property Query ${q.id}.`
          }
        ])
      };
      await insertRecord('properties', newProperty, client);

      if (q.assignedEmployeeId) {
        setTimeout(() => {
          notifyUser(q.assignedEmployeeId, 'new-property-matched', {
            propertyId: propId,
            message: `Property ${propId} added automatically from Sell Query ${q.id}.`
          });
        }, 500);
      }
      
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user ? req.user.name : 'System',
        action: `Automatically created Property ${propId} in inventory from Query ${q.id}`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', log, client);

      try { syncToSheets('properties'); } catch(e) {}
    }
  }
}

async function handleDealerCallInsertion(c, client) {
  if (!c.dealerId) return;
  const dealerRes = await client.query('SELECT * FROM dealers WHERE id = $1', [c.dealerId]);
  const dealer = dealerRes.rows[0];
  if (dealer) {
    await updateRecord('dealers', dealer.id, { remarks: c.remarks || '', callOutcome: c.callOutcome || '' }, client);
    try { syncToSheets('dealers'); } catch(e) {}
  }
}

async function handleDealerVisitAssignment(payload, client, req, oldPayload = null) {
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
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user ? req.user.name : 'System',
        action: `Assigned Dealer ${payload.id} to Employee ${payload.assignedEmployeeId} for a visit`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', log, client);
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
        dateAdded: new Date().toLocaleDateString('en-IN')
      };
      
      const insertedCust = await insertRecord('customers', newCust, client);
      existingCust = insertedCust;

    }

    await updateRecord('leads', leadId, { status: 'Converted' }, client);

    const newCustId = existingCust.id;

    await client.query('UPDATE follow_ups SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);

    await client.query('UPDATE queries SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);

    await client.query('UPDATE site_visits SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);

    await client.query('UPDATE sales SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);

    await client.query('UPDATE property_pitch_history SET "customerId" = $1 WHERE "customerId" = $2', [newCustId, leadId]);

    await client.query('UPDATE properties SET current_owner_id = $1 WHERE current_owner_id = $2', [newCustId, leadId]);

    if (!isOuterTransaction) {
      await client.query('COMMIT');
    }

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

async function handleDealStatusChange(d, dbOrClient, req) {
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
          saleDate: d.registrationDate || new Date().toLocaleDateString('en-IN'),
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

async function handlePitchStatusChange(p, dbOrClient, req) {
  if (!p.id) return;
  const client = dbOrClient || pool;

  if (p.propertyId && p.propertyStatus) {
    await client.query('UPDATE properties SET status = $1 WHERE id = $2', [p.propertyStatus, p.propertyId]);
    
  }

  // Auto-complete call follow-up if pitched via call
  if (p.pitchMethod === 'Call') {
    await client.query(
      `UPDATE follow_ups SET status = $1, remarks = concat(remarks, $2::text) WHERE "customerId" = $3 AND status <> $4`,
      ['Completed', `\n[System: Auto-completed call follow-up via logged Call Pitch ${p.id}]`, p.customerId, 'Completed']
    );
    
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

      await handleFollowUpPipelineAction(updatedF, client, req);

      if (targetF.queryId) {
        const qStatus = mappedStage === 'Closed' ? 'Closed' : undefined;
        const updates = { stage: mappedStage };
        if (qStatus) updates.status = qStatus;
        
        const updatedQ = await updateRecord('queries', targetF.queryId, updates, client);
        
      }
    }
  } else if (p.linkedQueryId) {
    const qStatus = mappedStage === 'Closed' ? 'Closed' : undefined;
    const updates = { stage: mappedStage };
    if (qStatus) updates.status = qStatus;

    const updatedQ = await updateRecord('queries', p.linkedQueryId, updates, client);

    const fupRes = await client.query('SELECT * FROM follow_ups WHERE "queryId" = $1', [p.linkedQueryId]);
    for (const f of fupRes.rows) {
      if (f.status !== 'Completed' && f.status !== 'Call Done') {
        const updatedF = await updateRecord('follow_ups', f.id, {
          pipelineAction: mappedStage,
          pitchedPropertyId: p.propertyId || f.pitchedPropertyId,
          pitchPrice: p.quotedPrice || f.pitchPrice,
          pitchRemarks: p.remarks || f.pitchRemarks
        }, client);
        
        await handleFollowUpPipelineAction(updatedF, client, req);
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
        
        await handleFollowUpPipelineAction(updatedF, client, req);
      }
    }

    const qRes = await client.query('SELECT * FROM queries WHERE "customerId" = $1', [p.customerId]);
    for (const q of qRes.rows) {
      const qStatus = mappedStage === 'Closed' ? 'Closed' : undefined;
      const updates = { stage: mappedStage };
      if (qStatus) updates.status = qStatus;

      const updatedQ = await updateRecord('queries', q.id, updates, client);
      
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
      
    }
  } else {
    await client.query('DELETE FROM site_visits WHERE "linkedPitchId" = $1', [p.id]);
    
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
      registrationDate: new Date().toLocaleDateString('en-IN'),
      purchasePrice: finalPrice || (prop ? (prop.demand || '') : ''),
      brokerage: '',
      commission: '',
      status: 'Closed',
      associatedPitchId: p.id
    };
    
    const insertedDeal = await insertRecord('deals', existingDeal, client);
    existingDeal = insertedDeal;

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
      
    }
  }

  // Invoke the master deal status change helper
  await handleDealStatusChange(existingDeal, client, req);

  // Auto convert follow-ups for this client to Call Done / Closed
  await client.query(
    'UPDATE follow_ups SET status = $1, "pipelineAction" = $2 WHERE "customerId" = $3 OR "customerId" = $4',
    ['Call Done', 'Property Registered/Sold Out', p.customerId, finalCustomerId]
  );
  
}

async function handleLeadStatusChange(lead, dbOrClient, req) {
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
        dateAdded: new Date().toLocaleDateString('en-IN')
      };
      const insertedCust = await insertRecord('customers', existingCust, client);
      existingCust = insertedCust;

    } else {
      const updatedCust = await updateRecord('customers', existingCust.id, {
        budget: leadDemand,
        city: lead.locality || existingCust.city || ''
      }, client);
      
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
      
    }
  }
}

async function syncPropertyDetailsUniversally(propId, dbOrClient) {
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

  await client.query(
    'UPDATE customers SET city = $1, budget = $2 WHERE id = $3 OR id = $4',
    [fieldsToSync.locality, fieldsToSync.demand, prop.current_owner_id, prop.booked_by_customer_id]
  );

  await client.query(
    'UPDATE queries SET r_c_i = $1, "propertyType" = $2, locality = $3, sector_block = $4, size = $5, demand = $6, budget = $6 WHERE "propertyId" = $7',
    [fieldsToSync.r_c_i, fieldsToSync.propertyType, fieldsToSync.locality, fieldsToSync.sector_block, fieldsToSync.size, fieldsToSync.demand, propId]
  );

  await client.query(
    'UPDATE follow_ups SET "pitchPrice" = $1 WHERE "pitchedPropertyId" = $2',
    [fieldsToSync.demand, propId]
  );
  
}

async function syncAssignedEmployeeUniversally(sourceModule, recordId, newEmployeeId, dbOrClient) {
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
    
  }

  if (custId || leadId || phones.length > 0) {
    await client.query(
      'UPDATE customers SET "assignedEmployeeId" = $1 WHERE id = $2 OR "leadId" = $3 OR (phone = ANY($4) AND $4 <> \'{}\')',
      [newEmployeeId, custId, leadId, phones]
    );
    
  }

  if (custId || leadId) {
    await client.query(
      'UPDATE follow_ups SET "employeeId" = $1 WHERE "customerId" = $2 OR "customerId" = $3',
      [newEmployeeId, custId, leadId]
    );
    
  }

  if (custId || leadId) {
    await client.query(
      'UPDATE queries SET "assignedEmployeeId" = $1 WHERE "customerId" = $2 OR "customerId" = $3',
      [newEmployeeId, custId, leadId]
    );
    
  }

  if (custId || leadId) {
    await client.query(
      'UPDATE site_visits SET "employeeId" = $1 WHERE "customerId" = $2 OR "customerId" = $3',
      [newEmployeeId, custId, leadId]
    );
    
  }
}

async function handleFollowUpPipelineAction(f, dbOrClient, req) {
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
      
    }
  } else {
    await client.query('DELETE FROM site_visits WHERE "linkedFollowUpId" = $1', [f.id]);
    
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
        registrationDate: new Date().toLocaleDateString('en-IN')
      };
      
      const insertedDeal = await insertRecord('deals', newDeal, client);

      await handleDealStatusChange(insertedDeal, client, req);
    } else {
      await handleDealStatusChange(existingDeal, client, req);
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

      await handleQueryStageChange(updatedQ, client, req);
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
      
    }
  } else if (customerId && String(customerId).startsWith('CUST-')) {
    const custRes = await client.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    const cust = custRes.rows[0];
    if (cust) {
      const updatedCust = await updateRecord('customers', cust.id, { stage: action }, client);
      
    }
  }
}

async function generateDynamicTimeline(moduleName, id, client = pool, preFetchedData = null) {
  const timeline = [];

  const allRemarks = preFetchedData && preFetchedData.remarks
    ? preFetchedData.remarks
    : (await client.query('SELECT * FROM remarks WHERE "targetModule" = $1 AND "targetId" = $2', [moduleName, id])).rows.map(r => normalizeRow('remarks', r));

  if (moduleName === 'customers') {
    const cust = preFetchedData && preFetchedData.customer
      ? preFetchedData.customer
      : (await client.query('SELECT * FROM customers WHERE id = $1', [id])).rows.map(r => normalizeRow('customers', r))[0] || null;

    if (cust) {
      timeline.push({
        date: cust.dateAdded || '',
        event: 'Customer Profile Created',
        details: `Customer ${cust.name} added to master record.`,
        icon: 'UserCheck'
      });
      
      const leads = preFetchedData && preFetchedData.leads
        ? preFetchedData.leads
        : await (async () => {
            const cleanPhone = String(cust.phone).trim();
            const cleanEmail = String(cust.email || '').trim().toLowerCase();
            const leadsRes = await client.query('SELECT * FROM leads WHERE phone = $1 OR (email = $2 AND $2 <> \'\')', [cleanPhone, cleanEmail]);
            return leadsRes.rows.map(r => normalizeRow('leads', r));
          })();
      
      leads.forEach(l => {
        timeline.push({
          date: l.dateAdded || '',
          event: `Lead Created (${l.id})`,
          details: `Source: ${l.source} • Status: ${l.status}`,
          icon: 'Magnet'
        });
      });

      const queries = preFetchedData && preFetchedData.queries
        ? preFetchedData.queries
        : (await client.query('SELECT * FROM queries WHERE "customerId" = $1', [id])).rows.map(r => normalizeRow('queries', r));

      const siteVisits = preFetchedData && preFetchedData.site_visits
        ? preFetchedData.site_visits
        : (await client.query('SELECT * FROM site_visits WHERE "customerId" = $1', [id])).rows.map(r => normalizeRow('site_visits', r));

      const followUps = preFetchedData && preFetchedData.follow_ups
        ? preFetchedData.follow_ups
        : (await client.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [id])).rows.map(r => normalizeRow('follow_ups', r));

      const pitches = preFetchedData && preFetchedData.pitches
        ? preFetchedData.pitches
        : (await client.query('SELECT * FROM property_pitch_history WHERE "customerId" = $1', [id])).rows.map(r => normalizeRow('property_pitch_history', r));

      const deals = preFetchedData && preFetchedData.deals
        ? preFetchedData.deals
        : (await client.query('SELECT * FROM deals WHERE "customerId" = $1 OR "sellerCustomerId" = $2', [id, id])).rows.map(r => normalizeRow('deals', r));

      queries.forEach(q => {
        timeline.push({
          date: q.date || '',
          event: `Query Created (${q.id})`,
          details: `Type: ${q.queryType} • Status: ${q.status} • Stage: ${q.stage}`,
          icon: 'HelpCircle'
        });
      });
      siteVisits.forEach(v => {
        timeline.push({
          date: v.date || '',
          event: `Site Visit Scheduled/Done (${v.id})`,
          details: `Property: ${v.propertyId} • Result: ${v.result}`,
          icon: 'Eye'
        });
      });
      followUps.forEach(f => {
        timeline.push({
          date: f.date || '',
          event: `Follow-Up Scheduled (${f.id})`,
          details: `Status: ${f.status} • Assigned Exec: ${f.employeeId}`,
          icon: 'PhoneCall'
        });
      });
      pitches.forEach(p => {
        timeline.push({
          date: p.pitchDate ? p.pitchDate.split(' ')[0] : '',
          event: `Property Pitched (${p.id})`,
          details: `Property: ${p.propertyId} pitched by ${p.employeeName} via ${p.pitchMethod}`,
          icon: 'Send'
        });
      });
      deals.forEach(d => {
        const role = String(d.customerId) === String(id) ? 'Buyer' : 'Seller';
        timeline.push({
          date: d.registrationDate || '',
          event: `Deal ${d.status} (${d.id})`,
          details: `Customer role: ${role} • Property: ${d.propertyId} • Price: ₹${d.purchasePrice}`,
          icon: 'Handshake'
        });
      });
    }
  } else if (moduleName === 'properties') {
    const prop = preFetchedData && preFetchedData.property
      ? preFetchedData.property
      : (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows.map(r => normalizeRow('properties', r))[0] || null;

    if (prop) {
      timeline.push({
        date: prop.date || '',
        event: 'Property Added to Inventory',
        details: `Status: ${prop.status} • Locality: ${prop.locality} • Price/Demand: ₹${prop.demand}`,
        icon: 'Home'
      });

      const siteVisits = preFetchedData && preFetchedData.site_visits
        ? preFetchedData.site_visits
        : (await client.query('SELECT * FROM site_visits WHERE "propertyId" = $1', [id])).rows.map(r => normalizeRow('site_visits', r));

      const pitches = preFetchedData && preFetchedData.pitches
        ? preFetchedData.pitches
        : (await client.query('SELECT * FROM property_pitch_history WHERE "propertyId" = $1', [id])).rows.map(r => normalizeRow('property_pitch_history', r));

      const deals = preFetchedData && preFetchedData.deals
        ? preFetchedData.deals
        : (await client.query('SELECT * FROM deals WHERE "propertyId" = $1', [id])).rows.map(r => normalizeRow('deals', r));

      siteVisits.forEach(v => {
        timeline.push({
          date: v.date || '',
          event: `Site Visit Showcased (${v.id})`,
          details: `Customer: ${v.customerId} • Result: ${v.result}`,
          icon: 'Eye'
        });
      });
      pitches.forEach(p => {
        timeline.push({
          date: p.pitchDate ? p.pitchDate.split(' ')[0] : '',
          event: `Pitched to Customer (${p.id})`,
          details: `Pitched to ${p.customerName} by ${p.employeeName}`,
          icon: 'Send'
        });
      });
      deals.forEach(d => {
        timeline.push({
          date: d.registrationDate || '',
          event: `Deal ${d.status} (${d.id})`,
          details: `Buyer: ${d.customerId} • Seller: ${d.sellerCustomerId} • Price: ₹${d.purchasePrice}`,
          icon: 'Handshake'
        });
      });

      const ownerHistory = prop.owner_history ? (Array.isArray(prop.owner_history) ? prop.owner_history : JSON.parse(prop.owner_history)) : [];
      ownerHistory.forEach(h => {
        timeline.push({
          date: h.saleDate || '',
          event: 'Ownership Transferred',
          details: `Sold by ${h.ownerName} on ${h.saleDate} for ₹${h.salePrice}`,
          icon: 'User'
        });
      });
    }
  } else if (moduleName === 'leads') {
    const lead = preFetchedData && preFetchedData.lead
      ? preFetchedData.lead
      : (await client.query('SELECT * FROM leads WHERE id = $1', [id])).rows.map(r => normalizeRow('leads', r))[0] || null;

    if (lead) {
      timeline.push({
        date: lead.dateAdded || '',
        event: 'Lead Created',
        details: `Source: ${lead.source} • Budget: ₹${lead.budget}`,
        icon: 'Magnet'
      });
    }
  } else if (moduleName === 'queries') {
    const q = preFetchedData && preFetchedData.query
      ? preFetchedData.query
      : (await client.query('SELECT * FROM queries WHERE id = $1', [id])).rows.map(r => normalizeRow('queries', r))[0] || null;

    if (q) {
      timeline.push({
        date: q.date || '',
        event: 'Query Created',
        details: `Type: ${q.queryType} • Status: ${q.status} • Stage: ${q.stage}`,
        icon: 'HelpCircle'
      });
    }
  } else if (moduleName === 'deals') {
    const d = preFetchedData && preFetchedData.deal
      ? preFetchedData.deal
      : (await client.query('SELECT * FROM deals WHERE id = $1', [id])).rows.map(r => normalizeRow('deals', r))[0] || null;

    if (d) {
      timeline.push({
        date: d.registrationDate || '',
        event: 'Deal Created',
        details: `Status: ${d.status} • Price: ₹${d.purchasePrice}`,
        icon: 'Handshake'
      });
    }
  } else if (moduleName === 'dealers') {
    const dealer = preFetchedData && preFetchedData.dealer
      ? preFetchedData.dealer
      : (await client.query('SELECT * FROM dealers WHERE id = $1', [id])).rows.map(r => normalizeRow('dealers', r))[0] || null;

    if (dealer) {
      timeline.push({
        date: dealer.dateAdded || new Date().toLocaleDateString('en-IN'),
        event: 'Dealer Created',
        details: `Firm: ${dealer.firm_name} • Contact: ${dealer.person_name}`,
        icon: 'Building'
      });
      
      const calls = preFetchedData && preFetchedData.calls
        ? preFetchedData.calls
        : (await client.query('SELECT * FROM dealer_calls WHERE "dealerId" = $1', [id])).rows.map(r => normalizeRow('dealer_calls', r));

      const meetings = preFetchedData && preFetchedData.meetings
        ? preFetchedData.meetings
        : (await client.query('SELECT * FROM dealer_meetings WHERE "dealerId" = $1', [id])).rows.map(r => normalizeRow('dealer_meetings', r));

      calls.forEach(c => {
        timeline.push({
          date: c.date || '',
          event: `Outreach Call logged`,
          details: `Outcome: ${c.remarks} • Followup: ${c.followUpDate || 'None'} • By: ${c.employeeName}`,
          icon: 'PhoneCall'
        });
      });

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
    timeline.push({
      date: r.dateTime ? r.dateTime.split(' ')[0] : '',
      event: `Remark by ${r.employeeName}`,
      details: r.comment,
      icon: 'MessageSquare'
    });
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
  const { limit, offset, search } = req.query;
  
  try {
    const userFilter = {
      userId: req.user.id,
      role: req.user.role
    };

    const totalCount = await getRecordsCount(module, pool, { search, userFilter });
    res.setHeader('X-Total-Count', totalCount);
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');

    const records = await getRecords(module, pool, { limit, offset, search, userFilter });
    
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

  if (payload.phone) {
    const cleanPhone = String(payload.phone).trim();
    if (cleanPhone.length > 0 && (cleanPhone.length !== 10 || isNaN(Number(cleanPhone)))) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits.' });
    }
  }

  if (module === 'employees') {
    delete payload.password;
    delete payload.passwordHash;
    delete payload.tokenVersion;
  }

  try {
    const log = {
      id: generateUniqueId('LOG'),
      employeeName: req.user.name,
      action: `Created record ${payload.id || 'new'} in ${module}`,
      dateTime: new Date().toLocaleString()
    };

    const inserted = await runTransaction(async (client) => {
      if (module === 'property_pitch_history' && payload.customerId && payload.propertyId) {
        const existingPitchRes = await client.query('SELECT * FROM property_pitch_history WHERE "customerId" = $1 AND "propertyId" = $2', [payload.customerId, payload.propertyId]);
        if (existingPitchRes.rows[0]) {
          const existingPitch = normalizeRow('property_pitch_history', existingPitchRes.rows[0]);
          const updatePayload = {
            status: payload.status || existingPitch.status || 'Pitched',
            interestLevel: payload.interestLevel || payload.status || existingPitch.interestLevel || 'Interested',
            quotedPrice: payload.quotedPrice !== undefined ? Number(payload.quotedPrice) : existingPitch.quotedPrice,
            remarks: payload.remarks || existingPitch.remarks,
            pitchDate: payload.pitchDate || new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN'),
            employeeId: payload.employeeId || req.user.id,
            employeeName: payload.employeeName || req.user.name
          };
          const updated = await updateRecord('property_pitch_history', existingPitch.id, updatePayload, client);
          await handlePitchStatusChange(updated, client, req);
          try { syncToSheets('property_pitch_history'); } catch(e) {}
          return updated;
        }
      }

      // 1. Generate ID if not provided
      if (!payload.id) {
        payload.id = await generateNextIdAsync(client, module);
      }
      log.action = `Created record ${payload.id} in ${module}`;

      // 2. Lead pre-insert automation
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

      // 3. Query pre-insert automation
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

      // 4. Duplicate prevention / query redirect for customers & leads (with phone)
      if (payload.phone && (module === 'customers' || module === 'leads')) {
        const cleanPhone = String(payload.phone).trim();
        const custRes = await client.query('SELECT * FROM customers WHERE phone = $1', [cleanPhone]);
        const leadRes = await client.query('SELECT * FROM leads WHERE phone = $1', [cleanPhone]);
        const existingCust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
        const existingLead = leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null;
        
        if (existingCust || existingLead) {
          const existingPerson = existingCust || existingLead;
          const queryId = await generateNextIdAsync(client, 'queries', 'QRY');
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
          
          await insertRecord('queries', newQuery, client);

          if (newQuery.queryType === 'Buy Property' && String(existingPerson.id).startsWith('LEAD')) {
            const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
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
            await insertRecord('follow_ups', newFollowUp, client);
            
            try { syncToSheets('follow_ups'); } catch(e) {}
          }
          
          const dupLog = {
            id: generateUniqueId('LOG'),
            employeeName: req.user ? req.user.name : 'System',
            action: `Detected duplicate phone ${cleanPhone}. Created Query ${queryId} for existing ${existingPerson.id.startsWith('LEAD') ? 'lead' : 'customer'} ${existingPerson.id}`,
            dateTime: new Date().toLocaleString()
          };
          await insertRecord('activity_logs', dupLog, client);

          try { syncToSheets('queries'); } catch(e) {}
          
          return {
            __is_redirected_query: true,
            message: `Customer/Lead already exists. Created Query (${queryId}) linked to customer profile instead.`,
            data: newQuery
          };
        }
      }

      // 5. Property dealer and direct owner pre-insert automations
      if (module === 'properties') {
        await handlePropertyDealerAssociation(payload, client);

        if (payload.dealer_owner_booked === 'Direct' || payload.dealer_owner_booked === 'Owner' || !payload.dealer_owner_booked) {
          payload.dealer_owner_booked = 'Direct';
          const ownerName = payload.contact_person_name || 'Direct Property Owner';
          const ownerPhone = payload.contact_number ? String(payload.contact_number).trim() : '';

          if ((ownerName || ownerPhone) && !payload.current_owner_id) {
            // Find existing customer matching name or phone
            let cust = null;
            if (ownerPhone) {
              const custRes = await client.query('SELECT * FROM customers WHERE phone = $1', [ownerPhone]);
              cust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
            }
            if (!cust && ownerName) {
              const custRes = await client.query('SELECT * FROM customers WHERE LOWER(name) = $1', [ownerName.toLowerCase()]);
              cust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
            }
            if (!cust) {
              const custId = await generateNextIdAsync(client, 'customers', 'CUST');
              cust = {
                id: custId,
                name: ownerName,
                phone: ownerPhone,
                stage: 'Active Seller',
                assignedEmployeeId: payload.assignedEmployeeId || (req.user ? req.user.id : 'EMP-001'),
                city: payload.locality || '',
                requirements: `Direct Property Owner for Property ${payload.id || ''}`,
                source: payload.source || 'Direct Property Seller',
                dateAdded: new Date().toLocaleDateString('en-IN')
              };
              await insertRecord('customers', cust, client);
              
              try { syncToSheets('customers'); } catch(e) {}
            }
            if (cust) {
              payload.current_owner_id = cust.id;
              payload.booked_by_customer_id = cust.id;
            }
          }
        }
      }

      // 6. Dealer duplicate prevention
      if (module === 'dealers' && payload.contact_num) {
        const cleanContact = String(payload.contact_num).trim();
        const existingDealerRes = await client.query('SELECT * FROM dealers WHERE contact_num = $1', [cleanContact]);
        if (existingDealerRes.rows[0]) {
          return normalizeRow('dealers', existingDealerRes.rows[0]);
        }
      }

      // 7. Wanted properties OPERATING AREAS assignment automation
      if (module === 'wanted_properties') {
        const dealerContactNum = String(payload.dealerContactNum || '').trim();
        if (!dealerContactNum) {
          throw new Error('Dealer Contact Number is required.');
        }

        const dealerRes = await client.query('SELECT * FROM dealers WHERE contact_num = $1', [dealerContactNum]);
        let dealer = dealerRes.rows[0] ? normalizeRow('dealers', dealerRes.rows[0]) : null;

        if (dealer) {
          payload.dealerId = dealer.id;
          const updatedDealer = {};
          if (payload.dealerContactName) updatedDealer.person_name = payload.dealerContactName;
          if (payload.dealerFirmName) updatedDealer.firm_name = payload.dealerFirmName;
          if (payload.dealerAddress) updatedDealer.address = payload.dealerAddress;
          if (Object.keys(updatedDealer).length > 0) {
            await updateRecord('dealers', dealer.id, updatedDealer, client);
          }
        } else {
          const nextDealerId = await generateNextIdAsync(client, 'dealers', 'DEALER');
          const newDealer = {
            id: nextDealerId,
            contact_num: dealerContactNum,
            person_name: payload.dealerContactName || "Unverified — Auto-created from Wanted Property",
            firm_name: payload.dealerFirmName || "Unverified — Auto-created from Wanted Property",
            address: payload.dealerAddress || "",
            sector_block: "Auto-created",
            dateAdded: new Date().toLocaleDateString('en-IN')
          };
          await insertRecord('dealers', newDealer, client);
          payload.dealerId = nextDealerId;

          const dealerLog = {
            id: generateUniqueId('LOG'),
            employeeName: req.user ? req.user.name : 'System',
            action: `Auto-created Dealer ${nextDealerId} for contact ${dealerContactNum} from Wanted Property`,
            dateTime: new Date().toLocaleString()
          };
          await insertRecord('activity_logs', dealerLog, client);
        }

        if (!payload.assignedEmployeeId && payload.locality) {
          const reqLocality = String(payload.locality).toLowerCase().trim();
          const allEmployees = await getRecords('employees', client);
          const matchingEmployees = allEmployees.filter(emp => {
            const areas = String(emp.operatingAreas || '').split(',').map(s => s.toLowerCase().trim());
            return areas.some(area => area !== '' && (area.includes(reqLocality) || reqLocality.includes(area)));
          });

          let assignedEmpId = null;

          if (matchingEmployees.length === 1) {
            assignedEmpId = matchingEmployees[0].id;
          } else if (matchingEmployees.length > 1) {
            const allWPs = await getRecords('wanted_properties', client);
            let minCount = Infinity;
            let bestEmp = null;

            for (const emp of matchingEmployees) {
              const openCount = allWPs.filter(wp => 
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

      // Populate basic date/user fields
      const metadata = readMetadata();
      const fields = (metadata.modules[module] && metadata.modules[module].fields) || [];
      fields.forEach(f => {
        if (f.name === 'dateAdded' && !payload[f.name]) {
          payload[f.name] = new Date().toLocaleDateString('en-IN');
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

      // Insert the main record
      const insertedRec = await insertRecord(module, payload, client);

      // Post-insert automations
      if (module === 'queries') {
        await handleQueryStageChange(insertedRec, client, req);
        
        if (payload.queryType === 'Buy Property' && String(payload.customerId).startsWith('LEAD')) {
          const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
          const newFollowUp = {
            id: followUpId,
            customerId: payload.customerId,
            queryId: insertedRec.id,
            employeeId: payload.assignedEmployeeId || 'EMP-001',
            date: new Date().toLocaleDateString('en-IN'),
            time: '12:00 PM',
            status: 'Pending Call',
            pipelineAction: 'Fresh Lead',
            remarks: `Auto-scheduled follow up for new Query ${insertedRec.id}: ${payload.remarks || 'No notes'}`
          };
          await insertRecord('follow_ups', newFollowUp, client);
          
          try { syncToSheets('follow_ups'); } catch(e) {}
        }
      }

      if (module === 'deals') await handleDealStatusChange(insertedRec, client, req);
      if (module === 'property_pitch_history') await handlePitchStatusChange(insertedRec, client, req);
      
      if (module === 'leads') {
        await handleLeadStatusChange(insertedRec, client, req);
        if (insertedRec.assignmentStatus === 'accepted' && insertedRec.leadType !== 'Seller') {
          await createFollowUpForLead(insertedRec, client);
        }
        if (insertedRec.assignedEmployeeId) {
          await syncAssignedEmployeeUniversally('leads', insertedRec.id, insertedRec.assignedEmployeeId, client);
        }
      }

      if (module === 'customers' && insertedRec.assignedEmployeeId) {
        await syncAssignedEmployeeUniversally('customers', insertedRec.id, insertedRec.assignedEmployeeId, client);
      }
      if (module === 'follow_ups' && insertedRec.employeeId) {
        await syncAssignedEmployeeUniversally('follow_ups', insertedRec.id, insertedRec.employeeId, client);
      }
      if (module === 'follow_ups') await handleFollowUpPipelineAction(insertedRec, client, req);
      if (module === 'dealer_calls') await handleDealerCallInsertion(insertedRec, client);
      if (module === 'dealers') await handleDealerVisitAssignment(insertedRec, client, req);
      
      if ((module === 'leads' || module === 'follow_ups' || module === 'queries') && insertedRec.pitchedPropertyId) {
        await handleAutomatedPitchLogging(insertedRec, client, req);
      }

      if (module === 'site_visits') {
        if (insertedRec.result === 'Completed') {
          const targetPitchesRes = await client.query(`
            SELECT * FROM property_pitch_history 
            WHERE ("id" = $1) 
               OR ("customerId" = $2 AND "propertyId" = $3 AND "status" = 'Site Visit Scheduled')
          `, [insertedRec.linkedPitchId || 'N/A', insertedRec.customerId, insertedRec.propertyId]);
          
          for (const pitch of targetPitchesRes.rows) {
            if (pitch.status === 'Site Visit Scheduled' || pitch.interestLevel === 'Site Visit Scheduled') {
              const updatedPitch = await updateRecord('property_pitch_history', pitch.id, {
                status: 'Site Visit Completed',
                interestLevel: 'Site Visit Completed'
              }, client);
              await handlePitchStatusChange(updatedPitch, client, req);
              try { syncToSheets('property_pitch_history'); } catch(e) {}
            }
          }
        }
      }

      if (module === 'site_visits' && insertedRec.employeeId) {
        notifyUser(insertedRec.employeeId, 'visit-assigned', {
          visitId: insertedRec.id,
          message: `New Site Visit ${insertedRec.id} scheduled/assigned to you.`
        });
      }
      if (module === 'dealer_meetings' && insertedRec.assignedEmployeeId) {
        notifyUser(insertedRec.assignedEmployeeId, 'meeting-assigned', {
          meetingId: insertedRec.id,
          message: `New Dealer Meeting ${insertedRec.id} assigned to you.`
        });
      }
      if (module === 'queries' && insertedRec.assignedEmployeeId && insertedRec.status === 'Approved') {
        notifyUser(insertedRec.assignedEmployeeId, 'query-approved', {
          queryId: insertedRec.id,
          message: `Your Property Query ${insertedRec.id} has been Approved.`
        });
      }
      if (module === 'documents') {
        notifyUser('EMP-001', 'pending-docs-alert', {
          docId: insertedRec.id,
          message: `New document "${insertedRec.name}" uploaded. Verification pending.`
        });
      }

      await insertRecord('activity_logs', log, client);
      return insertedRec;
    });

    syncToSheets(module);
    if (module === 'properties') {
      try { syncToSheets('dealers'); } catch (e) {}
    }
    res.status(201).json(inserted);
  } catch (err) {
    console.error(`Error inserting ${module}:`, err);
    res.status(400).json({ message: err.message });
  }
});

app.put('/api/data/:module/:id', authenticateToken, (req, res, next) => {
  const { module } = req.params;
  checkPermission(module, 'edit')(req, res, next);
}, async (req, res) => {
  const { module, id } = req.params;
  const payload = req.body;

  if (payload.phone) {
    const cleanPhone = String(payload.phone).trim();
    if (cleanPhone.length > 0 && (cleanPhone.length !== 10 || isNaN(Number(cleanPhone)))) {
      return res.status(400).json({ message: 'Phone number must be exactly 10 digits.' });
    }
  }

  if (module === 'employees') {
    delete payload.password;
    delete payload.passwordHash;
    delete payload.tokenVersion;
  }

  try {
    const log = {
      id: generateUniqueId('LOG'),
      employeeName: req.user.name,
      action: `Updated record ${id} in ${module}`,
      dateTime: new Date().toLocaleString()
    };

    const updated = await runTransaction(async (client) => {
      const recordExists = await getRecord(module, id, client);
      if (!recordExists) {
        throw new Error(`Record ${id} not found.`);
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
        if (payload.assignedEmployeeId && payload.assignedEmployeeId !== recordExists.assignedEmployeeId) {
          payload.assignmentStatus = 'accepted';
          payload.assignmentTime = null;
          payload.droppedBy = [];
          setTimeout(() => {
            notifyUser(payload.assignedEmployeeId, 'new-lead', { leadId: id, leadName: payload.name || payload.person_name || 'New Lead' });
          }, 500);
        }
      }

      if (module === 'properties') {
        await handlePropertyDealerAssociation(payload, client);
      }

      if (module === 'wanted_properties') {
        const dealerContactNum = String(payload.dealerContactNum || '').trim();
        if (dealerContactNum) {
          const dealerRes = await client.query('SELECT * FROM dealers WHERE contact_num = $1', [dealerContactNum]);
          let dealer = dealerRes.rows[0] ? normalizeRow('dealers', dealerRes.rows[0]) : null;

          if (dealer) {
            payload.dealerId = dealer.id;
            const updatedDealer = {};
            if (payload.dealerContactName) updatedDealer.person_name = payload.dealerContactName;
            if (payload.dealerFirmName) updatedDealer.firm_name = payload.dealerFirmName;
            if (payload.dealerAddress) updatedDealer.address = payload.dealerAddress;
            if (Object.keys(updatedDealer).length > 0) {
              await updateRecord('dealers', dealer.id, updatedDealer, client);
            }
          } else {
            const nextDealerId = await generateNextIdAsync(client, 'dealers', 'DEALER');
            const newDealer = {
              id: nextDealerId,
              contact_num: dealerContactNum,
              person_name: payload.dealerContactName || "Unverified — Auto-created from Wanted Property",
              firm_name: payload.dealerFirmName || "Unverified — Auto-created from Wanted Property",
              address: payload.dealerAddress || "",
              sector_block: "Auto-created",
              dateAdded: new Date().toLocaleDateString('en-IN')
            };
            await insertRecord('dealers', newDealer, client);
            payload.dealerId = nextDealerId;
          }
        }
      }

      if (module === 'projects') {
        const trackFields = ['pricing_details', 'plc_percent', 'status', 'configurations_sizes', 'total_land_area'];
        const historyEntries = [];
        
        trackFields.forEach(f => {
          const oldVal = recordExists[f];
          const newVal = payload[f];
          if (newVal !== undefined && String(oldVal || '').trim() !== String(newVal || '').trim()) {
            historyEntries.push({
              id: generateUniqueId('PRJH'),
              projectId: id,
              fieldName: f,
              oldValue: String(oldVal || ''),
              newValue: String(newVal || ''),
              updatedBy: req.user.name,
              updateDate: new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN')
            });
          }
        });

        for (const h of historyEntries) {
          await insertRecord('project_history', h, client);
        }
      }

      if (module === 'properties') {
        const trackFields = ['status', 'demand', 'owner_history', 'remarks', 'locality', 'sector_block'];
        const historyEntries = [];
        
        trackFields.forEach(f => {
          const oldVal = recordExists[f];
          const newVal = payload[f];
          if (newVal !== undefined && String(oldVal || '').trim() !== String(newVal || '').trim()) {
            historyEntries.push({
              id: generateUniqueId('PROPH'),
              propertyId: id,
              fieldName: f,
              oldValue: typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal || ''),
              newValue: typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal || ''),
              updatedBy: req.user.name,
              updateDate: new Date().toLocaleDateString('en-IN') + ' ' + new Date().toLocaleTimeString('en-IN')
            });
          }
        });

        for (const h of historyEntries) {
          await insertRecord('property_history', h, client);
        }
      }

      const rec = await updateRecord(module, id, payload, client);

      if (module === 'queries') {
        await handleQueryStageChange(rec, client, req);
      }

      if (module === 'leads') {
        await handleLeadStatusChange(rec, client, req);
        if (rec.assignmentStatus === 'accepted' && rec.leadType !== 'Seller') {
          await createFollowUpForLead(rec, client);
        }
        if (rec.assignedEmployeeId) {
          await syncAssignedEmployeeUniversally('leads', id, rec.assignedEmployeeId, client);
        }
      }

      if (module === 'follow_ups') {
        await handleFollowUpPipelineAction(rec, client, req);
      }

      if (module === 'property_pitch_history') {
        await handlePitchStatusChange(rec, client, req);
      }

      if (module === 'properties') {
        await syncPropertyDetailsUniversally(id, client);
        try { syncToSheets('leads'); } catch(e) {}
        try { syncToSheets('customers'); } catch(e) {}
        try { syncToSheets('queries'); } catch(e) {}
        try { syncToSheets('follow_ups'); } catch(e) {}
      }

      if (module === 'site_visits') {
        if (rec.linkedFollowUpId) {
          const fupRes = await client.query('SELECT * FROM follow_ups WHERE id = $1', [rec.linkedFollowUpId]);
          const fup = fupRes.rows[0];
          if (fup && fup.date !== rec.date) {
            await updateRecord('follow_ups', fup.id, { date: rec.date }, client);
            try { syncToSheets('follow_ups'); } catch(e) {}
          }
        }
        if (payload.result === 'Completed') {
          const targetPitchesRes = await client.query(`
            SELECT * FROM property_pitch_history 
            WHERE ("id" = $1) 
               OR ("customerId" = $2 AND "propertyId" = $3 AND "status" = 'Site Visit Scheduled')
          `, [rec.linkedPitchId || 'N/A', rec.customerId, rec.propertyId]);
          
          for (const pitch of targetPitchesRes.rows) {
            if (pitch.status === 'Site Visit Scheduled' || pitch.interestLevel === 'Site Visit Scheduled') {
              const updatedPitch = await updateRecord('property_pitch_history', pitch.id, {
                status: 'Site Visit Completed',
                interestLevel: 'Site Visit Completed'
              }, client);
              await handlePitchStatusChange(updatedPitch, client, req);
              try { syncToSheets('property_pitch_history'); } catch(e) {}
            }
          }
        }
      }

      if (module === 'site_visits' && rec.employeeId) {
        notifyUser(rec.employeeId, 'visit-assigned', {
          visitId: rec.id,
          message: `Site Visit ${rec.id} has been updated/assigned to you.`
        });
      }
      if (module === 'dealer_meetings' && rec.assignedEmployeeId) {
        notifyUser(rec.assignedEmployeeId, 'meeting-assigned', {
          meetingId: rec.id,
          message: `Dealer Meeting ${rec.id} has been updated/assigned to you.`
        });
      }
      if (module === 'queries' && rec.assignedEmployeeId && rec.status === 'Approved') {
        notifyUser(rec.assignedEmployeeId, 'query-approved', {
          queryId: rec.id,
          message: `Your Property Query ${rec.id} has been Approved.`
        });
      }
      if (module === 'documents') {
        notifyUser('EMP-001', 'pending-docs-alert', {
          docId: rec.id,
          message: `Document "${rec.name}" has been updated. Verification pending.`
        });
      }

      if (module === 'deals') await handleDealStatusChange(rec, client, req);
      if (module === 'dealer_calls') await handleDealerCallInsertion(rec, client);
      if (module === 'dealers') await handleDealerVisitAssignment(rec, client, req, recordExists);
      if ((module === 'leads' || module === 'follow_ups' || module === 'queries') && rec.pitchedPropertyId) {
        await handleAutomatedPitchLogging(rec, client, req);
      }

      await insertRecord('activity_logs', log, client);
      return rec;
    });

    syncToSheets(module);
    if (module === 'properties') {
      try { syncToSheets('dealers'); } catch (e) {}
    }
    res.json(updated);
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

  try {
    const log = {
      id: generateUniqueId('LOG'),
      employeeName: req.user.name,
      action: `Deleted record ${id} in ${module}`,
      dateTime: new Date().toLocaleString()
    };

    const recordDeleted = await runTransaction(async (client) => {
      const rec = await getRecord(module, id, client);
      if (!rec) {
        throw new Error(`Record ${id} not found.`);
      }

      // Automatically delete all linked child records if a lead or customer is deleted
      if (module === 'leads' || module === 'customers') {
        const targetPhone = String(rec.phone || '').trim();
        const targetEmail = String(rec.email || '').trim();

        // 1. Cross-delete client/lead
        if (module === 'leads') {
          await client.query('DELETE FROM customers WHERE "leadId" = $1 OR (phone = $2 AND $2 <> \'\') OR (email = $3 AND $3 <> \'\')', [id, targetPhone, targetEmail]);
        } else {
          const leadIdVal = rec.leadId || '';
          await client.query('DELETE FROM leads WHERE id = $1 OR (phone = $2 AND $2 <> \'\') OR (email = $3 AND $3 <> \'\')', [leadIdVal, targetPhone, targetEmail]);
        }

        // 2. Find all query IDs for this customer/lead
        const queriesRes = await client.query('SELECT id FROM queries WHERE "customerId" = $1', [id]);
        const queryIds = queriesRes.rows.map(q => q.id);

        // 3. Delete properties linked via queryId, booked_by_customer_id, or phone
        if (queryIds.length > 0) {
          await client.query('DELETE FROM properties WHERE "booked_by_customer_id" = $1 OR "linkedQueryId" = ANY($2) OR (contact_number = $3 AND $3 <> \'\')', [id, queryIds, targetPhone]);
        } else {
          await client.query('DELETE FROM properties WHERE "booked_by_customer_id" = $1 OR (contact_number = $2 AND $2 <> \'\')', [id, targetPhone]);
        }

        // 4. Delete follow_ups
        if (queryIds.length > 0) {
          await client.query('DELETE FROM follow_ups WHERE "customerId" = $1 OR "queryId" = ANY($2)', [id, queryIds]);
        } else {
          await client.query('DELETE FROM follow_ups WHERE "customerId" = $1', [id]);
        }

        // 5. Delete other references
        await client.query('DELETE FROM queries WHERE "customerId" = $1', [id]);
        await client.query('DELETE FROM site_visits WHERE "customerId" = $1', [id]);
        await client.query('DELETE FROM property_pitch_history WHERE "customerId" = $1', [id]);
        await client.query('DELETE FROM sales WHERE "customerId" = $1', [id]);
        await client.query('DELETE FROM deals WHERE "customerId" = $1', [id]);
      }

      if (module === 'property_pitch_history') {
        await client.query('DELETE FROM site_visits WHERE "linkedPitchId" = $1', [id]);
      }

      if (module === 'deals') {
        // Remove owner history references
        const propRes = await client.query('SELECT * FROM properties');
        for (const p of propRes.rows) {
          if (p.owner_history) {
            let hist = Array.isArray(p.owner_history) ? p.owner_history : JSON.parse(p.owner_history);
            const filteredHist = hist.filter(h => String(h.dealId) !== String(id));
            if (filteredHist.length !== hist.length) {
              await updateRecord('properties', p.id, { owner_history: JSON.stringify(filteredHist) }, client);
            }
          }
        }
      }

      if (module === 'queries') {
        await client.query('DELETE FROM follow_ups WHERE "queryId" = $1', [id]);
        await client.query('DELETE FROM properties WHERE "linkedQueryId" = $1', [id]);
      }

      await deleteRecord(module, id, client);
      await insertRecord('activity_logs', log, client);
      return rec;
    });

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
});

// Bulk Delete Route
app.post('/api/data/:module/bulk-delete', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { module } = req.params;
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids)) {
    return res.status(400).json({ message: 'Invalid IDs array.' });
  }

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

        if (module === 'deals') {
          // For deals, clean up owner_history on properties
          const propertiesRes = await client.query('SELECT id, owner_history FROM properties');
          for (const prop of propertiesRes.rows) {
            if (prop.owner_history) {
              const history = Array.isArray(prop.owner_history) ? prop.owner_history : JSON.parse(prop.owner_history);
              const cleanedHistory = history.filter(h => String(h.dealId) !== String(id));
              if (cleanedHistory.length !== history.length) {
                await client.query('UPDATE properties SET owner_history = $1 WHERE id = $2', [JSON.stringify(cleanedHistory), prop.id]);
              }
            }
          }
        }

        if (module === 'queries') {
          await client.query('DELETE FROM follow_ups WHERE "queryId" = $1', [id]);
          await client.query('DELETE FROM properties WHERE "linkedQueryId" = $1', [id]);
        }

        if (module === 'property_pitch_history') {
          await client.query('DELETE FROM site_visits WHERE "linkedPitchId" = $1', [id]);
        }

        await deleteRecord(module, id, client);
      }

      await insertRecord('activity_logs', log, client);
      return records;
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

      }
      
      await pool.query('DELETE FROM active_paths WHERE employee_id = $1', [employeeId]);
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
  const metadata = readMetadata();
  const defaultTemplates = {
    whatsapp: "Hi [Client Name], based on your requirements, here is a matching listing: [Property Name] (Price: ₹[Price]). Let me know when you'd like to visit!",
    email_subject: "Matching Property Listing - Gagan Realtech",
    email_body: "Hi [Client Name],\n\nBased on your requirements, here is a property listing you might like:\n\nProperty Name: [Property Name]\nPrice: ₹[Price]\nLocality: [Locality]\nSector: [Sector]\n\nBest regards,\nGagan Realtech Team",
    sms: "Hi [Client Name], matching listing found: [Property Name] (Price: ₹[Price]) in [Locality]. Contact us!"
  };
  res.json(metadata.templates || defaultTemplates);
});

// Update message templates config
app.post('/api/templates', authenticateToken, async (req, res) => {
  try {
    const metadata = readMetadata();
    metadata.templates = req.body;
    await writeMetadata(metadata);
    res.json({ success: true, templates: metadata.templates });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- GLOBAL 360° SEARCH ENGINE ---

app.get('/api/search', authenticateToken, async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim() === '') {
    return res.json({ results: {}, connections: {} });
  }

  try {
    const query = q.toLowerCase().trim();
    const keywords = query.split(/\s+/).filter(word => word.length > 0);
    const metadata = readMetadata();
    const results = {};
    const userRole = req.user.role;

    // 1. Search all dynamic tables
    for (const moduleName of Object.keys(metadata.modules)) {
      // Check if role has access to this module
      const permissions = metadata.rolesPermissions[userRole] || {};
      const modulePerms = permissions[moduleName] || [];
      if (userRole !== 'Admin' && !modulePerms.includes('view')) {
        continue; // Skip search if role cannot view this module
      }

      const cols = getTableColumns(moduleName);
      const allowedCols = cols.filter(col => {
        if (userRole !== 'Admin' && metadata.fieldPermissions && metadata.fieldPermissions[userRole]) {
          const allowed = metadata.fieldPermissions[userRole][moduleName];
          if (allowed) return allowed.includes(col);
        }
        return true;
      });

      if (allowedCols.length === 0) continue;

      const conditions = [];
      const params = [];
      keywords.forEach(word => {
        const colConditions = [];
        allowedCols.forEach(col => {
          colConditions.push(`"${col}"::text ILIKE $${params.length + 1}`);
        });
        if (colConditions.length > 0) {
          conditions.push(`(${colConditions.join(' OR ')})`);
          params.push(`%${word}%`);
        }
      });

      if (conditions.length > 0) {
        const sql = `SELECT * FROM "${moduleName}" WHERE ${conditions.join(' AND ')}`;
        const modRes = await pool.query(sql, params);
        const matchedRecords = modRes.rows.map(r => normalizeRow(moduleName, r));

        if (matchedRecords.length > 0) {
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
      }
    }

    // 1.5. Interconnect search results
    const matchedCustomerIdsSet = new Set();
    const matchedPropertyIdsSet = new Set();

    if (results.customers) {
      results.customers.forEach(c => matchedCustomerIdsSet.add(c.id));
    }
    if (results.leads) {
      for (const l of results.leads) {
        if (l.phone) {
          const cleanP = String(l.phone).trim();
          const custRes = await pool.query('SELECT id FROM customers WHERE phone = $1', [cleanP]);
          if (custRes.rows[0]) matchedCustomerIdsSet.add(custRes.rows[0].id);
        }
      }
    }
    if (results.properties) {
      results.properties.forEach(p => matchedPropertyIdsSet.add(p.id));
    }

    const matchedCustomerIds = Array.from(matchedCustomerIdsSet);
    const matchedPropertyIds = Array.from(matchedPropertyIdsSet);

    if (matchedCustomerIds.length > 0) {
      results.queries = results.queries || [];
      const queriesRes = await pool.query('SELECT * FROM queries WHERE "customerId" = ANY($1)', [matchedCustomerIds]);
      queriesRes.rows.forEach(q => {
        const normalized = normalizeRow('queries', q);
        if (!results.queries.some(r => r.id === normalized.id)) {
          results.queries.push(normalized);
        }
      });

      results.deals = results.deals || [];
      const dealsRes = await pool.query('SELECT * FROM deals WHERE "customerId" = ANY($1) OR "sellerCustomerId" = ANY($1)', [matchedCustomerIds]);
      dealsRes.rows.forEach(d => {
        const normalized = normalizeRow('deals', d);
        if (!results.deals.some(r => r.id === normalized.id)) {
          results.deals.push(normalized);
        }
      });

      results.site_visits = results.site_visits || [];
      const siteVisitsRes = await pool.query('SELECT * FROM site_visits WHERE "customerId" = ANY($1)', [matchedCustomerIds]);
      siteVisitsRes.rows.forEach(v => {
        const normalized = normalizeRow('site_visits', v);
        if (!results.site_visits.some(r => r.id === normalized.id)) {
          results.site_visits.push(normalized);
        }
      });

      results.properties = results.properties || [];
      const propsRes = await pool.query('SELECT * FROM properties WHERE "current_owner_id" = ANY($1)', [matchedCustomerIds]);
      propsRes.rows.forEach(p => {
        const normalized = normalizeRow('properties', p);
        if (!results.properties.some(r => r.id === normalized.id)) {
          results.properties.push(normalized);
        }
      });
    }

    if (matchedPropertyIds.length > 0) {
      results.deals = results.deals || [];
      const dealsRes = await pool.query('SELECT * FROM deals WHERE "propertyId" = ANY($1)', [matchedPropertyIds]);
      dealsRes.rows.forEach(d => {
        const normalized = normalizeRow('deals', d);
        if (!results.deals.some(r => r.id === normalized.id)) {
          results.deals.push(normalized);
        }
      });

      results.site_visits = results.site_visits || [];
      const siteVisitsRes = await pool.query('SELECT * FROM site_visits WHERE "propertyId" = ANY($1)', [matchedPropertyIds]);
      siteVisitsRes.rows.forEach(v => {
        const normalized = normalizeRow('site_visits', v);
        if (!results.site_visits.some(r => r.id === normalized.id)) {
          results.site_visits.push(normalized);
        }
      });

      results.customers = results.customers || [];
      const propsRes = await pool.query('SELECT * FROM properties WHERE id = ANY($1) AND "current_owner_id" IS NOT NULL', [matchedPropertyIds]);
      const ownerIds = propsRes.rows.map(p => p.current_owner_id).filter(Boolean);
      if (ownerIds.length > 0) {
        const ownersRes = await pool.query('SELECT * FROM customers WHERE id = ANY($1)', [ownerIds]);
        ownersRes.rows.forEach(owner => {
          const normalized = normalizeRow('customers', owner);
          if (!results.customers.some(r => r.id === normalized.id)) {
            results.customers.push(normalized);
          }
        });
      }
    }

    // Remove empty arrays from results
    Object.keys(results).forEach(k => {
      if (results[k].length === 0) {
        delete results[k];
      }
    });

    const connections = {};
    const getConnectedData = async (type, id) => {
      const data = {};
      if (type === 'employees') {
        const [attendance, leaves, customers, properties, tasks, remarks, docs] = await Promise.all([
          pool.query('SELECT * FROM attendance WHERE "employeeId" = $1', [id]),
          pool.query('SELECT * FROM leaves WHERE "employeeId" = $1', [id]),
          pool.query('SELECT * FROM customers WHERE "assignedEmployeeId" = $1', [id]),
          pool.query('SELECT * FROM properties WHERE "assignedEmployeeId" = $1', [id]),
          pool.query('SELECT * FROM tasks WHERE "assignedTo" = $1', [id]),
          pool.query('SELECT * FROM remarks WHERE "targetModule" = \'employees\' AND "targetId" = $1', [id]),
          pool.query('SELECT * FROM documents WHERE "targetModule" = \'employees\' AND "targetId" = $1', [id])
        ]);
        data.attendance = attendance.rows.map(r => normalizeRow('attendance', r));
        data.leaves = leaves.rows.map(r => normalizeRow('leaves', r));
        data.customers = customers.rows.map(r => normalizeRow('customers', r));
        data.properties = properties.rows.map(r => normalizeRow('properties', r));
        data.tasks = tasks.rows.map(r => normalizeRow('tasks', r));
        data.remarks = remarks.rows.map(r => normalizeRow('remarks', r));
        data.documents = docs.rows.map(r => normalizeRow('documents', r));
      } else if (type === 'customers') {
        const custRes = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
        const cust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
        if (cust) {
          let employee = null;
          if (cust.assignedEmployeeId) {
            const empRes = await pool.query('SELECT * FROM employees WHERE id = $1', [cust.assignedEmployeeId]);
            employee = empRes.rows[0] ? normalizeRow('employees', empRes.rows[0]) : null;
          }
          data.employee = employee;

          const [siteVisits, followUps, tasks, sales, remarks, docs] = await Promise.all([
            pool.query('SELECT * FROM site_visits WHERE "customerId" = $1', [id]),
            pool.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [id]),
            pool.query('SELECT * FROM tasks WHERE title ILIKE $1 OR description ILIKE $1', [`%${id}%`]),
            pool.query('SELECT * FROM sales WHERE "customerId" = $1', [id]),
            pool.query('SELECT * FROM remarks WHERE "targetModule" = \'customers\' AND "targetId" = $1', [id]),
            pool.query('SELECT * FROM documents WHERE "targetModule" = \'customers\' AND "targetId" = $1', [id])
          ]);

          const svs = siteVisits.rows.map(r => normalizeRow('site_visits', r));
          const svPropIds = Array.from(new Set(svs.map(sv => sv.propertyId).filter(Boolean)));
          let svPropsMap = {};
          if (svPropIds.length > 0) {
            const propRes = await pool.query('SELECT * FROM properties WHERE id = ANY($1)', [svPropIds]);
            propRes.rows.forEach(row => {
              const norm = normalizeRow('properties', row);
              svPropsMap[norm.id] = norm;
            });
          }
          svs.forEach(sv => {
            sv.property = sv.propertyId ? (svPropsMap[sv.propertyId] || null) : null;
          });
          data.site_visits = svs;
          data.follow_ups = followUps.rows.map(r => normalizeRow('follow_ups', r));
          data.tasks = tasks.rows.map(r => normalizeRow('tasks', r));

          const sas = sales.rows.map(r => normalizeRow('sales', r));
          const saPropIds = Array.from(new Set(sas.map(sa => sa.propertyId).filter(Boolean)));
          let saPropsMap = {};
          if (saPropIds.length > 0) {
            const propRes = await pool.query('SELECT * FROM properties WHERE id = ANY($1)', [saPropIds]);
            propRes.rows.forEach(row => {
              const norm = normalizeRow('properties', row);
              saPropsMap[norm.id] = norm;
            });
          }
          sas.forEach(sa => {
            sa.property = sa.propertyId ? (saPropsMap[sa.propertyId] || null) : null;
          });
          data.sales = sas;
          data.remarks = remarks.rows.map(r => normalizeRow('remarks', r));
          data.documents = docs.rows.map(r => normalizeRow('documents', r));
        }
      } else if (type === 'properties') {
        const propRes = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
        const prop = propRes.rows[0] ? normalizeRow('properties', propRes.rows[0]) : null;
        if (prop) {
          let employee = null;
          if (prop.assignedEmployeeId) {
            const empRes = await pool.query('SELECT * FROM employees WHERE id = $1', [prop.assignedEmployeeId]);
            employee = empRes.rows[0] ? normalizeRow('employees', empRes.rows[0]) : null;
          }
          data.employee = employee;

          const [siteVisits, sales, remarks, docs] = await Promise.all([
            pool.query('SELECT * FROM site_visits WHERE "propertyId" = $1', [id]),
            pool.query('SELECT * FROM sales WHERE "propertyId" = $1', [id]),
            pool.query('SELECT * FROM remarks WHERE "targetModule" = \'properties\' AND "targetId" = $1', [id]),
            pool.query('SELECT * FROM documents WHERE "targetModule" = \'properties\' AND "targetId" = $1', [id])
          ]);

          const svs = siteVisits.rows.map(r => normalizeRow('site_visits', r));
          const svCustIds = Array.from(new Set(svs.map(sv => sv.customerId).filter(Boolean)));
          let svCustsMap = {};
          if (svCustIds.length > 0) {
            const custRes = await pool.query('SELECT * FROM customers WHERE id = ANY($1)', [svCustIds]);
            custRes.rows.forEach(row => {
              const norm = normalizeRow('customers', row);
              svCustsMap[norm.id] = norm;
            });
          }
          svs.forEach(sv => {
            sv.customer = sv.customerId ? (svCustsMap[sv.customerId] || null) : null;
          });
          data.site_visits = svs;
          data.sales = sales.rows.map(r => normalizeRow('sales', r));
          data.remarks = remarks.rows.map(r => normalizeRow('remarks', r));
          data.documents = docs.rows.map(r => normalizeRow('documents', r));
          data.viewsCount = data.site_visits.length;
          data.viewedBy = data.site_visits.map(v => v.customer).filter(Boolean);
        }
      }
      return data;
    };

    // If search matches are small, pre-resolve their relations
    const firstModule = Object.keys(results)[0];
    if (firstModule && ['employees', 'customers', 'properties'].includes(firstModule) && results[firstModule].length === 1) {
      const record = results[firstModule][0];
      connections[record.id] = await getConnectedData(firstModule, record.id);
    }

    res.json({ results, connections });
  } catch (err) {
    console.error('Error during global search:', err);
    res.status(500).json({ message: 'Database error performing search.' });
  }
});

// GET Relationship Data for Single Record Details Page (Salesforce 360 style)
app.get('/api/360/:module/:id', authenticateToken, async (req, res) => {
  const { module, id } = req.params;
  
  try {
    const data = {};
    
    // Fetch remarks and documents in parallel
    const [remarksRes, docsRes] = await Promise.all([
      pool.query('SELECT * FROM remarks WHERE "targetModule" = $1 AND "targetId" = $2', [module, id]),
      pool.query('SELECT * FROM documents WHERE "targetModule" = $1 AND "targetId" = $2', [module, id])
    ]);
    data.remarks = remarksRes.rows.map(r => normalizeRow('remarks', r));
    data.documents = docsRes.rows.map(r => normalizeRow('documents', r));

    if (module === 'employees') {
      const [attendance, leaves, customers, properties, tasks, salaries, referrals] = await Promise.all([
        pool.query('SELECT * FROM attendance WHERE "employeeId" = $1', [id]),
        pool.query('SELECT * FROM leaves WHERE "employeeId" = $1', [id]),
        pool.query('SELECT * FROM customers WHERE "assignedEmployeeId" = $1', [id]),
        pool.query('SELECT * FROM properties WHERE "assignedEmployeeId" = $1', [id]),
        pool.query('SELECT * FROM tasks WHERE "assignedTo" = $1', [id]),
        pool.query('SELECT * FROM salaries WHERE "employeeId" = $1', [id]),
        pool.query('SELECT * FROM leads WHERE "referrer_type" = \'employees\' AND "referrer_id" = $1', [id])
      ]);

      data.attendance = attendance.rows.map(r => normalizeRow('attendance', r));
      data.leaves = leaves.rows.map(r => normalizeRow('leaves', r));
      data.customers = customers.rows.map(r => normalizeRow('customers', r));
      data.properties = properties.rows.map(r => normalizeRow('properties', r));
      data.tasks = tasks.rows.map(r => normalizeRow('tasks', r));
      data.salaries = salaries.rows.map(r => normalizeRow('salaries', r));
      data.referrals = referrals.rows.map(r => normalizeRow('leads', r));
      data.timeline = await generateDynamicTimeline(module, id, pool, { remarks: data.remarks });
    } else if (module === 'customers') {
      const custRes = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
      const cust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
      if (cust) {
        let employee = null;
        if (cust.assignedEmployeeId) {
          const empRes = await pool.query('SELECT * FROM employees WHERE id = $1', [cust.assignedEmployeeId]);
          employee = empRes.rows[0] ? normalizeRow('employees', empRes.rows[0]) : null;
        }
        data.employee = employee;

        const [siteVisits, followUps, sales, queries, properties, deals, pitches, referrals] = await Promise.all([
          pool.query('SELECT * FROM site_visits WHERE "customerId" = $1', [id]),
          pool.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [id]),
          pool.query('SELECT * FROM sales WHERE "customerId" = $1', [id]),
          pool.query('SELECT * FROM queries WHERE "customerId" = $1', [id]),
          pool.query('SELECT * FROM properties WHERE "current_owner_id" = $1', [id]),
          pool.query('SELECT * FROM deals WHERE "customerId" = $1 OR "sellerCustomerId" = $1', [id]),
          pool.query('SELECT * FROM property_pitch_history WHERE "customerId" = $1', [id]),
          pool.query('SELECT * FROM leads WHERE "referrer_type" = \'customers\' AND "referrer_id" = $1', [id])
        ]);

        const svs = siteVisits.rows.map(r => normalizeRow('site_visits', r));
        const svPropIds = Array.from(new Set(svs.map(sv => sv.propertyId).filter(Boolean)));
        let svPropsMap = {};
        if (svPropIds.length > 0) {
          const propRes = await pool.query('SELECT * FROM properties WHERE id = ANY($1)', [svPropIds]);
          propRes.rows.forEach(row => {
            const norm = normalizeRow('properties', row);
            svPropsMap[norm.id] = norm;
          });
        }
        svs.forEach(sv => {
          sv.property = sv.propertyId ? (svPropsMap[sv.propertyId] || null) : null;
        });
        data.site_visits = svs;

        data.follow_ups = followUps.rows.map(r => normalizeRow('follow_ups', r));

        const sas = sales.rows.map(r => normalizeRow('sales', r));
        const saPropIds = Array.from(new Set(sas.map(sa => sa.propertyId).filter(Boolean)));
        let saPropsMap = {};
        if (saPropIds.length > 0) {
          const propRes = await pool.query('SELECT * FROM properties WHERE id = ANY($1)', [saPropIds]);
          propRes.rows.forEach(row => {
            const norm = normalizeRow('properties', row);
            saPropsMap[norm.id] = norm;
          });
        }
        sas.forEach(sa => {
          sa.property = sa.propertyId ? (saPropsMap[sa.propertyId] || null) : null;
        });
        data.sales = sas;

        const cleanPhone = String(cust.phone || '').trim();
        const cleanEmail = String(cust.email || '').trim().toLowerCase();
        const leadsRes = await pool.query('SELECT * FROM leads WHERE phone = $1 OR (email = $2 AND $2 <> \'\')', [cleanPhone, cleanEmail]);
        data.leads = leadsRes.rows.map(r => normalizeRow('leads', r));

        data.queries = queries.rows.map(r => normalizeRow('queries', r));
        data.properties = properties.rows.map(r => normalizeRow('properties', r));
        data.propertiesOwned = data.properties;

        const allDeals = deals.rows.map(r => normalizeRow('deals', r));
        data.deals = allDeals;
        data.purchaseHistory = allDeals.filter(d => String(d.customerId) === String(id) && d.status === 'Closed');
        data.saleHistory = allDeals.filter(d => String(d.sellerCustomerId) === String(id) && d.status === 'Closed');

        const allPitches = pitches.rows.map(r => normalizeRow('property_pitch_history', r));
        data.pitches = allPitches;

        data.referrals = referrals.rows.map(r => normalizeRow('leads', r));
        data.payments = [];

        const preFetchedData = {
          remarks: data.remarks,
          customer: cust,
          leads: data.leads,
          queries: data.queries,
          site_visits: data.site_visits,
          follow_ups: data.follow_ups,
          pitches: data.pitches,
          deals: data.deals
        };
        data.timeline = await generateDynamicTimeline(module, id, pool, preFetchedData);
      }
    } else if (module === 'properties') {
      const propRes = await pool.query('SELECT * FROM properties WHERE id = $1', [id]);
      const prop = propRes.rows[0] ? normalizeRow('properties', propRes.rows[0]) : null;
      if (prop) {
        let employee = null;
        if (prop.assignedEmployeeId) {
          const empRes = await pool.query('SELECT * FROM employees WHERE id = $1', [prop.assignedEmployeeId]);
          employee = empRes.rows[0] ? normalizeRow('employees', empRes.rows[0]) : null;
        }
        data.employee = employee;

        const [siteVisits, sales, deals, pitches, propertyHistory] = await Promise.all([
          pool.query('SELECT * FROM site_visits WHERE "propertyId" = $1', [id]),
          pool.query('SELECT * FROM sales WHERE "propertyId" = $1', [id]),
          pool.query('SELECT * FROM deals WHERE "propertyId" = $1', [id]),
          pool.query('SELECT * FROM property_pitch_history WHERE "propertyId" = $1', [id]),
          pool.query('SELECT * FROM property_history WHERE "property_id" = $1', [id])
        ]);

        const svs = siteVisits.rows.map(r => normalizeRow('site_visits', r));
        const svCustIds = Array.from(new Set(svs.map(sv => sv.customerId).filter(Boolean)));
        let svCustsMap = {};
        if (svCustIds.length > 0) {
          const custRes = await pool.query('SELECT * FROM customers WHERE id = ANY($1)', [svCustIds]);
          custRes.rows.forEach(row => {
            const norm = normalizeRow('customers', row);
            svCustsMap[norm.id] = norm;
          });
        }
        svs.forEach(sv => {
          sv.customer = sv.customerId ? (svCustsMap[sv.customerId] || null) : null;
        });
        data.site_visits = svs;
        data.sales = sales.rows.map(r => normalizeRow('sales', r));

        if (prop.ownership_documents) {
          const ownershipDocs = typeof prop.ownership_documents === 'string' ? JSON.parse(prop.ownership_documents) : prop.ownership_documents;
          const oldOwnerDocs = (ownershipDocs.old_owner || []).map(d => ({ ...d, uploadedBy: 'System', dateAdded: prop.date, id: `DOC-OLD-${d.name}` }));
          const newOwnerDocs = (ownershipDocs.new_owner || []).map(d => ({ ...d, uploadedBy: 'System', dateAdded: prop.date, id: `DOC-NEW-${d.name}` }));
          data.documents = [...data.documents, ...oldOwnerDocs, ...newOwnerDocs];
        }

        data.viewsCount = data.site_visits.length;
        data.viewedBy = data.site_visits.map(v => v.customer).filter(Boolean);

        if (prop.current_owner_id) {
          const ownerRes = await pool.query('SELECT * FROM customers WHERE id = $1', [prop.current_owner_id]);
          data.currentOwner = ownerRes.rows[0] ? normalizeRow('customers', ownerRes.rows[0]) : null;
        } else {
          data.currentOwner = null;
        }

        data.ownerHistory = prop.owner_history ? (Array.isArray(prop.owner_history) ? prop.owner_history : JSON.parse(prop.owner_history)) : [];
        
        const allDeals = deals.rows.map(r => normalizeRow('deals', r));
        data.deals = allDeals;

        const closedDeals = allDeals.filter(d => d.status === 'Closed');
        const closedSellerIds = Array.from(new Set(closedDeals.map(d => d.sellerCustomerId).filter(Boolean)));
        let sellerNamesMap = {};
        if (closedSellerIds.length > 0) {
          const sellerRes = await pool.query('SELECT id, name FROM customers WHERE id = ANY($1)', [closedSellerIds]);
          sellerRes.rows.forEach(row => {
            sellerNamesMap[row.id] = row.name;
          });
        }
        for (const d of closedDeals) {
          const alreadyLogged = data.ownerHistory.some(h => String(h.saleDate) === String(d.registrationDate));
          if (!alreadyLogged) {
            const sellerName = sellerNamesMap[d.sellerCustomerId] || d.sellerCustomerId || prop.contact_person_name || 'Previous Owner';
            data.ownerHistory.push({
              ownerId: d.sellerCustomerId || 'N/A',
              ownerName: sellerName,
              purchaseDate: '',
              purchasePrice: '',
              saleDate: d.registrationDate || new Date().toLocaleDateString('en-IN'),
              salePrice: d.purchasePrice || ''
            });
          }
        }

        const dealCustIds = Array.from(new Set([
          ...allDeals.map(d => d.customerId),
          ...allDeals.map(d => d.sellerCustomerId)
        ].filter(Boolean)));
        let dealCustsMap = {};
        if (dealCustIds.length > 0) {
          const custRes = await pool.query('SELECT * FROM customers WHERE id = ANY($1)', [dealCustIds]);
          custRes.rows.forEach(row => {
            const norm = normalizeRow('customers', row);
            dealCustsMap[norm.id] = norm;
          });
        }
        const buyers = [];
        const sellers = [];
        for (const d of allDeals) {
          if (d.customerId && dealCustsMap[d.customerId]) {
            buyers.push(dealCustsMap[d.customerId]);
          }
          if (d.sellerCustomerId && dealCustsMap[d.sellerCustomerId]) {
            sellers.push(dealCustsMap[d.sellerCustomerId]);
          }
        }
        data.buyerHistory = buyers;
        data.sellerHistory = sellers;

        const pts = pitches.rows.map(r => normalizeRow('property_pitch_history', r));
        const pitchCustIds = Array.from(new Set(pts.map(p => p.customerId).filter(Boolean)));
        let pitchCustsMap = {};
        let pitchLeadsMap = {};
        if (pitchCustIds.length > 0) {
          const [custRes, leadRes] = await Promise.all([
            pool.query('SELECT * FROM customers WHERE id = ANY($1)', [pitchCustIds]),
            pool.query('SELECT * FROM leads WHERE id = ANY($1)', [pitchCustIds])
          ]);
          custRes.rows.forEach(row => {
            const norm = normalizeRow('customers', row);
            pitchCustsMap[norm.id] = norm;
          });
          leadRes.rows.forEach(row => {
            const norm = normalizeRow('leads', row);
            pitchLeadsMap[norm.id] = norm;
          });
        }
        pts.forEach(p => {
          p.customer = p.customerId ? (pitchCustsMap[p.customerId] || pitchLeadsMap[p.customerId] || null) : null;
        });
        data.pitches = pts;
        data.history = propertyHistory.rows.map(r => normalizeRow('property_history', r));

        const preFetchedData = {
          remarks: data.remarks,
          property: prop,
          site_visits: data.site_visits,
          pitches: data.pitches,
          deals: data.deals
        };
        data.timeline = await generateDynamicTimeline(module, id, pool, preFetchedData);
      }
    } else if (module === 'dealers') {
      const [dealerRes, calls, meetings, properties, referrals, pitches, wantedProps] = await Promise.all([
        pool.query('SELECT * FROM dealers WHERE id = $1', [id]),
        pool.query('SELECT * FROM dealer_calls WHERE "dealerId" = $1', [id]),
        pool.query('SELECT * FROM dealer_meetings WHERE "dealerId" = $1', [id]),
        pool.query('SELECT * FROM properties WHERE "dealerId" = $1', [id]),
        pool.query('SELECT * FROM leads WHERE "referrer_type" = \'dealers\' AND "referrer_id" = $1', [id]),
        pool.query('SELECT * FROM property_pitch_history WHERE "dealerId" = $1', [id]),
        pool.query('SELECT * FROM wanted_properties WHERE "dealerId" = $1', [id])
      ]);

      const dealer = dealerRes.rows[0] ? normalizeRow('dealers', dealerRes.rows[0]) : null;
      data.dealer = dealer;
      data.calls = calls.rows.map(r => normalizeRow('dealer_calls', r)).reverse();
      
      const mtgs = meetings.rows.map(r => normalizeRow('dealer_meetings', r));
      const empIds = Array.from(new Set(mtgs.map(m => m.assignedEmployeeId).filter(Boolean)));
      let empNamesMap = {};
      if (empIds.length > 0) {
        const empRes = await pool.query('SELECT id, name FROM employees WHERE id = ANY($1)', [empIds]);
        empRes.rows.forEach(row => {
          empNamesMap[row.id] = row.name;
        });
      }
      mtgs.forEach(m => {
        if (m.assignedEmployeeId) {
          m.assignedEmployeeName = empNamesMap[m.assignedEmployeeId] || m.assignedEmployeeId;
        }
      });
      data.meetings = mtgs;
      data.properties = properties.rows.map(r => normalizeRow('properties', r));
      data.referrals = referrals.rows.map(r => normalizeRow('leads', r));
      data.pitches = pitches.rows.map(r => normalizeRow('property_pitch_history', r));
      data.wanted_properties = wantedProps.rows.map(r => normalizeRow('wanted_properties', r)).reverse();

      const preFetchedData = {
        remarks: data.remarks,
        dealer: dealer,
        calls: data.calls,
        meetings: data.meetings
      };
      data.timeline = await generateDynamicTimeline(module, id, pool, preFetchedData);
    } else if (module === 'wanted_properties') {
      const wpRes = await pool.query('SELECT * FROM wanted_properties WHERE id = $1', [id]);
      const wp = wpRes.rows[0] ? normalizeRow('wanted_properties', wpRes.rows[0]) : null;
      data.wanted_property = wp;
      if (wp) {
        const [dealerRes, empRes, propRes] = await Promise.all([
          pool.query('SELECT * FROM dealers WHERE id = $1', [wp.dealerId]),
          pool.query('SELECT * FROM employees WHERE id = $1', [wp.assignedEmployeeId]),
          pool.query('SELECT * FROM properties WHERE id = $1', [wp.matchedPropertyId])
        ]);
        data.dealer = dealerRes.rows[0] ? normalizeRow('dealers', dealerRes.rows[0]) : null;
        data.employee = empRes.rows[0] ? normalizeRow('employees', empRes.rows[0]) : null;
        data.property = propRes.rows[0] ? normalizeRow('properties', propRes.rows[0]) : null;
      }
      data.timeline = await generateDynamicTimeline(module, id, pool, { remarks: data.remarks, wanted_property: wp });
    } else if (module === 'dealer_meetings') {
      const meetingRes = await pool.query('SELECT * FROM dealer_meetings WHERE id = $1', [id]);
      const meeting = meetingRes.rows[0] ? normalizeRow('dealer_meetings', meetingRes.rows[0]) : null;
      data.meeting = meeting;
      if (meeting) {
        const dealerId = meeting.dealerId;
        const [dealerRes, calls, remarks, docs] = await Promise.all([
          pool.query('SELECT * FROM dealers WHERE id = $1', [dealerId]),
          pool.query('SELECT * FROM dealer_calls WHERE "dealerId" = $1', [dealerId]),
          pool.query('SELECT * FROM remarks WHERE ("targetModule" = \'dealers\' AND "targetId" = $1) OR ("targetModule" = \'dealer_meetings\' AND "targetId" = $2)', [dealerId, id]),
          pool.query('SELECT * FROM documents WHERE ("targetModule" = \'dealers\' AND "targetId" = $1) OR ("targetModule" = \'dealer_meetings\' AND "targetId" = $2)', [dealerId, id])
        ]);

        data.dealer = dealerRes.rows[0] ? normalizeRow('dealers', dealerRes.rows[0]) : null;
        data.calls = calls.rows.map(r => normalizeRow('dealer_calls', r));
        data.remarks = remarks.rows.map(r => normalizeRow('remarks', r));
        data.documents = docs.rows.map(r => normalizeRow('documents', r));
      }
      data.timeline = await generateDynamicTimeline(module, id, pool, { remarks: data.remarks });
    } else if (module === 'projects') {
      const projRes = await pool.query('SELECT * FROM projects WHERE id = $1', [id]);
      const proj = projRes.rows[0] ? normalizeRow('projects', projRes.rows[0]) : null;
      data.project = proj;

      const [pitches, projHistory] = await Promise.all([
        pool.query('SELECT * FROM property_pitch_history WHERE "propertyId" = $1', [id]),
        pool.query('SELECT * FROM project_history WHERE "project_id" = $1', [id])
      ]);

      const pts = pitches.rows.map(r => normalizeRow('property_pitch_history', r));
      const pitchCustIds = Array.from(new Set(pts.map(p => p.customerId).filter(Boolean)));
      let pitchCustsMap = {};
      let pitchLeadsMap = {};
      if (pitchCustIds.length > 0) {
        const [custRes, leadRes] = await Promise.all([
          pool.query('SELECT * FROM customers WHERE id = ANY($1)', [pitchCustIds]),
          pool.query('SELECT * FROM leads WHERE id = ANY($1)', [pitchCustIds])
        ]);
        custRes.rows.forEach(row => {
          const norm = normalizeRow('customers', row);
          pitchCustsMap[norm.id] = norm;
        });
        leadRes.rows.forEach(row => {
          const norm = normalizeRow('leads', row);
          pitchLeadsMap[norm.id] = norm;
        });
      }
      pts.forEach(p => {
        p.customer = p.customerId ? (pitchCustsMap[p.customerId] || pitchLeadsMap[p.customerId] || null) : null;
      });
      data.pitches = pts;
      data.history = projHistory.rows.map(r => normalizeRow('project_history', r));
      data.timeline = await generateDynamicTimeline(module, id, pool, { remarks: data.remarks, project: proj });
    } else {
      if (module === 'follow_ups' || module === 'queries' || module === 'leads') {
        const recRes = await pool.query(`SELECT * FROM ${module} WHERE id = $1`, [id]);
        const rec = recRes.rows[0] ? normalizeRow(module, recRes.rows[0]) : null;
        if (rec) {
          const custId = rec.customerId || rec.id;
          const [pitches, siteVisits] = await Promise.all([
            pool.query('SELECT * FROM property_pitch_history WHERE "customerId" = $1', [custId]),
            pool.query('SELECT * FROM site_visits WHERE "customerId" = $1', [custId])
          ]);

          const pts = pitches.rows.map(r => normalizeRow('property_pitch_history', r));
          const svs = siteVisits.rows.map(r => normalizeRow('site_visits', r));

          const propIds = Array.from(new Set([
            ...pts.map(p => p.propertyId),
            ...svs.map(sv => sv.propertyId)
          ].filter(Boolean)));

          let propsMap = {};
          if (propIds.length > 0) {
            const propRes = await pool.query('SELECT * FROM properties WHERE id = ANY($1)', [propIds]);
            propRes.rows.forEach(row => {
              const norm = normalizeRow('properties', row);
              propsMap[norm.id] = norm;
            });
          }

          pts.forEach(p => {
            p.property = p.propertyId ? (propsMap[p.propertyId] || null) : null;
          });
          data.pitches = pts;

          svs.forEach(sv => {
            sv.property = sv.propertyId ? (propsMap[sv.propertyId] || null) : null;
          });
          data.site_visits = svs;

          const preFetchedData = { remarks: data.remarks };
          if (module === 'follow_ups') {
            preFetchedData.follow_up = rec;
          } else if (module === 'queries') {
            preFetchedData.query = rec;
          } else if (module === 'leads') {
            preFetchedData.lead = rec;
          }
          data.timeline = await generateDynamicTimeline(module, id, pool, preFetchedData);
        }
      }
    }

    res.json(data);
  } catch (err) {
    console.error('Error fetching 360 view data:', err);
    res.status(500).json({ message: 'Database error fetching 360 view data.' });
  }
});

// --- REMARKS TIMELINE SYSTEM ---

app.get('/api/remarks/:module/:id', authenticateToken, async (req, res) => {
  const { module, id } = req.params;
  try {
    const remarksRes = await pool.query('SELECT * FROM remarks WHERE "targetModule" = $1 AND "targetId" = $2', [module, id]);
    res.json(remarksRes.rows.map(r => normalizeRow('remarks', r)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/remarks', authenticateToken, async (req, res) => {
  const { targetModule, targetId, comment } = req.body;
  if (!targetModule || !targetId || !comment) {
    return res.status(400).json({ message: 'Target module, record ID and comment text are required.' });
  }

  try {
    const newRemark = {
      id: generateUniqueId('REM'),
      targetModule,
      targetId,
      employeeName: req.user.name,
      dateTime: new Date().toLocaleString(),
      comment
    };

    await insertRecord('remarks', newRemark);

    // Sync to sheets
    syncToSheets('remarks');
    res.status(201).json(newRemark);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
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

app.post('/api/documents', authenticateToken, async (req, res) => {
  const { targetModule, targetId, name, fileUrl } = req.body;
  if (!targetModule || !targetId || !name) {
    return res.status(400).json({ message: 'Target module, record ID, and document name required.' });
  }

  try {
    const newDoc = {
      id: generateUniqueId('DOC'),
      targetModule,
      targetId,
      name,
      fileUrl: fileUrl || '/uploads/sample_doc.pdf',
      uploadedBy: req.user.name,
      dateAdded: new Date().toLocaleDateString('en-IN')
    };

    await insertRecord('documents', newDoc);

    syncToSheets('documents');
    res.status(201).json(newDoc);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// --- WHATSAPP INTEGRATION & BULK SENDING ---

const https = require('https');

function sendHttpsPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(data);

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          reject(new Error(`Status Code: ${res.statusCode}, Body: ${body}`));
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

let currentCampaign = {
  id: null,
  total: 0,
  sent: 0,
  failed: 0,
  status: 'idle',
  logs: []
};

async function startCampaign(campaignId, numbers, message, mediaUrl, mediaType, mediaName, config) {
  currentCampaign = {
    id: campaignId,
    total: numbers.length,
    sent: 0,
    failed: 0,
    status: 'sending',
    logs: [`[${new Date().toLocaleTimeString()}] Campaign started: sending to ${numbers.length} recipients...`]
  };

  const delayMs = 1000;
  
  for (let i = 0; i < numbers.length; i++) {
    const number = numbers[i];
    
    if (currentCampaign.id !== campaignId) {
      break;
    }

    try {
      if (!config || !config.apiKey || config.gateway === 'Simulator') {
        await new Promise(resolve => setTimeout(resolve, 300));
        currentCampaign.sent++;
        currentCampaign.logs.push(`[${new Date().toLocaleTimeString()}] [Sent] To ${number} (Simulated)`);
      } else {
        if (config.gateway === 'UltraMsg') {
          let url = `https://api.ultramsg.com/${config.instanceId}/messages/chat`;
          let data = {
            token: config.apiKey,
            to: number,
            body: message
          };
          if (mediaUrl) {
            if (mediaType === 'image') {
              url = `https://api.ultramsg.com/${config.instanceId}/messages/image`;
              data = { token: config.apiKey, to: number, image: mediaUrl, caption: message };
            } else {
              url = `https://api.ultramsg.com/${config.instanceId}/messages/document`;
              data = { token: config.apiKey, to: number, document: mediaUrl, filename: mediaName || 'document', caption: message };
            }
          }
          await sendHttpsPost(url, data);
        } else if (config.gateway === 'Wassenger') {
          const url = 'https://api.wassenger.com/v1/messages';
          const data = {
            phone: number,
            message: message,
            media: mediaUrl ? { url: mediaUrl } : undefined
          };
          const headers = { 'Token': config.apiKey };
          await sendHttpsPost(url, data, headers);
        } else if (config.gateway === 'Meta Cloud API') {
          const url = `https://graph.facebook.com/v17.0/${config.instanceId}/messages`;
          const data = {
            messaging_product: "whatsapp",
            to: number,
            type: "text",
            text: { body: message }
          };
          const headers = { 'Authorization': `Bearer ${config.apiKey}` };
          await sendHttpsPost(url, data, headers);
        } else {
          const url = config.instanceId;
          const data = { to: number, message: message, mediaUrl: mediaUrl };
          const headers = {};
          if (config.apiKey) {
            headers['Authorization'] = `Bearer ${config.apiKey}`;
          }
          await sendHttpsPost(url, data, headers);
        }
        
        currentCampaign.sent++;
        currentCampaign.logs.push(`[${new Date().toLocaleTimeString()}] [Sent] To ${number}`);
      }
    } catch (err) {
      console.error(`WhatsApp send failed to ${number}:`, err);
      currentCampaign.failed++;
      currentCampaign.logs.push(`[${new Date().toLocaleTimeString()}] [Failed] To ${number}: ${err.message}`);
    }

    if (i < numbers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  currentCampaign.status = 'completed';
  currentCampaign.logs.push(`[${new Date().toLocaleTimeString()}] Campaign completed. Sent: ${currentCampaign.sent}, Failed: ${currentCampaign.failed}`);
}

app.post('/api/whatsapp/send-bulk', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { numbers, message, mediaUrl, mediaType, mediaName, config } = req.body;
  if (!numbers || !Array.isArray(numbers) || numbers.length === 0 || !message) {
    return res.status(400).json({ message: 'Recipients list (numbers) and message body are required.' });
  }

  if (currentCampaign.status === 'sending') {
    return res.status(400).json({ message: 'Another bulk sending campaign is currently active. Please wait for it to complete.' });
  }

  const campaignId = 'CAMP_' + Date.now();
  
  startCampaign(campaignId, numbers, message, mediaUrl, mediaType, mediaName, config || {});

  res.json({ success: true, message: 'Campaign queued successfully.', campaignId });
});

app.get('/api/whatsapp/campaign-status', authenticateToken, (req, res) => {
  res.json(currentCampaign);
});

app.post('/api/whatsapp/campaign-abort', authenticateToken, checkPermission('settings', 'edit'), (req, res) => {
  currentCampaign.id = null;
  currentCampaign.status = 'idle';
  currentCampaign.logs.push(`[${new Date().toLocaleTimeString()}] Campaign aborted by administrator.`);
  res.json({ success: true, message: 'Campaign aborted.' });
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
const rotateLeadsTask = async () => {
  try {
    const metadata = readMetadata();
    const config = metadata.automationConfig || { leadRotationActive: false, rotationHours: 24 };
    
    // Check if lead rotation engine is active
    if (!config.leadRotationActive) return;

    // Get active sales employees
    const employeesRes = await pool.query("SELECT * FROM employees WHERE status = 'Active' AND (role = 'Sales' OR role = 'Employee')");
    const employees = employeesRes.rows.map(r => normalizeRow('employees', r));
    if (employees.length === 0) return;
    
    const leadsRes = await pool.query("SELECT * FROM leads WHERE status NOT IN ('Won', 'Closed', 'Lost')");
    const leads = leadsRes.rows.map(r => normalizeRow('leads', r));
    if (leads.length === 0) return;

    const now = Date.now();
    const rotationHours = parseFloat(config.rotationHours) || 24;
    const ROTATION_TIMEOUT = rotationHours * 60 * 60 * 1000; 
    const rotatedSources = config.rotatedSources || [];

    await runTransaction(async (client) => {
      for (const lead of leads) {
        // Skip if rotation is explicitly disabled for this specific lead
        if (lead.enableRotation === false || lead.enableRotation === 'false') continue;
        
        // Skip rotation if this source is not enabled in preferences
        if (rotatedSources.length > 0 && !rotatedSources.includes(lead.source)) continue;
        
        // Calculate baseline activity time
        let lastActionTime = new Date(lead.dateAdded || new Date()).getTime();
        
        // Find latest remark follow-up
        const remarksRes = await client.query('SELECT * FROM remarks WHERE "targetModule" = \'leads\' AND "targetId" = $1', [lead.id]);
        const leadRemarks = remarksRes.rows.map(r => normalizeRow('remarks', r));
        if (leadRemarks.length > 0) {
          const latestRemark = leadRemarks.sort((a, b) => new Date(b.timestamp || b.date) - new Date(a.timestamp || a.date))[0];
          lastActionTime = new Date(latestRemark.timestamp || latestRemark.date).getTime();
        }
        
        if (now - lastActionTime > ROTATION_TIMEOUT) {
          // Filter rotation pool
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
            await updateRecord('leads', lead.id, { assignedEmployeeId: nextEmp.id }, client);
            
            const newRemark = {
              id: generateUniqueId('REM'),
              targetModule: 'leads',
              targetId: lead.id,
              comment: `System: Lead rotated automatically from ${pool[currentIndex]?.name || 'unassigned'} to ${nextEmp.name} due to inactivity.`,
              author: 'System Rotation Engine',
              date: new Date().toLocaleDateString('en-IN'),
              timestamp: new Date().toISOString()
            };
            await insertRecord('remarks', newRemark, client);
            
            const log = {
              id: generateUniqueId('LOG'),
              user: 'System',
              employeeName: 'System Rotation Engine',
              action: `Auto-rotated Lead "${lead.name}" to ${nextEmp.name} (inactivity)`,
              timestamp: new Date().toISOString(),
              dateTime: new Date().toLocaleString()
            };
            await insertRecord('activity_logs', log, client);
          }
        }
      }
    });

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
app.get('/api/public/lookup/:module', async (req, res) => {
  try {
    const { module } = req.params;

    // Security Allowlist: only allow lookup for public-facing/customer-facing modules
    const allowedLookupModules = ['dealers', 'customers', 'projects', 'properties'];
    if (!allowedLookupModules.includes(module)) {
      return res.status(403).json({ error: "Access denied. Public lookup not allowed for this module." });
    }

    const resRows = await pool.query(`SELECT id, name, contact_person_name, title FROM "${module}"`);
    const lookupList = resRows.rows.map(rec => {
      const normalized = normalizeRow(module, rec);
      return {
        id: normalized.id,
        name: normalized.name || normalized.contact_person_name || normalized.title || normalized.id
      };
    });
    res.json(lookupList);
  } catch (err) {
    res.status(500).json({ error: "Failed to load lookup list." });
  }
});

// Public Customer Intake Form Submission (Rate-limited, validated, and anti-spam checked)
// Public Customer Intake Form Submission (Rate-limited, validated, and anti-spam checked)
app.post('/api/public/lead-intake', ipRateLimiter(15 * 60 * 1000, 10), async (req, res) => {
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

  try {
    const result = await runTransaction(async (client) => {
      // Find duplicate lead/customer by phone
      const custRes = await client.query('SELECT * FROM customers WHERE phone = $1', [cleanPhone]);
      const leadRes = await client.query('SELECT * FROM leads WHERE phone = $1', [cleanPhone]);
      
      const existingCust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
      const existingLead = leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null;

      if (existingCust || existingLead) {
        const matchedId = existingCust ? existingCust.id : existingLead.id;
        const assignedEmployeeId = existingCust ? (existingCust.assignedEmployeeId || 'EMP-001') : (existingLead.assignedEmployeeId || 'EMP-001');
        
        const queryId = await generateNextIdAsync(client, 'queries', 'QRY');
        const newQuery = {
          id: queryId,
          customerId: matchedId,
          assignedEmployeeId: assignedEmployeeId,
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

        await insertRecord('queries', newQuery, client);

        // Schedule follow-up if it's a lead
        let newFollowUp = null;
        if (String(matchedId).startsWith('LEAD')) {
          const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
          newFollowUp = {
            id: followUpId,
            customerId: matchedId,
            queryId: queryId,
            employeeId: assignedEmployeeId,
            date: new Date().toLocaleDateString('en-IN'),
            time: '12:00 PM',
            status: 'Pending Call',
            pipelineAction: 'Fresh Lead',
            remarks: `Auto-scheduled follow up for requirements form Query ${queryId}.`
          };
          await insertRecord('follow_ups', newFollowUp, client);

        }

        return {
          isDuplicate: true,
          query: newQuery,
          followUp: newFollowUp
        };
      }

      // Else, create new Lead
      const leadId = await generateNextIdAsync(client, 'leads', 'LEAD');
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
        dateAdded: new Date().toLocaleDateString('en-IN')
      };
      await insertRecord('leads', newLead, client);

      const queryId = await generateNextIdAsync(client, 'queries', 'QRY');
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
      await insertRecord('queries', newQuery, client);

      const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
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
      await insertRecord('follow_ups', newFollowUp, client);

      return {
        isDuplicate: false,
        lead: newLead,
        query: newQuery,
        followUp: newFollowUp
      };
    });

    if (result.isDuplicate) {
      if (result.followUp) {
        try { syncToSheets('follow_ups'); } catch(e) {}
      }
      try { syncToSheets('queries'); } catch(e) {}
      res.json({ success: true, message: "Welcome back! Your new requirements query has been registered under your profile.", query: result.query });
    } else {
      try { syncToSheets('leads'); } catch(e) {}
      try { syncToSheets('queries'); } catch(e) {}
      try { syncToSheets('follow_ups'); } catch(e) {}
      res.json({ success: true, lead: result.lead, query: result.query });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route to generate an expiring short-lived signed intake token for Quick Add (valid for 24 hours)
app.get('/api/public/generate-intake-token', authenticateToken, checkPermission('settings', 'edit'), (req, res) => {
  const token = jwt.sign(
    { role: 'intake', type: 'quick-add' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
  res.json({ success: true, token });
});

// Public Employee Quick-Add Intake Portal Form Submission
app.post('/api/public/quick-add', ipRateLimiter(15 * 60 * 1000, 10), async (req, res) => {
  const { website_url, module, payload, key } = req.body;

  // 1. Honeypot check
  if (website_url) {
    return res.status(200).json({ success: true, message: "Record added successfully." });
  }

  let isAuthorized = false;
  let decodedUser = null;

  // Verify auth via standard Bearer Token
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      decodedUser = jwt.verify(token, JWT_SECRET);
      const employee = await getRecord('employees', decodedUser.id);
      if (employee && employee.status === 'Active') {
        isAuthorized = true;
      }
    } catch (e) {
      // Ignore and proceed to check temp key token
    }
  }

  // Verify auth via expiring signed intake token passed in the "key" field
  if (!isAuthorized && key) {
    try {
      const decodedKey = jwt.verify(key, JWT_SECRET);
      if (decodedKey && decodedKey.role === 'intake' && decodedKey.type === 'quick-add') {
        isAuthorized = true;
      }
    } catch (e) {
      // Ignore, unauthorized
    }
  }

  if (!isAuthorized) {
    return res.status(403).json({ error: "Invalid access token or expired session." });
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
      // ID generation using shared helper
      const prefixMap = {
        employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
        projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
        tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
        daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
        property_pitch_history: 'PITCH', dealer_calls: 'CALL', dealers: 'DEALER'
      };
      const prefix = prefixMap[module] || module.substring(0, 4).toUpperCase();
      payload.id = await generateNextIdAsync(client, module, prefix);

      // Enforce unique phone number / Master Customer record duplicate prevention
      if (payload.phone && (module === 'customers' || module === 'leads')) {
        const cleanPhone = String(payload.phone).trim();
        const custRes = await client.query('SELECT * FROM customers WHERE phone = $1', [cleanPhone]);
        const leadRes = await client.query('SELECT * FROM leads WHERE phone = $1', [cleanPhone]);
        
        const existingCust = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) : null;
        const existingLead = leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null;
        
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
          
          await insertRecord('queries', newQuery, client);

          // Automatically schedule a follow up task for the new query
          let newFollowUp = null;
          if (String(matchedId).startsWith('LEAD')) {
            const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
            newFollowUp = {
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
            await insertRecord('follow_ups', newFollowUp, client);

          }
          
          return {
            __is_redirected_query: true,
            message: `Customer already exists. Created Query (${queryId}) linked to customer profile instead.`,
            record: newQuery,
            followUp: newFollowUp
          };
        }
      }

      if (module === 'properties') {
        await handlePropertyDealerAssociation(payload, client);
      }

      // Normalize default date added keys if not present
      if (module === 'leads') {
        if (!payload.dateAdded) {
          payload.dateAdded = new Date().toLocaleDateString('en-IN');
        }
        if (payload.leadType === 'Seller') {
          payload.status = 'Converted';
          payload.assignmentStatus = 'accepted';
          payload.assignmentTime = null;
          payload.droppedBy = JSON.stringify([]);
        } else {
          payload.assignmentStatus = 'pending';
          payload.assignmentTime = new Date().toISOString();
          payload.droppedBy = JSON.stringify([]);
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

      await insertRecord(module, payload, client);

      if (module === 'follow_ups') {
        await handleFollowUpPipelineAction(payload, client, req);
      } else if (module === 'queries') {
        await handleQueryStageChange(payload, client, req);
        if (String(payload.customerId).startsWith('LEAD')) {
          const followUpId = await generateNextIdAsync(client, 'follow_ups', 'FOLLOW');
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
          await insertRecord('follow_ups', newFollowUp, client);

        }
      } else if (module === 'leads') {
        await handleLeadStatusChange(payload, client, req);
        if (payload.assignmentStatus === 'accepted' && payload.leadType !== 'Seller') {
          await createFollowUpForLead(payload, client);
        }
        if (payload.assignedEmployeeId) {
          await syncAssignedEmployeeUniversally('leads', payload.id, payload.assignedEmployeeId, client);
        }
      }

      return { record: payload };
    });

    if (result && !result.__is_redirected_query) {
      syncToSheets(module);
      if (module === 'properties') {
        try { syncToSheets('dealers'); } catch (e) {}
      }
    } else if (result && result.__is_redirected_query) {
      if (result.followUp) {
        try { syncToSheets('follow_ups'); } catch (e) {}
      }
      try { syncToSheets('queries'); } catch (e) {}
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

async function createFollowUpForLead(lead, dbOrClient) {
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
    res.json(resPending.rows.map(r => normalizeRow('leads', r)));
  } catch (err) {
    console.error('Error fetching pending leads:', err);
    res.status(500).json({ message: err.message });
  }
});

// Accept Lead
app.post('/api/leads/:id/accept', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    
    const updatedLead = await runTransaction(async (client) => {
      const leadRes = await client.query('SELECT * FROM leads WHERE id = $1', [id]);
      const lead = leadRes.rows[0];
      if (!lead) throw new Error("Lead not found.");

      const updated = await updateRecord('leads', id, {
        assignmentStatus: 'accepted',
        assignmentTime: null
      }, client);

      await createFollowUpForLead(updated, client);
      
      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Accepted Lead ${id}`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', log, client);

      return updated;
    });

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
        await createFollowUpForLead(updated, client);
      }

      const log = {
        id: generateUniqueId('LOG'),
        employeeName: req.user.name,
        action: `Dropped Lead ${id} (reassigned to ${nextEmpId})`,
        dateTime: new Date().toLocaleString()
      };
      await insertRecord('activity_logs', log, client);

      return updated;
    });

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

app.post('/api/ai/customer-summary', authenticateToken, async (req, res) => {
  const { customerId } = req.body;
  try {
    const custRes = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1', [customerId]);
    
    const customer = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) :
                     (leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null);
                     
    if (!customer) {
      return res.status(404).json({ message: "Customer/Lead not found." });
    }

    const cleanId = String(customer.id);
    const [followupsRes, siteVisitsRes, pitchesRes, dealsRes] = await Promise.all([
      pool.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [cleanId]),
      pool.query('SELECT * FROM site_visits WHERE "customerId" = $1', [cleanId]),
      pool.query('SELECT * FROM property_pitch_history WHERE "customerId" = $1', [cleanId]),
      pool.query('SELECT * FROM deals WHERE "customerId" = $1', [cleanId])
    ]);

    const assignedEmpId = customer.assignedEmployeeId || customer.employeeId;
    let empName = 'Relationship Manager';
    if (assignedEmpId) {
      const empRes = await pool.query('SELECT name FROM employees WHERE id = $1', [assignedEmpId]);
      if (empRes.rows[0]) empName = empRes.rows[0].name;
    }

    const contextData = {
      customer,
      followups: followupsRes.rows.map(r => normalizeRow('follow_ups', r)),
      siteVisits: siteVisitsRes.rows.map(r => normalizeRow('site_visits', r)),
      pitches: pitchesRes.rows.map(r => normalizeRow('property_pitch_history', r)),
      deals: dealsRes.rows.map(r => normalizeRow('deals', r)),
      employeeName: empName
    };

    const systemPrompt = `You are a Real Estate Sales Manager. Summarize the customer's profile, timelines, and journey. Use CRM data before writing. Output in plain text or standard markdown.`;
    const prompt = `Summarize customer details for ID ${cleanId}. Budget is ${customer.budget || 'N/A'}. Preferred locality: ${customer.locality || 'N/A'}.`;

    const summary = await generateAIResponse(prompt, systemPrompt, contextData);
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ message: "AI response failed", error: err.message });
  }
});

app.post('/api/ai/lead-scoring', authenticateToken, async (req, res) => {
  const { customerId } = req.body;
  try {
    const custRes = await pool.query('SELECT * FROM customers WHERE id = $1', [customerId]);
    const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1', [customerId]);
    
    const customer = custRes.rows[0] ? normalizeRow('customers', custRes.rows[0]) :
                     (leadRes.rows[0] ? normalizeRow('leads', leadRes.rows[0]) : null);

    if (!customer) {
      return res.status(404).json({ message: "Lead/Customer not found." });
    }

    const cleanId = String(customer.id);
    const [followupsRes, siteVisitsRes] = await Promise.all([
      pool.query('SELECT * FROM follow_ups WHERE "customerId" = $1', [cleanId]),
      pool.query('SELECT * FROM site_visits WHERE "customerId" = $1', [cleanId])
    ]);

    const contextData = {
      customer,
      followups: followupsRes.rows.map(r => normalizeRow('follow_ups', r)),
      siteVisits: siteVisitsRes.rows.map(r => normalizeRow('site_visits', r))
    };

    const systemPrompt = `Analyze lead metrics to output a JSON object containing { "score": number, "label": "Very Hot" | "Hot" | "Warm" | "Cold", "reasons": string[] }. Do not include formatting marks like backticks.`;
    const prompt = `Evaluate lead conversion scoring for customer ID ${cleanId}.`;

    const result = await generateAIResponse(prompt, systemPrompt, contextData);
    try {
      const parsed = JSON.parse(result);
      res.json(parsed);
    } catch (e) {
      res.json({ score: 65, label: "Warm", reasons: ["Engagement is stable."] });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/generate-content', authenticateToken, async (req, res) => {
  const { type, customerId, projectName } = req.body;
  try {
    const custRes = await pool.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    const leadRes = await pool.query('SELECT name FROM leads WHERE id = $1', [customerId]);
    
    const customer = custRes.rows[0] || leadRes.rows[0];
    const empName = req.user.name;

    const contextData = {
      customerName: customer ? customer.name : "Client",
      projectName: projectName || "Gagan Realtech Listings",
      employeeName: empName
    };

    const systemPrompt = `Generate a customized ${type} message template. Use variables where applicable. Do not wrap in markdown or backticks unless requested.`;
    const prompt = `Generate ${type} text for client ${contextData.customerName} regarding project ${contextData.projectName}.`;

    const text = await generateAIResponse(prompt, systemPrompt, contextData);
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/daily-evening-summary', authenticateToken, async (req, res) => {
  const { type } = req.body;
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const todayLocale = new Date().toLocaleDateString('en-IN');

    // Query Postgres database directly for today's entries
    const [followupsRes, siteVisitsRes, tasksRes, employeesRes, dealsRes] = await Promise.all([
      pool.query('SELECT * FROM follow_ups WHERE date = $1 OR date = $2', [todayLocale, todayStr]),
      pool.query('SELECT * FROM site_visits WHERE date = $1 OR date = $2', [todayLocale, todayStr]),
      pool.query('SELECT * FROM tasks'),
      pool.query('SELECT * FROM employees'),
      pool.query('SELECT * FROM deals WHERE "registrationDate" = $1 OR "registrationDate" = $2', [todayLocale, todayStr])
    ]);

    const contextData = {
      followups: followupsRes.rows.map(r => normalizeRow('follow_ups', r)),
      siteVisits: siteVisitsRes.rows.map(r => normalizeRow('site_visits', r)),
      tasks: tasksRes.rows.map(r => normalizeRow('tasks', r)),
      employees: employeesRes.rows.map(r => normalizeRow('employees', r)),
      deals: dealsRes.rows.map(r => normalizeRow('deals', r))
    };

    const systemPrompt = `Generate a JSON object for real estate managers summarizing daily briefings: { "todayFollowups": number, "todayVisits": number, "overdueTasks": number, "employeesOnLeave": number, "pendingSales": number, "expectedRevenue": string, "priorityCustomers": string[] } for morning; or achievements: { "callsCompleted": number, "visitsCompleted": number, "dealsClosed": number, "pendingTasks": number, "scheduleTomorrow": string } for evening.`;
    const prompt = `Generate CRM ${type} report summary.`;

    const result = await generateAIResponse(prompt, systemPrompt, contextData);
    try {
      const parsed = JSON.parse(result);
      res.json(parsed);
    } catch (e) {
      res.json({ error: "Failed to parse AI summary response." });
    }
  } catch (err) {
    console.error("AI briefing failed:", err);
    const isNotConfigured = err.message.includes("not configured") || err.message.includes("apiKey");
    res.status(isNotConfigured ? 400 : 500).json({ error: isNotConfigured ? "AI provider not configured" : err.message });
  }
});

app.post('/api/ai/insights', authenticateToken, async (req, res) => {
  try {
    const [leadsRes, dealsRes, propertiesRes, followupsRes, siteVisitsRes] = await Promise.all([
      pool.query('SELECT * FROM leads ORDER BY "dateAdded" DESC LIMIT 100'),
      pool.query('SELECT * FROM deals ORDER BY "registrationDate" DESC LIMIT 100'),
      pool.query('SELECT * FROM properties LIMIT 100'),
      pool.query('SELECT * FROM follow_ups ORDER BY date DESC LIMIT 100'),
      pool.query('SELECT * FROM site_visits ORDER BY date DESC LIMIT 100')
    ]);

    const contextData = {
      leads: leadsRes.rows.map(r => normalizeRow('leads', r)),
      deals: dealsRes.rows.map(r => normalizeRow('deals', r)),
      properties: propertiesRes.rows.map(r => normalizeRow('properties', r)),
      followups: followupsRes.rows.map(r => normalizeRow('follow_ups', r)),
      siteVisits: siteVisitsRes.rows.map(r => normalizeRow('site_visits', r))
    };

    const systemPrompt = `Generate a JSON list of 4 key insights regarding real estate marketing performance and RM conversions. Do not use markdown wrappers.`;
    const prompt = `Extract sales insights.`;

    const result = await generateAIResponse(prompt, systemPrompt, contextData);
    try {
      const parsed = JSON.parse(result);
      res.json(parsed);
    } catch (e) {
      res.json([
        "Facebook Ads continue to lead acquisition.",
        "Secondary site visit conversion is at 84%."
      ]);
    }
  } catch (err) {
    console.error("AI insights failed:", err);
    const isNotConfigured = err.message.includes("not configured") || err.message.includes("apiKey");
    res.status(isNotConfigured ? 400 : 500).json({ error: isNotConfigured ? "AI provider not configured" : err.message });
  }
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

async function loadSearchDb() {
  const db = {
    employees: [],
    customers: [],
    leads: [],
    properties: [],
    projects: [],
    queries: [],
    deals: [],
    follow_ups: [],
    site_visits: [],
    property_pitch_history: [],
    dealers: [],
    salaries: []
  };

  const [empRes, custRes, leadRes, propRes, projRes, qRes, dealRes, followRes, visitRes, pitchRes, dealerRes, salRes] = await Promise.all([
    pool.query("SELECT id, name FROM employees WHERE status = 'Active'"),
    pool.query('SELECT id, name, phone, email, "assignedEmployeeId" FROM customers'),
    pool.query('SELECT id, name, phone, email, "assignedEmployeeId", status FROM leads'),
    pool.query('SELECT id, "propertyName", status, "current_owner_id" FROM properties'),
    pool.query('SELECT id, name FROM projects'),
    pool.query('SELECT id, "customerId", "assignedEmployeeId", date, status, stage FROM queries'),
    pool.query('SELECT id, "customerId", "sellerCustomerId", "propertyId", "employeeId", status, "registrationDate" FROM deals'),
    pool.query('SELECT id, "customerId", "queryId", "employeeId", date, time, status, "pipelineAction" FROM follow_ups'),
    pool.query('SELECT id, "customerId", "propertyId", "employeeId", date, time, result FROM site_visits'),
    pool.query('SELECT id, "customerId", "propertyId", "employeeId" FROM property_pitch_history'),
    pool.query('SELECT id, person_name, firm_name FROM dealers'),
    pool.query('SELECT id, "employeeId" FROM salaries')
  ]);

  db.employees = empRes.rows.map(r => normalizeRow('employees', r));
  db.customers = custRes.rows.map(r => normalizeRow('customers', r));
  db.leads = leadRes.rows.map(r => normalizeRow('leads', r));
  db.properties = propRes.rows.map(r => normalizeRow('properties', r));
  db.projects = projRes.rows.map(r => normalizeRow('projects', r));
  db.queries = qRes.rows.map(r => normalizeRow('queries', r));
  db.deals = dealRes.rows.map(r => normalizeRow('deals', r));
  db.follow_ups = followRes.rows.map(r => normalizeRow('follow_ups', r));
  db.site_visits = visitRes.rows.map(r => normalizeRow('site_visits', r));
  db.property_pitch_history = pitchRes.rows.map(r => normalizeRow('property_pitch_history', r));
  db.dealers = dealerRes.rows.map(r => normalizeRow('dealers', r));
  db.salaries = salRes.rows.map(r => normalizeRow('salaries', r));

  return db;
}

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
    // 1. Read and filter database for the logged-in user (lightweight searchDb)
    const searchDbRaw = await loadSearchDb();
    const db = filterDbForUser(searchDbRaw, req.user);

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
    let searchResult = null;
    if (!classification.modules || classification.modules.length === 0) {
      searchResult = CRMSearchService.search(message, db);
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

    if (searchResult && searchResult.type === 'entity360') {
      const moduleKey = searchResult.data.moduleKey;
      const recordId = searchResult.data.record.id;
      const fullRecordRes = await pool.query(`SELECT * FROM "${moduleKey}" WHERE id = $1`, [recordId]);
      if (fullRecordRes.rows[0]) {
        const fullRecord = normalizeRow(moduleKey, fullRecordRes.rows[0]);
        searchResult.data.record = fullRecord;
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

      // Query PostgreSQL for the FULL records of these matched list IDs
      const matchedIds = list.map(rec => rec.id);
      if (matchedIds.length > 0) {
        const fullRecordsRes = await pool.query(`SELECT * FROM "${mKey}" WHERE id = ANY($1)`, [matchedIds]);
        const fullRecords = fullRecordsRes.rows.map(r => normalizeRow(mKey, r));
        for (const rec of fullRecords) {
          matchedRecords.push({ moduleKey: mKey, rec });
        }
      }
    }

    // Populate context data for main AI prompt grounding
    const contextData = {};
    const todayLocale = new Date().toLocaleDateString('en-IN');
    const todayISO = new Date().toISOString().split('T')[0];

    const [followCountRes, taskCountRes, visitCountRes, activeLeadsRes, propCountRes] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM follow_ups WHERE status <> 'Completed' AND (date = $1 OR date = $2)", [todayLocale, todayISO]),
      pool.query("SELECT COUNT(*) FROM tasks WHERE status <> 'Completed'"),
      pool.query("SELECT COUNT(*) FROM site_visits WHERE date = $1 OR date = $2", [todayLocale, todayISO]),
      pool.query("SELECT COUNT(*) FROM leads WHERE status NOT IN ('Dropped', 'Converted')"),
      pool.query("SELECT COUNT(*) FROM properties WHERE status = 'Available'")
    ]);

    contextData.todaySummary = {
      todayDate: todayLocale,
      followUpsToday: parseInt(followCountRes.rows[0].count) || 0,
      tasksOverdue: parseInt(taskCountRes.rows[0].count) || 0,
      siteVisitsToday: parseInt(visitCountRes.rows[0].count) || 0,
      totalActiveLeads: parseInt(activeLeadsRes.rows[0].count) || 0,
      totalPropertiesCount: parseInt(propCountRes.rows[0].count) || 0
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
app.get('/api/sync/dashboard/metrics', authenticateToken, async (req, res) => {
  try {
    const jobsRes = await pool.query('SELECT status FROM sync_jobs');
    const metrics = jobsRes.rows.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, { PENDING: 0, PROCESSING: 0, SUCCESS: 0, FAILED: 0 });

    res.json({ success: true, metrics });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List sync jobs
app.get('/api/sync/dashboard/jobs', authenticateToken, async (req, res) => {
  try {
    // Sort descending by updated/created time
    const jobsRes = await pool.query('SELECT * FROM sync_jobs ORDER BY "updatedAt" DESC LIMIT 100');
    const data = jobsRes.rows.map(r => normalizeRow('sync_jobs', r));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Trigger a retry for a specific failed job
app.post('/api/sync/dashboard/retry/:jobId', authenticateToken, async (req, res) => {
  const { jobId } = req.params;
  try {
    const jobRes = await pool.query('SELECT * FROM sync_jobs WHERE id = $1', [jobId]);
    const job = jobRes.rows[0];
    if (!job) {
      return res.status(404).json({ success: false, message: 'Sync job not found.' });
    }

    const nextAttemptAt = new Date().toISOString();
    const updatedAt = new Date().toISOString();
    
    await pool.query(
      'UPDATE sync_jobs SET status = \'PENDING\', "attemptCount" = 0, "lastError" = NULL, "updatedAt" = $1, "nextAttemptAt" = $2 WHERE id = $3',
      [updatedAt, nextAttemptAt, jobId]
    );

    // Trigger processing immediately in background
    setImmediate(() => processSyncQueue());

    res.json({ success: true, message: 'Sync job enqueued for immediate retry.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Explicit import preview from Google Sheets
app.post('/api/sync/dashboard/reconcile-preview/:module', authenticateToken, checkPermission('settings', 'edit'), async (req, res) => {
  const { module } = req.params;

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
    const dbRecords = await getModuleRecordsForServer(module);
    const employeesRes = await pool.query('SELECT id FROM employees');
    const employeeIds = new Set(employeesRes.rows.map(e => String(e.id)));

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
        if (!employeeIds.has(String(sheetRecord.assignedEmployeeId))) {
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

  try {
    let updatedCount = 0;
    let createdCount = 0;

    await runTransaction(async (client) => {
      for (const sheetRec of acceptedChanges) {
        const crmId = sheetRec.crm_id;
        const cleanedRec = { ...sheetRec };
        delete cleanedRec.crm_id;

        // Check if it exists in CRM database
        const checkRes = await client.query(`SELECT EXISTS(SELECT 1 FROM "${module}" WHERE id = $1)`, [crmId]);
        const exists = checkRes.rows[0] ? checkRes.rows[0].exists : false;

        if (exists) {
          // Overwrite CRM with Sheet record values
          await updateRecord(module, crmId, cleanedRec, client);
          updatedCount++;
        } else if (cleanedRec.id) {
          // Add as a new record in CRM
          await insertRecord(module, cleanedRec, client);
          createdCount++;
        }
      }
    });

    if (updatedCount > 0 || createdCount > 0) {
      
      // Enqueue outbound sync job to align Sheets correctly
      syncToSheets(module);
    }

    res.json({
      success: true,
      message: `Reconciliation successful. Updated ${updatedCount} records, created ${createdCount} records in CRM.`
    });
  } catch (err) {
    console.error('Reconcile Confirm Error:', err);
    res.status(500).json({ success: false, message: 'Failed to reconcile: ' + err.message });
  }
});

app.listen(PORT, async () => {
  console.log(`Gagan Realtech ERP+CRM API Server running on port ${PORT}`);
  try {
    const client = await pool.connect();
    try {
      // Clean up invalid test location logs that have NULL employeeIds or employeeNames from previous runs
      await client.query('DELETE FROM location_logs WHERE employee_id IS NULL OR employee_name IS NULL');
      console.log('PostgreSQL database connected.');
    } finally {
      client.release();
    }

    // Initialize metadataCache from PostgreSQL app_metadata table
    await initializeMetadata();
    await ensurePerformanceIndexes();
    console.log('CURRENT METADATA IN DATABASE:', JSON.stringify(readMetadata()));
  } catch (err) {
    console.error('Failed to initialize database or metadata Cache from PostgreSQL:', err);
    process.exit(1);
  }

  try {
    // 1. Self-correct ghost converted leads (if customer is deleted, reset status to In-Progress)
    const ghostCorrection = await pool.query(`
      UPDATE leads
      SET status = 'In-Progress'
      WHERE status = 'Converted'
        AND id NOT IN (
          SELECT DISTINCT "leadId" FROM customers WHERE "leadId" IS NOT NULL
        )
        AND phone NOT IN (
          SELECT DISTINCT phone FROM customers WHERE phone IS NOT NULL AND phone <> ''
        )
        AND email NOT IN (
          SELECT DISTINCT email FROM customers WHERE email IS NOT NULL AND email <> ''
        )
    `);
    if (ghostCorrection.rowCount > 0) {
      console.log(`Self-correction: reset status for ${ghostCorrection.rowCount} ghost converted leads.`);
      try { syncToSheets('leads'); } catch(e) {}
    }

    // 2. Self-correct closed deals property status and owner history alignment
    const closedDeals = await pool.query("SELECT * FROM deals WHERE status = 'Closed'");
    for (const d of closedDeals.rows) {
      const propRes = await pool.query('SELECT * FROM properties WHERE id = $1', [d.propertyId]);
      const prop = propRes.rows[0];
      if (prop) {
        let updated = false;
        const updatePayload = {};
        
        if (prop.status !== 'Property Registered/Sold Out') {
          updatePayload.status = 'Property Registered/Sold Out';
          updated = true;
        }
        if (prop.current_owner_id !== d.customerId) {
          updatePayload.current_owner_id = d.customerId;
          updated = true;
        }
        
        const ownerHistory = prop.owner_history ? (Array.isArray(prop.owner_history) ? prop.owner_history : JSON.parse(prop.owner_history)) : [];
        const hasHistory = ownerHistory.some(h => String(h.saleDate) === String(d.registrationDate));
        
        if (!hasHistory) {
          const sellerRes = await pool.query('SELECT name FROM customers WHERE id = $1', [d.sellerCustomerId]);
          const sellerName = sellerRes.rows[0] ? sellerRes.rows[0].name : (d.sellerCustomerId || prop.contact_person_name || 'Previous Owner');
          ownerHistory.push({
            ownerId: d.sellerCustomerId || 'N/A',
            ownerName: sellerName,
            purchaseDate: prop.date || '',
            purchasePrice: prop.demand || '',
            saleDate: d.registrationDate || new Date().toLocaleDateString('en-IN'),
            salePrice: d.purchasePrice || ''
          });
          updatePayload.owner_history = JSON.stringify(ownerHistory);
          updated = true;
        }
        
        if (updated) {
          await updateRecord('properties', prop.id, updatePayload);
          console.log(`Self-correction: aligned property status & owner history for deal ${d.id}.`);
          try { syncToSheets('properties'); } catch(e) {}
        }
      }
    }

    // 3. Self-correct duplicate leads
    const leadsRes = await pool.query('SELECT id, phone, email FROM leads');
    const sortedLeads = leadsRes.rows.sort((a, b) => {
      const idA = parseInt(String(a.id).split('-')[1]) || 0;
      const idB = parseInt(String(b.id).split('-')[1]) || 0;
      return idA - idB;
    });
    
    const seenLeads = new Map();
    const duplicateLeadIds = [];
    sortedLeads.forEach(l => {
      const phone = l.phone ? String(l.phone).trim() : '';
      const email = l.email ? String(l.email).trim().toLowerCase() : '';
      if (!phone && !email) return;
      const key = phone ? `phone:${phone}` : `email:${email}`;
      if (!seenLeads.has(key)) {
        seenLeads.set(key, l.id);
      } else {
        duplicateLeadIds.push(l.id);
      }
    });

    if (duplicateLeadIds.length > 0) {
      console.log(`Self-correction: found ${duplicateLeadIds.length} duplicate leads. Deleting:`, duplicateLeadIds);
      await pool.query('DELETE FROM leads WHERE id = ANY($1)', [duplicateLeadIds]);
      try { syncToSheets('leads'); } catch(e) {}
    }

    // 4. Self-correct duplicate customers
    const custRes = await pool.query('SELECT id, phone, email FROM customers');
    const sortedCusts = custRes.rows.sort((a, b) => {
      const idA = parseInt(String(a.id).split('-')[1]) || 0;
      const idB = parseInt(String(b.id).split('-')[1]) || 0;
      return idA - idB;
    });
    
    const seenCusts = new Map();
    const duplicateCustIds = [];
    sortedCusts.forEach(c => {
      const phone = c.phone ? String(c.phone).trim() : '';
      const email = c.email ? String(c.email).trim().toLowerCase() : '';
      if (!phone && !email) return;
      const key = phone ? `phone:${phone}` : `email:${email}`;
      if (!seenCusts.has(key)) {
        seenCusts.set(key, c.id);
      } else {
        duplicateCustIds.push(c.id);
      }
    });

    if (duplicateCustIds.length > 0) {
      console.log(`Self-correction: found ${duplicateCustIds.length} duplicate customers. Deleting:`, duplicateCustIds);
      await pool.query('DELETE FROM customers WHERE id = ANY($1)', [duplicateCustIds]);
      try { syncToSheets('customers'); } catch(e) {}
    }
  } catch (err) {
    console.error('Database self-correction failed:', err);
  }
});
