import { api } from './client';
import type { NotificationTemplate } from '../types/models';

export function listTemplates() {
  return api.get<NotificationTemplate[]>('/api/admin/notification-templates');
}

export function createTemplate(templateKey: string, subjectTemplate: string, bodyTemplate: string) {
  return api.post<NotificationTemplate>('/api/admin/notification-templates', {
    template_key: templateKey,
    subject_template: subjectTemplate,
    body_template: bodyTemplate,
  });
}

export function updateTemplate(templateKey: string, subjectTemplate: string, bodyTemplate: string) {
  return api.patch<NotificationTemplate>(`/api/admin/notification-templates/${templateKey}`, {
    subject_template: subjectTemplate,
    body_template: bodyTemplate,
  });
}

export function setTemplateActive(templateKey: string, isActive: boolean) {
  return api.patch<NotificationTemplate>(`/api/admin/notification-templates/${templateKey}/active`, { is_active: isActive });
}

export function deleteTemplate(templateKey: string) {
  return api.delete(`/api/admin/notification-templates/${templateKey}`);
}
