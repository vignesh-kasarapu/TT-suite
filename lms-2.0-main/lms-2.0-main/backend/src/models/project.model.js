const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// projects — generated from LMS 2.0 ER Design (37-table schema)

const Project = sequelize.define('Project', {
  project_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  project_code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  project_name: { type: DataTypes.STRING(200), allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'projects', timestamps: false });

module.exports = Project;
