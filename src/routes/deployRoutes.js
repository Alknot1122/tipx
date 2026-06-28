const express = require('express');
const crypto = require('crypto');
const { exec } = require('child_process');
const router = express.Router();

const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '';

/**
 * POST /api/deploy — GitHub push webhook auto-deploy
 * Must be mounted BEFORE express.json() for raw body HMAC verification.
 */
router.post('/', express.raw({ type: 'application/json', limit: '16kb' }), (req, res) => {
  const sig = req.headers['x-hub-signature-256'] || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', DEPLOY_SECRET).update(req.body).digest('hex');

  if (!DEPLOY_SECRET || sig.length !== expected.length) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
  } catch (_) {
    return res.status(403).json({ error: 'Forbidden.' });
  }

  exec(
    'cd /opt/tipx && git fetch origin && git reset --hard origin/main && npm install --production && pm2 restart tipx > /tmp/deploy.log 2>&1 &',
    (err, stdout, stderr) => {
      if (err) console.error('[Deploy] error:', stderr || err.message);
      else console.log('[Deploy] started successfully');
    }
  );
  res.json({ ok: true, message: 'Deploy triggered.' });
});

module.exports = router;
