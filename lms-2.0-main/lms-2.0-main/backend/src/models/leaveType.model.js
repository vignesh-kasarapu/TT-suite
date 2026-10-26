const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_types — generated from LMS 2.0 ER Design (37-table schema)

const LeaveType = sequelize.define('LeaveType', {
  leave_type_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  type_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  type_name: { type: DataTypes.STRING(100), allowNull: false },
  is_sick_leave: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // BR-42/43 masking + alerting
  is_balance_affecting: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // LOP = false
  is_system: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // LOP non-deletable, LMS-025
  is_selectable_by_employee: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // LOP = false
  permits_half_day: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  permits_attachments: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'leave_types' });

module.exports = LeaveType;
