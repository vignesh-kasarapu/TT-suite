const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// blackout_periods (R3 — LMS-085) — generated from LMS 2.0 ER Design (37-table schema)

const BlackoutPeriod = sequelize.define('BlackoutPeriod', {
  blackout_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  leave_type_id: { type: DataTypes.BIGINT, allowNull: true }, // null = all types
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  created_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'blackout_periods', updatedAt: false });

module.exports = BlackoutPeriod;
