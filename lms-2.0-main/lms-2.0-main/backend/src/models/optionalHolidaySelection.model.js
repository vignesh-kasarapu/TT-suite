const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// optional_holiday_selections — an employee opting to take one of the org's
// optional (floating) holidays, up to their quota for the leave year.

const OptionalHolidaySelection = sequelize.define('OptionalHolidaySelection', {
  selection_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  holiday_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_year_id: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'optional_holiday_selections', updatedAt: false, createdAt: 'selected_at' });

module.exports = OptionalHolidaySelection;
