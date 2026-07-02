const { query } = require('../config/db');

/**
 * Perform database cleanup operations:
 * 1. Delete expired refresh tokens.
 * 2. Delete stale pending tips (older than 24 hours).
 */
const runMaintenance = async () => {
  const startTime = Date.now();
  console.log('[DB Maintenance] Starting scheduled cleanup...');

  try {
    // 1. Clean up expired refresh tokens
    const tokenRes = await query(
      `DELETE FROM refresh_tokens WHERE expires_at <= NOW()`
    );
    if (tokenRes.rowCount > 0) {
      console.log(`[DB Maintenance] Deleted ${tokenRes.rowCount} expired refresh tokens.`);
    }

    // 2. Clean up stale pending tips older than 24 hours
    // (Stripe PromptPay intents expire in 1 hour or less; 24 hours is extremely safe)
    const tipRes = await query(
      `DELETE FROM tips WHERE status = 'pending' AND created_at < NOW() - INTERVAL '24 hours'`
    );
    if (tipRes.rowCount > 0) {
      console.log(`[DB Maintenance] Deleted ${tipRes.rowCount} stale pending tips.`);
    }

    const duration = Date.now() - startTime;
    console.log(`[DB Maintenance] Cleanup completed in ${duration}ms.`);
  } catch (err) {
    console.error('[DB Maintenance] Error during cleanup:', err.message);
  }
};

/**
 * Initialize maintenance timer.
 * Runs once on startup, then every 12 hours.
 */
const initDBMaintenance = () => {
  // Run on startup (delayed slightly to not block server startup log)
  setTimeout(() => {
    runMaintenance().catch(err => console.error('[DB Maintenance] Startup run failed:', err));
  }, 5000);

  // Set interval for every 12 hours (12 * 60 * 60 * 1000 ms)
  const INTERVAL_MS = 12 * 60 * 60 * 1000;
  setInterval(() => {
    runMaintenance().catch(err => console.error('[DB Maintenance] Interval run failed:', err));
  }, INTERVAL_MS).unref(); // unref so it doesn't prevent Node process from exiting in tests
};

module.exports = {
  runMaintenance,
  initDBMaintenance
};
