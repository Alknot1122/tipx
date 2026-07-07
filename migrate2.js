require('dotenv').config();
const { query, pool } = require('./src/config/db');

async function migrate() {
  try {
    console.log('Adding YouTube and Twitter columns...');
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube_username VARCHAR(50)`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_youtube_link BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twitter_username VARCHAR(50)`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_twitter_link BOOLEAN DEFAULT FALSE`);
    
    console.log('Updating user al...');
    const { rowCount } = await query(`
      UPDATE users SET 
        twitch_username = 'alxo9',
        youtube_username = 'alxo9s', 
        show_youtube_link = TRUE, 
        twitter_username = 'alxo9_',
        show_twitter_link = TRUE
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
