import { apiClient } from './client';
import type {
  ApproveAssetRequestPayload,
  AssetRequest,
  AssetRequestCreatePayload,
  AssetRequestStatus,
  AvailableAssetsForRequestResponse,
  RejectAssetRequestPayload,
} from '../types';

export async function listAssetRequestsApi(
  status?: AssetRequestStatus,
): Promise<AssetRequest[]> {
  const response = await apiClient.get<AssetRequest[]>('/asset-requests', {
    params: status ? { status } : undefined,
  });
  return response.data;
}

export async function createAssetRequestApi(
  payload: AssetRequestCreatePayload,
): Promise<AssetRequest> {
  const response = await apiClient.post<AssetRequest>('/asset-requests', payload);
  return response.data;
}

export async function listAvailableAssetsForRequestApi(
  id: number,
  categoryId?: number,
): Promise<AvailableAssetsForRequestResponse> {
  const response = await apiClient.get<AvailableAssetsForRequestResponse>(
    `/asset-requests/${id}/available-assets`,
    {
      params:
        categoryId !== undefined ? { category_id: categoryId } : undefined,
    },
  );
  return response.data;
}

export async function approveAssetRequestApi(
  id: number,
  payload: ApproveAssetRequestPayload = {},
): Promise<AssetRequest> {
  const response = await apiClient.patch<AssetRequest>(
    `/asset-requests/${id}/approve`,
    payload,
  );
  return response.data;
}

export async function rejectAssetRequestApi(
  id: number,
  payload: RejectAssetRequestPayload,
): Promise<AssetRequest> {
  const response = await apiClient.patch<AssetRequest>(
    `/asset-requests/${id}/reject`,
    payload,
  );
  return response.data;
}
