import { api } from './client';
import type { Delegation, EligibleDelegates } from '../types/models';

export function getEligibleDelegates() {
  return api.get<EligibleDelegates>('/api/delegations/eligible');
}

export function getMyDelegations() {
  return api.get<Delegation[]>('/api/delegations/mine');
}

export function nominateDelegate(delegateId: number, fromDate: string, toDate: string) {
  return api.post<Delegation>('/api/delegations', { delegate_id: delegateId, from_date: fromDate, to_date: toDate });
}

export function revokeDelegation(delegationId: number) {
  return api.post<Delegation>(`/api/delegations/${delegationId}/revoke`);
}
