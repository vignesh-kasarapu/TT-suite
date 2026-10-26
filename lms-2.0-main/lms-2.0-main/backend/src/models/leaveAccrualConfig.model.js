const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_accrual_configs — generated from LMS 2.0 ER Design (37-table schema)

const LeaveAccrualConfig = sequelize.define('LeaveAccrualConfig', {
  accrual_config_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  leave_type_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
  accrual_method: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['MONTHLY', 'QUARTERLY', 'ANNUAL']] } },
  posting_day: { type: DataTypes.SMALLINT, allowNull: true, validate: { min: 1, max: 31 } },
  updated_by: { type: DataTypes.BIGINT, allowNull: true },
}, { tableName: 'leave_accrual_configs', createdAt: false });

module.exports = LeaveAccrualConfig;
