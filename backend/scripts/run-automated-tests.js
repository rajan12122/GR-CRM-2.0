require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 5055;
const BASE_URL = `http://localhost:${PORT}/api`;

const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon') 
    ? { rejectUnauthorized: false } 
    : false
};

const pool = new Pool(dbConfig);

// Test details
const TEST_ADMIN_ID = 'TEST-ADMIN-99';
const TEST_EMP_ID = 'TEST-EMP-99';
const TEST_EMAIL_ADMIN = 'test_admin@gagan.com';
const TEST_EMAIL_EMP = 'test_emp@gagan.com';
const TEST_PASSWORD = 'password123';

let serverProcess = null;
let adminToken = '';
let empToken = '';
let tempIntakeToken = '';
let testLeadId = '';
let testCustomerId = '';

async function setupDatabaseFixtures() {
  console.log('🔧 Setting up test database fixtures...');
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, salt);

  // Clean up any stale data from previous runs
  await cleanupDatabaseFixtures();

  // Create temporary roles if not exists or use existing settings
  // Insert Test Admin
  await pool.query(
    `INSERT INTO employees (id, name, email, "passwordHash", role, status, "tokenVersion")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [TEST_ADMIN_ID, 'Test Admin User', TEST_EMAIL_ADMIN, passwordHash, 'Admin', 'Active', 1]
  );

  // Insert Test Employee
  await pool.query(
    `INSERT INTO employees (id, name, email, "passwordHash", role, status, "tokenVersion")
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [TEST_EMP_ID, 'Test Employee User', TEST_EMAIL_EMP, passwordHash, 'Sales', 'Active', 1]
  );

  console.log('✅ Fixtures inserted successfully.');
}

async function cleanupDatabaseFixtures() {
  console.log('🧹 Cleaning up database test records...');
  try {
    // Delete any test queries, follow-ups, and leads/customers created in tests
    await pool.query("DELETE FROM queries WHERE id LIKE 'TEST-%' OR \"customerId\" LIKE 'TEST-%' OR \"customerId\" LIKE 'LEAD-TEST-%'");
    await pool.query("DELETE FROM follow_ups WHERE id LIKE 'TEST-%' OR \"customerId\" LIKE 'TEST-%' OR \"customerId\" LIKE 'LEAD-TEST-%'");
    await pool.query("DELETE FROM site_visits WHERE id LIKE 'TEST-%' OR \"customerId\" LIKE 'TEST-%' OR \"customerId\" LIKE 'LEAD-TEST-%'");
    await pool.query("DELETE FROM property_pitch_history WHERE id LIKE 'TEST-%' OR \"customerId\" LIKE 'TEST-%' OR \"customerId\" LIKE 'LEAD-TEST-%'");
    await pool.query("DELETE FROM deals WHERE id LIKE 'TEST-%' OR \"customerId\" LIKE 'TEST-%' OR \"customerId\" LIKE 'LEAD-TEST-%'");
    await pool.query("DELETE FROM properties WHERE id LIKE 'TEST-%'");
    await pool.query("DELETE FROM leads WHERE id LIKE 'TEST-%' OR id LIKE 'LEAD-TEST-%' OR \"assignedEmployeeId\" IN ($1, $2) OR phone IN ('9999900001', '9999900002', '9999900003', '9999900005', '9999900007')", [TEST_ADMIN_ID, TEST_EMP_ID]);
    await pool.query("DELETE FROM customers WHERE id LIKE 'TEST-%' OR id LIKE 'LEAD-TEST-%' OR \"assignedEmployeeId\" IN ($1, $2) OR phone IN ('9999900001', '9999900002', '9999900003', '9999900005', '9999900007')", [TEST_ADMIN_ID, TEST_EMP_ID]);
    
    // Delete test employees
    await pool.query("DELETE FROM employees WHERE id IN ($1, $2)", [TEST_ADMIN_ID, TEST_EMP_ID]);
    console.log('✅ Database cleanup completed.');
  } catch (err) {
    console.error('❌ Database cleanup failed:', err.message);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting backend test server on port ${PORT}...`);
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PORT: PORT
      }
    });

    serverProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Server running') || msg.includes('listening on port')) {
        console.log('✅ Test server started successfully.');
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error]: ${data}`);
    });

    serverProcess.on('error', (err) => {
      reject(err);
    });

    // Timeout if server takes too long to respond
    setTimeout(() => {
      reject(new Error('Server start timed out after 10s'));
    }, 10000);
  });
}

