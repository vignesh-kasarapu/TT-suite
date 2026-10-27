import { apiClient } from './client';
import type {
  Asset,
  AssetBulkImportResponse,
  AssetCreatePayload,
  AssetStatus,
  AssetUpdatePayload,
  PaginatedAssetsResponse,
} from '../types';

export interface ListAssetsParams {
  page?: number;
  size?: number;
  sort?: string;
  search?: string;
  category?: string | number;
  status?: AssetStatus | '';
}

export async function listAssetsApi(
  params: ListAssetsParams = {},
): Promise<PaginatedAssetsResponse> {
  const query: Record<string, string | number> = {
    page: params.page ?? 1,
    size: params.size ?? 20,
    sort: params.sort ?? 'id,asc',
  };

  if (params.search && params.search.trim()) {
    query.search = params.search.trim();
  }
  if (params.category !== undefined && params.category !== '') {
    query.category = String(params.category);
  }
  if (params.status) {
    query.status = params.status;
  }

  const response = await apiClient.get<PaginatedAssetsResponse>('/assets', {
    params: query,
  });
  return response.data;
}

export async function getAssetApi(id: number): Promise<Asset> {
  const response = await apiClient.get<Asset>(`/assets/${id}`);
  return response.data;
}

export async function createAssetApi(payload: AssetCreatePayload): Promise<Asset> {
  const response = await apiClient.post<Asset>('/assets', payload);
  return response.data;
}

export async function updateAssetApi(
  id: number,
  payload: AssetUpdatePayload,
): Promise<Asset> {
  const response = await apiClient.put<Asset>(`/assets/${id}`, payload);
  return response.data;
}

export async function retireAssetApi(id: number): Promise<Asset> {
  const response = await apiClient.patch<Asset>(`/assets/${id}/retire`);
  return response.data;
}

export const ASSETS_SAMPLE_CSV = [
  'name\tserial_no\tcategory\tpurchase_date\tcost\tlocation\tassigned_to_email',
  'MacBook Pro 16 M4\tSN-MBP-9001\tLaptop\t2026-03-15\t195000.00\tHyderabad - Floor 14\temployee@tektalis.com',
  'Dell UltraSharp 27 4K\tSN-MON-9002\tMonitor\t2026-03-18\t48500.00\tHyderabad - Floor 14\t',
  'CalDigit TS4 Dock\tSN-DCK-9003\tDocking Station\t2026-03-20\t32000.00\tBengaluru - Floor 5\t',
].join('\n');

export interface AssetBulkImportPayload {
  excel_base64?: string;
  csv_content?: string;
}

export async function importAssetsDataApi(
  payload: AssetBulkImportPayload,
): Promise<AssetBulkImportResponse> {
  const response = await apiClient.post<AssetBulkImportResponse>(
    '/assets/import',
    payload,
  );
  return response.data;
}

export async function importAssetsCsvApi(
  csvContent: string,
): Promise<AssetBulkImportResponse> {
  return importAssetsDataApi({ csv_content: csvContent });
}

export async function downloadAssetsSampleCsv(
  filename = 'tektalis_assets_import_template.xlsx',
): Promise<void> {
  const response = await apiClient.get<Blob>('/assets/import/template', {
    responseType: 'blob',
  });
  if (typeof window === 'undefined' || !window.URL?.createObjectURL) {
    return;
  }
  const blob = new Blob([response.data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

