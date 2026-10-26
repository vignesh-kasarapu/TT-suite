import client from './client';

export const getMyLedger = (params) => client.get('/ledger/my', { params });
export const adjustBalance = (payload) => client.post('/ledger/adjust', payload);
export const getEmployeeLedger = (employeeId, params) => client.get(`/ledger/employee/${employeeId}`, { params });
export const getAllLedgerEntries = (params) => client.get('/ledger', { params });
