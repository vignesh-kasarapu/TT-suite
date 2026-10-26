import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { apiUrl, authHeaders } from '../api/client';

export interface AuthenticatedImageSource {
  uri: string;
  headers?: Record<string, string>;
}

/** React Native's <Image source={{uri, headers}}> supports custom request
 * headers natively (iOS/Android), but react-native-web maps straight to a
 * plain <img> tag, which cannot send an Authorization header — so on web this
 * fetches the bytes itself and hands back a blob: URL (no headers needed)
 * instead. */
export function useAuthenticatedImage(path: string | null): AuthenticatedImageSource | null {
  const [source, setSource] = useState<AuthenticatedImageSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    if (!path) {
      setSource(null);
      return;
    }

    (async () => {
      const headers = await authHeaders();
      if (Platform.OS !== 'web') {
        if (!cancelled) setSource({ uri: apiUrl(path), headers });
        return;
      }
      try {
        const response = await fetch(apiUrl(path), { headers });
        if (!response.ok) return;
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSource({ uri: objectUrl });
      } catch {
        // No avatar / network error — caller falls back to a placeholder.
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return source;
}
