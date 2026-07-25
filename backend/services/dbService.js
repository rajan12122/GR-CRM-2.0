const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const defaultMetadataPath = path.join(__dirname, '../config/metadata.json');
const metadataPath = process.env.METADATA_PATH || defaultMetadataPath;

if (!fs.existsSync(metadataPath)) {
  try {
    const parentDir = path.dirname(metadataPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(metadataPath, JSON.stringify({ modules: {}, chips: {} }, null, 2), 'utf8');
    console.log(`Initialized metadata file at: ${metadataPath}`);
  } catch (err) {
    console.error(`Failed to initialize metadata at ${metadataPath}:`, err.message);
  }
}

// Set up PostgreSQL Pool
if (!process.env.DATABASE_URL) {
  console.error('CRITICAL WARNING: DATABASE_URL environment variable is not defined! Please configure it in your Render settings.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1') ? {
    rejectUnauthorized: false
  } : false
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL pool client:', err.message);
});

let metadataCache = null;

async function initializeMetadata() {
  const client = await pool.connect();
  try {
    // 1. Create table app_metadata if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value JSONB
      );
    `);
    
    // 2. Fetch main_metadata
    const res = await client.query(`SELECT value FROM app_metadata WHERE key = 'main_metadata';`);
    if (res.rows.length > 0) {
      metadataCache = res.rows[0].value;
      console.log('Successfully loaded metadataCache from PostgreSQL app_metadata.');
    } else {
      // If missing in PG, read from local file as fallback, and write to PG!
      let localMetadata = { modules: {}, chips: {} };
      if (fs.existsSync(metadataPath)) {
        try {
          localMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
        } catch (e) {
          console.error('Error reading local metadata file:', e.message);
        }
      }
      metadataCache = localMetadata;
      await client.query(`
        INSERT INTO app_metadata (key, value)
        VALUES ('main_metadata', $1)
        ON CONFLICT (key) DO UPDATE SET value = $1;
      `, [JSON.stringify(localMetadata)]);
      console.log('Successfully initialized app_metadata table from local file.');
    }

    // 3. Ensure assignmentStatus column exists in leads table
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "assignmentStatus" TEXT DEFAULT 'accepted';
    `);

    // Ensure assignmentTime column exists in leads table
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "assignmentTime" TEXT;
    `);

    // Ensure droppedBy column exists in leads table
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS "droppedBy" JSONB DEFAULT '[]';
    `);

  } finally {
    client.release();
  }
}

function readMetadata() {
  if (!metadataCache) {
    if (fs.existsSync(metadataPath)) {
      try {
        metadataCache = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      } catch (e) {
        metadataCache = { modules: {}, chips: {} };
      }
    } else {
      metadataCache = { modules: {}, chips: {} };
    }
  }
  return metadataCache;
}

