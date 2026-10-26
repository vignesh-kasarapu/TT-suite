const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// standing_watchers — generated from LMS 2.0 ER Design (37-table schema)

const StandingWatcher = sequelize.define('StandingWatcher', {
  standing_watcher_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  watched_employee_id: { type: DataTypes.BIGINT, allowNull: false },
  watcher_employee_id: { type: DataTypes.BIGINT, allowNull: false },
  from_date: { type: DataTypes.DATEONLY, allowNull: false },
  to_date: { type: DataTypes.DATEONLY, allowNull: false },
  added_by_id: { type: DataTypes.BIGINT, allowNull: false },
}, { tableName: 'standing_watchers', createdAt: 'added_at', updatedAt: false });

module.exports = StandingWatcher;
