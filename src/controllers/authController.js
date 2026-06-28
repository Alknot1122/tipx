const bcrypt = require('bcrypt');
const { query } = require('../config/db');
const {
  signAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
} = require('../utils/token');

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
};

// Refresh token duration (days → ms), synced with token.js parseDuration
const REFRESH_DAYS = parseInt(String(process.env.REFRESH_TOKEN_EXPIRES_IN || '30d')) || 30;
const REFRESH_MAX_AGE = REFRESH_DAYS * 24 * 60 * 60 * 1000;

// ── POST /auth/login ──────────────────────────────────────────────────────────

const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const { rows } = await query(
      `SELECT id, username, password_hash, role, slug, is_active
       FROM users WHERE username = $1`,
      [username.toLowerCase().trim()]
    );

    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const payload = { id: user.id, username: user.username, role: user.role, slug: user.slug };
    const accessToken = signAccessToken(payload);
    const refreshToken = await generateRefreshToken(user.id);

    // Access token: short-lived in HTTP-only cookie
    res.cookie('access_token', accessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });

    // Refresh token: configurable duration in HTTP-only cookie (default 30 days)
    res.cookie('refresh_token', refreshToken, { ...COOKIE_OPTS, maxAge: REFRESH_MAX_AGE });

    return res.json({
      user: { id: user.id, username: user.username, role: user.role, slug: user.slug },
    });
  } catch (err) {
    console.error('[Auth] login error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── POST /auth/refresh ────────────────────────────────────────────────────────

const refresh = async (req, res) => {
  const rawToken = req.cookies?.refresh_token;
  if (!rawToken) {
    return res.status(401).json({ error: 'No refresh token.' });
  }

  try {
    const user = await verifyRefreshToken(rawToken);
    if (!user || !user.is_active) {
      res.clearCookie('refresh_token');
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    // Rotate: revoke old, issue new
    await revokeRefreshToken(rawToken);
    const newRefreshToken = await generateRefreshToken(user.user_id);
    const newAccessToken = signAccessToken({
      id: user.user_id,
      username: user.username,
      role: user.role,
      slug: user.slug,
    });

    res.cookie('access_token', newAccessToken, { ...COOKIE_OPTS, maxAge: 15 * 60 * 1000 });
    res.cookie('refresh_token', newRefreshToken, { ...COOKIE_OPTS, maxAge: REFRESH_MAX_AGE });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Auth] refresh error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── POST /auth/logout ─────────────────────────────────────────────────────────

const logout = async (req, res) => {
  const rawToken = req.cookies?.refresh_token;
  if (rawToken) {
    await revokeRefreshToken(rawToken).catch(() => {});
  }
  res.clearCookie('access_token', COOKIE_OPTS);
  res.clearCookie('refresh_token', COOKIE_OPTS);
  return res.json({ ok: true });
};

// ── GET /auth/me ──────────────────────────────────────────────────────────────

const me = async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id, username, role, slug, is_active, stripe_account_id, stripe_onboarding_done
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive.' });
    }
    return res.json({ user });
  } catch (err) {
    console.error('[Auth] me error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = { login, refresh, logout, me };
