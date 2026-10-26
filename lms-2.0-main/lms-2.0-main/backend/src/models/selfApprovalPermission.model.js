const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// self_approval_permissions (R1 Addendum, table 37) — generated from LMS 2.0 ER Design (37-table schema)

// Controlled self-approval: active grant here AND no valid higher authority => stage SELF (see leaveRequestApproval).
const SelfApprovalPermission = sequelize.define('SelfApprovalPermission', {
  self_approval_permission_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false }, // grantee
  granted_by: { type: DataTypes.BIGINT, allowNull: false }, // Admin/HR_ADMIN only
  effective_from: { type: DataTypes.DATEONLY, allowNull: false },
  effective_to: { type: DataTypes.DATEONLY, allowNull: true }, // null = open-ended
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, // revocable by Admin/HR
  notes: { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName: 'self_approval_permissions',
  updatedAt: false,
  // MySQL has no partial/filtered unique index — "only one active grant per
  // employee" is enforced in the service layer (see admin/selfApproval service),
  // not at the schema level.
});

module.exports = SelfApprovalPermission;
