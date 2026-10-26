const express = require('express');
const controller = require('../controllers/leaveRequest.controller');
const { requireAuth, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/preview', requireAuth, controller.preview);
router.post('/', requireAuth, controller.submit);
router.post('/draft', requireAuth, controller.saveDraft);
router.patch('/draft/:requestId', requireAuth, controller.updateDraft);
router.delete('/draft/:requestId', requireAuth, controller.discardDraft);
router.post('/draft/:requestId/submit', requireAuth, controller.submitDraft);
router.get('/my', requireAuth, controller.myRequests);
router.get('/approvals-queue', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.approvalsQueue);
router.get('/:requestId', requireAuth, controller.detail);
router.post('/:requestId/decision', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.decide);
router.post('/:requestId/withdraw', requireAuth, controller.withdraw);
router.post('/:requestId/cancellation', requireAuth, controller.requestCancellation);
router.post('/:requestId/cancellation/decision', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.decideCancellation);
router.post('/:requestId/watchers', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.addWatcher);
router.delete('/:requestId/watchers/:watcherId', requireAuth, requireRole('MANAGER', 'HR_ADMIN'), controller.removeWatcher);

module.exports = router;
