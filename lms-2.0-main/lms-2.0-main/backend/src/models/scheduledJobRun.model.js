const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// scheduled_job_runs — generated from LMS 2.0 ER Design (37-table schema)

// NFR-16: idempotency key = (job_type, period_key)
const ScheduledJobRun = sequelize.define('ScheduledJobRun', {
  job_run_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  job_type: { type: DataTypes.STRING(40), allowNull: false, validate: { isIn: [['ACCRUAL', 'CARRY_FORWARD', 'LOP_CONVERSION', 'SLA_ESCALATION', 'SLA_REMINDER', 'DIGEST']] } },
  period_key: { type: DataTypes.STRING(50), allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'RUNNING', validate: { isIn: [['RUNNING', 'SUCCESS', 'FAILED']] } },
  started_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  finished_at: { type: DataTypes.DATE, allowNull: true },
  error_message: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'scheduled_job_runs',
  timestamps: false,
  indexes: [{ unique: true, fields: ['job_type', 'period_key'] }],
});

module.exports = ScheduledJobRun;
