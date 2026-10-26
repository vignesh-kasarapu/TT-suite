const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// holidays — generated from LMS 2.0 ER Design (37-table schema)

const Holiday = sequelize.define('Holiday', {
  holiday_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  holiday_date: { type: DataTypes.DATEONLY, allowNull: false },
  holiday_name: { type: DataTypes.STRING(200), allowNull: false },
  leave_year_id: { type: DataTypes.BIGINT, allowNull: false },
  region_id: { type: DataTypes.BIGINT, allowNull: true }, // null = org-wide, applies to every region
  is_optional: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // true = employee opts in (see optionalHoliday.service.js), false = mandatory for everyone
  created_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'holidays', updatedAt: false });

module.exports = Holiday;
