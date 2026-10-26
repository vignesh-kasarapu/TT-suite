/** Mirrors backend-py's app/core/responses.py envelope — every endpoint
 * returns {success:true, data} or {success:false, error:{code, message}}.
 * This is the one place that unwraps it, so every api/*.ts module gets typed
 * data back directly and a thrown ApiError on failure, never a raw Response. */
import { getToken } from '../services/tokenStore';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

type QueryValue = string | number | boolean | undefined | null;

function buildQuery(params?: Record<string, QueryValue>): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
  return `?${search.toString()}`;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: { body?: unknown; query?: Record<string, QueryValue> } = {},
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${BASE_URL}${path}${buildQuery(options.query)}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = await response.json().catch(() => null);

  if (!json || json.success !== true) {
    const error = json?.error ?? { code: 'UNKNOWN_ERROR', message: `Request failed (${response.status})` };
    throw new ApiError(error.code, error.message, response.status);
  }
  return json.data as T;
}

/** For avatar/attachment uploads — a `{ uri, name, type }` triple is what
 * expo-image-picker/expo-document-picker hand back, and is exactly the shape
 * React Native's FormData/fetch expects for a file part. Never sets
 * Content-Type manually — fetch computes the multipart boundary itself; doing
 * it by hand silently breaks the boundary and the server sees an empty body. */
export interface FilePart {
  uri: string;
  name: string;
  type: string;
}

async function upload<T>(path: string, file: FilePart): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const form = new FormData();
  // React Native's FormData accepts this object shape directly; it is not a
  // real web File/Blob and must not be constructed as one.
  form.append('file', file as unknown as Blob);

  const response = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: form });
  const json = await response.json().catch(() => null);

  if (!json || json.success !== true) {
    const error = json?.error ?? { code: 'UNKNOWN_ERROR', message: `Request failed (${response.status})` };
    throw new ApiError(error.code, error.message, response.status);
  }
  return json.data as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, query?: Record<string, QueryValue>) => request<T>('POST', path, { body, query }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T>(path: string, query?: Record<string, QueryValue>) => request<T>('DELETE', path, { query }),
  upload: <T>(path: string, file: FilePart) => upload<T>(path, file),
};

export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
