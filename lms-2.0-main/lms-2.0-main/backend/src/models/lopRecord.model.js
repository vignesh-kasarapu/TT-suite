const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// lop_records — generated from LMS 2.0 ER Design (37-table schema)

const LopRecord = sequelize.define('LopRecord', {
  lop_record_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  request_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  prior_leave_type_id: { type: DataTypes.BIGINT, allowNull: false },
  lop_leave_type_id: { type: DataTypes.BIGINT, allowNull: false },
  start_date: { type: DataTypes.DATEONLY, allowNull: false },
  end_date: { type: DataTypes.DATEONLY, allowNull: false },
  deducted_days: { type: DataTypes.DECIMAL(6, 1), allowNull: false },
  converted_at: { type: DataTypes.DATE, allowNull: false },
  converted_by_job_run_id: { type: DataTypes.BIGINT, allowNull: true },
}, { tableName: 'lop_records', timestamps: false });

module.exports = LopRecord;
