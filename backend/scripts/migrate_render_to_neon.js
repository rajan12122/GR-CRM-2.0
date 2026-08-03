const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const sourceUrl = process.env.DATABASE_URL;
const targetUrl = process.argv[2] || 'postgresql://neondb_owner:npg_JawHR2QpBYk1@ep-orange-cell-ay4kys3m-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

if (!sourceUrl) {
  console.error('CRITICAL ERROR: DATABASE_URL is not set in backend/.env');
  process.exit(1);
}

if (!targetUrl) {
  console.error('CRITICAL ERROR: Target database connection string is not provided');
  process.exit(1);
}

console.log('--- Database Migration Tool ---');
console.log(`Source DB: ${sourceUrl.split('@')[1] || 'Render'}`);
console.log(`Target DB: ${targetUrl.split('@')[1] || 'Neon'}`);

const sourcePool = new Pool({
  connectionString: sourceUrl,
  ssl: { rejectUnauthorized: false }
});

const targetPool = new Pool({
  connectionString: targetUrl,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  let sourceClient, targetClient;
  try {
    sourceClient = await sourcePool.connect();
    console.log('Connected to Source Database.');
    
    targetClient = await targetPool.connect();
    console.log('Connected to Target Database.');

    // 1. Get all tables in public schema
    const tablesRes = await sourceClient.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(`Discovered ${tables.length} tables to migrate.`);

    for (const tableName of tables) {
      console.log(`\n----------------------------------------`);
      console.log(`Migrating table: "${tableName}"`);

      // 2. Get column definitions
      const colsRes = await sourceClient.query(`
        SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName]);
      
      const columns = colsRes.rows;

      // 3. Get primary keys
      const pkRes = await sourceClient.query(`
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1;
      `, [tableName]);

      const primaryKeys = pkRes.rows.map(r => r.column_name);

      // 4. Construct CREATE TABLE statement
      let createFields = columns.map(col => {
        let definition = `"${col.column_name}" ${col.data_type}`;
        if (col.character_maximum_length) {
          definition += `(${col.character_maximum_length})`;
        }
        if (col.is_nullable === 'NO') {
          definition += ' NOT NULL';
        }
        if (col.column_default !== null) {
          definition += ` DEFAULT ${col.column_default}`;
        }
        return definition;
      });

      if (primaryKeys.length > 0) {
        createFields.push(`PRIMARY KEY (${primaryKeys.map(k => `"${k}"`).join(', ')})`);
      }

      const createTableSql = `CREATE TABLE "${tableName}" (\n  ${createFields.join(',\n  ')}\n);`;

      // 5. Recreate table on Target
      console.log(`Recreating table on Target (dropping first)...`);
      await targetClient.query(`DROP TABLE IF EXISTS "${tableName}" CASCADE;`);
      await targetClient.query(createTableSql);

      // 6. Fetch and Insert Rows
      const dataRes = await sourceClient.query(`SELECT * FROM "${tableName}"`);
      const rows = dataRes.rows;
      console.log(`Fetched ${rows.length} rows from source.`);

      if (rows.length > 0) {
        const colNames = columns.map(c => `"${c.column_name}"`).join(', ');
        
        // Chunk inserts to prevent massive parameters list (max parameters in pg query is 65535)
        const batchSize = Math.floor(60000 / columns.length);
        console.log(`Inserting in batches of ${batchSize}...`);

        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const valuePlaceholders = [];
          const flatValues = [];
          let valIdx = 1;

          for (const r of batch) {
            const rowPlaceholders = [];
            for (const col of columns) {
              rowPlaceholders.push(`$${valIdx++}`);
              
              let val = r[col.column_name];
              // Edge case: stringify JSON/JSONB objects to avoid pg driver array confusion
              if ((col.data_type === 'jsonb' || col.data_type === 'json') && val !== null && typeof val === 'object') {
                val = JSON.stringify(val);
              }
              
              flatValues.push(val);
            }
            valuePlaceholders.push(`(${rowPlaceholders.join(', ')})`);
          }

          const insertQuery = `INSERT INTO "${tableName}" (${colNames}) VALUES ${valuePlaceholders.join(', ')}`;
          await targetClient.query(insertQuery, flatValues);
        }
        console.log(`Inserted ${rows.length} rows successfully.`);
      }
    }

    console.log('\n========================================');
    console.log('Migration Completed Successfully!');
    console.log('========================================');

  } catch (err) {
    console.error('CRITICAL ERROR DURING MIGRATION:', err);
    process.exit(1);
  } finally {
    if (sourceClient) sourceClient.release();
    if (targetClient) targetClient.release();
    await sourcePool.end();
    await targetPool.end();
  }
}

migrate();
