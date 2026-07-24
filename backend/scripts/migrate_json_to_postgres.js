const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const dbPath = path.join(__dirname, '../config/db.json');
const metadataPath = path.join(__dirname, '../config/metadata.json');

if (!process.env.DATABASE_URL) {
  console.error('Error: DATABASE_URL environment variable is not defined.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL pool client:', err.message);
});

async function migrate() {
  let client;
  try {
    client = await pool.connect();
    console.log('Successfully connected to PostgreSQL.');

    if (!fs.existsSync(dbPath)) {
      console.error(`db.json not found at ${dbPath}`);
      process.exit(1);
    }
    if (!fs.existsSync(metadataPath)) {
      console.error(`metadata.json not found at ${metadataPath}`);
      process.exit(1);
    }

    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    // 1. Create auxiliary tables
    console.log('Creating system and tracking tables...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS id_counters (
        module_name TEXT PRIMARY KEY,
        counter INTEGER NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_jobs (
        id TEXT PRIMARY KEY,
        module_name TEXT,
        crm_record_id TEXT,
        operation_type TEXT,
        attempt_count INTEGER,
        max_attempts INTEGER,
        last_error TEXT,
        idempotency_key TEXT,
        status TEXT,
        created_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ,
        synced_at TIMESTAMPTZ,
        next_attempt_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS remarks (
        id TEXT PRIMARY KEY,
        target_module TEXT,
        target_id TEXT,
        employee_name TEXT,
        date_time TEXT,
        comment TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        target_module TEXT,
        target_id TEXT,
        name TEXT,
        file_url TEXT,
        uploaded_by TEXT,
        date_added TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS project_history (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        field TEXT,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        date TEXT,
        employee_name TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS property_history (
        id TEXT PRIMARY KEY,
        property_id TEXT,
        field TEXT,
        field_name TEXT,
        old_value TEXT,
        new_value TEXT,
        date TEXT,
        employee_name TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS location_logs (
        id TEXT PRIMARY KEY,
        employee_id TEXT,
        employee_name TEXT,
        latitude TEXT,
        longitude TEXT,
        status TEXT,
        timestamp TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS active_paths (
        employee_id TEXT PRIMARY KEY,
        path JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // 2. Define modules to migrate
    const modulesToMigrate = [
      'employees', 'customers', 'leads', 'properties', 'projects', 'site_visits', 'follow_ups',
      'attendance', 'leaves', 'sales', 'tasks', 'daily_prices', 'dealers', 'notices',
      'salaries', 'queries', 'deals', 'property_pitch_history', 'dealer_calls', 'dealer_meetings'
    ];

    // Find all modules present in db.json that are not in metadata modules
    const dbKeys = Object.keys(db);
    const extraModulesInDb = dbKeys.filter(k => 
      Array.isArray(db[k]) && 
      !modulesToMigrate.includes(k) && 
      !['remarks', 'documents', 'reminders', 'activity_logs', 'sync_jobs', 'project_history', 'property_history', 'location_logs'].includes(k)
    );
    console.log('Extra modules discovered in db.json:', extraModulesInDb);
    const allModules = [...modulesToMigrate, ...extraModulesInDb];

    // 3. For each module, generate schema dynamically and insert records
    const migrationErrors = [];
    const migrationSummary = {};

    for (const mod of allModules) {
      console.log(`\nMigrating module: ${mod}...`);
      const records = db[mod] || [];
      migrationSummary[mod] = { migrated: 0, skipped: 0, reasons: [] };

      // Get fields from metadata.json (if defined)
      const metadataFields = (metadata.modules[mod] && metadata.modules[mod].fields) || [];
      
      // Build fields dictionary
      const fieldsMap = {};
      metadataFields.forEach(f => {
        fieldsMap[f.name] = f.type;
      });

      // Special overrides & additions
      if (mod === 'employees') {
        fieldsMap['passwordHash'] = 'text';
        fieldsMap['tokenVersion'] = 'number';
        fieldsMap['locationHistory'] = 'jsonb';
      }
      if (mod === 'properties') {
        fieldsMap['ownership_documents'] = 'jsonb';
        fieldsMap['owner_history'] = 'jsonb';
      }

      // Scan db.json records to discover any additional fields
      records.forEach(rec => {
        Object.keys(rec).forEach(key => {
          if (!fieldsMap[key]) {
            // Check value type to guess Postgres type
            const val = rec[key];
            if (val !== null && val !== undefined) {
              if (Array.isArray(val) || typeof val === 'object') {
                fieldsMap[key] = 'jsonb';
              } else if (typeof val === 'number') {
                fieldsMap[key] = 'number';
              } else if (typeof val === 'boolean') {
                fieldsMap[key] = 'boolean';
              } else {
                fieldsMap[key] = 'text';
              }
            } else {
              fieldsMap[key] = 'text';
            }
          }
        });
      });

      // Make sure 'id' is mapped as primary key text
      fieldsMap['id'] = 'text';

      // Build CREATE TABLE statement
      const columnDefs = [];
      const columns = Object.keys(fieldsMap);

      columns.forEach(col => {
        let pgType = 'TEXT';
        const rawType = fieldsMap[col];

        if (col === 'id') {
          pgType = 'TEXT PRIMARY KEY';
        } else if (rawType === 'number') {
          pgType = 'NUMERIC';
        } else if (rawType === 'boolean' || rawType === 'checkbox') {
          pgType = 'BOOLEAN DEFAULT false';
        } else if (rawType === 'jsonb') {
          pgType = 'JSONB';
        }

        columnDefs.push(`"${col}" ${pgType}`);
      });

      columnDefs.push('created_at TIMESTAMPTZ DEFAULT now()');
      columnDefs.push('updated_at TIMESTAMPTZ');

      const createTableSql = `CREATE TABLE IF NOT EXISTS "${mod}" (\n  ${columnDefs.join(',\n  ')}\n);`;
      await client.query(createTableSql);

      // Insert/Upsert records
      let migratedCount = 0;
      let skippedCount = 0;

      for (const rec of records) {
        if (!rec.id) {
          skippedCount++;
          migrationSummary[mod].reasons.push('Missing ID field');
          continue;
        }

        const valuePlaceholders = [];
        const valueValues = [];
        const updateSets = [];

        const filteredColumns = columns.filter(c => {
          const l = c.toLowerCase();
          return l !== 'created_at' && l !== 'updated_at' && l !== 'createdat' && l !== 'updatedat';
        });

        let index = 1;
        filteredColumns.forEach(col => {
          let val = rec[col];
          
          // Coerce boolean types
          if (fieldsMap[col] === 'boolean' || fieldsMap[col] === 'checkbox') {
            if (val === '') val = false;
            else val = !!val;
          }
          // Coerce number types
          if (fieldsMap[col] === 'number') {
            if (val === '' || val === undefined || val === null) {
              val = null;
            } else {
              const numVal = Number(val);
              val = isNaN(numVal) ? null : numVal;
            }
          }
          // Stringify JSONB fields
          if (fieldsMap[col] === 'jsonb') {
            if (val === undefined || val === null) {
              val = null;
            } else {
              val = JSON.stringify(val);
            }
          }

          valuePlaceholders.push(`$${index}`);
          valueValues.push(val === undefined ? null : val);
          
          if (col !== 'id') {
            updateSets.push(`"${col}" = $${index}`);
          }
          index++;
        });

        const colNamesStr = filteredColumns.map(c => `"${c}"`).join(', ');
        const placeholdersStr = valuePlaceholders.join(', ');
        
        let upsertSql = '';
        if (updateSets.length > 0) {
          upsertSql = `
            INSERT INTO "${mod}" (${colNamesStr}, updated_at)
            VALUES (${placeholdersStr}, now())
            ON CONFLICT (id) DO UPDATE
            SET ${updateSets.join(', ')}, updated_at = now();
          `;
        } else {
          upsertSql = `
            INSERT INTO "${mod}" (${colNamesStr})
            VALUES (${placeholdersStr})
            ON CONFLICT (id) DO NOTHING;
          `;
        }

        try {
          await client.query(upsertSql, valueValues);
          migratedCount++;
        } catch (err) {
          skippedCount++;
          migrationSummary[mod].reasons.push(`DB Error on ID ${rec.id}: ${err.message}`);
          migrationErrors.push({ module: mod, id: rec.id, error: err.message });
        }
      }

      migrationSummary[mod].migrated = migratedCount;
      migrationSummary[mod].skipped = skippedCount;
      console.log(`  Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
    }

    // 4. Migrate remarks & documents from db.json
    const specialTables = ['remarks', 'documents', 'sync_jobs'];
    for (const tbl of specialTables) {
      console.log(`\nMigrating special table: ${tbl}...`);
      const records = db[tbl] || [];
      migrationSummary[tbl] = { migrated: 0, skipped: 0, reasons: [] };

      let cols = [];
      if (tbl === 'remarks') {
        cols = ['id', 'targetModule', 'targetId', 'employeeName', 'dateTime', 'comment'];
      } else if (tbl === 'documents') {
        cols = ['id', 'targetModule', 'targetId', 'name', 'fileUrl', 'uploadedBy', 'dateAdded'];
      } else if (tbl === 'sync_jobs') {
        cols = ['id', 'moduleName', 'crmRecordId', 'operationType', 'attemptCount', 'maxAttempts', 'lastError', 'idempotencyKey', 'status', 'createdAt', 'updatedAt', 'syncedAt', 'nextAttemptAt'];
      }

      let migratedCount = 0;
      let skippedCount = 0;

      for (const rec of records) {
        if (!rec.id) {
          skippedCount++;
          continue;
        }

        const valuePlaceholders = [];
        const valueValues = [];
        const updateSets = [];

        const filteredCols = cols.filter(c => {
          const l = c.toLowerCase();
          return l !== 'created_at' && l !== 'updated_at' && l !== 'createdat' && l !== 'updatedat';
        });

        let index = 1;
        filteredCols.forEach(col => {
          let val = rec[col];
          const dbCol = col.replace(/([A-Z])/g, '_$1').toLowerCase();
          
          valuePlaceholders.push(`$${index}`);
          valueValues.push(val === undefined ? null : val);
          
          if (col !== 'id') {
            updateSets.push(`${dbCol} = $${index}`);
          }
          index++;
        });

        const dbColNames = filteredCols.map(c => c.replace(/([A-Z])/g, '_$1').toLowerCase());
        const colNamesStr = dbColNames.join(', ');
        const placeholdersStr = valuePlaceholders.join(', ');

        let upsertSql = '';
        if (updateSets.length > 0) {
          upsertSql = `
            INSERT INTO ${tbl} (${colNamesStr}, updated_at)
            VALUES (${placeholdersStr}, now())
            ON CONFLICT (id) DO UPDATE
            SET ${updateSets.join(', ')}, updated_at = now();
          `;
        } else {
          upsertSql = `
            INSERT INTO ${tbl} (${colNamesStr})
            VALUES (${placeholdersStr})
            ON CONFLICT (id) DO NOTHING;
          `;
        }

        try {
          await client.query(upsertSql, valueValues);
          migratedCount++;
        } catch (err) {
          skippedCount++;
          migrationErrors.push({ module: tbl, id: rec.id, error: err.message });
        }
      }
      migrationSummary[tbl].migrated = migratedCount;
      migrationSummary[tbl].skipped = skippedCount;
      console.log(`  Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
    }

    // 5. Populate id_counters table
    console.log('\nPopulating ID counters...');
    const prefixMap = {
      employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
      projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
      tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
      daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
      property_pitch_history: 'PITCH', dealer_calls: 'CALL', dealer_meetings: 'MEET',
      dealers: 'DEAL'
    };

    for (const mod of allModules) {
      const prefix = prefixMap[mod] || mod.substring(0, 4).toUpperCase();
      const records = db[mod] || [];
      let maxNum = 0;

      records.forEach(rec => {
        if (rec && rec.id && String(rec.id).startsWith(`${prefix}-`)) {
          const parts = String(rec.id).split('-');
          const num = parseInt(parts[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      });

      await client.query(`
        INSERT INTO id_counters (module_name, counter)
        VALUES ($1, $2)
        ON CONFLICT (module_name) DO UPDATE
        SET counter = GREATEST(id_counters.counter, EXCLUDED.counter);
      `, [mod, maxNum]);
    }
    console.log('ID counters initialized successfully.');

    console.log('\n================ MIGRATION REPORT ================');
    console.log(JSON.stringify(migrationSummary, null, 2));
    
    if (migrationErrors.length > 0) {
      console.warn(`\nMigration completed with ${migrationErrors.length} errors:`);
      console.warn(JSON.stringify(migrationErrors, null, 2));
    } else {
      console.log('\nMigration completed successfully with zero errors.');
    }

  } catch (err) {
    console.error('Migration crashed:', err);
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

migrate();
