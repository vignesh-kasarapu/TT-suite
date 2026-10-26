const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_request_attachments — generated from LMS 2.0 ER Design (37-table schema)

const LeaveRequestAttachment = sequelize.define('LeaveRequestAttachment', {
  attachment_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  request_id: { type: DataTypes.BIGINT, allowNull: false },
  file_name: { type: DataTypes.STRING(255), allowNull: false },
  content_type: { type: DataTypes.STRING(100), allowNull: false },
  size_bytes: { type: DataTypes.BIGINT, allowNull: false },
  storage_path: { type: DataTypes.STRING(500), allowNull: false }, // stored outside web root, NFR-10
  uploaded_by: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'leave_request_attachments', createdAt: 'uploaded_at', updatedAt: false });

module.exports = LeaveRequestAttachment;
