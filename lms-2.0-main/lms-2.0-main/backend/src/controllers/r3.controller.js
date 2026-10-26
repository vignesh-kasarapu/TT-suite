const blackoutService = require('../services/blackoutPeriod.service');
const capacityService = require('../services/teamCapacity.service');
const encashmentService = require('../services/encashment.service');
const compOffService = require('../services/compOff.service');
const calendarFeedService = require('../services/calendarFeed.service');
const employeeService = require('../services/employee.service');
const { ok, created } = require('../utils/apiResponse');

// --- Blackout periods (LMS-085), HR/Admin ---
const blackout = {
  list: async (req, res) => ok(res, await blackoutService.listBlackoutPeriods({ includeInactive: req.query.includeInactive === 'true' })),
  create: async (req, res) => created(res, await blackoutService.createBlackoutPeriod(req.body, req.currentUser.employeeId)),
  update: async (req, res) => ok(res, await blackoutService.updateBlackoutPeriod(req.params.blackoutId, req.body, req.currentUser.employeeId)),
  setActive: async (req, res) => ok(res, await blackoutService.setActive(req.params.blackoutId, !!req.body.isActive, req.currentUser.employeeId)),
  deactivate: async (req, res) => ok(res, await blackoutService.deactivate(req.params.blackoutId, req.currentUser.employeeId)),
  remove: async (req, res) => ok(res, await blackoutService.removeBlackoutPeriod(req.params.blackoutId, req.currentUser.employeeId)),
};

// --- Team capacity limits (LMS-086), HR/Admin ---
const capacity = {
  listForManager: async (req, res) => {
    const isHrAdmin = req.currentUser.roles.includes('HR_ADMIN');
    if (!isHrAdmin && String(req.params.managerId) !== String(req.currentUser.employeeId)) {
      return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You can only view your own team capacity limits.' } });
    }
    return ok(res, await capacityService.listForManager(req.params.managerId));
  },
  listAll: async (req, res) => ok(res, await capacityService.listAll()),
  create: async (req, res) => created(res, await capacityService.createLimit(req.body, req.currentUser.employeeId)),
  update: async (req, res) => ok(res, await capacityService.updateLimit(req.params.capacityLimitId, req.body, req.currentUser.employeeId)),
  setActive: async (req, res) => ok(res, await capacityService.setActive(req.params.capacityLimitId, !!req.body.isActive, req.currentUser.employeeId)),
  remove: async (req, res) => ok(res, await capacityService.removeLimit(req.params.capacityLimitId, req.currentUser.employeeId)),
};

// --- Leave encashment (LMS-084), HR/Admin initiates, employee can view own ---
const encashment = {
  create: async (req, res) => created(res, await encashmentService.requestEncashment({ ...req.body, requestedBy: req.currentUser.employeeId })),
  mine: async (req, res) => ok(res, await encashmentService.listForEmployee(req.currentUser.employeeId)),
};

// --- Compensatory off (LMS-083), Manager/HR credits, employee can view own ---
const compOff = {
  // creditCompOff itself doesn't know who the caller is relative to the target employee — a
  // Manager (unlike HR/Admin) may only credit their own reporting line, checked here since
  // this is the one place both the actor's role and the target employee are both in scope.
  credit: async (req, res) => {
    const isHrAdmin = req.currentUser.roles.includes('HR_ADMIN');
    if (!isHrAdmin) {
      const inHierarchy = await employeeService.isInManagerHierarchy(req.currentUser.employeeId, req.body.employeeId);
      if (!inHierarchy) {
        return res.status(403).json({ success: false, error: { code: 'PERMISSION_DENIED', message: 'You can only credit compensatory off for your own team.' } });
      }
    }
    return created(res, await compOffService.creditCompOff({ ...req.body, approvedBy: req.currentUser.employeeId }));
  },
  mine: async (req, res) => ok(res, await compOffService.listForEmployee(req.currentUser.employeeId)),
};

// --- Calendar feed (LMS-082) ---
const calendarFeed = {
  subscribe: async (req, res) => {
    const token = await calendarFeedService.createSubscription(req.currentUser.employeeId, req.body.scope || 'OWN');
    const env = require('../config/env');
    return created(res, { token, url: `${env.appBaseUrl}/api/calendar-feed/${token}.ics` });
  },
  mine: async (req, res) => ok(res, await calendarFeedService.listSubscriptions(req.currentUser.employeeId)),
  revoke: async (req, res) => ok(res, await calendarFeedService.revokeSubscription(req.params.subscriptionId, req.currentUser.employeeId)),
  // Public (token-authenticated, not session-authenticated) — this is what Outlook actually polls.
  serveIcs: async (req, res) => {
    const token = req.params.token.replace(/\.ics$/, '');
    const subscription = await calendarFeedService.resolveToken(token);
    const ics = await calendarFeedService.buildIcsFeed(subscription);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(ics);
  },
};

module.exports = { blackout, capacity, encashment, compOff, calendarFeed };
