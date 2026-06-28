require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, pool } = require('../config/db');

(async () => {
  try {
    const username = 'al';
    const password = process.env.AL_ADMIN_PASSWORD || 'ALAdminSecure123!';
    const slug = 'al';
    
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (username, slug, password_hash, role, is_active)
       VALUES ($1, $2, $3, 'admin', true)
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, slug = EXCLUDED.slug, role = EXCLUDED.role
       RETURNING id, username, slug, role, created_at`,
      [username, slug, hash]
    );
    console.log('✅ Admin account AL provisioned:');
    console.table(rows[0]);
  } catch (err) {
    console.error('❌ Failed to seed AL:', err.message);
  } finally {
    await pool.end();
  }
})();
