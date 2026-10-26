import { api } from './client';
import type { OrgConfig } from '../types/models';

export function listConfig() {
  return api.get<OrgConfig[]>('/api/config');
}

export function updateConfig(key: string, value: unknown, valueType: string) {
  return api.patch<{ key: string; prior_value: unknown; new_value: unknown }>(`/api/config/${key}`, { value, value_type: valueType });
}
