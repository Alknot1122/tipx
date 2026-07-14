require('dotenv').config();
const { query, pool } = require('./src/config/db');

async function migrate() {
  try {
    console.log('Adding accept_donations column...');
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS accept_donations BOOLEAN NOT NULL DEFAULT TRUE`);
    console.log('Migration completed successfully.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
