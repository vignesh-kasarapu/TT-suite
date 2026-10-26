import client from './client';
import { API_BASE } from './paths';

// Upload uses multipart/form-data, so it bypasses the default JSON content-type.
export const uploadAttachment = (requestId, file) => {
  const form = new FormData();
  form.append('file', file);
  return client.post(`/attachments/${requestId}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const attachmentDownloadUrl = (attachmentId) => `${API_BASE}/attachments/${attachmentId}/download`;
