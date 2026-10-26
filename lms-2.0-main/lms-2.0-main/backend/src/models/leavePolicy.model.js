const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_policies — generated from LMS 2.0 ER Design (37-table schema)

const LeavePolicy = sequelize.define('LeavePolicy', {
  policy_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  leave_type_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
  annual_entitlement: { type: DataTypes.DECIMAL(6, 1), allowNull: false },
  carries_forward: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  carry_forward_cap: { type: DataTypes.DECIMAL(6, 1), allowNull: true },
  updated_by: { type: DataTypes.BIGINT, allowNull: true },
}, { tableName: 'leave_policies', createdAt: false });

module.exports = LeavePolicy;
