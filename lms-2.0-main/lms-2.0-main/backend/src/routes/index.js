const express = require('express');
const authRoutes = require('./auth.routes');
const employeeRoutes = require('./employee.routes');
const leaveRequestRoutes = require('./leaveRequest.routes');
const configRoutes = require('./config.routes');
const ledgerRoutes = require('./ledger.routes');
const delegationRoutes = require('./delegation.routes');
const adminRoutes = require('./admin.routes');
const reportsRoutes = require('./reports.routes');
const attachmentRoutes = require('./attachment.routes');
const watcherRoutes = require('./watcher.routes');
const r3Routes = require('./r3.routes');
const calendarFeedPublicRoutes = require('./calendarFeedPublic.routes');
const notificationRoutes = require('./notification.routes');
const holidayViewRoutes = require('./holidayView.routes');

const router = express.Router();

// Pure wiring — no business logic lives in this file or any file under routes/.
router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);
router.use('/employees', watcherRoutes); // standing-watcher endpoints, scoped by :employeeId
router.use('/leave-requests', leaveRequestRoutes);
router.use('/config', configRoutes);
router.use('/ledger', ledgerRoutes);
router.use('/delegations', delegationRoutes);
router.use('/admin', adminRoutes);
router.use('/reports', reportsRoutes);
router.use('/attachments', attachmentRoutes);
router.use('/r3', r3Routes);
router.use('/calendar-feed', calendarFeedPublicRoutes); // NOT under requireAuth — token-authenticated instead
router.use('/notifications', notificationRoutes);
// Employee-facing: the calendar itself is read-only, plus each employee's own optional-holiday
// select/deselect — distinct from the HR/Admin-only CRUD under /admin/holidays.
router.use('/holidays', holidayViewRoutes);

module.exports = router;
