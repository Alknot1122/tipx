require('dotenv').config();
const { query, pool } = require('./src/config/db');

async function migrate() {
  try {
    console.log('Adding youtube_video_url and show_youtube_video columns...');
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS youtube_video_url VARCHAR(512)`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_youtube_video BOOLEAN DEFAULT FALSE`);
    
    console.log('Updating user al...');
    const { rowCount } = await query(`
      UPDATE users SET 
        youtube_video_url = 'https://youtu.be/X2lWdEQIRTc?si=5p8d4jZr-Uoh894g',
        show_youtube_video = TRUE
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
