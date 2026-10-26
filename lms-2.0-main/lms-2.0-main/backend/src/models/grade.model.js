const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// grades — generated from LMS 2.0 ER Design (37-table schema)

const Grade = sequelize.define('Grade', {
  grade_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  grade_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  grade_name: { type: DataTypes.STRING(100), allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'grades', timestamps: false });

module.exports = Grade;
