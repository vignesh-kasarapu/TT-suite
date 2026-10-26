const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// notification_digest_preferences (R2 — LMS-072) — generated from LMS 2.0 ER Design (37-table schema)

const NotificationDigestPreference = sequelize.define('NotificationDigestPreference', {
  preference_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
  digest_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, { tableName: 'notification_digest_preferences', createdAt: false });

module.exports = NotificationDigestPreference;
