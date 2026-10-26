const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_years — generated from LMS 2.0 ER Design (37-table schema)

const LeaveYear = sequelize.define('LeaveYear', {
  leave_year_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  year_code: { type: DataTypes.STRING(10), allowNull: false, unique: true },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  is_current: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  is_closed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // BR-01/BR-28: closed year never modified
}, { tableName: 'leave_years', updatedAt: false });

module.exports = LeaveYear;
