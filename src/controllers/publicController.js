const { query } = require('../config/db');
const stripe = require('../config/stripe');

// ── GET /public/:slug ─────────────────────────────────────────────────────────
// Public page data: returns just enough info for donors to make a payment

const getPublicPage = async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await query(
      `SELECT u.role, u.username, u.slug, u.stripe_account_id, u.stripe_onboarding_done,
              u.avatar_url, u.bg_color, u.bg_image_url,
              ws.goal_amount, ws.goal_current, ws.goal_start_date, ws.progress_config
       FROM users u
       LEFT JOIN widget_settings ws ON ws.streamer_id = u.id
       WHERE u.slug = $1 AND (u.role = 'streamer' OR u.role = 'admin') AND u.is_active = true`,
      [slug]
    );

    if (!rows.length) return res.status(404).json({ error: 'Streamer not found.' });
    const streamer = rows[0];

    // Don't expose stripe_account_id to the public
    delete streamer.stripe_account_id;

    return res.json({
      streamer,
      stripe_public_key: process.env.STRIPE_PUBLIC_KEY
    });
  } catch (err) {
    console.error('[Public] getPublicPage error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── POST /public/:slug/payment-intent ─────────────────────────────────────────
// Create a Stripe Payment Intent and charge the platform fee
// Fee structure:
//   - Stripe PromptPay fee: 1.65% (Stripe charges this automatically; we record it)
//   - TipX platform fee:    0.50% (charged via application_fee_amount)

const PLATFORM_FEE_RATE = 0.005;   // 0.50%
const STRIPE_FEE_RATE   = 0.0165;  // 1.65% (estimation for display/logging)

const createPaymentIntent = async (req, res) => {
  const { slug } = req.params;
  const { amount, donor_name, message, donor_email } = req.body;

  // Validate amount (minimum 2000 satang = 20 THB)
  const amountInt = parseInt(amount);
  if (!amountInt || amountInt < 2000) {
    return res.status(400).json({ error: 'Minimum donation amount is 20 THB (2000 satang).' });
  }
  if (amountInt > 100000000) {
    return res.status(400).json({ error: 'Donation amount too large.' });
  }

  try {
    const { rows } = await query(
      `SELECT id, stripe_account_id, stripe_onboarding_done, role, slug, username
       FROM users WHERE slug = $1 AND (role = 'streamer' OR role = 'admin') AND is_active = true`,
      [slug]
    );

    if (!rows.length) return res.status(404).json({ error: 'Streamer not found.' });
    const streamer = rows[0];

    // Compute fees (exempt admin users or user 'al')
    const isFeeExempt = streamer.role === 'admin' || streamer.slug === 'al' || streamer.username === 'al';

    // All users need Stripe Connect to receive payments (exempt users get 0% platform fee but still need Connect)
    if (!streamer.stripe_onboarding_done || !streamer.stripe_account_id) {
      return res.status(503).json({ error: 'Streamer is not ready to accept payments.' });
    }
    const platformFee = isFeeExempt ? 0 : Math.ceil(amountInt * PLATFORM_FEE_RATE);
    const stripeFeeEst = Math.ceil(amountInt * STRIPE_FEE_RATE);
    const netToStreamer = amountInt - platformFee - stripeFeeEst;

    // Sanitize donor inputs — strip control/zero-width characters
    const safeDonorName = (donor_name || 'Anonymous').replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]/g, '').slice(0, 50);
    const safeMessage   = (message || '').replace(/[\x00-\x1f\x7f\u200b-\u200f\u2028-\u202f\ufeff]/g, '').slice(0, 255);

    // Create PaymentIntent parameters
    const paymentIntentParams = {
      amount: amountInt,
      currency: 'thb',
      payment_method_types: ['promptpay'],
      metadata: {
        streamer_slug:   slug,
        streamer_id:     String(streamer.id),
        donor_name:      safeDonorName,
        message:         safeMessage,
        donor_email:     donor_email || '',
      },
    };

    if (platformFee > 0) {
      paymentIntentParams.application_fee_amount = platformFee;
    }

    // Create PaymentIntent options — route through connected account if available
    const stripeOptions = {};
    if (streamer.stripe_account_id) {
      stripeOptions.stripeAccount = streamer.stripe_account_id;
    }

    // Idempotency key: client-generated UUID prevents duplicate PI on network retry
    // NOTE: idempotencyKey is a request option (2nd arg), not a PaymentIntent param
    const idempotencyKey = req.body.idempotency_key || undefined;
    if (idempotencyKey) {
      stripeOptions.idempotencyKey = idempotencyKey;
    }

    const paymentIntent = await stripe.paymentIntents.create(
      paymentIntentParams,
      stripeOptions
    );

    return res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      stripe_account_id: streamer.stripe_account_id || null,
    });
  } catch (err) {
    console.error('[Public] createPaymentIntent error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── POST /public/payment-intent/cancel ────────────────────────────────────────
// Cancel the pending Stripe PaymentIntent and clean up any pending donation row
const cancelPaymentIntent = async (req, res) => {
  const { payment_intent_id } = req.body;
  if (!payment_intent_id) {
    return res.status(400).json({ error: 'Missing payment_intent_id.' });
  }

  try {
    // 1. Try to find and remove any pending donation row for this PaymentIntent
    const { rows: donations } = await query(
      `SELECT d.id, d.status, u.stripe_account_id
       FROM donations d
       JOIN users u ON u.id = d.streamer_id
       WHERE d.stripe_payment_intent = $1`,
      [payment_intent_id]
    );

    let stripeAccountId = null;

    if (donations.length) {
      const donation = donations[0];
      stripeAccountId = donation.stripe_account_id;
      // Only delete if still pending
      if (donation.status === 'pending') {
        await query(`DELETE FROM donations WHERE id = $1`, [donation.id]);
      }
    }

    // 2. Cancel on Stripe (runs regardless of DB row existence)
    const stripeOptions = {};
    if (stripeAccountId) {
      stripeOptions.stripeAccount = stripeAccountId;
    }
    try {
      await stripe.paymentIntents.cancel(payment_intent_id, {}, stripeOptions);
    } catch (stripeErr) {
      console.warn('[Public] Stripe paymentIntents.cancel failed (might be already canceled/processed):', stripeErr.message);
    }

    return res.json({ success: true, message: 'Transaction canceled successfully.' });
  } catch (err) {
    console.error('[Public] cancelPaymentIntent error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = { getPublicPage, createPaymentIntent, cancelPaymentIntent };
