import { api } from './client';
import type { LedgerAllEntry } from '../types/models';

export interface LedgerFilters {
  employee_id?: number;
  leave_type_id?: number;
  leave_year_id?: number;
  entry_type?: string;
  page?: number;
  page_size?: number;
  [key: string]: string | number | undefined;
}

export function listAllLedgerEntries(filters: LedgerFilters = {}) {
  return api.get<LedgerAllEntry[]>('/api/ledger', filters);
}

export function getEmployeeLedger(employeeId: number, leaveYearId?: number) {
  return api.get<LedgerAllEntry[]>(`/api/ledger/employee/${employeeId}`, { leave_year_id: leaveYearId });
}

export function adjustBalance(employeeId: number, leaveTypeId: number, leaveYearId: number, quantity: number, reason: string) {
  return api.post<{ entry_id: number; quantity: number }>('/api/ledger/adjust', {
    employee_id: employeeId,
    leave_type_id: leaveTypeId,
    leave_year_id: leaveYearId,
    quantity,
    reason,
  });
}
