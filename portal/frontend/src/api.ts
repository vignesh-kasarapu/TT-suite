// Portal API client: same-origin cookies, the CSRF header on writes, `{code, detail}` errors.
export type AppKey = 'lms' | 'expense' | 'kanban' | 'ams' | 'resume';
export type Access = Record<AppKey, string | null>;
export type Preferences = { preset: string; mode: string };

export type Me = {
  id: string;
  email: string;
  name: string;
  employeeCode: string | null;
  isGlobalAdmin: boolean;
  photoUrl: string | null;
  jobTitle: string;
  phone: string;
  location: string;
  /** The rest of the person's own details (0008). Every app copies what it keeps from here,
   * so these are edited once, on Profile. */
  personalEmail: string;
  dateOfBirth: string | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  gender: string;
  maritalStatus: string;
  access: Access;
  /** This deployment's apps: the server's SUITE_SKIP can leave some out (e.g. the Resume Evaluator). */
  apps?: AppKey[];
  preferences: Preferences;
  unreadCount: number;
};

export type InboxItem = {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

export type RoleRequest = {
  id: number;
  app: AppKey;
  userId: string;
  email: string;
  name: string;
  role: string | null;
  leadTeamIds: string[];
  note: string;
  status: 'pending' | 'approved' | 'declined';
  requestedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  decisionNote: string;
};

export type Device = { key: string; createdAt: string; lastSeenAt: string; expiresAt: string; userAgent: string; current: boolean };

export type SuiteUser = {
  id: string;
  email: string;
  name: string;
  employeeCode: string | null;
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
  { key: 'ams', title: 'Asset Management', short: 'AMS', description: 'Track laptops and equipment, assignments, repairs and replacements.' },
  { key: 'resume', title: 'Resume Evaluator', short: 'Resumes', description: 'Score, compare and shortlist candidate resumes.' },
];

/** The apps in this deployment (all of APPS unless the server skips some with SUITE_SKIP). */
export const activeApps = (me: Pick<Me, 'apps'> | null | undefined) =>
  (me?.apps ? APPS.filter((a) => me.apps!.includes(a.key)) : APPS);

/** Apps nobody sees - no card, no access request - until a global admin grants a role. */
export const HIDDEN_UNLESS_GRANTED: ReadonlySet<AppKey> = new Set<AppKey>(['resume']);

export const ROLES: Record<AppKey, string[]> = {
  lms: ['employee', 'manager', 'admin'],
  expense: ['member', 'approver', 'finance', 'admin'],
  kanban: ['member', 'lead', 'admin'],
  ams: ['employee', 'manager', 'admin'],
  resume: ['recruiter', 'admin'],
};

export const roleLabel = (role: string | null | undefined): string =>
  role ? role.charAt(0).toUpperCase() + role.slice(1) : 'No access';

/** "5 min ago", "yesterday", "12 Oct". */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  if (seconds < 172800) return 'yesterday';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "Chrome on Windows" from a user-agent string (good enough to tell devices apart). */
export function describeDevice(ua: string): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
