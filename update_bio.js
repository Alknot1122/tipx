require('dotenv').config();
const { query, pool } = require('./src/config/db');

const newBio = `I'm AL. I do music covers on youtube/alxo9s and make original songs with my band, Re:codeX.
I stream in the Just Chatting category on Twitch—mostly just hanging out, telling stories, playing some casual games, and responding to tips. I'll try my best to read and reply to every single tip, but I apologize in advance if I accidentally miss any!

So glad to meet you all and welcome to the stream.
Thank you so much for your support!`;

async function updateBio() {
  try {
    const { rowCount } = await query(`UPDATE users SET bio_text = $1 WHERE slug = 'al'`, [newBio]);
    console.log(`Updated ${rowCount} row(s)`);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
updateBio();
