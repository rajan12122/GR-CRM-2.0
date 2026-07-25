const crypto = require('crypto');
const { google } = require('googleapis');
const dbService = require('./dbService');

// Memory queue locks for concurrency protection
const queueLocks = {};
let isProcessingQueue = false;

// Helper to load sheets config
function getSheetsConfig() {
  let spreadsheetId = null;
  let syncActive = false;
  
  try {
    const metadata = dbService.readMetadata();
    if (metadata && metadata.sheetsConfig) {
      spreadsheetId = metadata.sheetsConfig.spreadsheetId;
      syncActive = metadata.sheetsConfig.syncActive === true || metadata.sheetsConfig.syncActive === 'true';
    }
  } catch (e) {
    // Ignore
  }

  // Fallback to environment variables
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
    const metadata = dbService.readMetadata();
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
    const records = await dbService.getRecords(moduleName);
    const lastRecId = records.length > 0 ? records[records.length - 1].id : 'empty';
    const hash = crypto.createHash('md5').update(`moduleSync:${moduleName}:${records.length}:${lastRecId}`).digest('hex');
    const idempotencyKey = `module:${hash}`;

    // Prevent duplicate enqueues if one is already pending or processing
    const duplicateRes = await dbService.pool.query(`
      SELECT id FROM sync_jobs 
      WHERE idempotency_key = $1 AND (status = 'PENDING' OR status = 'PROCESSING')
    `, [idempotencyKey]);

    if (duplicateRes.rows.length > 0) {
      return duplicateRes.rows[0].id;
    }

    const jobId = `JOB-MOD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
    const now = new Date().toISOString();

    await dbService.pool.query(`
      INSERT INTO sync_jobs (
        id, module_name, crm_record_id, operation_type, attempt_count, 
        max_attempts, last_error, idempotency_key, status, 
        created_at, updated_at, synced_at, next_attempt_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      jobId, moduleName, 'ALL', 'MODULE_SYNC', 0,
      5, null, idempotencyKey, 'PENDING', now, now, null, now
    ]);
    
    // Trigger the queue runner
    setImmediate(() => processSyncQueue());
    return jobId;
  } catch (err) {
    console.error(`Failed to enqueue module sync for ${moduleName}:`, err.message);
    return null;
  }
}

