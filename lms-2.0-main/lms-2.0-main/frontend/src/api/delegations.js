import client from './client';

export const getEligibleDelegates = () => client.get('/delegations/eligible');
export const listDelegationManagers = () => client.get('/delegations/managers');
export const getEligibleDelegatesForManager = (nominatorId) => client.get(`/delegations/eligible-for/${nominatorId}`);
export const getMyDelegations = () => client.get('/delegations/mine');
export const createDelegation = (payload) => client.post('/delegations', payload);
export const createDelegationOnBehalf = (payload) => client.post('/delegations/on-behalf', payload);
export const revokeDelegation = (delegationId) => client.post(`/delegations/${delegationId}/revoke`);
export const listAllDelegations = () => client.get('/delegations');
