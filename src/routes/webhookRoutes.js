const express = require('express');
const router = express.Router();
const { handleStripeWebhook } = require('../controllers/webhookController');

/**
 * IMPORTANT: This route uses express.raw() to preserve the raw body buffer
 * required for Stripe webhook signature verification.
 * Do NOT add express.json() middleware before this route.
 */
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), handleStripeWebhook);

module.exports = router;
