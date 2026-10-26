import { api } from './client';
import type { LeaveTakenRow } from '../types/models';

export interface LeaveTakenFilters {
  from_date?: string;
  to_date?: string;
  leave_type_id?: number;
  state?: string;
  [key: string]: string | number | undefined;
}

export function getLeaveTakenReport(filters: LeaveTakenFilters = {}) {
  return api.get<LeaveTakenRow[]>('/api/reports/leave-taken', filters);
}
