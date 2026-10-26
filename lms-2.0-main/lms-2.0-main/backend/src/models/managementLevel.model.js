const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// management_levels — generated from LMS 2.0 ER Design (37-table schema)

const ManagementLevel = sequelize.define('ManagementLevel', {
  management_level_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  level_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  level_name: { type: DataTypes.STRING(100), allowNull: false },
  level_rank: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'management_levels', timestamps: false });

module.exports = ManagementLevel;
