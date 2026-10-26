const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// employee_final_settlements (R2 — LMS-016/017) — generated from LMS 2.0 ER Design (37-table schema)

const EmployeeFinalSettlement = sequelize.define('EmployeeFinalSettlement', {
  settlement_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
  deactivated_at: { type: DataTypes.DATE, allowNull: false },
  settlement_snapshot_json: { type: DataTypes.TEXT, allowNull: false },
  created_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'employee_final_settlements', updatedAt: false });

module.exports = EmployeeFinalSettlement;
