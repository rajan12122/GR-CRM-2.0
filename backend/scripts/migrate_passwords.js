const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'config', 'db.json');

if (!fs.existsSync(dbPath)) {
  console.error('db.json not found at:', dbPath);
  process.exit(1);
}

try {
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  console.log('Starting employee credentials database migration...');

  if (!db.employees) {
    console.log('No employees array found in database.');
    process.exit(0);
  }

  let count = 0;
  db.employees.forEach(emp => {
    // If the legacy password field exists and is not already a bcrypt hash
    if (emp.password && !emp.password.startsWith('$2a$') && !emp.password.startsWith('$2b$')) {
      console.log(`Hashing credentials for employee: ${emp.name} (${emp.id})`);
      
      const salt = bcrypt.genSaltSync(12);
      emp.passwordHash = bcrypt.hashSync(emp.password, salt);
      emp.tokenVersion = 1;
      
      // Permanently remove the plaintext password property from the database
      delete emp.password;
      count++;
    } else if (!emp.password && !emp.passwordHash) {
      // Disabled by default until set by Admin explicitly
      emp.passwordHash = null;
      emp.tokenVersion = 1;
    }
  });

  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
  console.log(`Success! Migrated ${count} employee passwords to secure bcrypt hashes.`);
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
}
