const express = require('express');
const router = express.Router();
const { requireAuth, requireSelf } = require('../middleware/auth');
const {
  getDashboard,
  getDonations,
  replayDonation,
  deleteDonation,
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
router.get('/:slug/donations',                getDonations);
router.post('/:slug/donations/test-alert',     testAlert);
router.post('/:slug/toggle-active',              toggleSelfActive);
router.post('/:slug/donations/:id/replay',    replayDonation);
router.delete('/:slug/donations/:id',           deleteDonation);
router.put('/:slug/widget',                   updateWidgetSettings);
router.get('/:slug/stripe/onboard',           getStripeOnboardingLink);
router.post('/:slug/stripe/unlink',          unlinkStripe);
router.put('/:slug/profile',                  updateProfile);

module.exports = router;
