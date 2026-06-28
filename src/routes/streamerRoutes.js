const express = require('express');
const router = express.Router();
const { requireAuth, requireSelf } = require('../middleware/auth');
const {
  getDashboard,
  getDonations,
  replayDonation,
  updateWidgetSettings,
  getStripeOnboardingLink,
  updateProfile,
  unlinkStripe,
} = require('../controllers/streamerController');

// All streamer dashboard routes require auth + ownership (or admin)
router.use('/:slug', requireAuth, requireSelf);

router.get('/:slug',                          getDashboard);
router.get('/:slug/donations',                getDonations);
router.post('/:slug/donations/:id/replay',    replayDonation);
router.put('/:slug/widget',                   updateWidgetSettings);
router.get('/:slug/stripe/onboard',           getStripeOnboardingLink);
router.post('/:slug/stripe/unlink',          unlinkStripe);
router.put('/:slug/profile',                  updateProfile);

module.exports = router;
