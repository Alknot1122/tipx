const { verifyAccessToken } = require('../utils/token');

// ── Cookie Extractor ──────────────────────────────────────────────────────────

/**
 * Reads the access token from the HTTP-Only cookie or Authorization header.
 * Cookie takes precedence (more secure for browser clients).
 */
const extractToken = (req) => {
  if (req.cookies && req.cookies.access_token) {
    return req.cookies.access_token;
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
};

// ── Core Auth Middleware ──────────────────────────────────────────────────────

/**
 * Verifies the JWT and attaches `req.user` = { id, username, role, slug }.
 * Returns 401 if no valid token is present.
 */
const requireAuth = (req, res, next) => {
  const token = extractToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = payload; // { id, username, role, slug }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
};

// ── Role Guards ───────────────────────────────────────────────────────────────

/**
 * Requires role === 'admin'.
 * Compose after requireAuth: router.get('/dashboard', requireAuth, requireAdmin, handler)
 */
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: admin access required.' });
  }
  next();
};

/**
 * Requires role === 'streamer' AND the slug in the route param must match
 * the authenticated user's own slug (or user is admin).
 *
 * Route must have `:slug` param.
 */
const requireSelf = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  // Admins may access any streamer dashboard
  if (req.user.role === 'admin') {
    return next();
  }

  const routeSlug = req.params.slug;
  if (req.user.role === 'streamer' && req.user.slug === routeSlug) {
    return next();
  }

  // Return 404 (not 403) to avoid revealing that the route exists
  return res.status(404).json({ error: 'Not found.' });
};

module.exports = { requireAuth, requireAdmin, requireSelf };
