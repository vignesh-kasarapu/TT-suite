const { NotificationTemplate, NotificationDigestPreference } = require('../models');
const auditService = require('./audit.service');

/** Every template_key referenced directly (as a literal or a fixed set of literals) by
 * business logic — deleting one of these leaves the referencing code with nothing to look
 * up, and notification.service.js's notify() throws loudly for a missing key (as opposed to
 * a disabled one, which it silently no-ops for). Disabling one of these is still fully
 * supported; only hard deletion is blocked here. */
const PROTECTED_TEMPLATE_KEYS = new Set([
  'BALANCE_ADJUSTED', 'CARRY_FORWARD_APPLIED', 'SLA_REMINDER', 'ESCALATION_NOTICE_TO_PRIOR_APPROVER',
  'NEW_REQUEST_AWAITING_DECISION', 'LOSS_OF_PAY_APPLIED', 'COMP_OFF_CREDITED', 'DELEGATE_ASSIGNED_TO_YOU',
  'EMPLOYEE_ONBOARDING_INVITE', 'MANAGER_REASSIGNED', 'LEAVE_ENCASHMENT_POSTED', 'REQUEST_AWAITING_DECISION',
  'EXTENDED_SICK_LEAVE_ALERT', 'REQUEST_SUBMITTED_CONFIRMATION', 'LONG_LEAVE_SUPERVISOR_NOTICE',
  'REQUEST_APPROVED', 'REQUEST_REJECTED', 'CANCELLATION_REQUEST_AWAITING_DECISION', 'CANCELLATION_APPROVED',
  'CANCELLATION_REJECTED', 'SELF_APPROVAL_GRANTED', 'WATCHED_REQUEST_SUBMITTED', 'WATCHED_REQUEST_APPROVED',
  'WATCHED_REQUEST_REJECTED', 'WATCHED_REQUEST_CANCELLED',
]);

/** LMS-071: HR/Admin edits notification templates through the administration interface. */
async function listTemplates() { return NotificationTemplate.findAll({ order: [['template_key', 'ASC']] }); }

async function createTemplate({ templateKey, subjectTemplate, bodyTemplate }, actorId) {
  const existing = await NotificationTemplate.findByPk(templateKey);
  if (existing) throw Object.assign(new Error(`A template with key "${templateKey}" already exists.`), { status: 400, code: 'DUPLICATE_TEMPLATE_KEY' });

  const template = await NotificationTemplate.create({
    template_key: templateKey, subject_template: subjectTemplate, body_template: bodyTemplate, updated_by: actorId,
  });
  await auditService.record({ actorId, action: 'NOTIFICATION_TEMPLATE_CREATED', entityType: 'notification_templates', entityId: templateKey, newValue: { subjectTemplate, bodyTemplate } });
  return template;
}

async function setTemplateActive(templateKey, isActive, actorId) {
  const template = await NotificationTemplate.findByPk(templateKey);
  if (!template) throw Object.assign(new Error('Template not found'), { status: 404 });
  template.is_active = isActive;
  await template.save();
  await auditService.record({ actorId, action: isActive ? 'NOTIFICATION_TEMPLATE_ENABLED' : 'NOTIFICATION_TEMPLATE_DISABLED', entityType: 'notification_templates', entityId: templateKey });
  return template;
}

async function deleteTemplate(templateKey, actorId) {
  const template = await NotificationTemplate.findByPk(templateKey);
  if (!template) throw Object.assign(new Error('Template not found'), { status: 404 });
  if (PROTECTED_TEMPLATE_KEYS.has(templateKey)) {
    throw Object.assign(
      new Error(`"${templateKey}" is used directly by the application and cannot be deleted — disable it instead if you don't want it sent.`),
      { status: 400, code: 'TEMPLATE_IN_USE' },
    );
  }
  await template.destroy();
  await auditService.record({ actorId, action: 'NOTIFICATION_TEMPLATE_DELETED', entityType: 'notification_templates', entityId: templateKey, priorValue: { subject_template: template.subject_template } });
  return { deleted: true };
}

async function updateTemplate(templateKey, { subjectTemplate, bodyTemplate }, actorId) {
  const template = await NotificationTemplate.findByPk(templateKey);
  if (!template) throw Object.assign(new Error('Template not found'), { status: 404 });

  const prior = { subject_template: template.subject_template, body_template: template.body_template };
  template.subject_template = subjectTemplate;
  template.body_template = bodyTemplate;
  template.updated_by = actorId;
  await template.save();

  await auditService.record({
    actorId, action: 'NOTIFICATION_TEMPLATE_UPDATED', entityType: 'notification_templates', entityId: templateKey,
    priorValue: prior, newValue: { subjectTemplate, bodyTemplate },
  });
  return template;
}

/** LMS-072: a Manager may opt into a daily digest in place of individual per-request notifications. */
async function setDigestPreference(employeeId, digestEnabled) {
  const [pref] = await NotificationDigestPreference.findOrCreate({
    where: { employee_id: employeeId },
    defaults: { digest_enabled: digestEnabled },
  });
  pref.digest_enabled = digestEnabled;
  await pref.save();
  return pref;
}

async function getDigestPreference(employeeId) {
  const pref = await NotificationDigestPreference.findOne({ where: { employee_id: employeeId } });
  return pref ? pref.digest_enabled : false;
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, setTemplateActive, deleteTemplate,
  setDigestPreference, getDigestPreference,
};
