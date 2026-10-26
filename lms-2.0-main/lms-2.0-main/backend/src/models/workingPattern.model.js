const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// working_patterns (R2 — LMS-015) — generated from LMS 2.0 ER Design (37-table schema)

const WorkingPattern = sequelize.define('WorkingPattern', {
  working_pattern_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  pattern_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  pattern_name: { type: DataTypes.STRING(100), allowNull: false },
  weekend_days: { type: DataTypes.STRING(50), allowNull: false }, // JSON/CSV of weekdays
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'working_patterns', updatedAt: false });

module.exports = WorkingPattern;
