const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// working_pattern_assignments (R2 — LMS-015) — generated from LMS 2.0 ER Design (37-table schema)

const WorkingPatternAssignment = sequelize.define('WorkingPatternAssignment', {
  assignment_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  working_pattern_id: { type: DataTypes.BIGINT, allowNull: false },
  effective_from: { type: DataTypes.DATEONLY, allowNull: false },
  effective_to: { type: DataTypes.DATEONLY, allowNull: true },
  assigned_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'working_pattern_assignments', updatedAt: false });

module.exports = WorkingPatternAssignment;