/**
 * Process the Postgres sync queue
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
      const now = new Date().toISOString();

      // Find next pending or failed job to process
      const nextJobRes = await dbService.pool.query(`
        SELECT * FROM sync_jobs
        WHERE (status = 'PENDING' OR (status = 'FAILED' AND attempt_count < max_attempts))
          AND (next_attempt_at IS NULL OR next_attempt_at <= $1)
        ORDER BY created_at ASC
        LIMIT 1
      `, [now]);

      if (nextJobRes.rows.length === 0) {
        break;
      }

      const job = nextJobRes.rows[0];
      const lockKey = `${job.module_name}`;

      if (queueLocks[lockKey]) {
        break; // Lock busy for this module
      }

      // Acquire Lock
      queueLocks[lockKey] = true;

      await dbService.pool.query(`
        UPDATE sync_jobs 
        SET status = 'PROCESSING', updated_at = $1 
        WHERE id = $2
      `, [new Date().toISOString(), job.id]);

      try {
        const sheetName = `data_${job.module_name}`;
        
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
        const headers = getModuleHeaders(job.module_name);
        const dbRecords = await dbService.getRecords(job.module_name);

        // Execute row-level comparative sync
        await syncModuleRowLevel(sheets, spreadsheetId, sheetName, sheetId, dbRecords, headers);

        // Update job to success
        await dbService.pool.query(`
          UPDATE sync_jobs
          SET status = 'SUCCESS', synced_at = $1, updated_at = $2, last_error = null
          WHERE id = $3
        `, [new Date().toISOString(), new Date().toISOString(), job.id]);

      } catch (err) {
        console.error(`[Queue Worker] Sync job ${job.id} failed:`, err.message);

        const attemptCount = job.attempt_count + 1;
        let nextAttemptAt = now;
        let newStatus = 'FAILED';

        if (attemptCount >= job.max_attempts) {
          newStatus = 'FAILED';
        } else {
          // Exponential backoff
          const delaySec = Math.pow(2, attemptCount) * 10;
          nextAttemptAt = new Date(Date.now() + delaySec * 1000).toISOString();
        }

        await dbService.pool.query(`
          UPDATE sync_jobs
          SET attempt_count = $1, last_error = $2, updated_at = $3, status = $4, next_attempt_at = $5
          WHERE id = $6
        `, [attemptCount, err.message, new Date().toISOString(), newStatus, nextAttemptAt, job.id]);

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

  const sheetHeaders = sheetRows[0];
  const idColIndex = sheetHeaders.findIndex(h => {
    const clean = String(h).trim().toLowerCase();
    return clean === 'crm_id' || clean === 'id';
  });
  const actualIdIndex = idColIndex !== -1 ? idColIndex : 0;

  // 1. Scan DB records and determine what to write or update
  for (const record of dbRecords) {
    let matchedRowIndex = -1;
    let isIdentical = false;

    const rowValues = sheetHeaders.map(h => {
      const cleanHeader = String(h).trim();
      if (cleanHeader === 'crm_id' || cleanHeader === 'id') {
        return String(record.id);
      }
      const val = record[cleanHeader];
      if (val === undefined || val === null) return '';
      return typeof val === 'object' ? JSON.stringify(val) : String(val);
    });

    for (let i = 1; i < sheetRows.length; i++) {
      if (sheetRows[i][actualIdIndex] === String(record.id)) {
        matchedRowIndex = i + 1; // 1-indexed

        // Compare values
        isIdentical = true;
        for (let j = 0; j < sheetHeaders.length; j++) {
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
    const crmId = sheetRows[i][actualIdIndex];
    if (crmId && !dbRecords.some(r => String(r.id) === String(crmId))) {
      deleteRowIndices.push(i + 1);
    }
  }

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
 * DEPRECATED: One-Way Incremental Import from Google Sheet -> CRM DB
 */
async function syncFromSheetsIncremental(targetModule = null) {
  console.warn('Google Sheets import paths are dropped (one-directional export only).');
  return { success: false, message: 'Google Sheets import paths are deprecated. CRM is now the single source of truth.' };
}

/**
 * Force manual export of all modules (or target module) from CRM -> Google Sheets
 */
async function syncToSheetsManual(targetModule = null) {
  const metadata = dbService.readMetadata();
  const modulesToSync = targetModule ? [targetModule] : Object.keys(metadata.modules || {});
  
  const enqueuedJobs = [];
  for (const mod of modulesToSync) {
    const jobId = await syncToSheets(mod);
    if (jobId) enqueuedJobs.push({ module: mod, jobId });
  }

  await processSyncQueue();
  return { success: true, count: enqueuedJobs.length, jobs: enqueuedJobs };
}

/**
 * DEPRECATED: Compatibility function (Sync From Sheets)
 */
