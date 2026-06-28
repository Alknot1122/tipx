const express = require('express');
const router = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { createStreamer, listStreamers, toggleStreamer } = require('../controllers/adminController');

// All admin routes require authentication + admin role
router.use(requireAuth, requireAdmin);

router.get('/streamers', listStreamers);
router.post('/streamers', createStreamer);
router.patch('/streamers/:id/toggle', toggleStreamer);

module.exports = router;
