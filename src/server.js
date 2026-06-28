require('dotenv').config();

// ── Environment Validation ────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STRIPE_PUBLIC_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'CORS_ORIGIN',
];
const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('[FATAL] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const express  = require('express');
const http     = require('http');
const path     = require('path');
const { Server } = require('socket.io');
const cors     = require('cors');
const helmet   = require('helmet');
const morgan   = require('morgan');
const cookieParser = require('cookie-parser');

const { initWidgetSocket } = require('./websockets/widgetSocket');
const { initDBMaintenance } = require('./utils/dbMaintenance');

// Routes
const authRoutes    = require('./routes/authRoutes');
const adminRoutes   = require('./routes/adminRoutes');
const streamerRoutes = require('./routes/streamerRoutes');
const publicRoutes  = require('./routes/publicRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const widgetRoutes  = require('./routes/widgetRoutes');
const uploadRoutes  = require('./routes/uploadRoutes');

// ── App Init ──────────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);

// ── Socket.io ─────────────────────────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

initWidgetSocket(io);
initDBMaintenance();

// ── Global Middleware ─────────────────────────────────────────────────────────

// IMPORTANT: webhookRoutes must be mounted BEFORE express.json() parses the body
// (express.raw() is applied inside webhookRoutes.js only for that specific endpoint)
app.use('/webhooks/stripe', webhookRoutes);
app.use('/api/webhooks/stripe', webhookRoutes);

// Security with strict Content Security Policy (CSP)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://js.stripe.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: [
        "'self'",
        "data:",
        process.env.CLOUDFLARE_R2_PUBLIC_URL || "https://*.r2.dev",
        "https://*.stripe.com",
        "https://images.unsplash.com"
      ],
      mediaSrc: [
        "'self'",
        "https://*.mixkit.co",
        "https://assets.mixkit.co",
        process.env.CLOUDFLARE_R2_PUBLIC_URL || "https://*.r2.dev"
      ],
      connectSrc: [
        "'self'",
        "ws:",
        "wss:",
        "https://api.stripe.com",
        "https://*.r2.dev"
      ],
      frameSrc: ["'self'", "https://js.stripe.com", "https://*.stripe.com"],
      objectSrc: ["'none'"],
    },
  },
}));

// CORS — strict: only allow our own domain
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Static Files ──────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '../public')));

// ── Widget Routes ─────────────────────────────────────────────────────────────

app.use('/widget', widgetRoutes);
app.use('/public/widget', widgetRoutes);

// ── API Routes (prefixed with /api/) ──────────────────────────────────────────

app.use('/api/auth',       authRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/dashboard',  streamerRoutes);
app.use('/api/dashboard',  uploadRoutes);
app.use('/api/public',     publicRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// Middleware to disable caching for HTML pages to ensure new scripts/styles load immediately
const noCache = (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
};

// ── HTML Page Routes ──────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.redirect(302, process.env.ROOT_REDIRECT_URL || 'https://re-codex.com');
});

app.get('/login', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/login.html'));
});

app.get('/dashboard', noCache, (req, res) => {
  const jwt = require('jsonwebtoken');
  const token = req.cookies?.access_token;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload && payload.role === 'streamer') {
        return res.redirect(302, `/dashboard/${payload.slug}`);
      }
    } catch (err) {
      // Let client-side requireAdmin handle rotation and redirects
    }
  }
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

app.get('/dashboard/:slug', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/dashboard.html'));
});

// Any other single-level URL slug serves the Streamer Public Donation Page
app.get('/:slug', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/donate.html'));
});

// ── 404 Catch-all ─────────────────────────────────────────────────────────────

app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));

// ── Error Handler ─────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[Server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

// Global safety net — catch unhandled promise rejections
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled Rejection:', reason);
});

// Graceful shutdown on SIGTERM/SIGINT (Docker, Render, Ctrl+C)
const shutdown = async (signal) => {
  console.log(`\n[Server] ${signal} received — shutting down gracefully...`);
  const { pool } = require('./config/db');
  try { await pool.end(); } catch (_) {}
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = parseInt(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`🚀 TipX backend running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});

module.exports = { app, server };
