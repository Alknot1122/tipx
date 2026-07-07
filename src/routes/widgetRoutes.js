const express = require('express');
const router = express.Router();
const { query } = require('../config/db');

/**
 * GET /widget/alert?token=XYZ
 * Returns the OBS Alert Box HTML page.
 */
router.get('/alert', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token.');

  try {
    const { rows } = await query(
      `SELECT ws.streamer_id, ws.alert_config
       FROM widget_settings ws WHERE ws.alert_token = $1`,
      [token]
    );
    if (!rows.length) return res.status(404).send('Invalid token.');

    const config = rows[0].alert_config;
    res.setHeader('Content-Type', 'text/html');
    res.send(generateAlertBoxHTML(token, config));
  } catch (err) {
    console.error('[Widget] alert route error:', err.message);
    res.status(500).send('Internal server error.');
  }
});

/**
 * GET /widget/progress?token=XYZ
 * Returns the OBS Progress Bar HTML page.
 */
router.get('/progress', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('Missing token.');

  try {
    const { rows } = await query(
      `SELECT ws.streamer_id, ws.progress_config, ws.goal_amount, ws.goal_current
       FROM widget_settings ws WHERE ws.alert_token = $1`,
      [token]
    );
    if (!rows.length) return res.status(404).send('Invalid token.');

    const { progress_config, goal_amount, goal_current } = rows[0];
    res.setHeader('Content-Type', 'text/html');
    res.send(generateProgressBarHTML(token, progress_config, goal_amount, goal_current));
  } catch (err) {
    console.error('[Widget] progress route error:', err.message);
    res.status(500).send('Internal server error.');
  }
});

module.exports = router;

// ── HTML Generators ───────────────────────────────────────────────────────────

const generateAlertBoxHTML = (token, config) => {
  const cfg = {
    duration_ms: 5000,
    gif_url: '',
    sound_url: '',
    font_family: 'Inter',
    font_size: 32,
    text_color: '#FFFFFF',
    bg_color: 'transparent',
    min_amount_to_show: 0,
    ...config,
  };

  // Sanitize font_family: only allow letters, digits, spaces, hyphens, commas
  cfg.font_family = (cfg.font_family || 'Inter').replace(/[^a-zA-Z0-9 ,_-]/g, '').slice(0, 100) || 'Inter';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TipX Alert Box</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(cfg.font_family)}:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${cfg.bg_color};
      font-family: '${cfg.font_family}', sans-serif;
      color: ${cfg.text_color};
      overflow: hidden;
      width: 100vw; height: 100vh;
      display: flex; align-items: center; justify-content: center;
    }
    #alert-box {
      display: none;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 500px;
    }
    #alert-box.show {
      display: flex;
      animation: slideInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    #alert-box.fade-out {
      animation: slideOutUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    #alert-gif {
      max-width: 280px;
      max-height: 200px;
      border-radius: 12px;
      margin-bottom: 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    #alert-text {
      font-size: ${cfg.font_size}px;
      font-weight: 700;
      line-height: 1.2;
      color: #FFFFFF; /* Pure, static clean white */
      text-shadow: 2px 2px 6px rgba(0,0,0,0.9);
      margin-bottom: 4px;
    }
    #alert-message {
      font-size: ${Math.round(cfg.font_size * 0.62)}px;
      font-weight: 500;
      color: #E5E7EB;
      text-shadow: 2px 2px 6px rgba(0,0,0,0.9);
      max-width: 450px;
      word-break: break-word;
      margin-top: 8px;
    }
    @keyframes slideInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes slideOutUp {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(-30px); }
    }
  </style>
