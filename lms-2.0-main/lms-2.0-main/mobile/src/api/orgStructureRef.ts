import { api } from './client';
import type { ManagementLevel, Region } from '../types/models';

/** Read-only reference lookups for employee-form pickers. Department/Grade/
 * Project CRUD exists server-side but has no web UI either (department is a
 * free-text field on the employee form there — see OnboardEmployeeIn's
 * department_name) — not duplicated here for the same reason. */
export function listRegions() {
  return api.get<Region[]>('/api/admin/regions');
}

export function listManagementLevels() {
  return api.get<ManagementLevel[]>('/api/admin/management-levels');
}
