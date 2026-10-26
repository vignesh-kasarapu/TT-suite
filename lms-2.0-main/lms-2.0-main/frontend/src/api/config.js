import client from './client';

export const listConfig = () => client.get('/config');
export const updateConfig = (key, value, valueType) => client.patch(`/config/${key}`, { value, valueType });
