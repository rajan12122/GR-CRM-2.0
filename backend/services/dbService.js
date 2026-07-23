const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../config/db.json');
const metadataPath = path.join(__dirname, '../config/metadata.json');

let dbCache = null;
let metadataCache = null;

// Lightweight in-process Mutex class for async task serialization
class Mutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }

  async acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this._dispatch();
    });
  }

  release() {
    this.locked = false;
    this._dispatch();
  }

  _dispatch() {
    if (this.locked || this.queue.length === 0) return;
    this.locked = true;
    const nextResolve = this.queue.shift();
    nextResolve();
  }
}

const dbMutex = new Mutex();

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

// Wrap operations in a transaction utilizing the database Mutex
async function runTransaction(fn) {
  await dbMutex.acquire();
  try {
    const db = readDb();
    const result = await fn(db);
    writeDb(db);
    return result;
  } finally {
    dbMutex.release();
  }
}

// Generate sequential IDs utilizing a persistent counter structure in db.json
function generateNextId(db, moduleName, prefix) {
  db.idCounters = db.idCounters || {};
  
  const prefixMap = {
    employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
    projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
    tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
    daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
    property_pitch_history: 'PITCH', dealer_calls: 'CALL', dealer_meetings: 'MEET'
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

function handlePropertyDealerAssociation(payload, db, dryRun = false) {
  const isDealer = payload.dealer_owner_booked && String(payload.dealer_owner_booked).trim().toLowerCase() === 'dealer';
  if (!isDealer) return;

  const contactPhone = payload.contact_number;
  if (!contactPhone) return;
  const cleanPhone = String(contactPhone).trim();

  db.dealers = db.dealers || [];
  let dealer = db.dealers.find(d => d.contact_num && String(d.contact_num).trim() === cleanPhone);

  if (!dealer) {
    if (dryRun) {
      payload.dealerId = 'DEAL-TEMP';
      return;
    }
    const dealerId = generateNextId(db, 'dealers', 'DEAL');
    dealer = {
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
    db.dealers.push(dealer);
  }

  payload.dealerId = dealer.id;
}

module.exports = {
  dbPath,
  metadataPath,
  readDb,
  writeDb,
  readMetadata,
  writeMetadata,
  runTransaction,
  generateNextId,
  handlePropertyDealerAssociation
};
