const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const metadataPath = path.join(__dirname, '../config/metadata.json');

async function run() {
  const client = await pool.connect();
  try {
    console.log("Connected to database...");
    
    if (!fs.existsSync(metadataPath)) {
      console.error("Local metadata.json not found at:", metadataPath);
      process.exit(1);
    }
    
    const localMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    console.log("Read local metadata.json successfully.");

    const res = await client.query(`
      INSERT INTO app_metadata (key, value)
      VALUES ('main_metadata', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1
      RETURNING key;
    `, [JSON.stringify(localMetadata)]);

    console.log("Successfully forced database app_metadata update to match local metadata.json!", res.rows[0]);
  } catch (err) {
    console.error("Error during sync:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
