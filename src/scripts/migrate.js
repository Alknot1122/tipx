#!/usr/bin/env node
/**
 * TipX — Database Migration Script
 * Applies schema.sql to the configured PostgreSQL database.
 * Usage: node src/scripts/migrate.js
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { pool } = require('../config/db');

(async () => {
  const schemaPath = path.resolve(__dirname, '../../schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    console.log('⏳ Running migration...');
    await client.query(sql);
    console.log('✅ Migration complete.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
