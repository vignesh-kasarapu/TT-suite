const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// roles — generated from LMS 2.0 ER Design (37-table schema)

const Role = sequelize.define('Role', {
  role_id: { type: DataTypes.SMALLINT, primaryKey: true, autoIncrement: true },
  role_code: { type: DataTypes.STRING(30), allowNull: false, unique: true, validate: { isIn: [['EMPLOYEE', 'MANAGER', 'HR_ADMIN']] } },
  role_name: { type: DataTypes.STRING(50), allowNull: false },
  description: { type: DataTypes.STRING(200), allowNull: true },
}, { tableName: 'roles', timestamps: false });

module.exports = Role;
