const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../config/db');
const stripe = require('../config/stripe');

const SALT_ROUNDS = 12;

// ── POST /admin/streamers ─────────────────────────────────────────────────────
// Provision a new streamer account (admin only)

const createStreamer = async (req, res) => {
  const { username, slug, password, email } = req.body;

  if (!username || !slug || !password) {
    return res.status(400).json({ error: 'username, slug, and password are required.' });
  }

  if (password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters long.' });
  }

  if (!/^[a-z0-9_-]{2,50}$/.test(slug)) {
    return res.status(400).json({
      error: 'slug must be 2-50 chars: lowercase letters, numbers, hyphens, underscores only.',
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user
    const { rows: userRows } = await query(
      `INSERT INTO users (username, slug, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'streamer')
       RETURNING id, username, slug, role, created_at`,
      [username.toLowerCase().trim(), slug.toLowerCase().trim(), email || null, passwordHash]
    );
    const newUser = userRows[0];

    // Provision default widget settings with a random alert_token
    const alertToken = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO widget_settings (streamer_id, alert_token) VALUES ($1, $2)`,
      [newUser.id, alertToken]
    );

    return res.status(201).json({
      streamer: newUser,
      widget_alert_url: `/widget/alert?token=${alertToken}`,
      widget_progress_url: `/widget/progress?token=${alertToken}`,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or slug already exists.' });
    }
    console.error('[Admin] createStreamer error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── GET /admin/streamers ──────────────────────────────────────────────────────
// Master list of all streamers (admin dashboard overview)

const listStreamers = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         u.id, u.username, u.slug, u.email, u.is_active, u.role,
         u.stripe_onboarding_done, u.stripe_account_id, u.created_at,
         ws.goal_amount, ws.goal_current, ws.alert_token,
         COUNT(d.id)::INT            AS total_tips,
         COALESCE(SUM(d.amount), 0)::INT AS total_volume,
         COALESCE(SUM(d.platform_fee), 0)::INT AS total_platform_fee
       FROM users u
       LEFT JOIN widget_settings ws ON ws.streamer_id = u.id
       LEFT JOIN tips d ON d.streamer_id = u.id AND d.status = 'succeeded'
       WHERE u.role = 'streamer' OR u.slug IS NOT NULL
       GROUP BY u.id, ws.streamer_id
       ORDER BY u.created_at DESC`
    );

    return res.json({ streamers: rows });
  } catch (err) {
    console.error('[Admin] listStreamers error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── PATCH /admin/streamers/:id/toggle ────────────────────────────────────────
// Soft-enable or disable a streamer account

const toggleStreamer = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `UPDATE users SET is_active = NOT is_active
       WHERE id = $1 AND role = 'streamer'
       RETURNING id, username, is_active`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Streamer not found.' });
    return res.json({ streamer: rows[0] });
  } catch (err) {
    console.error('[Admin] toggleStreamer error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = { createStreamer, listStreamers, toggleStreamer };
