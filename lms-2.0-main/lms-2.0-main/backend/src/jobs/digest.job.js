const { Op } = require('sequelize');
const { Notification, NotificationDigestPreference, Employee } = require('../models');
const mailer = require('../utils/mailer');

/**
 * LMS-072: once a day, gather every SUPPRESSED per-request email created since
 * the last digest for each opted-in Manager and send one summary email instead.
 * The in-app notifications were never suppressed (LMS-068) — this only ever
 * affects the email channel, and only for the digestible templates listed in
 * notification.service.js.
 */
async function runDailyDigest() {
  const optedIn = await NotificationDigestPreference.findAll({ where: { digest_enabled: true } });

  for (const pref of optedIn) {
    const suppressed = await Notification.findAll({
      where: { recipient_id: pref.employee_id, channel: 'EMAIL', status: 'SUPPRESSED' },
      order: [['created_at', 'ASC']],
    });
    if (!suppressed.length) continue;

    const employee = await Employee.findByPk(pref.employee_id);
    const body = [
      `<p>You have ${suppressed.length} item(s) awaiting your decision:</p>`,
      '<ul>',
      ...suppressed.map((n) => `<li>${n.subject}</li>`),
      '</ul>',
    ].join('\n');

    try {
      await mailer.send({ recipientId: pref.employee_id, subject: `Daily digest: ${suppressed.length} pending approval(s)`, body });
      await Notification.update(
        { status: 'SENT', sent_at: new Date() },
        { where: { notification_id: { [Op.in]: suppressed.map((n) => n.notification_id) } } },
      );
    } catch (err) {
      // LMS-070: a digest failure is logged, not thrown — it never blocks anything else.
      // eslint-disable-next-line no-console
      console.error(`Digest send failed for employee ${pref.employee_id}:`, err.message);
    }
  }
}

module.exports = { runDailyDigest };
