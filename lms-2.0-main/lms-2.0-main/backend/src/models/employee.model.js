const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// users table mapping in lms_2_0
const Employee = sequelize.define('Employee', {
  employee_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'user_id' },
  entra_oid: { type: DataTypes.STRING(64), allowNull: true, unique: true, field: 'entra_oid' },
  work_email: { type: DataTypes.STRING(255), allowNull: false, unique: true, field: 'email' },
  employee_code: { type: DataTypes.STRING(50), allowNull: false, unique: true },
  first_name: { type: DataTypes.STRING(100), allowNull: true },
  last_name: { type: DataTypes.STRING(100), allowNull: true },
  full_name: {
    type: DataTypes.VIRTUAL,
    get() {
      const fn = this.getDataValue('first_name') || '';
      const ln = this.getDataValue('last_name') || '';
      return (fn + ' ' + ln).trim() || this.getDataValue('employee_code');
    },
    set(val) {
      if (val) {
        const parts = String(val).trim().split(' ');
        this.setDataValue('first_name', parts[0] || '');
        this.setDataValue('last_name', parts.slice(1).join(' ') || null);
      }
    }
  },
  date_of_joining: { type: DataTypes.DATEONLY, allowNull: false, field: 'joined_date' },
  department_id: { type: DataTypes.BIGINT, allowNull: true },
  grade_id: { type: DataTypes.BIGINT, allowNull: true },
  management_level_id: { type: DataTypes.BIGINT, allowNull: true },
  region_id: { type: DataTypes.BIGINT, allowNull: true }, // "region of working" — filters which holidays apply
  gender: { type: DataTypes.STRING(10), allowNull: true, validate: { isIn: [['MALE', 'FEMALE']] } },
  marital_status: { type: DataTypes.STRING(20), allowNull: true }, // optional, free-text (e.g. Single/Married)
  designation: { type: DataTypes.STRING(100), allowNull: true, defaultValue: 'Employee' },
  reporting_manager_id: { type: DataTypes.BIGINT, allowNull: true, field: 'manager_id' },
  // Self-service "personal details" — the only fields an employee may edit on their own
  // record (see employeeService.updateOwnProfile); everything else on this model is
  // org-controlled and only reachable through HR/Admin-gated routes.
  phone: { type: DataTypes.STRING(30), allowNull: true },
  personal_email: { type: DataTypes.STRING(255), allowNull: true, validate: { isEmail: true } },
  date_of_birth: { type: DataTypes.DATEONLY, allowNull: true },
  emergency_contact_name: { type: DataTypes.STRING(150), allowNull: true },
  emergency_contact_phone: { type: DataTypes.STRING(30), allowNull: true },
  avatar_path: { type: DataTypes.STRING(500), allowNull: true }, // absolute disk path; served only via GET /employees/:id/avatar
  status: {
    type: DataTypes.VIRTUAL,
    get() {
      return this.getDataValue('is_active') === false || this.getDataValue('is_active') === 0 ? 'DEACTIVATED' : 'ACTIVE';
    },
    set(val) {
      this.setDataValue('is_active', val === 'ACTIVE' || val === true || val === 1);
    }
  },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  deactivated_at: { type: DataTypes.DATE, allowNull: true, field: 'deactivated_date' },
}, {
  tableName: 'users',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = Employee;
