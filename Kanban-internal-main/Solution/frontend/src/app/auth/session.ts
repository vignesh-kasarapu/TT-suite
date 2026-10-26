// Session-side helpers (FR-002, C-21; TC-117). Presentation state only: the server decides
// whether a session is valid. `preserve()` keeps the return URL and an unsent form across a
// re-authentication; `take()` restores it exactly once.
const PRESERVE_KEY = 'app.reauth';
const SIGNED_IN_KEY = 'app.signedIn';

export interface Preserved {
  returnTo: string;
  form?: Record<string, unknown>;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function preserve(p: Preserved): void {
  storage()?.setItem(PRESERVE_KEY, JSON.stringify(p));
}

/** Read and remove the preserved entry (null when nothing was preserved). */
export function take(): Preserved | null {
  const s = storage();
  const raw = s?.getItem(PRESERVE_KEY);
  if (!raw) return null;
  s?.removeItem(PRESERVE_KEY);
  try {
    const parsed = JSON.parse(raw) as Preserved;
    return typeof parsed.returnTo === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function peekReturnTo(): string | null {
  const raw = storage()?.getItem(PRESERVE_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as Preserved).returnTo ?? null;
  } catch {
    return null;
  }
}

/** Whether this browser tab had a session: a later 401 means "expired", not "never signed in". */
export function markSignedIn(): void {
  storage()?.setItem(SIGNED_IN_KEY, '1');
}
export function clearSignedIn(): void {
  storage()?.removeItem(SIGNED_IN_KEY);
}
export function wasSignedIn(): boolean {
  return storage()?.getItem(SIGNED_IN_KEY) === '1';
}

/** Only same-origin paths are ever used as a return target. */
export function safeReturnTo(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}
