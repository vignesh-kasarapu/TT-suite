const { Op } = require('sequelize');
const { SelfApprovalPermission, Employee } = require('../models');
const auditService = require('./audit.service');
const notificationService = require('./notification.service');

/**
 * Enforces "at most one active grant per employee" here, in the service layer.
 * MySQL has no partial/filtered unique index (unlike Postgres), so this check —
 * not a DB constraint — is what BR/Addendum-37 relies on. Always go through
 * this function to create a grant; never LeaveLedger-style direct model.create.
 */
async function grant({ employeeId, grantedBy, effectiveFrom, effectiveTo, notes }) {
  const existingActive = await SelfApprovalPermission.findOne({
    where: { employee_id: employeeId, is_active: true },
  });
  if (existingActive) {
    throw Object.assign(
      new Error('This employee already has an active self-approval grant. Revoke it before issuing a new one.'),
      { status: 400, code: 'ACTIVE_GRANT_EXISTS' },
    );
  }

  const grantRow = await SelfApprovalPermission.create({
    employee_id: employeeId,
    granted_by: grantedBy,
    effective_from: effectiveFrom,
    effective_to: effectiveTo || null,
    is_active: true,
    notes: notes || null,
  });

  await auditService.record({
    actorId: grantedBy, action: 'SELF_APPROVAL_GRANTED', entityType: 'self_approval_permissions',
    entityId: grantRow.self_approval_permission_id, newValue: { employeeId, effectiveFrom, effectiveTo },
  });

  await notificationService.notify({
    recipientId: employeeId, templateKey: 'SELF_APPROVAL_GRANTED',
    tokens: { grantedBy },
  }).catch(() => {});

  return grantRow;
}

async function revoke(grantId, actorId) {
  const grantRow = await SelfApprovalPermission.findByPk(grantId);
  if (!grantRow) throw Object.assign(new Error('Grant not found'), { status: 404 });
  grantRow.is_active = false;
  await grantRow.save();

  await auditService.record({
    actorId, action: 'SELF_APPROVAL_REVOKED', entityType: 'self_approval_permissions', entityId: grantId,
  });
  return grantRow;
}

async function listAll() {
  return SelfApprovalPermission.findAll({
    include: [
      { model: Employee, as: 'grantee', attributes: ['full_name', 'employee_code'] },
      { model: Employee, as: 'grantedBy', attributes: ['full_name'] },
    ],
    order: [['created_at', 'DESC']],
  });
}

module.exports = { grant, revoke, listAll };
