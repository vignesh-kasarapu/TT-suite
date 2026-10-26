const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// project_assignments — generated from LMS 2.0 ER Design (37-table schema)

const ProjectAssignment = sequelize.define('ProjectAssignment', {
  assignment_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  project_id: { type: DataTypes.BIGINT, allowNull: false },
  project_lead_id: { type: DataTypes.BIGINT, allowNull: false }, // auto-Watcher, LMS-014
  effective_from: { type: DataTypes.DATEONLY, allowNull: false },
  effective_to: { type: DataTypes.DATEONLY, allowNull: true }, // null = open
  created_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'project_assignments', updatedAt: false });

module.exports = ProjectAssignment;
