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
  } : false,
  max: 15,
  min: 5,
  idleTimeoutMillis: 300000 // 5 minutes
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

      // Check if local file contains modules or columns that are missing in PostgreSQL metadataCache
      if (fs.existsSync(metadataPath)) {
        try {
          const localMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          let needsUpdate = false;
          if (localMetadata && localMetadata.modules) {
            for (const mKey of Object.keys(localMetadata.modules)) {
              if (!metadataCache.modules || !metadataCache.modules[mKey]) {
                console.log(`Local metadata contains new module "${mKey}" not present in PostgreSQL. Syncing...`);
                needsUpdate = true;
                break;
              }
            }
            if (!needsUpdate) {
              for (const mKey of Object.keys(localMetadata.modules)) {
                const localFields = localMetadata.modules[mKey].fields || [];
                const dbFields = metadataCache.modules?.[mKey]?.fields || [];
                if (localFields.length !== dbFields.length) {
                  console.log(`Local fields count for "${mKey}" differs from PostgreSQL. Syncing...`);
                  needsUpdate = true;
                  break;
                }
              }
            }
          }
          if (needsUpdate) {
            metadataCache = localMetadata;
            await client.query(`
              INSERT INTO app_metadata (key, value)
              VALUES ('main_metadata', $1)
              ON CONFLICT (key) DO UPDATE SET value = $1;
            `, [JSON.stringify(localMetadata)]);
            console.log('Successfully updated PostgreSQL app_metadata from local file due to schema updates.');
          }
        } catch (e) {
          console.error('Error during local metadata auto-sync:', e.message);
        }
      }
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

    // Ensure land_type column exists in properties table
    await client.query(`
      ALTER TABLE properties ADD COLUMN IF NOT EXISTS "land_type" TEXT;
    `);

    // Ensure new dealer info columns exist in wanted_properties table
    await client.query(`
      ALTER TABLE wanted_properties ADD COLUMN IF NOT EXISTS "dealerContactName" TEXT;
    `);
    await client.query(`
      ALTER TABLE wanted_properties ADD COLUMN IF NOT EXISTS "dealerFirmName" TEXT;
    `);
    await client.query(`
      ALTER TABLE wanted_properties ADD COLUMN IF NOT EXISTS "dealerAddress" TEXT;
    `);

    // Auto-create missing tables for modules in metadata
    await ensureModuleTablesExist(client);

    // Pre-warm the database pool connections to eliminate TCP/TLS handshake latency on request handling
    try {
      const warmClients = await Promise.all([
        pool.connect(),
        pool.connect(),
        pool.connect(),
        pool.connect(),
        pool.connect()
      ]);
      warmClients.forEach(c => c.release());
      console.log('Successfully pre-warmed 5 PostgreSQL pool database connections.');
    } catch (warmErr) {
      console.error('Error pre-warming PostgreSQL pool database connections:', warmErr.message);
    }

  } finally {
    client.release();
  }
}

