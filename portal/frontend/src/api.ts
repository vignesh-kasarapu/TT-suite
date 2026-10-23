// Portal API client: same-origin cookies, the CSRF header on writes, `{code, detail}` errors.
export type AppKey = 'lms' | 'expense' | 'kanban';
export type Access = Record<AppKey, string | null>;
export type Preferences = { preset: string; mode: string };

export type Me = {
  id: string;
  email: string;
  name: string;
  isGlobalAdmin: boolean;
  photoUrl: string | null;
  access: Access;
  preferences: Preferences;
};

export type SuiteUser = {
  id: string;
  email: string;
  name: string;
  status: 'invited' | 'active' | 'inactive';
  isGlobalAdmin: boolean;
  invitedAt: string | null;
  lastLoginAt: string | null;
  access: Access;
};

export type AppError = { app: string; code: string; detail: string };
export type ChangeReport = { user: SuiteUser; errors: AppError[]; mailDelivery?: 'stub' | 'graph' | 'smtp' };
export type Grant = { role: string | null; leadTeamIds?: string[] };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== 'GET') headers.set('X-Requested-With', 'XHR');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? 'ERROR', body?.detail ?? 'Something went wrong.');
  }
  return body as T;
}

export const json = (data: unknown) => JSON.stringify(data);

export function goToLogin(): void {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/login?returnTo=${encodeURIComponent(here)}`);
}

export const APPS: { key: AppKey; title: string; short: string; description: string }[] = [
  { key: 'lms', title: 'Leave Management', short: 'LMS', description: 'Apply for leave, approve requests and track balances.' },
  { key: 'expense', title: 'Expense Management', short: 'EMS', description: 'Submit claims, approve expenses and reimburse.' },
  { key: 'kanban', title: 'Kanban', short: 'Kanban', description: 'Plan work on team boards, log time and track delivery.' },
];

export const ROLES: Record<AppKey, string[]> = {
  lms: ['employee', 'manager', 'admin'],
  expense: ['member', 'approver', 'finance', 'admin'],
  kanban: ['member', 'lead', 'admin'],
};

export const roleLabel = (role: string | null | undefined): string =>
  role ? role.charAt(0).toUpperCase() + role.slice(1) : 'No access';
