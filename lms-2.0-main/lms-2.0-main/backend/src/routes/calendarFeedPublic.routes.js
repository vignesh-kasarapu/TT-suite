const express = require('express');
const controller = require('../controllers/r3.controller');

const router = express.Router();

// Token-authenticated, not session-authenticated — see calendarFeed.service.js's resolveToken.
router.get('/:token', controller.calendarFeed.serveIcs);

module.exports = router;