async function ensureModuleTablesExist(client) {
  const metadata = readMetadata();
  if (!metadata || !metadata.modules) return;

  for (const [modKey, modConfig] of Object.entries(metadata.modules)) {
    if (modKey === 'location_tracker') continue; // Virtual module
    
    const checkRes = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name = $1
      );
    `, [modKey]);

    const exists = checkRes.rows[0]?.exists;
    if (!exists) {
      console.log(`Auto-creating missing table for module "${modKey}"...`);
      const fields = modConfig.fields || [];
      const columnDefs = [];
      
      if (!fields.some(f => f.name === 'id')) {
        columnDefs.push(`"id" TEXT PRIMARY KEY`);
      }

      fields.forEach(f => {
        let pgType = 'TEXT';
        if (f.name === 'id') {
          pgType = 'TEXT PRIMARY KEY';
        } else if (f.type === 'number') {
          pgType = 'NUMERIC';
        } else if (f.type === 'boolean' || f.type === 'checkbox') {
          pgType = 'BOOLEAN DEFAULT false';
        } else if (f.type === 'multiref' || f.type === 'jsonb') {
          pgType = 'JSONB';
        }
        columnDefs.push(`"${f.name}" ${pgType}`);
      });

      columnDefs.push('created_at TIMESTAMPTZ DEFAULT now()');
      columnDefs.push('updated_at TIMESTAMPTZ');

      const createSql = `CREATE TABLE IF NOT EXISTS "${modKey}" (\n  ${columnDefs.join(',\n  ')}\n);`;
      await client.query(createSql);
      console.log(`Successfully created table "${modKey}".`);
    }
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
  
  // Write to local file as fallback asynchronously
  fs.writeFile(metadataPath, JSON.stringify(data, null, 2), 'utf8', (err) => {
    if (err) {
      console.error('Failed to write metadata fallback file:', err.message);
    }
  });
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

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/_/g, '');
}

function normalizeRow(moduleName, row) {
  if (!row) return row;
  
  const metadata = readMetadata();
  const normalized = {};
  
  // 1. Get all expected keys for this module
  const expectedKeys = new Set(['id', 'created_at', 'updated_at']);
  
  if (metadata.modules[moduleName]) {
    const fields = metadata.modules[moduleName].fields || [];
    fields.forEach(f => expectedKeys.add(f.name));
  }
  
  // Custom non-metadata modules mapping
  if (moduleName === 'location_logs') {
    expectedKeys.add('employeeId');
    expectedKeys.add('employeeName');
    expectedKeys.add('latitude');
    expectedKeys.add('longitude');
    expectedKeys.add('status');
    expectedKeys.add('timestamp');
  } else if (moduleName === 'activity_logs') {
    expectedKeys.add('employeeName');
    expectedKeys.add('action');
    expectedKeys.add('dateTime');
  }
  
  // Map database keys to expected keys case-insensitively and ignoring underscores
  for (const dbKey of Object.keys(row)) {
    let matchedKey = null;
    const normDbKey = normalizeKey(dbKey);
    for (const expKey of expectedKeys) {
      if (normalizeKey(expKey) === normDbKey) {
        matchedKey = expKey;
        break;
      }
    }
    if (matchedKey) {
      normalized[matchedKey] = row[dbKey];
    } else {
      normalized[dbKey] = row[dbKey];
    }
  }
  
  return normalized;
}

// Granular database APIs
async function getRecords(moduleName, dbOrClient, options = {}) {
  const executor = getExecutor(dbOrClient);
  const { limit, offset, search, userFilter } = options;

  let sql = `SELECT * FROM "${moduleName}"`;
  const queryParams = [];
  let paramIndex = 1;
  const whereClauses = [];

  if (search) {
    const tableCols = await getTableColumns(moduleName, executor);
    if (tableCols.length > 0) {
      const searchVal = `%${search}%`;
      queryParams.push(searchVal);
      const searchPlaceholder = `$${paramIndex++}`;
      const searchClauses = tableCols.map(col => `"${col}"::text ILIKE ${searchPlaceholder}`);
      whereClauses.push(`(${searchClauses.join(' OR ')})`);
    }
  }

  if (userFilter && userFilter.role !== 'Admin') {
    const { userId, role } = userFilter;
    let ownershipClause = null;

    if (moduleName === 'wanted_properties' && role !== 'Manager') {
      queryParams.push(userId);
      ownershipClause = `"assignedEmployeeId" = $${paramIndex++}`;
    } else if (moduleName === 'leads' || moduleName === 'customers') {
      queryParams.push(userId, userId, userId, userId);
      ownershipClause = `(
        "assignedEmployeeId" = $${paramIndex++} OR 
        id IN (SELECT "customerId" FROM follow_ups WHERE "employeeId" = $${paramIndex++}) OR 
        id IN (SELECT "customerId" FROM site_visits WHERE "employeeId" = $${paramIndex++}) OR 
        id IN (SELECT "customerId" FROM property_pitch_history WHERE "employeeId" = $${paramIndex++})
      )`;
    } else if (moduleName === 'follow_ups') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'queries') {
      queryParams.push(userId, userId);
      ownershipClause = `(
        "assignedEmployeeId" = $${paramIndex++} OR 
        id IN (SELECT "queryId" FROM follow_ups WHERE "employeeId" = $${paramIndex++})
      )`;
    } else if (moduleName === 'property_pitch_history') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'site_visits') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'salaries') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'tasks') {
      queryParams.push(userId);
      ownershipClause = `"assignedTo" = $${paramIndex++}`;
    }

    if (ownershipClause) {
      whereClauses.push(ownershipClause);
    }
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(' AND ');
  }

  // Ordering to guarantee deterministic pagination results
  sql += ` ORDER BY id ASC`;

  let limitVal = limit !== undefined && limit !== null ? parseInt(limit, 10) : null;
  let offsetVal = offset !== undefined && offset !== null ? parseInt(offset, 10) : null;

  if (limitVal !== null && !isNaN(limitVal)) {
    if (limitVal > 100) limitVal = 100;
    if (limitVal < 1) limitVal = 1;
    sql += ` LIMIT $${paramIndex++}`;
    queryParams.push(limitVal);
  }

  if (offsetVal !== null && !isNaN(offsetVal)) {
    if (offsetVal < 0) offsetVal = 0;
    sql += ` OFFSET $${paramIndex++}`;
    queryParams.push(offsetVal);
  }

  const res = await executor.query(sql, queryParams);
  return res.rows.map(row => normalizeRow(moduleName, row));
}

async function getRecordsCount(moduleName, dbOrClient, options = {}) {
  const executor = getExecutor(dbOrClient);
  const { search, userFilter } = options;

  let sql = `SELECT COUNT(*) FROM "${moduleName}"`;
  const queryParams = [];
  let paramIndex = 1;
  const whereClauses = [];

  if (search) {
    const tableCols = await getTableColumns(moduleName, executor);
    if (tableCols.length > 0) {
      const searchVal = `%${search}%`;
      queryParams.push(searchVal);
      const searchPlaceholder = `$${paramIndex++}`;
      const searchClauses = tableCols.map(col => `"${col}"::text ILIKE ${searchPlaceholder}`);
      whereClauses.push(`(${searchClauses.join(' OR ')})`);
    }
  }

  if (userFilter && userFilter.role !== 'Admin') {
    const { userId, role } = userFilter;
    let ownershipClause = null;

    if (moduleName === 'wanted_properties' && role !== 'Manager') {
      queryParams.push(userId);
      ownershipClause = `"assignedEmployeeId" = $${paramIndex++}`;
    } else if (moduleName === 'leads' || moduleName === 'customers') {
      queryParams.push(userId, userId, userId, userId);
      ownershipClause = `(
        "assignedEmployeeId" = $${paramIndex++} OR 
        id IN (SELECT "customerId" FROM follow_ups WHERE "employeeId" = $${paramIndex++}) OR 
        id IN (SELECT "customerId" FROM site_visits WHERE "employeeId" = $${paramIndex++}) OR 
        id IN (SELECT "customerId" FROM property_pitch_history WHERE "employeeId" = $${paramIndex++})
      )`;
    } else if (moduleName === 'follow_ups') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'queries') {
      queryParams.push(userId, userId);
      ownershipClause = `(
        "assignedEmployeeId" = $${paramIndex++} OR 
        id IN (SELECT "queryId" FROM follow_ups WHERE "employeeId" = $${paramIndex++})
      )`;
    } else if (moduleName === 'property_pitch_history') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'site_visits') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'salaries') {
      queryParams.push(userId);
      ownershipClause = `"employeeId" = $${paramIndex++}`;
    } else if (moduleName === 'tasks') {
      queryParams.push(userId);
      ownershipClause = `"assignedTo" = $${paramIndex++}`;
    }

    if (ownershipClause) {
      whereClauses.push(ownershipClause);
    }
  }

  if (whereClauses.length > 0) {
    sql += ` WHERE ` + whereClauses.join(' AND ');
  }

  const res = await executor.query(sql, queryParams);
  return parseInt(res.rows[0].count, 10);
}

async function getRecord(moduleName, id, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const res = await executor.query(`SELECT * FROM "${moduleName}" WHERE id = $1`, [id]);
  return res.rows[0] ? normalizeRow(moduleName, res.rows[0]) : null;
}

function coerceRecordValues(moduleName, data, columns) {
  const metadata = readMetadata();
  const fields = (metadata.modules[moduleName] && metadata.modules[moduleName].fields) || [];
  
  return columns.map(col => {
    let val = data[col];
    const fieldDef = fields.find(f => normalizeKey(f.name) === normalizeKey(col));
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

const tableColumnsCache = {};

async function getTableColumns(moduleName, executor) {
  if (tableColumnsCache[moduleName]) {
    return tableColumnsCache[moduleName];
  }
  try {
    const res = await executor.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1
    `, [moduleName]);
    const cols = res.rows.map(r => r.column_name);
    tableColumnsCache[moduleName] = cols;
    return cols;
  } catch (err) {
    console.error(`Failed to load columns for table ${moduleName}:`, err);
    return [];
  }
}

