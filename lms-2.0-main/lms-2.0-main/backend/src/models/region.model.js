const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// regions — "region of working" master list, same shape as departments/grades.

const Region = sequelize.define('Region', {
  region_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  region_code: { type: DataTypes.STRING(30), allowNull: false, unique: true },
  region_name: { type: DataTypes.STRING(100), allowNull: false },
  is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'regions', timestamps: false });

module.exports = Region;
