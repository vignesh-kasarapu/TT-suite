import { apiClient } from './client';
import type {
  AssetCreatePayload,
  AssetHistoryResponse,
  AssignAssetPayload,
  AssignedAsset,
  AssignmentRecord,
  ReturnAssetPayload,
} from '../types';

export async function assignAssetApi(
  assetId: number,
  payload: AssignAssetPayload,
): Promise<AssignmentRecord> {
  const response = await apiClient.post<AssignmentRecord>(
    `/assets/${assetId}/assign`,
    payload,
  );
  return response.data;
}

export async function returnAssetApi(
  assetId: number,
  payload: ReturnAssetPayload,
): Promise<AssignmentRecord> {
  const response = await apiClient.post<AssignmentRecord>(
    `/assets/${assetId}/return`,
    payload,
  );
  return response.data;
}

export async function getAssetHistoryApi(
  assetId: number,
): Promise<AssetHistoryResponse> {
  const response = await apiClient.get<AssetHistoryResponse>(
    `/assets/${assetId}/history`,
  );
  return response.data;
}

export async function listMyAssetsApi(): Promise<AssignedAsset[]> {
  const response = await apiClient.get<AssignedAsset[]>('/me/assets');
  return response.data;
}

export async function registerMyAssetApi(
  payload: AssetCreatePayload,
): Promise<AssignedAsset> {
  const response = await apiClient.post<AssignedAsset>('/me/assets', payload);
  return response.data;
}

export interface EmployeeAssetDetailsPayload {
  name?: string | null;
  serial_no?: string | null;
  service_tag?: string | null;
  asset_tag?: string | null;
  purchase_date?: string | null;
  cost?: number | null;
  location?: string | null;
}

export async function fillMyAssetDetailsApi(
  assetId: number,
  payload: EmployeeAssetDetailsPayload,
): Promise<AssignedAsset> {
  const response = await apiClient.patch<AssignedAsset>(
    `/me/assets/${assetId}/details`,
    payload,
  );
  return response.data;
}

export async function listUserAssetsApi(userId: number): Promise<AssignedAsset[]> {
  const response = await apiClient.get<AssignedAsset[]>(`/users/${userId}/assets`);
  return response.data;
}
