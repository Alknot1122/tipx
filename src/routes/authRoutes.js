const express = require('express');
const router = express.Router();
const { login, refresh, logout, me } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const rateLimiter = require('../middleware/rateLimiter');

// Rate limiter: Max 5 login attempts per 15 minutes per IP
const loginLimiter = rateLimiter(15 * 60 * 1000, 5, 'Too many login attempts from this IP. Please try again after 15 minutes.');

// Rate limiter: Max 30 refresh attempts per 15 minutes per IP (generous for auto-refresh)
const refreshLimiter = rateLimiter(15 * 60 * 1000, 30, 'Too many refresh attempts. Please try again later.');

// Rate limiter: Max 60 me-checks per minute (dashboard polling)
const meLimiter = rateLimiter(60 * 1000, 60, 'Too many requests. Please slow down.');

router.post('/login', loginLimiter, login);
router.post('/refresh', refreshLimiter, refresh);
router.post('/logout', logout);
router.get('/me', meLimiter, requireAuth, me);

module.exports = router;
