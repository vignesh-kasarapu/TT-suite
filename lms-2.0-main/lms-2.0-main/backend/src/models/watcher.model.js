const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// watchers — generated from LMS 2.0 ER Design (37-table schema)

const Watcher = sequelize.define('Watcher', {
  watcher_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  request_id: { type: DataTypes.BIGINT, allowNull: false },
  watcher_employee_id: { type: DataTypes.BIGINT, allowNull: false }, // must hold MANAGER or HR_ADMIN, LMS-063
  added_by_id: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'watchers', createdAt: 'added_at', updatedAt: false });

module.exports = Watcher;
