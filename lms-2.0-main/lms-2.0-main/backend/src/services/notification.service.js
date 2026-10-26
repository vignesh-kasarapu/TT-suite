const { Notification, NotificationTemplate, NotificationDigestPreference } = require('../models');

// LMS-072: these are the per-request approval-queue notifications a digest
// replaces. Other templates (approved, rejected, LOP applied, etc.) are never
// digested — those are outcomes the recipient needs to know about immediately,
// not a queue to batch.
const DIGESTIBLE_TEMPLATES = ['REQUEST_AWAITING_DECISION', 'NEW_REQUEST_AWAITING_DECISION'];

function substitute(template, tokens) {
  return Object.entries(tokens).reduce(
    (str, [key, value]) => str.replaceAll(`{{${key}}}`, String(value)),
    template,
  );
}

/**
 * LMS-069: templates are data, not code. LMS-068: every notification is written
 * in-app regardless of email outcome. LMS-070: failure never blocks the caller's
 * business transaction — this function swallows send errors and marks FAILED.
 * LMS-072: for a Manager who has opted into the daily digest, the immediate
 * per-request EMAIL leg is suppressed (marked SUPPRESSED, not sent) for
 * digestible templates — the digest job (jobs/digest.job.js) sends one email
 * a day instead. The in-app record is written either way; digest only ever
 * changes the email channel.
 */
async function notify({ recipientId, templateKey, tokens = {}, relatedRequestId = null, transaction }) {
  const template = await NotificationTemplate.findByPk(templateKey);
  if (!template) {
    throw new Error(`Notification template "${templateKey}" is not seeded.`);
  }
  // HR/Admin disabled this template via the admin screen — send nothing, silently. (A
  // *deleted* template still throws above, same as always: that's a config error worth
  // surfacing loudly, since it can mean an in-use system template was removed by mistake.)
  if (!template.is_active) return null;

  const subject = substitute(template.subject_template, tokens);
  const body = substitute(template.body_template, tokens);

  const inApp = await Notification.create({
    recipient_id: recipientId,
    channel: 'IN_APP',
    template_key: templateKey,
    subject,
    body,
    status: 'SENT',
    related_request_id: relatedRequestId,
    sent_at: new Date(),
  }, { transaction });

  let digestEnabled = false;
  if (DIGESTIBLE_TEMPLATES.includes(templateKey)) {
    const pref = await NotificationDigestPreference.findOne({ where: { employee_id: recipientId }, transaction });
    digestEnabled = pref ? pref.digest_enabled : false;
  }

  if (digestEnabled) {
    await Notification.create({
      recipient_id: recipientId,
      channel: 'EMAIL',
      template_key: templateKey,
      subject,
      body,
      status: 'SUPPRESSED', // the digest job picks this up instead of sending it individually
      related_request_id: relatedRequestId,
    }, { transaction });
    return inApp;
  }

  // Email leg is dispatched via the mailer (Exchange/OAuth2, LMS-066); kept out of the
  // request's own DB transaction so a mail outage can never roll back the business action.
  const emailRecord = await Notification.create({
    recipient_id: recipientId,
    channel: 'EMAIL',
    template_key: templateKey,
    subject,
    body,
    status: 'PENDING',
    related_request_id: relatedRequestId,
  }, { transaction });

  queueEmailDelivery(emailRecord.notification_id, recipientId, subject, body).catch(() => {});

  return inApp;
}

async function queueEmailDelivery(notificationId, recipientId, subject, body) {
  // Wired to src/utils/mailer.js (Exchange Online SMTP, OAuth2 client credentials).
  // Retried with backoff; final failure is logged and surfaced to HR/Admin (LMS-070).
  const mailer = require('../utils/mailer');
  try {
    await mailer.send({ recipientId, subject, body });
    await Notification.update({ status: 'SENT', sent_at: new Date() }, { where: { notification_id: notificationId } });
  } catch (err) {
    await Notification.update({ status: 'FAILED', error_message: err.message }, { where: { notification_id: notificationId } });
  }
}

module.exports = { notify, DIGESTIBLE_TEMPLATES };
