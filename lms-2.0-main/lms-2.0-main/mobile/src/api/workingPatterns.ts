import { api } from './client';
import type { WorkingPattern, WorkingPatternAssignmentDetail } from '../types/models';

export function listWorkingPatterns(includeInactive = true) {
  return api.get<WorkingPattern[]>('/api/admin/working-patterns', { include_inactive: includeInactive });
}

export function createWorkingPattern(patternCode: string, patternName: string, weekendDays: string[]) {
  return api.post<WorkingPattern>('/api/admin/working-patterns', { pattern_code: patternCode, pattern_name: patternName, weekend_days: weekendDays });
}

export function deactivateWorkingPattern(id: number) {
  return api.post(`/api/admin/working-patterns/${id}/deactivate`);
}

export function reactivateWorkingPattern(id: number) {
  return api.post(`/api/admin/working-patterns/${id}/reactivate`);
}

export function listWorkingPatternAssignments() {
  return api.get<WorkingPatternAssignmentDetail[]>('/api/admin/working-pattern-assignments');
}

export function assignWorkingPattern(employeeId: number, workingPatternId: number, effectiveFrom: string, effectiveTo?: string | null) {
  return api.post('/api/admin/working-pattern-assignments', {
    employee_id: employeeId,
    working_pattern_id: workingPatternId,
    effective_from: effectiveFrom,
    effective_to: effectiveTo ?? null,
  });
}
