const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

const dbPath = path.join(__dirname, '../config/db.json');
const metadataPath = path.join(__dirname, '../config/metadata.json');

// Memory queue locks for concurrency protection
const queueLocks = {};
let isProcessingQueue = false;

// Helper to load sheets config from environment variables
function getSheetsConfig() {
  return {
    syncActive: process.env.GOOGLE_SHEETS_SYNC_ACTIVE === 'true',
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  };
}

// Get Authenticated Google Sheets client
function getSheetsClient(config) {
  if (!config.syncActive || !config.spreadsheetId || !config.clientEmail || !config.privateKey) {
    return null;
  }
  try {
    const auth = new google.auth.JWT(
      config.clientEmail,
      null,
      config.privateKey.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    return google.sheets({ version: 'v4', auth });
  } catch (err) {
    console.error('Google Auth Init Failed in sheetsService:', err.message);
    return null;
  }
}

// Helper to get module headers
function getModuleHeaders(moduleName) {
  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const fields = (metadata.modules[moduleName] && metadata.modules[moduleName].fields) || [];
    const headers = fields.map(f => f.name);
    if (!headers.includes('crm_id')) {
      headers.unshift('crm_id');
    }
    return headers;
  } catch (e) {
    return ['crm_id', 'id', 'name', 'status'];
  }
}

/**
 * Enqueue a sheet synchronization job (Asynchronous entrypoint)
 */
