const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// user_roles table mapping in lms_2_0
const EmployeeRole = sequelize.define('EmployeeRole', {
  employee_id: { type: DataTypes.BIGINT, primaryKey: true, field: 'user_id' },
  role_id: { type: DataTypes.BIGINT, primaryKey: true, field: 'role_id' },
  assigned_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, {
  tableName: 'user_roles',
  timestamps: false,
});

module.exports = EmployeeRole;
