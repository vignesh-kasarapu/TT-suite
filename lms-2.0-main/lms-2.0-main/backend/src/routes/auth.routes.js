const express = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Routes carry no logic — every handler here is a direct call into a controller.
router.get('/config', authController.getAuthConfig);
router.get('/login', authController.redirectToEntra);
router.get('/dev-login', authController.devLogin);
router.get('/callback', authController.handleCallback);
router.post('/signout', requireAuth, authController.signOut);

module.exports = router;