async function insertRecord(moduleName, data, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const tableCols = await getTableColumns(moduleName, executor);
  const columns = [];
  const coercedData = {};
  
  for (const key of Object.keys(data)) {
    if (key === 'created_at' || key === 'updated_at') continue;
    const normKey = normalizeKey(key);
    const dbCol = tableCols.find(c => normalizeKey(c) === normKey);
    if (dbCol) {
      columns.push(dbCol);
      coercedData[dbCol] = data[key];
    }
  }

  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const colNames = columns.map(c => `"${c}"`).join(', ');

  const sql = `
    INSERT INTO "${moduleName}" (${colNames}, created_at)
    VALUES (${placeholders}, now())
    RETURNING *;
  `;
  const values = coerceRecordValues(moduleName, coercedData, columns);

  const res = await executor.query(sql, values);
  const inserted = res.rows[0] ? normalizeRow(moduleName, res.rows[0]) : null;
  if (inserted) {
    try {
      await handleTodoTriggers(moduleName, inserted, executor, 'insert');
    } catch (e) {
      console.error('Todo trigger error:', e);
    }
  }
  return inserted;
}

async function updateRecord(moduleName, id, data, dbOrClient) {
  const executor = getExecutor(dbOrClient);
  const tableCols = await getTableColumns(moduleName, executor);
  const columns = [];
  const coercedData = {};
  
  for (const key of Object.keys(data)) {
    if (key === 'created_at' || key === 'updated_at') continue;
    const normKey = normalizeKey(key);
    const dbCol = tableCols.find(c => normalizeKey(c) === normKey);
    if (dbCol) {
      columns.push(dbCol);
      coercedData[dbCol] = data[key];
    }
  }

  if (columns.length === 0) return getRecord(moduleName, id, executor);

  const setClauses = columns.map((col, i) => `"${col}" = $${i + 2}`).join(', ');
  const sql = `
    UPDATE "${moduleName}"
    SET ${setClauses}, updated_at = now()
    WHERE id = $1
    RETURNING *;
  `;
  const values = [id, ...coerceRecordValues(moduleName, coercedData, columns)];

  const res = await executor.query(sql, values);
  const updated = res.rows[0] ? normalizeRow(moduleName, res.rows[0]) : null;
  if (updated) {
    try {
      await handleTodoTriggers(moduleName, updated, executor, 'update');
    } catch (e) {
      console.error('Todo trigger error:', e);
    }
  }
  return updated;
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
      address: '',
      sector_block: 'Auto-created',
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

async function ensurePerformanceIndexes() {
  const client = await pool.connect();
  try {
    console.log('Ensuring performance indexes exist in PostgreSQL...');
    
    // Create workspace tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS todos (
        id TEXT PRIMARY KEY,
        title TEXT,
        "assignedTo" TEXT,
        "dueDate" TEXT,
        "dueTime" TEXT,
        priority TEXT,
        status TEXT DEFAULT 'Pending',
        personal BOOLEAN DEFAULT false,
        "reminderStatus" TEXT DEFAULT 'Pending',
        notes TEXT,
        "linkedModule" TEXT,
        "linkedId" TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sticky_notes (
        id TEXT PRIMARY KEY,
        "employeeId" TEXT,
        content TEXT,
        color TEXT DEFAULT 'Yellow',
        pinned BOOLEAN DEFAULT false,
        "linkedModule" TEXT,
        "linkedId" TEXT,
        "reminderDate" TEXT,
        "reminderTime" TEXT,
        "reminderStatus" TEXT DEFAULT 'Pending',
        shared BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS personal_documents (
        id TEXT PRIMARY KEY,
        "employeeId" TEXT,
        name TEXT,
        "fileUrl" TEXT,
        "expiryDate" TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_shortcuts (
        id TEXT PRIMARY KEY,
        "employeeId" TEXT,
        "moduleName" TEXT,
        "recordId" TEXT,
        label TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS draft_forms (
        id TEXT PRIMARY KEY,
        "employeeId" TEXT,
        "moduleName" TEXT,
        "formData" TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      )
    `);

    // Alter documents to add expiry_date column
    await client.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS expiry_date TEXT');

    // Create indexes for remarks
    await client.query('CREATE INDEX IF NOT EXISTS idx_remarks_target ON remarks ("targetModule", "targetId")');
    
    // Create indexes for documents
    await client.query('CREATE INDEX IF NOT EXISTS idx_documents_target ON documents ("targetModule", "targetId")');
    
    // Create indexes for site_visits
    await client.query('CREATE INDEX IF NOT EXISTS idx_site_visits_customer ON site_visits ("customerId")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_site_visits_property ON site_visits ("propertyId")');
    
    // Create indexes for deals
    await client.query('CREATE INDEX IF NOT EXISTS idx_deals_customer ON deals ("customerId")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_deals_seller ON deals ("sellerCustomerId")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_deals_property ON deals ("propertyId")');
    
    // Create indexes for property_pitch_history
    await client.query('CREATE INDEX IF NOT EXISTS idx_pitches_customer ON property_pitch_history ("customerId")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pitches_property ON property_pitch_history ("propertyId")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_pitches_dealer ON property_pitch_history ("dealerId")');
    
    // Create indexes for dealer_calls
    await client.query('CREATE INDEX IF NOT EXISTS idx_dealer_calls_dealer ON dealer_calls ("dealerId")');
    
    // Create indexes for dealer_meetings
    await client.query('CREATE INDEX IF NOT EXISTS idx_dealer_meetings_dealer ON dealer_meetings ("dealerId")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_dealer_meetings_employee ON dealer_meetings ("assignedEmployeeId")');
    
    // Create indexes for leads.phone/email for customers conversion mapping lookup
    await client.query('CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads ("phone")');
    await client.query('CREATE INDEX IF NOT EXISTS idx_leads_email ON leads ("email")');
    
    console.log('Successfully verified/created database performance indexes.');
  } catch (err) {
    console.error('Error ensuring performance indexes:', err.message);
  } finally {
    client.release();
  }
}

async function handleTodoTriggers(moduleName, record, client, action) {
  // Prevent infinite loops if we are modifying todos itself
  if (moduleName === 'todos') {
    // Bidirectional sync: if employee manually completes a todo, auto-complete linked follow_ups/site_visits/tasks
    if (record.status === 'Completed' && record.linkedModule && record.linkedId) {
      const lm = record.linkedModule;
      const lid = record.linkedId;
      console.log(`[Todo Trigger] Todo completed. Syncing status back to linked ${lm} (${lid})`);
      if (lm === 'follow_ups') {
        await client.query('UPDATE follow_ups SET status = $1, updated_at = now() WHERE id = $2', ['Completed', lid]);
      } else if (lm === 'site_visits') {
        await client.query('UPDATE site_visits SET result = $1, updated_at = now() WHERE id = $2', ['Interested', lid]);
      } else if (lm === 'tasks') {
        await client.query('UPDATE tasks SET status = $1, updated_at = now() WHERE id = $2', ['Completed', lid]);
      } else if (lm === 'leads') {
        await client.query('UPDATE leads SET status = $1, updated_at = now() WHERE id = $2', ['In-Progress', lid]);
      }
    }
    return;
  }

  // 1. FOLLOW-UPS TRIGGER
  if (moduleName === 'follow_ups') {
    // Fetch customer or lead name
    let name = 'Customer';
    const custRes = await client.query('SELECT name FROM customers WHERE id = $1', [record.customerId]);
    if (custRes.rows[0]) {
      name = custRes.rows[0].name;
    } else {
      const leadRes = await client.query('SELECT name FROM leads WHERE id = $1', [record.customerId]);
      if (leadRes.rows[0]) name = leadRes.rows[0].name;
    }

    const todoTitle = `Call ${name}`;
    
    // Check if todo already exists
    const checkTodo = await client.query('SELECT id FROM todos WHERE "linkedModule" = $1 AND "linkedId" = $2', ['follow_ups', record.id]);
    if (checkTodo.rows[0]) {
      const todoId = checkTodo.rows[0].id;
      if (record.status === 'Completed') {
        await client.query('UPDATE todos SET status = $1, notes = $2, updated_at = now() WHERE id = $3', ['Completed', record.comment || '', todoId]);
      } else {
        await client.query('UPDATE todos SET title = $1, "dueDate" = $2, "dueTime" = $3, "assignedTo" = $4, status = $5, updated_at = now() WHERE id = $6', [todoTitle, record.date, record.time || '', record.employeeId, 'Pending', todoId]);
      }
    } else {
      const newTodoId = 'TODO-FOLLOW-' + record.id;
      await client.query(`
        INSERT INTO todos (id, title, "assignedTo", "dueDate", "dueTime", priority, status, personal, "reminderStatus", notes, "linkedModule", "linkedId", created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
      `, [newTodoId, todoTitle, record.employeeId, record.date, record.time || '', 'Medium', record.status === 'Completed' ? 'Completed' : 'Pending', false, 'Pending', record.comment || '', 'follow_ups', record.id]);
    }
  }

  // 2. SITE VISITS TRIGGER
  if (moduleName === 'site_visits') {
    let name = 'Customer';
    const custRes = await client.query('SELECT name FROM customers WHERE id = $1', [record.customerId]);
    if (custRes.rows[0]) name = custRes.rows[0].name;

    let propLoc = 'Property';
    const propRes = await client.query('SELECT "propertyName", locality FROM properties WHERE id = $1', [record.propertyId]);
    if (propRes.rows[0]) {
      propLoc = propRes.rows[0].propertyName || propRes.rows[0].locality || 'Property';
    }

    const todoTitle = `Site visit: ${propLoc} for ${name}`;
    const checkTodo = await client.query('SELECT id FROM todos WHERE "linkedModule" = $1 AND "linkedId" = $2', ['site_visits', record.id]);
    const isCompleted = record.result && record.result !== '' && record.result !== 'Pending';

    if (checkTodo.rows[0]) {
      const todoId = checkTodo.rows[0].id;
      if (isCompleted) {
        await client.query('UPDATE todos SET status = $1, notes = $2, updated_at = now() WHERE id = $3', ['Completed', record.result || '', todoId]);
      } else {
        await client.query('UPDATE todos SET title = $1, "dueDate" = $2, "dueTime" = $3, "assignedTo" = $4, status = $5, updated_at = now() WHERE id = $6', [todoTitle, record.date, record.time || '', record.employeeId, 'Pending', todoId]);
      }
    } else {
      const newTodoId = 'TODO-VISIT-' + record.id;
      await client.query(`
        INSERT INTO todos (id, title, "assignedTo", "dueDate", "dueTime", priority, status, personal, "reminderStatus", notes, "linkedModule", "linkedId", created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
      `, [newTodoId, todoTitle, record.employeeId, record.date, record.time || '', 'High', isCompleted ? 'Completed' : 'Pending', false, 'Pending', record.result || '', 'site_visits', record.id]);
    }
  }

  // 3. LEADS TRIGGER
  if (moduleName === 'leads') {
    const todoTitle = `Accept or review new lead: ${record.name}`;
    const checkTodo = await client.query('SELECT id FROM todos WHERE "linkedModule" = $1 AND "linkedId" = $2', ['leads', record.id]);
    const isCompleted = record.status !== 'Open';

    if (checkTodo.rows[0]) {
      const todoId = checkTodo.rows[0].id;
      if (isCompleted) {
        await client.query('UPDATE todos SET status = $1, updated_at = now() WHERE id = $2', ['Completed', todoId]);
      } else {
        await client.query('UPDATE todos SET "assignedTo" = $1, status = $2, updated_at = now() WHERE id = $3', [record.assignedEmployeeId || 'EMP-001', 'Pending', todoId]);
      }
    } else {
      const newTodoId = 'TODO-LEAD-' + record.id;
      await client.query(`
        INSERT INTO todos (id, title, "assignedTo", "dueDate", "dueTime", priority, status, personal, "reminderStatus", notes, "linkedModule", "linkedId", created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
      `, [newTodoId, todoTitle, record.assignedEmployeeId || 'EMP-001', new Date().toISOString().split('T')[0], '12:00', 'High', isCompleted ? 'Completed' : 'Pending', false, 'Pending', '', 'leads', record.id]);
    }
  }

  // 4. DOCUMENTS TRIGGER
  if (moduleName === 'documents') {
    if (record.expiry_date) {
      const todoTitle = `Collect/update document: ${record.name}`;
      const checkTodo = await client.query('SELECT id FROM todos WHERE "linkedModule" = $1 AND "linkedId" = $2', ['documents', record.id]);
      if (checkTodo.rows[0]) {
        const todoId = checkTodo.rows[0].id;
        await client.query('UPDATE todos SET title = $1, "dueDate" = $2, "assignedTo" = $3, updated_at = now() WHERE id = $4', [todoTitle, record.expiry_date, record.uploaded_by || 'EMP-001', todoId]);
      } else {
        const newTodoId = 'TODO-DOC-' + record.id;
        await client.query(`
          INSERT INTO todos (id, title, "assignedTo", "dueDate", "dueTime", priority, status, personal, "reminderStatus", notes, "linkedModule", "linkedId", created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
        `, [newTodoId, todoTitle, record.uploaded_by || 'EMP-001', record.expiry_date, '12:00', 'Medium', 'Pending', false, 'Pending', '', 'documents', record.id]);
      }
    }
  }

  // 5. TASKS TRIGGER
  if (moduleName === 'tasks') {
    const todoTitle = `Complete assigned task: ${record.title}`;
    const checkTodo = await client.query('SELECT id FROM todos WHERE "linkedModule" = $1 AND "linkedId" = $2', ['tasks', record.id]);
    const isCompleted = record.status === 'Completed';

    if (checkTodo.rows[0]) {
      const todoId = checkTodo.rows[0].id;
      if (isCompleted) {
        await client.query('UPDATE todos SET status = $1, updated_at = now() WHERE id = $2', ['Completed', todoId]);
      } else {
        await client.query('UPDATE todos SET title = $1, "dueDate" = $2, "assignedTo" = $3, priority = $4, status = $5, updated_at = now() WHERE id = $6', [todoTitle, record.dueDate, record.assignedTo, record.priority || 'Medium', 'Pending', todoId]);
      }
    } else {
      const newTodoId = 'TODO-TASK-' + record.id;
      await client.query(`
        INSERT INTO todos (id, title, "assignedTo", "dueDate", "dueTime", priority, status, personal, "reminderStatus", notes, "linkedModule", "linkedId", created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
      `, [newTodoId, todoTitle, record.assignedTo, record.dueDate, '18:00', record.priority || 'Medium', isCompleted ? 'Completed' : 'Pending', false, 'Pending', '', 'tasks', record.id]);
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
  getRecordsCount,
  getRecord,
  insertRecord,
  updateRecord,
  deleteRecord,
  getIdCounters,
  normalizeRow,
  ensurePerformanceIndexes
};
