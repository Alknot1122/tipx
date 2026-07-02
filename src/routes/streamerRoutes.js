const express = require('express');
const router = express.Router();
const { requireAuth, requireSelf } = require('../middleware/auth');
const {
  getDashboard,
  getTips,
  replayTip,
  deleteTip,
  testAlert,
  toggleSelfActive,
  updateWidgetSettings,
  getStripeOnboardingLink,
  updateProfile,
  unlinkStripe,
} = require('../controllers/streamerController');

// All streamer dashboard routes require auth + ownership (or admin)
router.use('/:slug', requireAuth, requireSelf);

router.get('/:slug',                          getDashboard);
router.get('/:slug/tips',                getTips);
router.post('/:slug/tips/test-alert',     testAlert);
router.post('/:slug/toggle-active',              toggleSelfActive);
router.post('/:slug/tips/:id/replay',    replayTip);
router.delete('/:slug/tips/:id',           deleteTip);
router.put('/:slug/widget',                   updateWidgetSettings);
router.get('/:slug/stripe/onboard',           getStripeOnboardingLink);
router.post('/:slug/stripe/unlink',          unlinkStripe);
router.put('/:slug/profile',                  updateProfile);

module.exports = router;
