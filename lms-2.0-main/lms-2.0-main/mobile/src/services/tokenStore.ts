/** The one place that touches SecureStore for the session token — mirrors
 * backend-py's "one session-token function pair" discipline on the client
 * side. Never import expo-secure-store anywhere else.
 *
 * expo-secure-store has no web implementation (it's backed by Keychain/
 * Keystore, both native-only) — calling it under `expo start --web` throws
 * "getValueWithKeyAsync is not a function" immediately on mount. Web is a
 * dev-preview convenience only (the real targets are Expo Go/native builds),
 * so it falls back to localStorage there instead of failing outright. */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'lms_session_token';

// In-memory mirror so synchronous reads (e.g. inside a fetch call already in
// flight) don't need to await SecureStore on every single request.
let cached: string | null | undefined;

async function readStored(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
  return SecureStore.getItemAsync(KEY);
}

async function writeStored(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    } catch {
      // Private browsing / storage disabled — token just won't persist across reloads.
    }
    return;
  }
  if (token) {
    await SecureStore.setItemAsync(KEY, token);
  } else {
    await SecureStore.deleteItemAsync(KEY);
  }
}

export async function getToken(): Promise<string | null> {
  if (cached !== undefined) return cached;
  cached = await readStored();
  return cached;
}

export async function setToken(token: string | null): Promise<void> {
  cached = token;
  await writeStored(token);
}
