const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// leave_ledger — generated from LMS 2.0 ER Design (37-table schema)

// BR-07 to BR-12: append-only. No update/delete path exists anywhere in this model or its service.
const LEDGER_ENTRY_TYPES = [
  'OPENING_PRO_RATA_CREDIT', 'PERIODIC_ACCRUAL_CREDIT', 'CARRY_FORWARD_CREDIT',
  'CARRY_FORWARD_LAPSE_DEBIT', 'LEAVE_DEDUCTION_DEBIT', 'CANCELLATION_RESTORATION_CREDIT',
  'MANUAL_ADJUSTMENT',
];

const LeaveLedger = sequelize.define('LeaveLedger', {
  entry_id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
  employee_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_type_id: { type: DataTypes.BIGINT, allowNull: false },
  leave_year_id: { type: DataTypes.BIGINT, allowNull: false },
  entry_type: { type: DataTypes.STRING(40), allowNull: false, validate: { isIn: [LEDGER_ENTRY_TYPES] } },
  quantity: { type: DataTypes.DECIMAL(8, 1), allowNull: false }, // signed
  source_reference: { type: DataTypes.STRING(100), allowNull: false },
  actor_id: { type: DataTypes.BIGINT, allowNull: true },
  is_system_actor: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  reason: { type: DataTypes.TEXT, allowNull: true }, // mandatory for MANUAL_ADJUSTMENT — enforced in service
}, { tableName: 'leave_ledger', updatedAt: false });

LeaveLedger.ENTRY_TYPES = LEDGER_ENTRY_TYPES;

module.exports = LeaveLedger;
