const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: "postgresql://neondb_owner:npg_JawHR2QpBYk1@ep-orange-cell-ay4kys3m-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("Ensuring entity_contacts table exists...");
    await client.query(`
      CREATE TABLE IF NOT EXISTS "entity_contacts" (
        "id" TEXT PRIMARY KEY,
        "record_id" TEXT UNIQUE NOT NULL,
        "module" TEXT NOT NULL,
        "contact_name" TEXT,
        "phone" TEXT,
        "dateAdded" TEXT,
        "created_at" TIMESTAMPTZ DEFAULT now(),
        "updated_at" TIMESTAMPTZ DEFAULT now()
      );
    `);

    console.log("Fetching leads, customers, and dealers...");
    const [leadsRes, custRes, dealerRes] = await Promise.all([
      client.query("SELECT id, name, phone, \"dateAdded\" FROM leads"),
      client.query("SELECT id, name, phone, \"dateAdded\" FROM customers"),
      client.query("SELECT id, person_name, contact_num, created_at FROM dealers")
    ]);

    console.log(`Found ${leadsRes.rows.length} leads, ${custRes.rows.length} customers, ${dealerRes.rows.length} dealers.`);

    let count = 0;

    // Helper to insert or update contacts
    const upsertContact = async (recordId, moduleName, name, phone, dateAdded) => {
      const id = `CON-${recordId}`;
      await client.query(`
        INSERT INTO "entity_contacts" (id, record_id, module, contact_name, phone, "dateAdded")
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (record_id) DO UPDATE SET
          contact_name = EXCLUDED.contact_name,
          phone = EXCLUDED.phone,
          "dateAdded" = EXCLUDED."dateAdded",
          updated_at = now()
      `, [id, recordId, moduleName, name, phone, dateAdded]);
      count++;
    };

    for (const r of leadsRes.rows) {
      await upsertContact(r.id, 'leads', r.name, r.phone, r.dateAdded);
    }
    for (const r of custRes.rows) {
      await upsertContact(r.id, 'customers', r.name, r.phone, r.dateAdded);
    }
    for (const r of dealerRes.rows) {
      const d = r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : new Date().toLocaleDateString('en-IN');
      await upsertContact(r.id, 'dealers', r.person_name, r.contact_num, d);
    }

    console.log(`Populated ${count} entries into entity_contacts table.`);
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

run();
