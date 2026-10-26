const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// audit_log — generated from LMS 2.0 ER Design (37-table schema)

// NFR-12: append-only, not modifiable through any application path.
const AuditLog = sequelize.define('AuditLog', {
  audit_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  actor_id: { type: DataTypes.BIGINT, allowNull: true },
  is_system_actor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  action: { type: DataTypes.STRING(80), allowNull: false },
  entity_type: { type: DataTypes.STRING(50), allowNull: false },
  entity_id: { type: DataTypes.STRING(50), allowNull: false },
  prior_value: { type: DataTypes.TEXT, allowNull: true },
  new_value: { type: DataTypes.TEXT, allowNull: true },
  timestamp: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'audit_log', timestamps: false });

module.exports = AuditLog;
