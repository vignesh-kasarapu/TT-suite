const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_encashment_requests (R3 — LMS-084) — generated from LMS 2.0 ER Design (37-table schema)

const LeaveEncashmentRequest = sequelize.define('LeaveEncashmentRequest', {
  encashment_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_type_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_year_id: { type: DataTypes.BIGINT, allowNull: false },
  days_encashed: { type: DataTypes.DECIMAL(6, 1), allowNull: false },
  ledger_entry_id: { type: DataTypes.BIGINT, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['REQUESTED', 'POSTED', 'CANCELLED']] } },
  requested_by: { type: DataTypes.BIGINT, allowNull: false },
  requested_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  notes: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'leave_encashment_requests', timestamps: false });

module.exports = LeaveEncashmentRequest;