async function syncToSheets(moduleName) {
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    db.sync_jobs = db.sync_jobs || [];

    // Calculate idempotency key for this module sync operation
    const lastRecId = db[moduleName] && db[moduleName].length > 0 ? db[moduleName][db[moduleName].length - 1].id : 'empty';
    const hash = crypto.createHash('md5').update(`moduleSync:${moduleName}:${db[moduleName]?.length || 0}:${lastRecId}`).digest('hex');
    const idempotencyKey = `module:${hash}`;

    // Prevent duplicate enqueues if one is already pending or processing
    const duplicateJob = db.sync_jobs.find(j => 
      j.idempotencyKey === idempotencyKey && 
      (j.status === 'PENDING' || j.status === 'PROCESSING')
    );
    if (duplicateJob) {
      return duplicateJob.id;
    }

    const jobId = `JOB-MOD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const newJob = {
      id: jobId,
      moduleName,
      crmRecordId: 'ALL',
      operationType: 'MODULE_SYNC',
      attemptCount: 0,
      maxAttempts: 5,
      lastError: null,
      idempotencyKey,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      syncedAt: null,
      nextAttemptAt: new Date().toISOString()
    };

    db.sync_jobs.push(newJob);
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    
    // Trigger the queue runner
    setImmediate(() => processSyncQueue());
    return jobId;
  } catch (err) {
    console.error(`Failed to enqueue module sync for ${moduleName}:`, err.message);
    return null;
  }
}

/**
 * Process the JSON-db sync queue
 */
async function processSyncQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    const config = getSheetsConfig();
    const sheets = getSheetsClient(config);
    if (!sheets) {
      isProcessingQueue = false;
      return;
    }

    const spreadsheetId = config.spreadsheetId;

    while (true) {
      const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      db.sync_jobs = db.sync_jobs || [];
      const now = new Date().toISOString();

      // Find next pending or failed job to process
      const jobIndex = db.sync_jobs.findIndex(j => 
        (j.status === 'PENDING' || (j.status === 'FAILED' && j.attemptCount < j.maxAttempts)) &&
        (!j.nextAttemptAt || j.nextAttemptAt <= now)
      );

      if (jobIndex === -1) {
        break;
      }

      const job = db.sync_jobs[jobIndex];
      const lockKey = `${job.moduleName}`;

      if (queueLocks[lockKey]) {
        break; // Lock busy for this module
      }

      // Acquire Lock
      queueLocks[lockKey] = true;
      job.status = 'PROCESSING';
      job.updatedAt = new Date().toISOString();
      fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');

      try {
        const sheetName = `data_${job.moduleName}`;
        
        // Retrieve spreadsheet metadata
        const meta = await sheets.spreadsheets.get({ spreadsheetId });
        let sheet = meta.data.sheets.find(s => s.properties.title === sheetName);

        if (!sheet) {
          // Auto create sheet if missing
          const addRes = await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{ addSheet: { properties: { title: sheetName } } }]
            }
          });
          sheet = addRes.data.replies[0].addSheet.properties;
        }

        const sheetId = sheet.properties ? sheet.properties.sheetId : sheet.sheetId;
        const headers = getModuleHeaders(job.moduleName);
        const dbRecords = db[job.moduleName] || [];

        // Execute row-level comparative sync
        await syncModuleRowLevel(sheets, spreadsheetId, sheetName, sheetId, dbRecords, headers);

        // Update job to success
        const updatedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const freshJob = updatedDb.sync_jobs.find(j => j.id === job.id);
        if (freshJob) {
          freshJob.status = 'SUCCESS';
          freshJob.syncedAt = new Date().toISOString();
          freshJob.updatedAt = new Date().toISOString();
          freshJob.lastError = null;
          fs.writeFileSync(dbPath, JSON.stringify(updatedDb, null, 2), 'utf8');
        }

      } catch (err) {
        console.error(`[Queue Worker] Sync job ${job.id} failed:`, err.message);

        const updatedDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        const freshJob = updatedDb.sync_jobs.find(j => j.id === job.id);
        if (freshJob) {
          freshJob.attemptCount += 1;
          freshJob.lastError = err.message;
          freshJob.updatedAt = new Date().toISOString();

          if (freshJob.attemptCount >= freshJob.maxAttempts) {
            freshJob.status = 'FAILED';
          } else {
            // Exponential backoff
            const delaySec = Math.pow(2, freshJob.attemptCount) * 10;
            freshJob.nextAttemptAt = new Date(Date.now() + delaySec * 1000).toISOString();
          }
          fs.writeFileSync(dbPath, JSON.stringify(updatedDb, null, 2), 'utf8');
        }
      } finally {
        delete queueLocks[lockKey];
      }
    }
  } catch (err) {
    console.error('[Queue Worker] Error running processing loop:', err.message);
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Performs comparison and row-level updates/deletes/creations
 */
async function syncModuleRowLevel(sheets, spreadsheetId, sheetName, sheetId, dbRecords, headers) {
  // Fetch columns up to Column Z
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z10000`
  });

  const sheetRows = getRes.data.values || [];

  // Write headers if sheet is empty
  if (sheetRows.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] }
    });
    sheetRows.push(headers);
  }

  // 1. Scan DB records and determine what to write or update
  for (const record of dbRecords) {
    let matchedRowIndex = -1;
    let isIdentical = false;

    const rowValues = headers.map(h => {
      if (h === 'crm_id') return String(record.id);
      const val = record[h];
      if (val === undefined || val === null) return '';
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });

    for (let i = 1; i < sheetRows.length; i++) {
      if (sheetRows[i][0] === String(record.id)) {
        matchedRowIndex = i + 1; // 1-indexed

        // Compare values
        isIdentical = true;
        for (let j = 0; j < headers.length; j++) {
          const sheetVal = sheetRows[i][j] !== undefined ? String(sheetRows[i][j]) : '';
          const recordVal = rowValues[j];
          if (sheetVal !== recordVal) {
            isIdentical = false;
            break;
          }
        }
        break;
      }
    }

    if (matchedRowIndex !== -1) {
      if (!isIdentical) {
        // Update row
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A${matchedRowIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [rowValues] }
        });
      }
    } else {
      // Append row
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowValues] }
      });
    }
  }

  // 2. Scan Sheet rows and physically delete any missing keys (Soft-delete / Sync delete)
  const deleteRowIndices = [];
  for (let i = 1; i < sheetRows.length; i++) {
    const crmId = sheetRows[i][0];
    if (crmId && !dbRecords.some(r => String(r.id) === String(crmId))) {
      deleteRowIndices.push(i + 1);
    }
  }

  // Delete from bottom to top to preserve correct indices
  deleteRowIndices.sort((a, b) => b - a);
  for (const index of deleteRowIndices) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: index - 1,
              endIndex: index
            }
          }
        }]
      }
    });
  }
}

/**
 * Compatibility function (Sync From Sheets) with explicit verification
 */
async function syncFromSheets() {
  console.log('Direct automated imports are deprecated. Please use the Sync Dashboard Reconcile feature.');
  return false;
}

// Background daemon interval polling
setInterval(() => {
  processSyncQueue();
}, 15000);

module.exports = {
  syncToSheets,
  syncFromSheets,
  getSheetsConfig,
  processSyncQueue
};
