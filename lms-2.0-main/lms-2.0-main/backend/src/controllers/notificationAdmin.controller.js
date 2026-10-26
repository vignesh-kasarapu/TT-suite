const notificationAdminService = require('../services/notificationAdmin.service');
const { ok } = require('../utils/apiResponse');

async function listTemplates(req, res) {
  return ok(res, await notificationAdminService.listTemplates());
}

async function createTemplate(req, res) {
  const { templateKey, subjectTemplate, bodyTemplate } = req.body;
  const template = await notificationAdminService.createTemplate({ templateKey, subjectTemplate, bodyTemplate }, req.currentUser.employeeId);
  return ok(res, template);
}

async function updateTemplate(req, res) {
  const { subjectTemplate, bodyTemplate } = req.body;
  const template = await notificationAdminService.updateTemplate(req.params.templateKey, { subjectTemplate, bodyTemplate }, req.currentUser.employeeId);
  return ok(res, template);
}

async function setTemplateActive(req, res) {
  const template = await notificationAdminService.setTemplateActive(req.params.templateKey, !!req.body.isActive, req.currentUser.employeeId);
  return ok(res, template);
}

async function deleteTemplate(req, res) {
  return ok(res, await notificationAdminService.deleteTemplate(req.params.templateKey, req.currentUser.employeeId));
}

async function getMyDigestPreference(req, res) {
  const enabled = await notificationAdminService.getDigestPreference(req.currentUser.employeeId);
  return ok(res, { digestEnabled: enabled });
}

async function setMyDigestPreference(req, res) {
  const pref = await notificationAdminService.setDigestPreference(req.currentUser.employeeId, !!req.body.digestEnabled);
  return ok(res, pref);
}

module.exports = {
  listTemplates, createTemplate, updateTemplate, setTemplateActive, deleteTemplate,
  getMyDigestPreference, setMyDigestPreference,
};
