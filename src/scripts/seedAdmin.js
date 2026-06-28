#!/usr/bin/env node
/**
 * TipX — Seed Admin Script
 * Usage: node src/scripts/seedAdmin.js <username> <password>
 *
 * Creates the initial master admin account. Run this once after schema migration.
 * Example:
 *   node src/scripts/seedAdmin.js admin supersecretpassword
 */

require('dotenv').config();

const bcrypt = require('bcrypt');
const { query, pool } = require('../config/db');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node src/scripts/seedAdmin.js <username> <password>');
  process.exit(1);
}

if (password.length < 12) {
  console.error('Password must be at least 12 characters long.');
  process.exit(1);
}

(async () => {
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, username, role, created_at`,
      [username.toLowerCase(), hash]
    );
    console.log('✅ Admin account provisioned:');
    console.table(rows[0]);
  } catch (err) {
    console.error('❌ Failed to seed admin:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
