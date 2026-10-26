import { api } from './client';
import type { NotificationItem } from '../types/models';

export function listNotifications(unreadOnly = false) {
  return api.get<NotificationItem[]>('/api/notifications', { unread_only: unreadOnly });
}

export function getUnreadCount() {
  return api.get<{ count: number }>('/api/notifications/unread-count');
}

export function markRead(notificationId: number) {
  return api.post<NotificationItem>(`/api/notifications/${notificationId}/read`);
}

export function markAllRead() {
  return api.post<{ marked: boolean }>('/api/notifications/mark-all-read');
}