</head>
<body>
  <div id="alert-box">
    <img id="alert-gif" src="" alt="" style="display:none">
    <div id="alert-text"></div>
    <div id="alert-message"></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const CONFIG = ${JSON.stringify(cfg)};
    const TOKEN  = ${JSON.stringify(token)};
    const socket = io('/widget', { query: { token: TOKEN }, transports: ['websocket'] });
    const box    = document.getElementById('alert-box');
    const gif    = document.getElementById('alert-gif');
    const text   = document.getElementById('alert-text');
    const msg    = document.getElementById('alert-message');

    let queue = [];
    let showing = false;

    socket.on('connect', () => console.log('[TipX Alert] Connected'));
    socket.on('disconnect', () => console.log('[TipX Alert] Disconnected'));

    socket.on('tip:alert', (data) => {
      const tip = data.tip;
      if (tip.amount < CONFIG.min_amount_to_show) return;
      queue.push(data);
      if (!showing) processQueue();
    });

    function processQueue() {
      if (!queue.length) { showing = false; return; }
      showing = true;
      const data = queue.shift();
      showAlert(data);
    }

    function showAlert(data) {
      const tip = data.tip;
      const cfg = data.alert_config || CONFIG;
      const amountDisplay = (tip.amount / 100).toLocaleString('th-TH', { style: 'currency', currency: tip.currency });

      text.textContent = \`\${tip.tipper_name} tipped \${amountDisplay}!\`;
      if (tip.message && tip.message.trim()) {
        msg.textContent = tip.message.trim();
        msg.style.display = 'block';
      } else {
        msg.textContent = '';
        msg.style.display = 'none';
      }

      if (cfg.gif_url) {
        gif.src = cfg.gif_url;
        gif.style.display = 'block';
      } else {
        gif.style.display = 'none';
      }

      if (cfg.sound_url) {
        const audio = new Audio(cfg.sound_url);
        audio.play().catch(() => {});
      }

      // Free, Unlimited Built-in Browser TTS (SpeechSynthesis)
      if (cfg.tts_enabled && tip.amount >= (cfg.tts_min_amount || 0)) {
        setTimeout(() => {
          const rawAmount = (tip.amount / 100).toFixed(0);
          const volume = cfg.tts_volume !== undefined ? parseFloat(cfg.tts_volume) : 1.0;
          const voices = window.speechSynthesis.getVoices();
          
          function getVoiceForLang(langCode) {
            let voice = voices.find(v => v.lang.toLowerCase() === langCode.toLowerCase());
            if (!voice) {
              const prefix = langCode.split('-')[0].toLowerCase();
              voice = voices.find(v => v.lang.toLowerCase().startsWith(prefix));
            }
            return voice;
          }

          const thVoice = getVoiceForLang('th-TH');

          // 1. Speak Intro in Thai
          const introText = \`\${tip.tipper_name} โดเนท \${rawAmount} บาท. \`;
          const introUtterance = new SpeechSynthesisUtterance(introText);
          introUtterance.volume = volume;
          if (thVoice) {
            introUtterance.voice = thVoice;
          } else {
            introUtterance.lang = 'th-TH';
          }
          window.speechSynthesis.speak(introUtterance);

          // 2. Speak Message (Detect language)
          if (tip.message && tip.message.trim()) {
            const cleanMsg = tip.message.trim();
            
            // Simple regex detection for common stream languages
            let lang = 'en-US';
            if (/[\u0e00-\u0e7f]/.test(cleanMsg)) {
              lang = 'th-TH';
            } else if (/[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(cleanMsg)) {
              lang = 'ja-JP';
            } else if (/[\uac00-\ud7a3]/.test(cleanMsg)) {
              lang = 'ko-KR';
            } else if (/[\u4e00-\u9fff]/.test(cleanMsg)) {
              lang = 'zh-CN';
            }

            // Speak 'ข้อความ' prefix in Thai first
            const prefixUtterance = new SpeechSynthesisUtterance('ข้อความ. ');
            prefixUtterance.volume = volume;
            if (thVoice) {
              prefixUtterance.voice = thVoice;
            } else {
              prefixUtterance.lang = 'th-TH';
            }
            window.speechSynthesis.speak(prefixUtterance);

            // Speak message in its matching language
            const msgUtterance = new SpeechSynthesisUtterance(cleanMsg);
            msgUtterance.volume = volume;
            const msgVoice = getVoiceForLang(lang);
            if (msgVoice) {
              msgUtterance.voice = msgVoice;
            } else {
              msgUtterance.lang = lang;
            }
            window.speechSynthesis.speak(msgUtterance);
          }
        }, 1200);
      }

      box.classList.remove('fade-out');
      box.classList.add('show');

      setTimeout(() => {
        box.classList.add('fade-out');
        setTimeout(() => {
          box.classList.remove('show', 'fade-out');
          processQueue();
        }, 500);
      }, cfg.duration_ms || 7000);
    }
  </script>
</body>
</html>`;
};

const generateProgressBarHTML = (token, config, goalAmount, goalCurrent) => {
  const cfg = {
    goal_label: 'Tip Goal',
    bar_color: '#7C3AED',
    text_color: '#FFFFFF',
    bg_color: '#1a1a2e',
    ...config,
  };

  const percent = goalAmount > 0 ? Math.min((goalCurrent / goalAmount) * 100, 100).toFixed(1) : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>TipX Progress Bar</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: ${cfg.bg_color};
      font-family: 'Inter', sans-serif;
      color: ${cfg.text_color};
      padding: 16px 24px;
      display: flex; flex-direction: column; gap: 8px;
    }
    #goal-label {
      font-size: 18px; font-weight: 700;
      display: flex; justify-content: space-between;
    }
    #bar-track {
      width: 100%; height: 24px;
      background: rgba(255,255,255,0.15);
      border-radius: 12px; overflow: hidden;
    }
    #bar-fill {
      height: 100%;
      background: ${cfg.bar_color};
      border-radius: 12px;
      width: ${percent}%;
      transition: width 1.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 0 12px ${cfg.bar_color}88;
    }
    #percent-label { font-size: 14px; text-align: right; opacity: 0.8; }
  </style>
</head>
<body>
  <div id="goal-label">
    <span>${cfg.goal_label}</span>
    <span id="amounts">${(goalCurrent / 100).toLocaleString()} / ${(goalAmount / 100).toLocaleString()} THB</span>
  </div>
  <div id="bar-track">
    <div id="bar-fill"></div>
  </div>
  <div id="percent-label">${percent}%</div>

  <script src="/socket.io/socket.io.js"></script>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    const socket = io('/widget', { query: { token: TOKEN }, transports: ['websocket'] });

    let current = ${goalCurrent};
    let goal    = ${goalAmount};

    socket.on('tip:alert', (data) => {
      if (!data.progress) return;
      current = data.progress.goal_current;
      goal    = data.progress.goal_amount;
      updateBar();
    });

    function updateBar() {
      const pct = goal > 0 ? Math.min((current / goal) * 100, 100).toFixed(1) : 0;
      document.getElementById('bar-fill').style.width = pct + '%';
      document.getElementById('percent-label').textContent = pct + '%';
      document.getElementById('amounts').textContent =
        (current / 100).toLocaleString() + ' / ' + (goal / 100).toLocaleString() + ' THB';
    }
  </script>
</body>
</html>`;
};
