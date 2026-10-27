import { apiClient } from './client';
import type {
  ApproveReplacementPayload,
  HoldReplacementPayload,
  RejectReplacementPayload,
  ReplacementRequest,
  ReplacementRequestCreatePayload,
  ReplacementStatus,
} from '../types';

export async function listReplacementRequestsApi(
  status?: ReplacementStatus,
): Promise<ReplacementRequest[]> {
  const response = await apiClient.get<ReplacementRequest[]>(
    '/replacement-requests',
    {
      params: status ? { status } : undefined,
    },
  );
  return response.data;
}

export async function createReplacementRequestApi(
  payload: ReplacementRequestCreatePayload,
): Promise<ReplacementRequest> {
  const response = await apiClient.post<ReplacementRequest>(
    '/replacement-requests',
    payload,
  );
  return response.data;
}

export async function approveReplacementRequestApi(
  id: number,
  payload: ApproveReplacementPayload,
): Promise<ReplacementRequest> {
  const response = await apiClient.patch<ReplacementRequest>(
    `/replacement-requests/${id}/approve`,
    payload,
  );
  return response.data;
}

export async function rejectReplacementRequestApi(
  id: number,
  payload: RejectReplacementPayload,
): Promise<ReplacementRequest> {
  const response = await apiClient.patch<ReplacementRequest>(
    `/replacement-requests/${id}/reject`,
    payload,
  );
  return response.data;
}

export async function holdReplacementRequestApi(
  id: number,
  payload: HoldReplacementPayload = {},
): Promise<ReplacementRequest> {
  const response = await apiClient.patch<ReplacementRequest>(
    `/replacement-requests/${id}/hold`,
    payload,
  );
  return response.data;
}
