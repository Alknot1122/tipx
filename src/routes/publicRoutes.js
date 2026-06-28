const express = require('express');
const router = express.Router();
const { getPublicPage, createPaymentIntent, cancelPaymentIntent } = require('../controllers/publicController');
const rateLimiter = require('../middleware/rateLimiter');

// Rate limiter: Max 5 payment intent creations per minute to prevent Stripe card-testing attacks
const paymentLimiter = rateLimiter(1 * 60 * 1000, 5, 'Too many donation attempts. Please wait a minute before trying again.');

// Rate limiter: Max 60 requests per minute for public profile page loads
const publicGetLimiter = rateLimiter(1 * 60 * 1000, 60, 'Too many requests. Please try again later.');

// Public streamer donation page data
router.get('/:slug', publicGetLimiter, getPublicPage);

// Create a payment intent (donor submits the form)
router.post('/:slug/payment-intent', paymentLimiter, createPaymentIntent);

// Cancel a payment intent (if user clicks back or cancels)
router.post('/payment-intent/cancel', cancelPaymentIntent);


module.exports = router;
