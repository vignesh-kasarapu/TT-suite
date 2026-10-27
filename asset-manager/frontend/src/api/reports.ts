import { apiClient } from './client';
import type { AssetStatus, ReportsSummaryResponse } from '../types';

export interface RegisterExportParams {
  status?: AssetStatus | '';
  category_id?: number | '';
  search?: string;
}

/** @deprecated Use RegisterExportParams */
export type CsvExportParams = RegisterExportParams;

function buildExportQuery(
  params?: RegisterExportParams,
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  if (params?.status) {
    query.status = params.status;
  }
  if (params?.category_id) {
    query.category_id = params.category_id;
  }
  if (params?.search && params.search.trim()) {
    query.search = params.search.trim();
  }
  return query;
}

export async function getReportsSummaryApi(): Promise<ReportsSummaryResponse> {
  const response = await apiClient.get<ReportsSummaryResponse>('/reports/summary');
  return response.data;
}

export async function downloadAssetsCsvApi(
  params?: RegisterExportParams,
): Promise<Blob> {
  const response = await apiClient.get('/reports/assets.csv', {
    params: buildExportQuery(params),
    responseType: 'blob',
  });
  return response.data as Blob;
}

export async function downloadAssetsPdfApi(
  params?: RegisterExportParams,
): Promise<Blob> {
  const response = await apiClient.get('/reports/assets.pdf', {
    params: buildExportQuery(params),
    responseType: 'blob',
  });
  return response.data as Blob;
}

export function triggerFileDownload(
  blob: Blob,
  filename: string,
): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** @deprecated Prefer triggerFileDownload */
export function triggerCsvFileDownload(
  blob: Blob,
  filename = 'assets_report.csv',
): void {
  triggerFileDownload(blob, filename);
}
