const stripe = require('../config/stripe');
const { query, transaction } = require('../config/db');
const { getIO } = require('../websockets/widgetSocket');

/**
 * POST /webhooks/stripe
 *
 * Stripe sends webhook events here. The raw body MUST be available
 * for signature verification (use express.raw() on this route, not express.json()).
 */
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,                           // raw Buffer
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.warn('[Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed.' });
  }

  // ── Handle payment_intent.succeeded ────────────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    try { await handlePaymentSucceeded(event.data.object); }
    catch (err) { console.error('[Webhook] handlePaymentSucceeded failed:', err.message); return res.status(500).json({ error: 'Processing failed.' }); }
  }

  // ── Handle payment_intent.canceled ─────────────────────────────────────────
  if (event.type === 'payment_intent.canceled') {
    try { await handlePaymentCanceled(event.data.object); }
    catch (err) { console.error('[Webhook] handlePaymentCanceled failed:', err.message); return res.status(500).json({ error: 'Processing failed.' }); }
  }

  // ── Handle account.updated (Stripe Connect onboarding complete) ────────────
  if (event.type === 'account.updated') {
    try { await handleAccountUpdated(event.data.object); }
    catch (err) { console.error('[Webhook] handleAccountUpdated failed:', err.message); return res.status(500).json({ error: 'Processing failed.' }); }
  }

  // Acknowledge only if all handlers succeeded
  return res.json({ received: true });
};

// ─────────────────────────────────────────────────────────────────────────────

const handlePaymentSucceeded = async (paymentIntent) => {
  const {
    id: piId,
    amount,
    currency,
    metadata,
    charges,
  } = paymentIntent;

  const chargeId = charges?.data?.[0]?.id || null;
  const { streamer_id, tipper_name, message, tipper_email } = metadata || {};

  if (!streamer_id) {
    console.warn('[Webhook] payment_intent.succeeded missing streamer_id metadata:', piId);
    return;
  }

  try {
    await transaction(async (tx) => {
      // Fetch existing pending tip row
      const { rows: existing } = await tx(
        `SELECT * FROM tips WHERE stripe_payment_intent = $1`,
        [piId]
      );

      let tip;

      if (existing.length) {
        // Only update if still pending (idempotent — duplicate webhooks are no-ops)
        const { rows: updated } = await tx(
          `UPDATE tips
           SET status = 'succeeded', stripe_charge_id = $1
           WHERE stripe_payment_intent = $2 AND status = 'pending'
           RETURNING *`,
          [chargeId, piId]
        );
        if (!updated.length) {
          // Already succeeded — duplicate webhook, skip broadcast
          console.log(`[Webhook] Tip for PI ${piId} already succeeded — skipping broadcast.`);
          return;
        }
        tip = updated[0];
      } else {
        // Insert new tip row (normal path after pending-insert removal)
        const { rows: userRows } = await tx(
          `SELECT role, slug, username FROM users WHERE id = $1`,
          [parseInt(streamer_id)]
        );
        const streamer = userRows[0];
        const isFeeExempt = streamer && (streamer.role === 'admin' || streamer.slug === 'al' || streamer.username === 'al');
        const platformFee    = isFeeExempt ? 0 : Math.ceil(amount * 0.005);
        const stripeFeeEst   = Math.ceil(amount * 0.0165);
        const netToStreamer  = amount - platformFee - stripeFeeEst;

        try {
          const { rows: inserted } = await tx(
             `INSERT INTO tips
               (streamer_id, tipper_name, tipper_email, message, amount, currency,
                platform_fee, stripe_fee_estimated, net_to_streamer,
                stripe_payment_intent, stripe_charge_id, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'succeeded')
             RETURNING *`,
            [
              parseInt(streamer_id),
              (tipper_name || 'Anonymous').slice(0, 50),
              tipper_email || null,
              (message || '').slice(0, 255) || null,
              amount,
              (currency || 'THB').toUpperCase(),
              platformFee,
              stripeFeeEst,
              netToStreamer,
              piId,
              chargeId,
            ]
          );
          tip = inserted[0];
        } catch (insertErr) {
          // UNIQUE constraint on stripe_payment_intent — duplicate webhook race
          if (insertErr.code === '23505') {
            console.log(`[Webhook] Tip for PI ${piId} already inserted — skipping.`);
            return;
          }
          throw insertErr;
        }
      }

      // Update progress bar — only count if tip is after goal_start_date (if set)
      await tx(
        `UPDATE widget_settings SET goal_current = 
           CASE WHEN goal_start_date IS NULL OR $3::timestamptz >= goal_start_date
                THEN LEAST(goal_current + $1, goal_amount) ELSE goal_current END
         WHERE streamer_id = $2`,
        [tip.amount, parseInt(streamer_id), tip.created_at]
      );

      // Fetch widget config for the alert payload
      const { rows: wsRows } = await tx(
        `SELECT alert_config, progress_config, goal_amount, goal_current
         FROM widget_settings WHERE streamer_id = $1`,
        [parseInt(streamer_id)]
      );
      const ws = wsRows[0] || {};

      // ── Broadcast to OBS widgets via WebSocket ──────────────────────────────
      const io = getIO();
      const room = `streamer:${streamer_id}`;

      const alertPayload = {
        type: 'new_tip',
        tip: {
          id:           tip.id,
          tipper_name:  tip.tipper_name,
          message:      tip.message,
          amount:       tip.amount,
          currency:     tip.currency,
          created_at:   tip.created_at,
        },
        alert_config:    ws.alert_config || {},
        progress: {
          goal_amount:   ws.goal_amount || 0,
          goal_current:  ws.goal_current || 0,
          config:        ws.progress_config || {},
        },
      };

      io.to(room).emit('tip:alert', alertPayload);
      console.log(`[Webhook] ✅ Tip #${tip.id} broadcast to room ${room}`);
    });
  } catch (err) {
    console.error('[Webhook] handlePaymentSucceeded error:', err.message);
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────────────

const handleAccountUpdated = async (account) => {
  const { id: stripeAccountId, charges_enabled, details_submitted } = account;
  if (!charges_enabled || !details_submitted) return;

  await query(
    `UPDATE users SET stripe_onboarding_done = true WHERE stripe_account_id = $1`,
    [stripeAccountId]
  );
  console.log(`[Webhook] ✅ Stripe account ${stripeAccountId} onboarding complete.`);
};

// ─────────────────────────────────────────────────────────────────────────────

const handlePaymentCanceled = async (paymentIntent) => {
  const { id: piId } = paymentIntent;

  const { rows: existing } = await query(
    `SELECT id, status FROM tips WHERE stripe_payment_intent = $1`,
    [piId]
  );

  if (existing.length && existing[0].status === 'pending') {
    await query(`DELETE FROM tips WHERE id = $1`, [existing[0].id]);
    console.log(`[Webhook] Cleaned up canceled PI ${piId} — pending row deleted.`);
  }
};

module.exports = { handleStripeWebhook };
