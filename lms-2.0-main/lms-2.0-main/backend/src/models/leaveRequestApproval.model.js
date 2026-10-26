const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_request_approvals — generated from LMS 2.0 ER Design (37-table schema)

// stage SELF = controlled self-approval addendum (table 37 disposition), not a new leave_requests state.
const LeaveRequestApproval = sequelize.define('LeaveRequestApproval', {
  approval_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  request_id: { type: DataTypes.BIGINT, allowNull: false },
  stage: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['MANAGER', 'HR', 'CANCELLATION', 'SELF']] } },
  actor_id: { type: DataTypes.BIGINT, allowNull: false },
  on_behalf_of_id: { type: DataTypes.BIGINT, allowNull: true }, // delegate acting for a Manager, LMS-043
  decision: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [['APPROVE', 'REJECT']] } },
  reason: { type: DataTypes.TEXT, allowNull: true }, // mandatory on REJECT — enforced in service layer
  decision_timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'leave_request_approvals', timestamps: false });

module.exports = LeaveRequestApproval;
