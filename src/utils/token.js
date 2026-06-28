const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query } = require('../config/db');

// ── Helpers ───────────────────────────────────────────────────────────────────

const parseDuration = (str) => {
  const match = str && String(str).match(/^(\d+)(d|h|m)$/);
  if (!match) return 30; // default 30 days
  const val = parseInt(match[1]);
  switch (match[2]) {
    case 'd': return val;
    case 'h': return Math.ceil(val / 24);
    case 'm': return Math.ceil(val / 1440);
    default: return 30;
  }
};

// ── JWT Access Token ─────────────────────────────────────────────────────────

/**
 * Sign a short-lived access token.
 * @param {object} payload - { id, username, role, slug }
 */
const signAccessToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    issuer: 'tipx',
  });

/**
 * Verify an access token. Returns decoded payload or throws.
 */
const verifyAccessToken = (token) =>
  jwt.verify(token, process.env.JWT_SECRET, { issuer: 'tipx' });

// ── Refresh Token ─────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random refresh token and store its hash in DB.
 * Returns the raw token (to be sent in an HTTP-only cookie).
 */
const generateRefreshToken = async (userId) => {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const days = parseDuration(process.env.REFRESH_TOKEN_EXPIRES_IN);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return rawToken;
};

/**
 * Verify a refresh token against the DB. Returns the user row or null.
 */
const verifyRefreshToken = async (rawToken) => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const { rows } = await query(
    `SELECT rt.user_id, u.username, u.role, u.slug, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND rt.expires_at > NOW()`,
    [tokenHash]
  );

  return rows[0] || null;
};

/**
 * Revoke a single refresh token (on logout or rotation).
 */
const revokeRefreshToken = async (rawToken) => {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await query(`DELETE FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]);
};

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
};
