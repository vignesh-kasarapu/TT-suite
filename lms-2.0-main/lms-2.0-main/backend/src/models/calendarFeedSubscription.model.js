const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// calendar_feed_subscriptions (R3 — LMS-082) — generated from LMS 2.0 ER Design (37-table schema)

const CalendarFeedSubscription = sequelize.define('CalendarFeedSubscription', {
  subscription_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  feed_token_hash: { type: DataTypes.STRING(128), allowNull: false, unique: true },
  scope: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['OWN', 'TEAM']] } },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'calendar_feed_subscriptions', updatedAt: false });

module.exports = CalendarFeedSubscription;
