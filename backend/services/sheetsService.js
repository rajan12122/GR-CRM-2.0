const crypto = require('crypto');
const { google } = require('googleapis');
const { dbPath, metadataPath, readDb, writeDb, readMetadata, writeMetadata, runTransaction, generateNextId, handlePropertyDealerAssociation } = require('./dbService');

// Memory queue locks for concurrency protection
const queueLocks = {};
let isProcessingQueue = false;

// Helper to load sheets config from metadata.json or environment variables
function getSheetsConfig() {
  let spreadsheetId = null;
  let syncActive = false;
  
  try {
    const metadata = readMetadata();
    if (metadata && metadata.sheetsConfig) {
      spreadsheetId = metadata.sheetsConfig.spreadsheetId;
      syncActive = metadata.sheetsConfig.syncActive === true || metadata.sheetsConfig.syncActive === 'true';
    }
  } catch (e) {
    // Ignore
  }

  // Fallback to environment variables if not found in metadata
  if (!spreadsheetId) {
    spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  }
  if (process.env.GOOGLE_SHEETS_SYNC_ACTIVE !== undefined) {
    syncActive = process.env.GOOGLE_SHEETS_SYNC_ACTIVE === 'true';
  }

  return {
    syncActive: syncActive,
    spreadsheetId: spreadsheetId ? String(spreadsheetId).trim() : null,
    clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  };
}

// Helper to format private key properly
function formatPrivateKey(rawKey) {
  if (!rawKey) return null;
  let key = String(rawKey).trim();
  
  // Replace escaped newlines with actual newlines
  key = key.replace(/\\n/g, '\n');
  
  const prefix = '-----BEGIN PRIVATE KEY-----';
  const suffix = '-----END PRIVATE KEY-----';
  
  if (!key.includes(prefix)) {
    key = `${prefix}\n${key}`;
  }
  if (!key.includes(suffix)) {
    key = `${key}\n${suffix}\n`;
  }
  
  return key;
}