async function runTests() {
  const results = [];

  const testCase = async (name, testFn) => {
    console.log(`\n👉 Testing: ${name}...`);
    try {
      await testFn();
      console.log(`✔️ PASSED: ${name}`);
      results.push({ name, passed: true });
    } catch (err) {
      console.error(`❌ FAILED: ${name}`);
      console.error(err);
      results.push({ name, passed: false, error: err.message });
    }
  };

  // --- TEST CASE 1: Authentication ---
  await testCase('User Login - Invalid Password', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL_ADMIN, password: 'wrongpassword' })
    });
    if (res.status !== 401) {
      throw new Error(`Expected 401 Unauthorized status, got: ${res.status}`);
    }
  });

  await testCase('User Login - Success Admin', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL_ADMIN, password: TEST_PASSWORD })
    });
    if (res.status !== 200) {
      throw new Error(`Expected 200 OK status, got: ${res.status}`);
    }
    const data = await res.json();
    if (!data.token) {
      throw new Error('Response did not contain JWT token');
    }
    adminToken = data.token;
  });

  await testCase('User Login - Success Employee', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL_EMP, password: TEST_PASSWORD })
    });
    if (res.status !== 200) {
      throw new Error(`Expected 200 OK status, got: ${res.status}`);
    }
    const data = await res.json();
    empToken = data.token;
  });

  // --- TEST CASE 2: Roles and Permissions Gateways ---
  await testCase('Role Permissions - Admin Action Blocked for Employee', async () => {
    // Attempting settings action using Employee token
    const res = await fetch(`${BASE_URL}/settings/test-sheets`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${empToken}`
      }
    });
    if (res.status !== 403) {
      throw new Error(`Expected 403 Forbidden for Employee calling Admin settings sync, got: ${res.status}`);
    }
  });

  await testCase('Role Permissions - Admin Action Allowed for Admin', async () => {
    const res = await fetch(`${BASE_URL}/settings/test-sheets`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      }
    });
    // Can return either 200 or 400 (if Sheets API config is invalid), but must NOT return 403
    if (res.status === 403) {
      throw new Error(`Expected Admin settings access to bypass 403, got: ${res.status}`);
    }
  });

  // --- TEST CASE 3: Data Access / Ownership Constraints ---
  await testCase('Data Access / Ownership Constraints', async () => {
    // 1. Create a lead under TEST_EMP_ID
    const leadRes = await pool.query(
      `INSERT INTO leads (id, name, phone, email, "assignedEmployeeId", status)
       VALUES ('TEST-LEAD-A', 'Leads owned by Employee', '9999900001', 'lead_emp@gagan.com', $1, 'Cold') RETURNING *`,
      [TEST_EMP_ID]
    );
    testLeadId = leadRes.rows[0].id;

    // 2. Create another lead under TEST_ADMIN_ID
    await pool.query(
      `INSERT INTO leads (id, name, phone, email, "assignedEmployeeId", status)
       VALUES ('TEST-LEAD-B', 'Leads owned by Admin', '9999900002', 'lead_admin@gagan.com', $1, 'Cold')`,
      [TEST_ADMIN_ID]
    );

    // 3. Query leads list as Employee
    const resEmp = await fetch(`${BASE_URL}/data/leads`, {
      headers: { 'Authorization': `Bearer ${empToken}` }
    });
    const leadsEmp = await resEmp.json();

    // Verify employee only sees their own lead
    const hasAdminLead = leadsEmp.some(l => l.id === 'TEST-LEAD-B');
    const hasEmpLead = leadsEmp.some(l => l.id === 'TEST-LEAD-A');

    if (hasAdminLead) {
      throw new Error('Data Access Leak: Employee was able to access leads owned by Admin');
    }
    if (!hasEmpLead) {
      throw new Error('Expected Employee to see their own assigned lead, but it was not returned');
    }

    // 4. Query leads list as Admin
    const resAdmin = await fetch(`${BASE_URL}/data/leads`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    const leadsAdmin = await resAdmin.json();

    // Verify Admin sees both
    const adminHasA = leadsAdmin.some(l => l.id === 'TEST-LEAD-A');
    const adminHasB = leadsAdmin.some(l => l.id === 'TEST-LEAD-B');

    if (!adminHasA || !adminHasB) {
      throw new Error('Admin should have global visibility into all leads');
    }
  });

  // --- TEST CASE 4: Field-level Validation & Sanity Constraints ---
  await testCase('Field Edit Permissions & Validation Constraints', async () => {
    // Attempting to submit a lead update with invalid phone length
    const res = await fetch(`${BASE_URL}/data/leads/${testLeadId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${empToken}`
      },
      body: JSON.stringify({ phone: '12345' }) // 5 digits (invalid)
    });
    if (res.status === 200 || res.status === 204) {
      throw new Error('Expected validation failure for invalid phone digits length, but request succeeded');
    }
  });

  // --- TEST CASE 5: Public intake ---
  await testCase('Public Intake Portal API', async () => {
    // 1. Submit valid public lead
    const res = await fetch(`${BASE_URL}/public/lead-intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Public Guest',
        phone: '9999900003',
        lead_source: 'Website Form'
      })
    });
    if (res.status !== 200) {
      throw new Error(`Expected 200 OK for public lead intake, got: ${res.status}`);
    }
    const data = await res.json();
    if (!data.success) {
      throw new Error('Intake submission success property was false');
    }

    // 2. Test honeypot trigger
    const honeypotRes = await fetch(`${BASE_URL}/public/lead-intake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Spam Bot',
        phone: '9999900004',
        website_url: 'http://spammy.com' // Honeypot filled
      })
    });
    const honeypotData = await honeypotRes.json();
    if (!honeypotData.success) {
      throw new Error('Honeypot request should return success status to trick bots but not insert into DB');
    }
    
    // Verify bot lead was NOT created in DB
    const dbCheck = await pool.query("SELECT * FROM leads WHERE name = 'Spam Bot'");
    if (dbCheck.rows.length > 0) {
      throw new Error('Security Breach: Honeypot submission was incorrectly saved in the database');
    }
  });

  // --- TEST CASE 6: Intake Token Generation & Quick-Add Auth ---
  await testCase('Intake Token Generation & Quick Add Signed Verification', async () => {
    // 1. Generate intake token as Admin
    const resGen = await fetch(`${BASE_URL}/public/generate-intake-token`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    if (resGen.status !== 200) {
      throw new Error(`Failed to generate intake token, status: ${resGen.status}`);
    }
    const dataGen = await resGen.json();
    tempIntakeToken = dataGen.token;

    // 2. Submit Quick-Add using temporary token
    const resAdd = await fetch(`${BASE_URL}/public/quick-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'leads',
        key: tempIntakeToken,
        payload: {
          name: 'Quick Added Lead',
          phone: '9999900005',
          status: 'Cold'
        }
      })
    });
    if (resAdd.status !== 200) {
      const errBody = await resAdd.text();
      throw new Error(`Expected 200 OK for Quick Add using temporary token, got ${resAdd.status}. Error: ${errBody}`);
    }

    // 3. Submit Quick-Add with invalid key -> should fail
    const resFail = await fetch(`${BASE_URL}/public/quick-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        module: 'leads',
        key: 'invalid_expired_token_signature',
        payload: {
          name: 'Unauthorized Lead',
          phone: '9999900006',
          status: 'Cold'
        }
      })
    });
    if (resFail.status !== 403) {
      throw new Error(`Expected 403 Forbidden for invalid Quick Add token key, got: ${resFail.status}`);
    }
  });

  // --- TEST CASE 7: Uploads ---
  await testCase('Files Upload Endpoint', async () => {
    // Create simple mock text file buffer payload
    const boundary = '----TestBoundary' + Math.random().toString(16);
    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        fileName: 'test.txt',
        base64Data: Buffer.from('Hello World Test File Content').toString('base64')
      })
    });
    
    if (res.status !== 200) {
      const txt = await res.text();
      throw new Error(`Expected 200 OK for file uploads, got: ${res.status}. Body: ${txt}`);
    }
    const data = await res.json();
    if (!data.fileUrl) {
      throw new Error('Upload response did not return a valid fileUrl path');
    }
  });

  // --- TEST CASE 8: Lead Conversion ---
  await testCase('Lead Conversion Pipeline Workflow', async () => {
    // 1. Create a lead to convert
    const lead = await pool.query(
      `INSERT INTO leads (id, name, phone, email, "assignedEmployeeId", status)
       VALUES ('LEAD-TEST-CONVERT', 'Convertible Lead', '9999900007', 'convert@gagan.com', $1, 'Warm') RETURNING *`,
      [TEST_EMP_ID]
    );

    // 2. Insert test property
    await pool.query(
      `INSERT INTO properties (id, "propertyName", status)
       VALUES ('TEST-PROP-CONVERT', 'Test Property to Convert', 'Available')`
    );

    // 3. Create a deal to convert
    const resConvert = await fetch(`${BASE_URL}/data/deals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        id: 'TEST-DEAL-CONVERT',
        customerId: 'LEAD-TEST-CONVERT',
        sellerCustomerId: 'LEAD-TEST-CONVERT',
        propertyId: 'TEST-PROP-CONVERT',
        employeeId: TEST_EMP_ID,
        status: 'Closed',
        registrationDate: '2026-08-03'
      })
    });

    if (resConvert.status !== 200 && resConvert.status !== 201) {
      const errTxt = await resConvert.text();
      throw new Error(`Lead conversion to customer via deal failed with status: ${resConvert.status}. Error: ${errTxt}`);
    }

    // Verify lead status got automatically updated to Converted
    const leadCheck = await pool.query("SELECT status FROM leads WHERE id = 'LEAD-TEST-CONVERT'");
    if (!leadCheck.rows[0] || leadCheck.rows[0].status !== 'Converted') {
      throw new Error(`Lead status was not updated to 'Converted', got: ${leadCheck.rows[0]?.status}`);
    }

    // Verify customer record was successfully created with lead's phone number
    const custCheck = await pool.query("SELECT * FROM customers WHERE phone = '9999900007'");
    if (custCheck.rows.length === 0) {
      throw new Error('Customer record was not successfully created from lead details during conversion');
    }
  });

  // Print results summary dashboard
  console.log('\n==================================================');
  console.log('🏁                  TEST RESULTS                  ');
  console.log('==================================================');
  let passedCount = 0;
  results.forEach(r => {
    if (r.passed) {
      console.log(`✅ [PASS] - ${r.name}`);
      passedCount++;
    } else {
      console.log(`❌ [FAIL] - ${r.name} (${r.error})`);
    }
  });
  console.log('--------------------------------------------------');
  console.log(`Result: ${passedCount}/${results.length} tests passed.`);
  console.log('==================================================');

  if (passedCount !== results.length) {
    throw new Error('Some test cases failed.');
  }
}

async function main() {
  let exitCode = 0;
  try {
    await setupDatabaseFixtures();
    await startServer();
    await runTests();
    console.log('🎉 All automated tests passed successfully!');
  } catch (err) {
    console.error('💥 Test suite runner encountered critical failure:', err.message);
    exitCode = 1;
  } finally {
    // Kill test server
    if (serverProcess) {
      console.log('🔌 Shutting down test server...');
      serverProcess.kill('SIGINT');
    }
    // Clean up DB
    await cleanupDatabaseFixtures();
    await pool.end();
    process.exit(exitCode);
  }
}

main();
