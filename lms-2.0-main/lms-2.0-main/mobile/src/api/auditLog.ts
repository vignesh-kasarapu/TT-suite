import { api } from './client';
import type { AuditLogRow } from '../types/models';

export interface AuditLogFilters {
  actor_id?: number;
  action?: string;
  entity_type?: string;
  [key: string]: string | number | undefined;
}

export function getAuditLog(filters: AuditLogFilters = {}) {
  return api.get<AuditLogRow[]>('/api/reports/audit-log', filters);
}