async function syncFromSheets() {
  console.log('Automated imports from Google Sheets are deprecated.');
  return false;
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

/**
 * DEPRECATED: Core Import & Preview Engine
 */
function getColumnLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

async function executeImportWithMapping(config, mapping, dryRun = false) {
  const startTime = Date.now();
  try {
    const sheets = getSheetsClient(config);
    if (!sheets) throw new Error('Failed to initialize Google Sheets client.');

    const { module: moduleName, sheetName, headerMap, writeBackEnabled } = mapping;
    if (!moduleName || !sheetName || !headerMap) {
      throw new Error('Invalid mapping parameters.');
    }

    // 1. Fetch spreadsheet values
    const getRes = await sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${sheetName}!A1:Z5000` // read up to 5000 rows
    });
    const rows = getRes.data.values || [];
    if (rows.length === 0) {
      return {
        success: true,
        message: 'The sheet is empty.',
        metrics: { totalRows: 0, imported: 0, updated: 0, skipped: 0, validationErrors: [], duration: '0.0s' },
        previewRows: []
      };
    }

    const sheetHeaders = (rows[0] || []).map(h => String(h).trim());
    const dataRows = rows.slice(1);

    // Build colIndexMap: map crmField to column index in sheet
    // Note: headerMap is structured as { [sheetColName]: crmField }
    const colIndexMap = {};
    for (const [sheetColName, crmField] of Object.entries(headerMap)) {
      const idx = sheetHeaders.findIndex(h => h.toLowerCase() === String(sheetColName).trim().toLowerCase());
      if (idx !== -1) {
        colIndexMap[crmField] = idx;
      }
    }

    // Get existing records from DB to perform updates/deduping
    const existingRecords = await dbService.getRecords(moduleName);

    const mappedRecords = [];
    const validationErrors = [];

    for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
      const row = dataRows[rowIndex];
      const recordData = {};

      // Map columns
      for (const [crmField, idx] of Object.entries(colIndexMap)) {
        let val = row[idx];
        if (val === undefined || val === null) {
          val = null;
        } else {
          val = String(val).trim();
          if (val === '') {
            val = null;
          }
        }
        recordData[crmField] = val;
      }

      // If all fields are null (empty row), skip it
      const hasData = Object.values(recordData).some(v => v !== null);
      if (!hasData) continue;

      // Determine if insert or update
      const idValue = recordData.id ? String(recordData.id).trim() : '';
      let existing = idValue ? existingRecords.find(r => String(r.id).trim().toLowerCase() === idValue.toLowerCase()) : null;

      // Deduplication fallback if ID is missing in sheet
      if (!existing) {
        if (moduleName === 'customers' || moduleName === 'leads' || moduleName === 'employees') {
          const phoneVal = recordData.phone ? String(recordData.phone).trim() : '';
          const emailVal = recordData.email ? String(recordData.email).trim().toLowerCase() : '';
          
          if (phoneVal || emailVal) {
            existing = existingRecords.find(r => {
              const rPhone = r.phone ? String(r.phone).trim() : '';
              const rEmail = r.email ? String(r.email).trim().toLowerCase() : '';
              return (phoneVal && rPhone === phoneVal) || (emailVal && rEmail === emailVal);
            });
            if (existing) {
              recordData.id = existing.id;
            }
          }
        } else if (moduleName === 'properties') {
          const contactNumVal = recordData.contact_number ? String(recordData.contact_number).trim() : '';
          const nameVal = recordData.propertyName ? String(recordData.propertyName).trim().toLowerCase() : '';
          
          if (contactNumVal || nameVal) {
            existing = existingRecords.find(r => {
              const rContact = r.contact_number ? String(r.contact_number).trim() : '';
              const rName = r.propertyName ? String(r.propertyName).trim().toLowerCase() : '';
              return (contactNumVal && rContact === contactNumVal) || (nameVal && rName === nameVal);
            });
            if (existing) {
              recordData.id = existing.id;
            }
          }
        } else if (moduleName === 'dealers') {
          const contactNumVal = recordData.contact_num ? String(recordData.contact_num).trim() : '';
          const nameVal = recordData.firm_name ? String(recordData.firm_name).trim().toLowerCase() : '';
          
          if (contactNumVal || nameVal) {
            existing = existingRecords.find(r => {
              const rContact = r.contact_num ? String(r.contact_num).trim() : '';
              const rName = r.firm_name ? String(r.firm_name).trim().toLowerCase() : '';
              return (contactNumVal && rContact === contactNumVal) || (nameVal && rName === nameVal);
            });
            if (existing) {
              recordData.id = existing.id;
            }
          }
        }
      }

      mappedRecords.push({
        isUpdate: !!existing,
        data: recordData
      });
    }

    const metrics = {
      totalRows: mappedRecords.length,
      imported: 0,
      updated: 0,
      skipped: 0,
      validationErrors: validationErrors
    };

    const previewRows = [];

    if (!dryRun) {
      // Run actual database transactions
      await dbService.runTransaction(async (client) => {
        for (let i = 0; i < mappedRecords.length; i++) {
          const rec = mappedRecords[i];

          if (moduleName === 'properties') {
            await dbService.handlePropertyDealerAssociation(rec.data, client);
          }

          if (rec.isUpdate) {
            const { id, ...data } = rec.data;
            await dbService.updateRecord(moduleName, id, data, client);
            metrics.updated++;
          } else {
            if (!rec.data.id) {
              rec.data.id = await dbService.generateNextId(client, moduleName);
            }
            await dbService.insertRecord(moduleName, rec.data, client);
            metrics.imported++;
          }

          if (i < 50) {
            previewRows.push({
              rowNumber: i + 2,
              status: rec.isUpdate ? 'UPDATE' : 'INSERT',
              data: rec.data,
              errors: []
            });
          }
        }
      });

      // Write-back IDs to Google Sheets if enabled
      const writeBackActive = writeBackEnabled === true || writeBackEnabled === 'true';
      if (writeBackActive && colIndexMap['id'] !== undefined) {
        const idColLetter = getColumnLetter(colIndexMap['id']);
        const dataToBatchUpdate = [];

        for (let i = 0; i < mappedRecords.length; i++) {
          const rec = mappedRecords[i];
          const rowNum = i + 2; // header is row 1
          const originalRow = dataRows[i];
          const originalId = originalRow && originalRow[colIndexMap['id']] ? String(originalRow[colIndexMap['id']]).trim() : '';
          
          if (!originalId && rec.data.id) {
            dataToBatchUpdate.push({
              range: `${sheetName}!${idColLetter}${rowNum}`,
              values: [[rec.data.id]]
            });
          }
        }

        if (dataToBatchUpdate.length > 0) {
          try {
            await sheets.spreadsheets.values.batchUpdate({
              spreadsheetId: config.spreadsheetId,
              requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: dataToBatchUpdate
              }
            });
            console.log(`Successfully wrote back ${dataToBatchUpdate.length} IDs to Google Sheet tab "${sheetName}"`);
          } catch (writeBackErr) {
            console.error('Failed to write back generated IDs to Google Sheet:', writeBackErr.message);
          }
        }
      }
    } else {
      // In dry run, count preview metrics and populate preview list
      let nextMockCounter = 1;
      for (let i = 0; i < mappedRecords.length; i++) {
        const rec = mappedRecords[i];

        if (moduleName === 'properties') {
          await dbService.handlePropertyDealerAssociation(rec.data, null, true); // dryRun = true
        }

        if (rec.isUpdate) {
          metrics.updated++;
        } else {
          metrics.imported++;
          if (!rec.data.id) {
            rec.data.id = `NEW-${nextMockCounter++}`;
          }
        }

        if (i < 50) {
          previewRows.push({
            rowNumber: i + 2,
            status: rec.isUpdate ? 'UPDATE' : 'INSERT',
            data: rec.data,
            errors: []
          });
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    metrics.duration = duration;

    return {
      success: true,
      message: dryRun ? 'Mapping test simulation completed successfully.' : 'Google Sheets data imported successfully.',
      metrics,
      previewRows
    };

  } catch (err) {
    console.error('executeImportWithMapping error:', err.message);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1) + 's';
    return {
      success: false,
      message: 'Sheets import failed: ' + err.message,
      metrics: { totalRows: 0, imported: 0, updated: 0, skipped: 0, validationErrors: [err.message], duration },
      previewRows: []
    };
  }
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
