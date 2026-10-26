const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// organization_configs — generated from LMS 2.0 ER Design (37-table schema)

// BR-01,03,04,20-23,27,29,33,45 etc. — every [CONFIG] value in the FRD lives here. Never hard-coded.
const OrganizationConfig = sequelize.define('OrganizationConfig', {
  config_key: { type: DataTypes.STRING(100), primaryKey: true },
  config_value: { type: DataTypes.TEXT, allowNull: false },
  value_type: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['STRING', 'INT', 'BOOL', 'JSON']] } },
  description: { type: DataTypes.STRING(500), allowNull: true },
  updated_by: { type: DataTypes.BIGINT, allowNull: true }, // null = system-seeded default, never set by a request
}, { tableName: 'organization_configs', createdAt: false });

module.exports = OrganizationConfig;
