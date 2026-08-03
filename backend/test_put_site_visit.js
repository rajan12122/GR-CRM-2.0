const { Client } = require('pg');
const { loadTransactionDb } = require('./services/dbService');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_JawHR2QpBYk1@ep-orange-cell-ay4kys3m-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  
  const db = await loadTransactionDb(client);
  const sv = db.site_visits.find(x => x.id === 'VISIT-005');
  console.log("=== site_visit VISIT-005 ===");
  console.log(sv);
  
  const payload = { result: 'Completed' };
  
  const targetPitches = (db.property_pitch_history || []).filter(p => 
    (sv.linkedPitchId && String(p.id) === String(sv.linkedPitchId)) ||
    (!sv.linkedPitchId && String(p.customerId) === String(sv.customerId) && String(p.propertyId) === String(sv.propertyId) && p.status === 'Site Visit Scheduled')
  );
  
  console.log("=== Matching Pitches ===");
  console.log(targetPitches);
  
  await client.end();
}

main().catch(console.error);
