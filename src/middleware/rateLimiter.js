/**
 * TipX — Lightweight Custom Rate Limiter Middleware
 * Protects login and payment endpoints from brute-force and card-testing attacks
 * without external dependency bloat.
 */

const rateLimitStore = {};

/**
 * Custom Rate Limiter Middleware Creator
 * @param {number} windowMs Time window in milliseconds
 * @param {number} maxRequests Maximum requests allowed per IP in the time window
 * @param {string} message Custom error message
 */
const rateLimiter = (windowMs = 15 * 60 * 1000, maxRequests = 100, message = 'Too many requests. Please try again later.') => {
  // Clean up memory leaks periodically
  setInterval(() => {
    const now = Date.now();
    for (const ip in rateLimitStore) {
      rateLimitStore[ip] = rateLimitStore[ip].filter(timestamp => now - timestamp < windowMs);
      if (rateLimitStore[ip].length === 0) {
        delete rateLimitStore[ip];
      }
    }
  }, 10 * 60 * 1000).unref(); // runs every 10 mins without holding node process

  return (req, res, next) => {
    // Retrieve correct client IP even behind proxies (Cloudflare/Nginx)
    const rawFwd = req.headers['x-forwarded-for'];
    const ip = rawFwd ? rawFwd.split(',')[0].trim() : (req.socket.remoteAddress || req.ip);
    const now = Date.now();

    if (!rateLimitStore[ip]) {
      rateLimitStore[ip] = [];
    }

    // Filter timestamps inside current window
    rateLimitStore[ip] = rateLimitStore[ip].filter(timestamp => now - timestamp < windowMs);

    if (rateLimitStore[ip].length >= maxRequests) {
      return res.status(429).json({ error: message });
    }

    rateLimitStore[ip].push(now);
    next();
  };
};

module.exports = rateLimiter;