// Get Authenticated Google Sheets client
function getSheetsClient(config) {
  if (!config.syncActive || !config.spreadsheetId || !config.clientEmail || !config.privateKey) {
    return null;
  }
  try {
    const formattedKey = formatPrivateKey(config.privateKey);
    const auth = new google.auth.JWT(
      config.clientEmail,
      null,
      formattedKey,
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
    const metadata = readMetadata();
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
    const db = readDb();
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
    writeDb(db);
    
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
      const db = readDb();
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
      writeDb(db);

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
        const updatedDb = readDb();
        const freshJob = updatedDb.sync_jobs.find(j => j.id === job.id);
        if (freshJob) {
          freshJob.status = 'SUCCESS';
          freshJob.syncedAt = new Date().toISOString();
          freshJob.updatedAt = new Date().toISOString();
          freshJob.lastError = null;
          writeDb(updatedDb);
        }

      } catch (err) {
        console.error(`[Queue Worker] Sync job ${job.id} failed:`, err.message);

        const updatedDb = readDb();
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
          writeDb(updatedDb);
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
 * One-Way Incremental Import from Google Sheet -> CRM DB
 * Reads rows from Google Sheets, appends ONLY NEW rows into CRM database.
 * Does NOT duplicate existing records, and does NOT delete any CRM rows if removed from Google Sheets.
 */
async function syncFromSheetsIncremental(targetModule = null) {
  const config = getSheetsConfig();
  const sheets = getSheetsClient(config);
  if (!sheets || !config.spreadsheetId) {
    throw new Error('Google Sheets integration is not configured or disabled in environment settings.');
  }

  const spreadsheetId = config.spreadsheetId;
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const allSheets = meta.data.sheets || [];

  const metadata = readMetadata();
  const modulesToSync = targetModule ? [targetModule] : Object.keys(metadata.modules || {});
  
  // Fetch all sheet data first (outside of mutex lock)
  const sheetsData = {};
  for (const mod of modulesToSync) {
    const sheetName = `data_${mod}`;
    const sheetObj = allSheets.find(s => s.properties && s.properties.title === sheetName);
    if (!sheetObj) continue;

    try {
      const getRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!A1:Z10000`
      });
      sheetsData[mod] = getRes.data.values || [];
    } catch (e) {
      console.error(`Failed to read sheet for ${mod}:`, e.message);
    }
  }

  const importSummary = { added: 0, skipped: 0, details: {} };
  const prefixMap = {
    employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
    projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
    tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
    daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
    property_pitch_history: 'PITCH', dealer_calls: 'CALL', dealer_meetings: 'MEET'
  };

  // Run DB writes inside transaction Mutex
  await runTransaction(async (db) => {
    for (const mod of modulesToSync) {
      const rows = sheetsData[mod];
      if (!rows || rows.length < 2) continue;

      const rawHeaders = rows[0] || [];
      const headers = rawHeaders.map(h => String(h).trim());
      const lowerHeaders = headers.map(h => h.toLowerCase());

      const crmIdIdx = lowerHeaders.indexOf('crm_id') !== -1 ? lowerHeaders.indexOf('crm_id') : lowerHeaders.indexOf('id');
      const phoneIdx = lowerHeaders.indexOf('phone') !== -1 ? lowerHeaders.indexOf('phone') : lowerHeaders.indexOf('contact_number');

      db[mod] = db[mod] || [];
      const existingList = db[mod];
      const prefix = prefixMap[mod] || mod.substring(0, 4).toUpperCase();

      let modAdded = 0;
      let modSkipped = 0;

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0 || row.every(cell => !cell || String(cell).trim() === '')) continue;

        const rowCrmId = crmIdIdx !== -1 && row[crmIdIdx] ? String(row[crmIdIdx]).trim() : '';
        const rowPhone = phoneIdx !== -1 && row[phoneIdx] ? String(row[phoneIdx]).trim() : '';

        let exists = false;
        if (rowCrmId) {
          exists = existingList.some(rec => String(rec.id) === rowCrmId);
        }
        if (!exists && rowPhone) {
          exists = existingList.some(rec => rec.phone && String(rec.phone).trim() === rowPhone);
        }

        if (exists) {
          modSkipped++;
          continue;
        }

        const newRec = {};
        headers.forEach((h, colIdx) => {
          if (h.toLowerCase() === 'crm_id') return;
          const fieldName = h;
          const val = row[colIdx] !== undefined ? String(row[colIdx]).trim() : '';
          newRec[fieldName] = val;
        });

        // Use sequential persistent ID counter
        newRec.id = generateNextId(db, mod, prefix);

        existingList.push(newRec);
        modAdded++;
      }

      importSummary.added += modAdded;
      importSummary.skipped += modSkipped;
      importSummary.details[mod] = { added: modAdded, skipped: modSkipped };
    }
  });

  return importSummary;
}

/**
 * Force manual export of all modules (or target module) from CRM -> Google Sheets
 */
async function syncToSheetsManual(targetModule = null) {
  const metadata = readMetadata();
  const modulesToSync = targetModule ? [targetModule] : Object.keys(metadata.modules || {});
  
  const enqueuedJobs = [];
  for (const mod of modulesToSync) {
    const jobId = await syncToSheets(mod);
    if (jobId) enqueuedJobs.push({ module: mod, jobId });
  }

  // Trigger immediate processing of the sync queue
  await processSyncQueue();

  return { success: true, count: enqueuedJobs.length, jobs: enqueuedJobs };
}

/**
 * Compatibility function (Sync From Sheets) with explicit verification
 */
async function syncFromSheets() {
  console.log('Direct automated imports are deprecated. Please use the Sync Dashboard Reconcile feature.');
  return false;
}

// Helper to convert index to Excel column letters (1 -> A, 27 -> AA, etc.)
function getColLetter(col) {
  let letter = '';
  while (col > 0) {
    let temp = (col - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    col = Math.floor((col - temp) / 26);
  }
  return letter;
}

// Fetch all sheets (tabs) in configured Google Spreadsheet
async function getSpreadsheetSheets(config) {
  const sheets = getSheetsClient(config);
  if (!sheets) throw new Error('Failed to initialize Google Sheets client.');
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId });
  return (meta.data.sheets || []).map(s => s.properties?.title).filter(Boolean);
}

// Fetch headers from first row of sheet tab
async function getSheetHeaders(config, sheetName) {
  const sheets = getSheetsClient(config);
  if (!sheets) throw new Error('Failed to initialize Google Sheets client.');
  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId: config.spreadsheetId,
    range: `${sheetName}!A1:Z1`
  });
  const rows = getRes.data.values || [];
  return (rows[0] || []).map(h => String(h).trim()).filter(Boolean);
}

// Perform validation on cell values based on CRM module metadata types
function validateFieldValue(value, fieldDef, db, metadata) {
  const strVal = value !== undefined && value !== null ? String(value).trim() : '';
  
  if (fieldDef.required && !strVal) {
    if (fieldDef.name !== 'id' && fieldDef.name !== 'last_updated' && fieldDef.name !== 'propertyName') {
      return 'Required field is missing.';
    }
  }
  
  if (!strVal) return null;
  
  if (fieldDef.type === 'number') {
    if (isNaN(Number(strVal))) return 'Must be a valid number.';
  }
  if (fieldDef.type === 'currency') {
    const cleanNum = strVal.replace(/[$,₹\s]/g, '');
    if (isNaN(Number(cleanNum))) return 'Must be a valid currency value.';
  }
  if (fieldDef.type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(strVal)) return 'Must be a valid email address.';
  }
  if (fieldDef.type === 'phone') {
    const phoneDigits = strVal.replace(/\D/g, '');
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      return 'Must be a valid phone number (7-15 digits).';
    }
  }
  if (fieldDef.type === 'date') {
    if (isNaN(Date.parse(strVal)) && !/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(strVal)) {
      return 'Must be a valid date.';
    }
  }
  
  // Accept custom select options under "Others" without throwing a validation error.
  // Case-insensitive normalization is performed separately inside the execution loop.
  
  if (fieldDef.relationship && fieldDef.relationship.module) {
    const relModule = fieldDef.relationship.module;
    const relRecords = db[relModule] || [];
    const exists = relRecords.some(r => 
      String(r.id).trim().toLowerCase() === strVal.toLowerCase() ||
      (r.name && String(r.name).trim().toLowerCase() === strVal.toLowerCase()) ||
      (r.firm_name && String(r.firm_name).trim().toLowerCase() === strVal.toLowerCase()) ||
      (r.person_name && String(r.person_name).trim().toLowerCase() === strVal.toLowerCase())
    );
    if (!exists) {
      return `Referenced record not found in related module '${relModule}'.`;
    }
  }
  return null;
}

// Core Import & Preview Engine
async function executeImportWithMapping(config, mapping, dryRun = false) {
  const startTime = Date.now();
  const sheets = getSheetsClient(config);
  if (!sheets || !config.spreadsheetId) {
    throw new Error('Google Sheets integration is not configured or disabled.');
  }

  const spreadsheetId = config.spreadsheetId;
  const sheetName = mapping.sheetName;

  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetObj = (meta.data.sheets || []).find(s => s.properties?.title === sheetName);
  if (!sheetObj) {
    throw new Error(`Sheet tab '${sheetName}' does not exist in the spreadsheet.`);
  }

  const getRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:Z10000`
  });
  const rows = getRes.data.values || [];
  if (rows.length === 0) {
    throw new Error(`Sheet '${sheetName}' is completely empty.`);
  }

  const rawHeaders = rows[0] || [];
  const headers = rawHeaders.map(h => String(h).trim());

  const moduleName = mapping.module;
  const headerMap = mapping.headerMap || {};
  const unmappedHeaders = headers.filter(h => !headerMap[h]);

  const prefixMap = {
    employees: 'EMP', customers: 'CUST', leads: 'LEAD', properties: 'PROP',
    projects: 'PROJ', site_visits: 'VISIT', follow_ups: 'FOLLOW', remarks: 'REM',
    tasks: 'TASK', sales: 'SALE', documents: 'DOC', attendance: 'ATT',
    daily_prices: 'PRICE', salaries: 'SAL', queries: 'QRY', deals: 'DEAL',
    property_pitch_history: 'PITCH', dealer_calls: 'CALL', dealer_meetings: 'MEET'
  };
  const prefix = prefixMap[moduleName] || moduleName.substring(0, 4).toUpperCase();

  const sheetsWriteBacks = [];
  let metrics;
  let previewRows = [];

  await runTransaction(async (db) => {
    const metadata = readMetadata();
    const fields = metadata.modules[moduleName]?.fields || [];
    
    // For dryRun preview, copy existing List so we don't pollute database cache in-memory
    let existingList;
    if (dryRun) {
      existingList = [...(db[moduleName] || [])];
    } else {
      db[moduleName] = db[moduleName] || [];
      existingList = db[moduleName];
    }

    const requiredFields = fields.filter(f => f.required && f.name !== 'id' && f.name !== 'last_updated' && f.name !== 'propertyName');
    const missingRequired = requiredFields.filter(f => !Object.values(headerMap).includes(f.name));

    metrics = {
      totalRows: Math.max(0, rows.length - 1),
      imported: 0,
      updated: 0,
      skipped: 0,
      duplicates: 0,
      validationErrors: [],
      missingRequired: missingRequired.map(f => f.label),
      unmappedHeaders,
      duration: 0
    };

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0 || row.every(cell => !cell || String(cell).trim() === '')) {
        metrics.skipped++;
        continue;
      }

      const rowErrors = [];
      const mappedRecord = {};

      fields.forEach(f => {
        const sheetHeader = Object.keys(headerMap).find(key => headerMap[key] === f.name);
        if (!sheetHeader) return;

        const colIdx = headers.indexOf(sheetHeader);
        if (colIdx === -1) return;

        let rawVal = row[colIdx] !== undefined ? String(row[colIdx]).trim() : '';

        // Case-insensitive normalization for select options
        if (f.type === 'select' && rawVal) {
          const chipGroup = f.chipGroup;
          const chipList = metadata?.chipGroups?.[chipGroup] || metadata?.chips?.[chipGroup] || [];
          const match = chipList.find(c => 
            String(c.value).toLowerCase() === rawVal.toLowerCase() ||
            String(c.label).toLowerCase() === rawVal.toLowerCase()
          );
          if (match) {
            rawVal = match.value;
          }
        }
        
        const errorMsg = validateFieldValue(rawVal, f, db, metadata);
        if (errorMsg) {
          rowErrors.push({ field: f.label, value: rawVal, error: errorMsg });
          metrics.validationErrors.push({ row: i + 1, field: f.label, value: rawVal, error: errorMsg });
        }

        if (f.type === 'number') {
          mappedRecord[f.name] = rawVal ? Number(rawVal) : '';
        } else if (f.type === 'checkbox') {
          mappedRecord[f.name] = rawVal.toLowerCase() === 'true' || rawVal === '1' || rawVal.toLowerCase() === 'yes';
        } else {
          mappedRecord[f.name] = rawVal;
        }
      });

      const idHeader = Object.keys(headerMap).find(key => headerMap[key] === 'id');
      let rowId = '';
      if (idHeader) {
        const colIdx = headers.indexOf(idHeader);
        if (colIdx !== -1 && row[colIdx]) {
          rowId = String(row[colIdx]).trim();
        }
      }

      const phoneHeader = Object.keys(headerMap).find(key => headerMap[key] === 'phone');
      let rowPhone = '';
      if (phoneHeader) {
        const colIdx = headers.indexOf(phoneHeader);
        if (colIdx !== -1 && row[colIdx]) {
          rowPhone = String(row[colIdx]).trim();
        }
      }

      let existingRecordIndex = -1;
      if (rowId) {
        existingRecordIndex = existingList.findIndex(rec => String(rec.id) === rowId);
      }
      if (existingRecordIndex === -1 && rowPhone) {
        existingRecordIndex = existingList.findIndex(rec => rec.phone && String(rec.phone).trim() === rowPhone);
      }

      if (rowErrors.length > 0) {
        metrics.skipped++;
        previewRows.push({ rowNumber: i + 1, status: 'ERROR', data: mappedRecord, errors: rowErrors });
        continue;
      }

      if (moduleName === 'properties') {
        handlePropertyDealerAssociation(mappedRecord, db, dryRun);
      }

      if (existingRecordIndex !== -1) {
        if (!dryRun) {
          const oldRecord = existingList[existingRecordIndex];
          Object.keys(mappedRecord).forEach(k => {
            if (k !== 'id') {
              oldRecord[k] = mappedRecord[k];
            }
          });
          oldRecord.last_updated = new Date().toLocaleString('en-IN');
        }
        metrics.updated++;
        previewRows.push({ rowNumber: i + 1, status: 'UPDATE', data: { ...existingList[existingRecordIndex], ...mappedRecord } });
      } else {
        const generatedId = generateNextId(db, moduleName, prefix);
        mappedRecord.id = generatedId;
        mappedRecord.dateAdded = new Date().toISOString().split('T')[0];
        mappedRecord.last_updated = new Date().toLocaleString('en-IN');

        // Always push to in-memory list (cloned list if dryRun, db list if real)
        existingList.push(mappedRecord);
        
        if (!dryRun && mapping.writeBackEnabled && idHeader) {
          const idColIdx = headers.indexOf(idHeader);
          if (idColIdx !== -1) {
            sheetsWriteBacks.push({
              range: `${sheetName}!${getColLetter(idColIdx + 1)}${i + 1}`,
              values: [[generatedId]]
            });
          }
        }
        metrics.imported++;
        previewRows.push({ rowNumber: i + 1, status: 'INSERT', data: mappedRecord });
      }
    }
  });

  if (!dryRun && sheetsWriteBacks.length > 0) {
    try {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        resource: {
          data: sheetsWriteBacks,
          valueInputOption: 'USER_ENTERED'
        }
      });
    } catch (writeErr) {
      console.error('Failed to write generated IDs back to Google Sheets:', writeErr.message);
    }
  }

  metrics.duration = ((Date.now() - startTime) / 1000).toFixed(2);

  return {
    success: true,
    metrics,
    previewRows
  };
}

// Background daemon interval polling
setInterval(() => {
  processSyncQueue();
}, 15000);

module.exports = {
  syncToSheets,
  syncFromSheets,
  syncFromSheetsIncremental,
  syncToSheetsManual,
  getSheetsConfig,
  getSheetsClient,
  getSpreadsheetSheets,
  getSheetHeaders,
  executeImportWithMapping,
  processSyncQueue
};
