const express = require('express');
const controller = require('../controllers/attachment.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/:requestId', requireAuth, controller.upload.single('file'), controller.uploadAttachment);
router.get('/:attachmentId/download', requireAuth, controller.downloadAttachment);

module.exports = router;
