const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// departments — generated from LMS 2.0 ER Design (37-table schema)

const Department = sequelize.define('Department', {
  department_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  department_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  department_name: { type: DataTypes.STRING(100), allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'departments', timestamps: false });

module.exports = Department;