async function writeMetadata(data) {
  metadataCache = data;
  // Write to PostgreSQL
  await pool.query(`
    INSERT INTO app_metadata (key, value)
    VALUES ('main_metadata', $1)
    ON CONFLICT (key) DO UPDATE SET value = $1;
  `, [JSON.stringify(data)]);
  
  // Write to local file as fallback
  try {
    fs.writeFileSync(metadataPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // Ignore write failures to local disk on ephemeral systems
  }
}

// PostgreSQL transaction wrapper
async function runTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Helper to check if a client/pool or transaction client is passed
function getExecutor(dbOrClient) {
  if (dbOrClient && typeof dbOrClient.query === 'function') {
    return dbOrClient;
  }
  return pool;
}

// Granular database APIs
async function getRecords(moduleName, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const res = await executor.query(`SELECT * FROM "${moduleName}"`);
  return res.rows;
}

async function getRecord(moduleName, id, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const res = await executor.query(`SELECT * FROM "${moduleName}" WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

function coerceRecordValues(moduleName, data, columns) {
  const metadata = readMetadata();
  const fields = (metadata.modules[moduleName] && metadata.modules[moduleName].fields) || [];
  
  return columns.map(col => {
    let val = data[col];
    const fieldDef = fields.find(f => f.name === col);
    if (fieldDef) {
      if (fieldDef.type === 'boolean' || fieldDef.type === 'checkbox') {
        if (val === '' || val === null || val === undefined) {
          return false;
        }
        return !!val;
      }
      if (fieldDef.type === 'number') {
        if (val === '' || val === null || val === undefined) {
          return null;
        }
        const numVal = Number(val);
        return isNaN(numVal) ? null : numVal;
      }
    }
    if (val && (typeof val === 'object' || Array.isArray(val))) {
      return JSON.stringify(val);
    }
    return val === undefined ? null : val;
  });
}

async function insertRecord(moduleName, data, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const columns = Object.keys(data).filter(col => col !== 'created_at' && col !== 'updated_at');
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const colNames = columns.map(c => `"${c}"`).join(', ');

  const sql = `
    INSERT INTO "${moduleName}" (${colNames}, created_at)
    VALUES (${placeholders}, now())
    RETURNING *;
  `;
  const values = coerceRecordValues(moduleName, data, columns);

  const res = await executor.query(sql, values);
  return res.rows[0];
}

async function updateRecord(moduleName, id, data, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const columns = Object.keys(data).filter(col => col !== 'created_at' && col !== 'updated_at');
  if (columns.length === 0) return getRecord(moduleName, id, executor);

  const setClauses = columns.map((col, i) => `"${col}" = $${i + 2}`).join(', ');
  const sql = `
    UPDATE "${moduleName}"
    SET ${setClauses}, updated_at = now()
    WHERE id = $1
    RETURNING *;
  `;
  const values = [id, ...coerceRecordValues(moduleName, data, columns)];

  const res = await executor.query(sql, values);
  return res.rows[0];
}

async function deleteRecord(moduleName, id, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const res = await executor.query(`DELETE FROM "${moduleName}" WHERE id = $1 RETURNING *`, [id]);
  return res.rows[0] || null;
}

// Generate sequential IDs utilizing database atomic counters
async function generateNextId(dbOrClient, moduleName, prefix) {
  const executor = getExecutor(dbOrClient);
  const prefixMap = {
    employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
    projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
    tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
    daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
    property_pitch_history: 'PITCH', dealer_calls: 'CALL', dealer_meetings: 'MEET',
    dealers: 'DEAL'
  };
  const effPrefix = prefix || prefixMap[moduleName] || String(moduleName).substring(0, 4).toUpperCase();

  const res = await executor.query(`
    INSERT INTO id_counters (module_name, counter)
    VALUES ($1, 1)
    ON CONFLICT (module_name) DO UPDATE
    SET counter = id_counters.counter + 1
    RETURNING counter;
  `, [moduleName]);

  const nextNum = res.rows[0].counter;
  return `${effPrefix}-${String(nextNum).padStart(3, '0')}`;
}

// Dealer auto-creation and association hook
async function handlePropertyDealerAssociation(payload, dbOrClient, dryRun = false) {
  const executor = getExecutor(dbOrClient);
  const isDealer = payload.dealer_owner_booked && String(payload.dealer_owner_booked).trim().toLowerCase() === 'dealer';
  if (!isDealer) return;

  const contactPhone = payload.contact_number;
  if (!contactPhone) return;
  const cleanPhone = String(contactPhone).trim();

  const res = await executor.query('SELECT * FROM dealers WHERE "contact_num" = $1', [cleanPhone]);
  let dealer = res.rows[0];

  if (!dealer) {
    if (dryRun) {
      payload.dealerId = 'DEAL-TEMP';
      return;
    }
    const dealerId = await generateNextId(executor, 'dealers', 'DEAL');
    const newDealer = {
      id: dealerId,
      firm_name: payload.firm_name ? String(payload.firm_name).trim() : 'Property Dealer',
      address: payload.locality || payload.address || '',
      sector_block: payload.sector_block || '',
      person_name: payload.contact_person_name ? String(payload.contact_person_name).trim() : 'Contact Person',
      contact_num: cleanPhone,
      contacted_num: '',
      remarks: 'Auto-created from property registration.',
      callOutcome: '',
      assignedEmployeeId: payload.assignedEmployeeId || 'EMP-001',
      visitStatus: ''
    };
    await insertRecord('dealers', newDealer, executor);
    payload.dealerId = dealerId;
  } else {
    payload.dealerId = dealer.id;
  }
}

// Fetch ID counters from PostgreSQL
async function getIdCounters(dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const res = await executor.query('SELECT * FROM id_counters');
  const counters = {};
  res.rows.forEach(row => {
    counters[row.module_name] = row.counter;
  });
  return counters;
}

// Pre-load relevant tables for write transactions
async function loadTransactionDb(client) {
  const tables = [
    'employees', 'customers', 'leads', 'properties', 'projects', 'site_visits',
    'follow_ups', 'remarks', 'documents', 'dealers', 'queries', 'deals',
    'property_pitch_history', 'dealer_calls', 'dealer_meetings', 'activity_logs',
    'attendance', 'leaves', 'sales', 'tasks', 'daily_prices', 'notices',
    'salaries', 'reminders', 'location_logs', 'project_history', 'property_history'
  ];

  const results = await Promise.all([
    ...tables.map(tbl => getRecords(tbl, client)),
    client.query('SELECT * FROM active_paths'),
    getIdCounters(client)
  ]);

  const db = {};
  tables.forEach((tbl, idx) => {
    db[tbl] = results[idx];
  });

  const activePathsRes = results[results.length - 2];
  const paths = {};
  activePathsRes.rows.forEach(r => {
    paths[r.employee_id] = r.path;
  });
  db.active_paths = paths;

  db.idCounters = results[results.length - 1];

  return db;
}

// Sync in-memory changes inside transaction back to PostgreSQL
async function syncDbChangesToPostgres(dbBefore, dbAfter, client) {
  // Sync active_paths
  if (dbAfter.active_paths) {
    const dbBeforeKeys = Object.keys(dbBefore.active_paths || {});
    const dbAfterKeys = Object.keys(dbAfter.active_paths || {});
    
    const deletedKeys = dbBeforeKeys.filter(k => !dbAfterKeys.includes(k));
    for (const key of deletedKeys) {
      await client.query('DELETE FROM active_paths WHERE employee_id = $1', [key]);
    }
    
    for (const key of dbAfterKeys) {
      const pathVal = dbAfter.active_paths[key];
      const beforeVal = dbBefore.active_paths?.[key];
      if (!beforeVal || JSON.stringify(beforeVal) !== JSON.stringify(pathVal)) {
        await client.query(`
          INSERT INTO active_paths (employee_id, path)
          VALUES ($1, $2)
          ON CONFLICT (employee_id) DO UPDATE SET path = EXCLUDED.path
        `, [key, JSON.stringify(pathVal)]);
      }
    }
  }

  // Sync ID counters
  if (dbAfter.idCounters) {
    for (const [mod, counter] of Object.entries(dbAfter.idCounters)) {
      const oldCounter = dbBefore.idCounters?.[mod] || 0;
      if (counter > oldCounter) {
        await client.query(`
          INSERT INTO id_counters (module_name, counter)
          VALUES ($1, $2)
          ON CONFLICT (module_name) DO UPDATE
          SET counter = GREATEST(id_counters.counter, EXCLUDED.counter);
        `, [mod, counter]);
      }
    }
  }

  // Tables to sync
  const tables = [
    'employees', 'customers', 'leads', 'properties', 'projects', 'site_visits', 
    'follow_ups', 'remarks', 'documents', 'dealers', 'queries', 'deals', 
    'property_pitch_history', 'dealer_calls', 'dealer_meetings', 'activity_logs',
    'attendance', 'leaves', 'sales', 'tasks', 'daily_prices', 'notices',
    'salaries', 'reminders', 'location_logs', 'project_history', 'property_history'
  ];

  for (const tbl of tables) {
    const beforeList = dbBefore[tbl] || [];
    const afterList = dbAfter[tbl] || [];

    // 1. Find added items
    const addedItems = afterList.filter(item => !beforeList.some(b => b.id === item.id));
    for (const item of addedItems) {
      await insertRecord(tbl, item, client);
    }

    // 2. Find updated items
    const updatedItems = afterList.filter(item => {
      const beforeItem = beforeList.find(b => b.id === item.id);
      if (!beforeItem) return false;
      return JSON.stringify(beforeItem) !== JSON.stringify(item);
    });
    for (const item of updatedItems) {
      const { id, created_at, updated_at, ...data } = item;
      await updateRecord(tbl, id, data, client);
    }

    // 3. Find deleted items
    const deletedItems = beforeList.filter(item => !afterList.some(a => a.id === item.id));
    for (const item of deletedItems) {
      await deleteRecord(tbl, item.id, client);
    }
  }
}

module.exports = {
  pool,
  metadataPath,
  initializeMetadata,
  readMetadata,
  writeMetadata,
  runTransaction,
  generateNextId,
  handlePropertyDealerAssociation,
  
  // Granular functions
  getRecords,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  getIdCounters,
  loadTransactionDb,
  syncDbChangesToPostgres
};
