import { api } from './client';
import type { Employee } from '../types/models';

export interface OnboardEmployee {
  full_name: string;
  work_email: string;
  employee_code: string;
  date_of_joining: string;
  designation: string;
  role_code?: string | null;
  department_id?: number | null;
  department_name?: string | null;
  grade_id?: number | null;
  management_level_id?: number | null;
  region_id?: number | null;
  gender?: string | null;
  marital_status?: string | null;
  reporting_manager_id?: number | null;
}

export interface UpdateEmployeeDetails {
  full_name?: string;
  designation?: string;
  management_level_id?: number | null;
  gender?: string | null;
  marital_status?: string | null;
  region_id?: number | null;
  department_name?: string | null;
}

export function onboardEmployee(payload: OnboardEmployee) {
  return api.post<Employee>('/api/employees', payload);
}

export function updateEmployeeDetails(employeeId: number, payload: UpdateEmployeeDetails) {
  return api.patch<Employee>(`/api/employees/${employeeId}`, payload);
}

export function updateManager(employeeId: number, managerId: number) {
  return api.patch<Employee>(`/api/employees/${employeeId}/manager`, { manager_id: managerId });
}

export function listRoles(employeeId: number) {
  return api.get<string[]>(`/api/employees/${employeeId}/roles`);
}

export function assignRole(employeeId: number, roleCode: string) {
  return api.post<string[]>(`/api/employees/${employeeId}/roles`, undefined, { role_code: roleCode });
}

export function revokeRole(employeeId: number, roleCode: string) {
  return api.delete<string[]>(`/api/employees/${employeeId}/roles`, { role_code: roleCode });
}

export function deactivateEmployee(employeeId: number, lastWorkingDay: string) {
  return api.post<{ employee: Employee; settlement_id: number }>(`/api/employees/${employeeId}/deactivate`, { last_working_day: lastWorkingDay });
}

export function reassignManager(employeeId: number, newManagerId: number, transferPendingRequests: boolean) {
  return api.post(`/api/employees/${employeeId}/reassign-manager`, {
    new_manager_id: newManagerId,
    transfer_pending_requests: transferPendingRequests,
  });
}
