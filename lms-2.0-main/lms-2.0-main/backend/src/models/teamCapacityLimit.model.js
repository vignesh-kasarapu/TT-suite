const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// team_capacity_limits (R3 — LMS-086) — generated from LMS 2.0 ER Design (37-table schema)

const TeamCapacityLimit = sequelize.define('TeamCapacityLimit', {
  capacity_limit_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  manager_employee_id: { type: DataTypes.BIGINT, allowNull: false },
  max_concurrent_on_leave: { type: DataTypes.INTEGER, allowNull: false },
  effective_from: { type: DataTypes.DATEONLY, allowNull: false },
  effective_to: { type: DataTypes.DATEONLY, allowNull: true },
  created_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'team_capacity_limits', updatedAt: false });

module.exports = TeamCapacityLimit;
