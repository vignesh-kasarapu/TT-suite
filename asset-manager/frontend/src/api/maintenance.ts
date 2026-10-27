import { apiClient } from './client';
import type {
  MaintenanceClosePayload,
  MaintenanceCreatePayload,
  MaintenanceRecord,
} from '../types';

export interface ListMaintenanceParams {
  open_only?: boolean;
  asset_id?: number;
}

export async function listMaintenanceRecordsApi(
  params: ListMaintenanceParams = {},
): Promise<MaintenanceRecord[]> {
  const query: Record<string, string | number | boolean> = {};
  if (typeof params.open_only === 'boolean') {
    query.open_only = params.open_only;
  }
  if (params.asset_id !== undefined) {
    query.asset_id = params.asset_id;
  }
  const response = await apiClient.get<MaintenanceRecord[]>('/maintenance', {
    params: query,
  });
  return response.data;
}

export async function openMaintenanceApi(
  assetId: number,
  payload: MaintenanceCreatePayload,
): Promise<MaintenanceRecord> {
  const response = await apiClient.post<MaintenanceRecord>(
    `/assets/${assetId}/maintenance`,
    payload,
  );
  return response.data;
}

export async function closeMaintenanceApi(
  recordId: number,
  payload?: MaintenanceClosePayload,
): Promise<MaintenanceRecord> {
  const response = await apiClient.patch<MaintenanceRecord>(
    `/maintenance/${recordId}/close`,
    payload ?? {},
  );
  return response.data;
}
