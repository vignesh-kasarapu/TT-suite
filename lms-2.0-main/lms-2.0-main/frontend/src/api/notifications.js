import client from './client';

export const listNotifications = (params) => client.get('/notifications', { params });
export const getUnreadCount = () => client.get('/notifications/unread-count');
export const markNotificationRead = (id) => client.post(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => client.post('/notifications/mark-all-read');
