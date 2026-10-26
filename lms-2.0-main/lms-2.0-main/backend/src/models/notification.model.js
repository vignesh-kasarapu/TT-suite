const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// notifications — generated from LMS 2.0 ER Design (37-table schema)

const Notification = sequelize.define('Notification', {
  notification_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  recipient_id: { type: DataTypes.BIGINT, allowNull: false },
  channel: { type: DataTypes.STRING(10), allowNull: false, validate: { isIn: [['EMAIL', 'IN_APP']] } },
  template_key: { type: DataTypes.STRING(100), allowNull: false },
  subject: { type: DataTypes.STRING(500), allowNull: false },
  body: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'PENDING', validate: { isIn: [['PENDING', 'SENT', 'FAILED', 'SUPPRESSED']] } },
  read_at: { type: DataTypes.DATE, allowNull: true },
  related_request_id: { type: DataTypes.BIGINT, allowNull: true },
  error_message: { type: DataTypes.TEXT, allowNull: true },
  sent_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'notifications', updatedAt: false });

module.exports = Notification;
