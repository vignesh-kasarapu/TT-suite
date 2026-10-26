const configService = require('../services/config.service');
const auditService = require('../services/audit.service');
const { OrganizationConfig } = require('../models');
const { ok } = require('../utils/apiResponse');

async function listAll(req, res) {
  const rows = await OrganizationConfig.findAll();
  return ok(res, rows);
}

/** LMS-032: no config value hard-coded; every change is audited with prior/new value, actor, timestamp. */
async function updateOne(req, res) {
  const { key } = req.params;
  const { value, valueType } = req.body;
  const { priorValue, newValue } = await configService.set(key, value, valueType, req.currentUser.employeeId);

  await auditService.record({
    actorId: req.currentUser.employeeId, action: 'CONFIG_UPDATED', entityType: 'organization_configs',
    entityId: key, priorValue, newValue,
  });

  return ok(res, { key, value: newValue });
}

module.exports = { listAll, updateOne };
