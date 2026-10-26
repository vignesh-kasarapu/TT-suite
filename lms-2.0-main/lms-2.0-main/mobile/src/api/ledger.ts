import { api } from './client';
import type { LedgerEntry } from '../types/models';

export function getMyLedger(leaveYearId?: number) {
  return api.get<LedgerEntry[]>('/api/ledger/my', { leave_year_id: leaveYearId });
}
