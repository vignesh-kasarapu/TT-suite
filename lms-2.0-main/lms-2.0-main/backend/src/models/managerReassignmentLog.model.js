const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// manager_reassignment_log (R2 — LMS-018) — generated from LMS 2.0 ER Design (37-table schema)

const ManagerReassignmentLog = sequelize.define('ManagerReassignmentLog', {
  reassignment_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  old_manager_id: { type: DataTypes.BIGINT, allowNull: false },
  new_manager_id: { type: DataTypes.BIGINT, allowNull: false },
  pending_requests_transferred: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  reassigned_by: { type: DataTypes.BIGINT, allowNull: false },
  reassigned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  notes: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'manager_reassignment_log', timestamps: false });

module.exports = ManagerReassignmentLog;
