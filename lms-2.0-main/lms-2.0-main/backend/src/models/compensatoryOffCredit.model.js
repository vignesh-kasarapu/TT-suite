const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// compensatory_off_credits (R3 — LMS-083) — generated from LMS 2.0 ER Design (37-table schema)

const CompensatoryOffCredit = sequelize.define('CompensatoryOffCredit', {
  comp_off_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  work_date: { type: DataTypes.DATEONLY, allowNull: false },
  hours_or_days: { type: DataTypes.DECIMAL(6, 1), allowNull: false },
  ledger_entry_id: { type: DataTypes.BIGINT, allowNull: true },
  approved_by: { type: DataTypes.BIGINT, allowNull: false },
  notes: { type: DataTypes.TEXT, allowNull: true },
}, { tableName: 'compensatory_off_credits', updatedAt: false });

module.exports = CompensatoryOffCredit;
