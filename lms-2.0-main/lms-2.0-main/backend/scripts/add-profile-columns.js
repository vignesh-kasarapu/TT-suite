// One-off dev migration: adds the self-service "personal details" + avatar columns to `users`.
// Run once: node scripts/add-profile-columns.js
// (Production would apply this via a versioned migration per NFR-23 — see server.js's sync() comment.)
const sequelize = require('../src/config/database');

const COLUMNS = [
  ['phone', 'VARCHAR(30) NULL'],
  ['personal_email', 'VARCHAR(255) NULL'],
  ['date_of_birth', 'DATE NULL'],
  ['emergency_contact_name', 'VARCHAR(150) NULL'],
  ['emergency_contact_phone', 'VARCHAR(30) NULL'],
  ['avatar_path', 'VARCHAR(500) NULL'],
];

(async () => {
  try {
    const [existing] = await sequelize.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'",
    );
    const existingNames = new Set(existing.map((r) => r.COLUMN_NAME));
    const missing = COLUMNS.filter(([name]) => !existingNames.has(name));

    if (!missing.length) {
      console.log('OK: all columns already present, nothing to do.');
      return;
    }

    const clauses = missing.map(([name, def]) => `ADD COLUMN ${name} ${def}`).join(', ');
    await sequelize.query(`ALTER TABLE users ${clauses}`);
    console.log(`OK: added columns [${missing.map(([n]) => n).join(', ')}] to users.`);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
