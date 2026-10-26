import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { api, apiUrl, authHeaders, type FilePart } from './client';

export function uploadAttachment(requestId: number, file: FilePart) {
  return api.upload<{ attachment_id: number; file_name: string; content_type: string; size_bytes: number }>(
    `/api/attachments/${requestId}`,
    file,
  );
}

/** No dedicated web-friendly "view" endpoint — the same authenticated
 * download works everywhere, just delivered differently per platform (a
 * browser download vs. the native share sheet, since a bearer token can't
 * ride along with a plain `<a href>`/Linking.openURL the way a cookie can). */
export async function downloadAttachment(attachmentId: number, fileName: string): Promise<void> {
  const path = `/api/attachments/${attachmentId}/download`;
  const headers = await authHeaders();

  if (Platform.OS === 'web') {
    const response = await fetch(apiUrl(path), { headers });
    if (!response.ok) throw new Error(`Download failed (${response.status})`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
    return;
  }

  const file = await File.downloadFileAsync(apiUrl(path), new Directory(Paths.cache), { headers, idempotent: true });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri);
  }
}
