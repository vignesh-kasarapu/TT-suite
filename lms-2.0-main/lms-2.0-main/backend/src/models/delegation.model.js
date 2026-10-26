const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// delegations — generated from LMS 2.0 ER Design (37-table schema)

const Delegation = sequelize.define('Delegation', {
  delegation_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  nominator_id: { type: DataTypes.BIGINT, allowNull: false },
  delegate_id: { type: DataTypes.BIGINT, allowNull: false }, // same management_level, else supervisor fallback (LMS-041)
  set_by_id: { type: DataTypes.BIGINT, allowNull: false }, // self or supervisor (LMS-042)
  from_date: { type: DataTypes.DATEONLY, allowNull: false },
  to_date: { type: DataTypes.DATEONLY, allowNull: false },
  revoked_at: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'delegations', updatedAt: false });

module.exports = Delegation;
