const { OrganizationConfig } = require('../models');

// BR-01,03,04,20-23,27,29,33,45: every configurable value the FRD marks [CONFIG]
// is stored in organization_configs and read through here. Nothing below is a
// fallback business default baked into code — CONFIG_DEFAULTS only seeds the
// table once; after seeding, the database is the sole source of truth.
const CONFIG_DEFAULTS = {
  'leave_year.start_month_day': { value: '04-01', type: 'STRING' },      // BR-01
  'weekend.days': { value: '["SAT","SUN"]', type: 'JSON' },              // BR-03
  'weekend.count_within_leave': { value: 'false', type: 'BOOL' },        // BR-04
  'holiday.count_within_leave': { value: 'false', type: 'BOOL' },        // BR-04
  'timezone': { value: 'Asia/Kolkata', type: 'STRING' },
  'approval.long_leave_threshold_days': { value: '10', type: 'INT' },    // BR-23
  'approval.sla_working_days': { value: '3', type: 'INT' },              // BR-33
  'approval.sla_reminder_days_before': { value: '1', type: 'INT' },      // BR-34: reminder fires this many days before the SLA deadline
  'backdating.window_days': { value: '30', type: 'INT' },                // BR-27
  'advance_leave.withdrawal_window_days': { value: '7', type: 'INT' },   // BR-18
  'sick_leave.alert_threshold_days': { value: '3', type: 'INT' },        // BR-43
  'sick_leave.alert_supervisor_enabled': { value: 'true', type: 'BOOL' },// BR-45
  'sick_leave.alert_hr_enabled': { value: 'true', type: 'BOOL' },        // BR-45
  // 0 = auto: each employee's quota is half the optional holidays published for that leave
  // year (rounded down). A positive value here overrides that computed default org-wide.
  // See optionalHoliday.service.js#getOptionalHolidayQuota.
  'holiday.optional_holiday_quota_override': { value: '0', type: 'INT' },
};

function cast(raw, type) {
  switch (type) {
    case 'INT': return parseInt(raw, 10);
    case 'BOOL': return raw === 'true' || raw === true;
    case 'JSON': return JSON.parse(raw);
    default: return raw;
  }
}

async function get(key) {
  const row = await OrganizationConfig.findByPk(key);
  if (!row) {
    throw new Error(`Configuration key "${key}" is not set. Seed organization_configs before use.`);
  }
  return cast(row.config_value, row.value_type);
}

async function getMany(keys) {
  const rows = await OrganizationConfig.findAll({ where: { config_key: keys } });
  const map = {};
  for (const row of rows) map[row.config_key] = cast(row.config_value, row.value_type);
  for (const key of keys) {
    if (!(key in map)) throw new Error(`Configuration key "${key}" is not set.`);
  }
  return map;
}

async function set(key, value, valueType, updatedBy) {
  const [row] = await OrganizationConfig.findOrCreate({
    where: { config_key: key },
    defaults: { config_value: String(value), value_type: valueType, updated_by: updatedBy },
  });
  const priorValue = row.config_value;
  row.config_value = typeof value === 'string' ? value : JSON.stringify(value);
  row.value_type = valueType;
  row.updated_by = updatedBy;
  await row.save();
  return { priorValue, newValue: row.config_value };
}

async function seedDefaults(updatedByEmployeeId) {
  for (const [key, def] of Object.entries(CONFIG_DEFAULTS)) {
    await OrganizationConfig.findOrCreate({
      where: { config_key: key },
      defaults: {
        config_value: def.value,
        value_type: def.type,
        updated_by: updatedByEmployeeId,
      },
    });
  }
}

module.exports = { get, getMany, set, seedDefaults, CONFIG_DEFAULTS };
