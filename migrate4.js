require('dotenv').config();
const { query, pool } = require('./src/config/db');

async function migrate() {
  try {
    console.log('Adding theme_preset column...');
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preset VARCHAR(20) DEFAULT 'dark'`);
    
    console.log('Updating user al...');
    const { rowCount } = await query(`
      UPDATE users SET 
        theme_preset = 'dark'
      WHERE slug = 'al'
    `);
    
    console.log(`Updated ${rowCount} row(s) for user al.`);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
