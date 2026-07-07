require('dotenv').config();
const { query, pool } = require('./src/config/db');

async function migrate() {
  try {
    console.log('Adding columns to users table...');
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS twitch_username VARCHAR(50)`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_twitch_link BOOLEAN DEFAULT FALSE`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS bio_text TEXT`);
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS show_bio BOOLEAN DEFAULT FALSE`);
    
    console.log('Columns added. Updating user al...');
    const bioText = `i'm al. i doing a cover music in youtube/alxo9s and มีออริจินัลซองที่ทำกับวงในนามของ Re:codeX\nผมสตรีมในสไตล์ Just Chatting on twitch คือ พูดคุยกันไปเรื่อยๆ เล่าเรื่องบ้าง เล่นเกมเล็กๆ น้อยๆ บ้าง และตอบติ๊บ ผมจะพยายามตอบทุกติ๊บ ถ้ามีตกหล่นไปบ้างต้องขออภัย\n\nดีใจที่ได้เจอกัน และยินดีที่ได้รู้จักทุกคนนะ\nขอบคุณที่สนับสนุนกันครับ`;
    
    const { rowCount } = await query(`
      UPDATE users SET 
        twitch_username = 'alxo9s', 
        show_twitch_link = TRUE, 
        bio_text = $1,
        show_bio = TRUE
      WHERE slug = 'al'
    `, [bioText]);
    
    console.log(`Updated ${rowCount} row(s) for user al.`);
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
