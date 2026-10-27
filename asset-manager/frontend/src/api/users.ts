import { apiClient } from './client';
import type {
  PaginatedUsersResponse,
  RoleChangeRequestResult,
  RoleRequest,
  SuiteRole,
  User,
  UserRole,
} from '../types';

// TT Suite: only the global admin (portal) creates people, assigns roles, changes emails and
// deactivates. AMS lists people and can *request* a role change for the global admin to approve.

export interface ListUsersParams {
  page?: number;
  size?: number;
  sort?: string;
  search?: string;
  role?: UserRole | '';
  active?: boolean | '';
}

export async function listUsersApi(params: ListUsersParams = {}): Promise<PaginatedUsersResponse> {
  const query: Record<string, string | number | boolean> = {
    page: params.page ?? 1,
    size: params.size ?? 20,
    sort: params.sort ?? 'id,asc',
  };

  if (params.search && params.search.trim()) {
    query.search = params.search.trim();
  }
  if (params.role) {
    query.role = params.role;
  }
  if (typeof params.active === 'boolean') {
    query.active = params.active;
  }

  const response = await apiClient.get<PaginatedUsersResponse>('/users', { params: query });
  return response.data;
}

export async function listUserDirectoryApi(activeOnly = false): Promise<User[]> {
  const response = await apiClient.get<User[]>('/users/directory', {
    params: { active_only: activeOnly },
  });
  return response.data;
}

/** Open role-change requests for Asset Management (ADMIN). */
export async function listRoleRequestsApi(): Promise<RoleRequest[]> {
  const response = await apiClient.get<RoleRequest[]>('/users/role-requests');
  return response.data;
}

/** Ask the global admin to change someone's role; `role: null` asks to remove their access. */
export async function requestRoleChangeApi(
  id: number,
  role: SuiteRole | null,
  note = '',
): Promise<RoleChangeRequestResult> {
  const response = await apiClient.post<RoleChangeRequestResult>(`/users/${id}/role-request`, {
    role,
    note,
  });
  return response.data;
}
