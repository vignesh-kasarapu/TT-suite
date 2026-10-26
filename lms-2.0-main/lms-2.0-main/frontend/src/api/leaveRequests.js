import client from './client';

export const previewApplication = (params) => client.get('/leave-requests/preview', { params });
export const submitRequest = (payload) => client.post('/leave-requests', payload);
export const getMyRequests = () => client.get('/leave-requests/my');
export const getRequestDetail = (requestId) => client.get(`/leave-requests/${requestId}`);
export const getApprovalsQueue = () => client.get('/leave-requests/approvals-queue');
export const decideRequest = (requestId, decision, reason) =>
  client.post(`/leave-requests/${requestId}/decision`, { decision, reason });
export const withdrawRequest = (requestId) => client.post(`/leave-requests/${requestId}/withdraw`);
export const requestCancellation = (requestId) => client.post(`/leave-requests/${requestId}/cancellation`);
export const decideCancellation = (requestId, decision, unelapsedDays) =>
  client.post(`/leave-requests/${requestId}/cancellation/decision`, { decision, unelapsedDays });
export const addWatcher = (requestId, watcherEmployeeId) =>
  client.post(`/leave-requests/${requestId}/watchers`, { watcherEmployeeId });
export const removeWatcher = (requestId, watcherId) => client.delete(`/leave-requests/${requestId}/watchers/${watcherId}`);
export const saveDraft = (payload) => client.post('/leave-requests/draft', payload);
export const submitDraft = (requestId) => client.post(`/leave-requests/draft/${requestId}/submit`);
export const discardDraft = (requestId) => client.delete(`/leave-requests/draft/${requestId}`);
