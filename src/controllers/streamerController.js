const { query } = require('../config/db');
const stripe = require('../config/stripe');
const { getIO } = require('../websockets/widgetSocket');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client } = require('../config/r2');

// ── GET /dashboard/:slug ──────────────────────────────────────────────────────
// Returns streamer profile + widget settings + recent donation summary

const getDashboard = async (req, res) => {
  const { slug } = req.params;
  const crypto = require('crypto');

  try {
    const { rows: userRows } = await query(
      `SELECT u.id, u.role, u.username, u.slug, u.email,
              u.stripe_account_id, u.stripe_onboarding_done,
              u.avatar_url, u.bg_color, u.bg_image_url,
              ws.alert_token, ws.alert_config, ws.progress_config,
              ws.goal_amount, ws.goal_current, ws.goal_start_date
       FROM users u
       LEFT JOIN widget_settings ws ON ws.streamer_id = u.id
       WHERE u.slug = $1 AND (u.role = 'streamer' OR u.role = 'admin') AND u.is_active = true`,
      [slug]
    );

    if (!userRows.length) return res.status(404).json({ error: 'Not found.' });
    
    let dashboard = userRows[0];

    // Admin user 'al' uses platform Stripe — no Connect needed, but show as ready
    if (dashboard.role === 'admin' || dashboard.username === 'al') {
      dashboard.stripe_onboarding_done = true;
    }
    
    // Auto-provision widget settings on the fly if missing (useful for seeded admin AL)
    if (!dashboard.alert_token) {
      const alertToken = crypto.randomBytes(32).toString('hex');
      await query(
        `INSERT INTO widget_settings (streamer_id, alert_token)
         VALUES ($1, $2)
         ON CONFLICT (streamer_id) DO NOTHING`,
        [dashboard.id, alertToken]
      );
      
      // Fetch again with the newly created widget settings
      const { rows: updatedRows } = await query(
        `SELECT u.id, u.role, u.username, u.slug, u.email,
                u.stripe_account_id, u.stripe_onboarding_done,
                u.avatar_url, u.bg_color, u.bg_image_url,
                ws.alert_token, ws.alert_config, ws.progress_config,
                ws.goal_amount, ws.goal_current, ws.goal_start_date
         FROM users u
         LEFT JOIN widget_settings ws ON ws.streamer_id = u.id
         WHERE u.id = $1`,
        [dashboard.id]
      );
      dashboard = updatedRows[0];
      if (dashboard.role === 'admin' || dashboard.username === 'al') {
        dashboard.stripe_onboarding_done = true;
      }
    }
    
    return res.json({ dashboard });
  } catch (err) {
    console.error('[Streamer] getDashboard error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── GET /dashboard/:slug/donations ────────────────────────────────────────────
// Paginated donation history for the streamer's transaction log

const getDonations = async (req, res) => {
  const { slug } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const offset = parseInt(req.query.offset) || 0;

  try {
    // Resolve slug → streamer_id
    const { rows: userRows } = await query(
      `SELECT id FROM users WHERE slug = $1 AND (role = 'streamer' OR role = 'admin')`,
      [slug]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Not found.' });
    const streamerId = userRows[0].id;

    const { rows: donations } = await query(
      `SELECT id, donor_name, message, amount, currency,
              platform_fee, stripe_fee_estimated, net_to_streamer,
              stripe_payment_intent, stripe_charge_id, status, is_replayed, created_at
       FROM donations
       WHERE streamer_id = $1 AND status = 'succeeded'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [streamerId, limit, offset]
    );

    const { rows: countRows } = await query(
      `SELECT COUNT(*)::INT as total FROM donations WHERE streamer_id = $1 AND status = 'succeeded'`,
      [streamerId]
    );

    return res.json({ donations, total: countRows[0].total, limit, offset });
  } catch (err) {
    console.error('[Streamer] getDonations error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── POST /dashboard/:slug/donations/test-alert ────────────────────────────────
const testAlert = async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows: userRows } = await query(
      `SELECT id FROM users WHERE slug = $1`,
      [slug]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Not found.' });
    const streamerId = userRows[0].id;

    const { rows: wsRows } = await query(
      `SELECT alert_config, progress_config, goal_amount, goal_current
       FROM widget_settings WHERE streamer_id = $1`,
      [streamerId]
    );
    const ws = wsRows[0] || {};

    const io = require('../websockets/widgetSocket').getIO();
    io.to(`streamer:${streamerId}`).emit('donation:alert', {
      type: 'test',
      donation: {
        id: 0,
        donor_name: 'TipX',
        message: '🎉 Test Alert — your widget is working!',
        amount: 5000,
        currency: 'THB',
        created_at: new Date().toISOString(),
      },
      alert_config: ws.alert_config || {},
      progress: {
        goal_amount: ws.goal_amount || 0,
        goal_current: ws.goal_current || 0,
        config: ws.progress_config || {},
      },
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Streamer] testAlert error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};
// Re-broadcast a past donation alert to the OBS widget

const replayDonation = async (req, res) => {
  const { slug, id } = req.params;

  try {
    const { rows } = await query(
      `SELECT d.*, ws.alert_token, ws.alert_config
       FROM donations d
       JOIN users u ON u.id = d.streamer_id
       JOIN widget_settings ws ON ws.streamer_id = d.streamer_id
       WHERE d.id = $1 AND u.slug = $2 AND d.status = 'succeeded'`,
      [id, slug]
    );

    if (!rows.length) return res.status(404).json({ error: 'Donation not found.' });
    const donation = rows[0];

    // Mark as replayed
    await query(`UPDATE donations SET is_replayed = true WHERE id = $1`, [id]);

    // Emit re-alert over WebSocket to the streamer's room
    const io = getIO();
    io.to(`streamer:${donation.streamer_id}`).emit('donation:alert', {
      type: 'replay',
      donation: {
        id: donation.id,
        donor_name: donation.donor_name,
        message: donation.message,
        amount: donation.amount,
        currency: donation.currency,
        created_at: donation.created_at,
      },
      config: donation.alert_config,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('[Streamer] replayDonation error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── DELETE /dashboard/:slug/donations/:id ─────────────────────────────────────
const deleteDonation = async (req, res) => {
  const { slug, id } = req.params;

  try {
    const { rowCount } = await query(
      `DELETE FROM donations d
       USING users u
       WHERE d.id = $1 AND u.slug = $2 AND d.streamer_id = u.id`,
      [id, slug]
    );

    if (!rowCount) return res.status(404).json({ error: 'Donation not found.' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Streamer] deleteDonation error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── PUT /dashboard/:slug/widget ───────────────────────────────────────────────
// Update widget configuration (alert + progress bar settings)

const updateWidgetSettings = async (req, res) => {
  const { slug } = req.params;
  const { alert_config, progress_config, goal_amount, goal_start_date } = req.body;

  try {
    const { rows: userRows } = await query(
      `SELECT id FROM users WHERE slug = $1 AND (role = 'streamer' OR role = 'admin')`,
      [slug]
    );
    if (!userRows.length) return res.status(404).json({ error: 'Not found.' });
    const streamerId = userRows[0].id;

    const updates = [];
    const values = [];
    let idx = 1;

    if (alert_config !== undefined) {
      updates.push(`alert_config = $${idx++}`);
      values.push(JSON.stringify(alert_config));
    }
    if (progress_config !== undefined) {
      updates.push(`progress_config = $${idx++}`);
      values.push(JSON.stringify(progress_config));
    }
    if (goal_amount !== undefined) {
      updates.push(`goal_amount = $${idx++}`);
      values.push(parseInt(goal_amount));
    }
    if (goal_start_date !== undefined) {
      updates.push(`goal_start_date = $${idx++}`);
      values.push(goal_start_date || null);
    }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

    values.push(streamerId);
    const { rows } = await query(
      `UPDATE widget_settings SET ${updates.join(', ')} WHERE streamer_id = $${idx} RETURNING *`,
      values
    );

    // Recalculate goal_current from history if start date was set/changed
    if (goal_start_date !== undefined) {
      const { rows: recalc } = await query(
        `SELECT COALESCE(SUM(amount), 0)::INT as total FROM donations
         WHERE streamer_id = $1 AND status = 'succeeded' AND created_at >= $2`,
        [streamerId, goal_start_date || '1970-01-01']
      );
      await query(
        `UPDATE widget_settings SET goal_current = $1 WHERE streamer_id = $2`,
        [recalc[0].total, streamerId]
      );
      rows[0].goal_current = recalc[0].total;
    }

    return res.json({ settings: rows[0] });
  } catch (err) {
    console.error('[Streamer] updateWidgetSettings error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── GET /dashboard/:slug/stripe/onboard ───────────────────────────────────────
// Generate a Stripe Connect onboarding link

const getStripeOnboardingLink = async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await query(
      `SELECT id, stripe_account_id FROM users WHERE slug = $1 AND (role = 'streamer' OR role = 'admin')`,
      [slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found.' });
    const user = rows[0];

    let accountId = user.stripe_account_id;

    // Create Stripe Standard account if not yet created (required for Stripe Thailand compliance)
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
      });
      accountId = account.id;
      await query(`UPDATE users SET stripe_account_id = $1 WHERE id = $2`, [accountId, user.id]);
    } else {
      // Account already exists — check if it's already activated (webhook may have run)
      try {
        const acc = await stripe.accounts.retrieve(accountId);
        if (acc.charges_enabled && acc.details_submitted) {
          await query(`UPDATE users SET stripe_onboarding_done = true WHERE id = $1`, [user.id]);
          return res.json({ already_connected: true, message: 'Stripe account is already connected.' });
        }
      } catch (_) { /* account retrieval failed — proceed with onboarding link */ }
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.CORS_ORIGIN}/dashboard/${slug}/stripe/onboard`,
      return_url: `${process.env.CORS_ORIGIN}/dashboard/${slug}`,
      type: 'account_onboarding',
    });

    return res.json({ url: accountLink.url });
  } catch (err) {
    console.error('[Streamer] getStripeOnboardingLink error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── PUT /dashboard/:slug/profile ──────────────────────────────────────────────
// Helper to delete an object from Cloudflare R2 given its public URL
const deleteR2FileByUrl = async (url) => {
  if (!url) return;
  const publicUrl = process.env.CLOUDFLARE_R2_PUBLIC_URL;
  if (!publicUrl) return;

  const normPublic = publicUrl.replace(/\/$/, '');
  if (url.startsWith(normPublic)) {
    const key = url.substring(normPublic.length).replace(/^\//, '');
    try {
      const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME;
      if (!bucketName) return;

      const command = new DeleteObjectCommand({
        Bucket: bucketName,
        Key: key,
      });
      await s3Client.send(command);
      console.log(`[R2] Successfully deleted old file from storage: ${key}`);
    } catch (err) {
      console.error(`[R2] Failed to delete file ${key} from storage:`, err.message);
    }
  }
};

// ── PUT /dashboard/:slug/profile ──────────────────────────────────────────────
// Update profile, handle, background appearance, and optionally the slug
const updateProfile = async (req, res) => {
  const { slug } = req.params;
  const { slug: newSlug, avatar_url, bg_color, bg_image_url } = req.body;

  if (bg_color && !/^#[0-9A-Fa-f]{6}$/.test(bg_color)) {
    return res.status(400).json({ error: 'Invalid background color format. Must be a 6-digit hex color starting with #.' });
  }

  if (newSlug) {
    const cleaned = newSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50);
    if (cleaned.length < 2) {
      return res.status(400).json({ error: 'Handle must be at least 2 characters (letters, numbers, hyphen, underscore).' });
    }
    if (cleaned !== slug && cleaned === 'dashboard') {
      return res.status(400).json({ error: 'That handle is reserved.' });
    }
  }

  try {
    // Fetch current user media files to see if we should delete them
    const { rows: currentRows } = await query(
      `SELECT avatar_url, bg_image_url FROM users WHERE slug = $1`,
      [slug]
    );
    const current = currentRows[0];

    const resolvedSlug = newSlug ? newSlug.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 50) : slug;

    const { rows } = await query(
      `UPDATE users
       SET slug = $1, avatar_url = $2, bg_color = $3, bg_image_url = $4, updated_at = NOW()
       WHERE slug = $5 AND (role = 'streamer' OR role = 'admin') AND is_active = true
       RETURNING id, username, slug, avatar_url, bg_color, bg_image_url`,
      [resolvedSlug, avatar_url || null, bg_color || '#0B0E14', bg_image_url || null, slug]
    );

    if (!rows.length) return res.status(404).json({ error: 'Streamer not found.' });

    // Clean up replaced or removed R2 assets to free up space
    if (current) {
      if (current.avatar_url && current.avatar_url !== avatar_url) {
        await deleteR2FileByUrl(current.avatar_url);
      }
      if (current.bg_image_url && current.bg_image_url !== bg_image_url) {
        await deleteR2FileByUrl(current.bg_image_url);
      }
    }

    return res.json({ profile: rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'That handle is already taken. Choose another.' });
    }
    console.error('[Streamer] updateProfile error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

// ── POST /dashboard/:slug/stripe/unlink ──────────────────────────────────────
// Disconnect/unlink the Stripe connected account
const unlinkStripe = async (req, res) => {
  const { slug } = req.params;

  try {
    const { rows } = await query(
      `UPDATE users
       SET stripe_account_id = NULL, stripe_onboarding_done = FALSE
       WHERE slug = $1 AND is_active = true
       RETURNING id, username, slug, stripe_onboarding_done`,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Streamer not found.' });
    }

    return res.json({
      message: 'Stripe account unlinked successfully.',
      streamer: rows[0],
    });
  } catch (err) {
    console.error('[Streamer] unlinkStripe error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

module.exports = {
  getDashboard,
  getDonations,
  replayDonation,
  deleteDonation,
  testAlert,
  updateWidgetSettings,
  getStripeOnboardingLink,
  updateProfile,
  unlinkStripe,
};
