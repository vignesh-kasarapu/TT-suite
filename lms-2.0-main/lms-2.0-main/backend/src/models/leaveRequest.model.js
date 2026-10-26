const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_requests — generated from LMS 2.0 ER Design (37-table schema)

// FRD Section 5.11 — exactly these 10 states, no renaming/merging.
const LEAVE_REQUEST_STATES = [
  'DRAFT', 'PENDING_MANAGER', 'PENDING_HR', 'APPROVED', 'REJECTED',
  'REJECTED_PENDING_WITHDRAWAL', 'WITHDRAWN', 'LOP_APPLIED',
  'CANCELLATION_REQUESTED', 'CANCELLED',
];

const LeaveRequest = sequelize.define('LeaveRequest', {
  request_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_type_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_year_id: { type: DataTypes.BIGINT, allowNull: false },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  is_half_day: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  half_day_portion: { type: DataTypes.STRING(10), allowNull: true, validate: { isIn: [['FIRST', 'SECOND']] } },
  reason: { type: DataTypes.TEXT, allowNull: false }, // hidden from Watchers, BR-42
  state: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'DRAFT', validate: { isIn: [LEAVE_REQUEST_STATES] } },
  deducted_days: { type: DataTypes.DECIMAL(6, 1), allowNull: true },
  is_advance_leave: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_long_leave: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  application_timestamp: { type: DataTypes.DATE, allowNull: true },
  withdrawal_window_end: { type: DataTypes.DATE, allowNull: true },
  prior_leave_type_id: { type: DataTypes.BIGINT, allowNull: true }, // set on LOP conversion, BR-20
  current_approver_id: { type: DataTypes.BIGINT, allowNull: true },
  sla_started_at: { type: DataTypes.DATE, allowNull: true },
  lock_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, // NFR-18 optimistic concurrency
}, { tableName: 'leave_requests', version: 'lock_version' });

LeaveRequest.STATES = LEAVE_REQUEST_STATES;

module.exports = LeaveRequest;
