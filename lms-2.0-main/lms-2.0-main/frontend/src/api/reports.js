import client from './client';

export const getLeaveTakenReport = (params) => client.get('/reports/leave-taken', { params });
export const getLopReport = (params) => client.get('/reports/lop', { params });
export const getLopPending = () => client.get('/reports/lop-pending');
export const getEncashmentReport = (params) => client.get('/reports/encashment', { params });
export const getCompOffReport = (params) => client.get('/reports/comp-off', { params });
export const getBalancesReport = (params) => client.get('/reports/balances', { params });
export const getEntitlementReport = (params) => client.get('/reports/entitlement', { params });
export const getRestrictionReport = (params) => client.get('/reports/restrictions', { params });
export const getAdjustmentReport = (params) => client.get('/reports/adjustments', { params });
export const getCarryForwardReport = (params) => client.get('/reports/carry-forward', { params });
export const getArchivedLeaveTypeReport = () => client.get('/reports/archived-leave-types');
// Downloads the same rows the screen shows. `name` is leave-taken | lop | encashment | comp-off |
// balances | entitlement | restrictions | adjustments | carry-forward | archived-leave-types | audit-log,
// `format` is csv | xlsx.
export const downloadReport = async (name, params, format) => {
  const blob = await client.get(`/reports/${name}`, { params: { ...params, export: format }, responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 10)}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
export const getAuditLog = (params) => client.get('/reports/audit-log', { params });
