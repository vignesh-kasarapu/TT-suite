import React, { useEffect, useRef, useState } from 'react';
import styles from './SignOutDialog.module.css';

// TT Suite: sign out in place — a card over the page instead of the portal's /signout page.
// It asks the portal how many devices are signed in (GET /api/me/sessions), then signs out of
// this device or all of them (POST /api/auth/logout), clears AMS's local copy and goes to /login.

interface SessionsResponse {
  items?: Array<{ current?: boolean; userAgent?: string; createdAt?: string; lastSeenAt?: string }>;
}

type SessionsState =
  | { kind: 'loading' }
  | { kind: 'ready'; count: number }
  | { kind: 'error' };

interface SignOutDialogProps {
  /** Close the card without signing out (Cancel, Esc, backdrop). */
  onClose: () => void;
  /** Local cleanup once the server has signed out (AuthContext / localStorage). */
  onSignedOut: () => void;
  /** Where focus goes back to when the card closes (the sign-out button). */
  returnFocusTo?: React.RefObject<HTMLElement>;
}

const PRIMARY_BUTTON =
  'w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer';
const SECONDARY_BUTTON =
  'w-full px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer';

async function messageOf(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as Record<string, unknown> | null;
    for (const key of ['message', 'detail', 'error']) {
      const value = data?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  } catch {
    // Not JSON: fall through to the generic message.
  }
  return `Couldn't sign out (error ${response.status}). Try again.`;
}

export const SignOutDialog: React.FC<SignOutDialogProps> = ({ onClose, onSignedOut, returnFocusTo }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [sessions, setSessions] = useState<SessionsState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open as a modal (focus moves into the card); on unmount, focus goes back to the trigger.
  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = returnFocusTo?.current ?? null;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    primaryRef.current?.focus();
    return () => {
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      trigger?.focus();
    };
  }, [returnFocusTo]);

  useEffect(() => {
    let active = true;
    fetch('/api/me/sessions', { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<SessionsResponse>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!active) return;
        const count = Array.isArray(data?.items) ? data.items.length : 0;
        setSessions({ kind: 'ready', count });
      })
      .catch(() => {
        if (active) setSessions({ kind: 'error' });
      });
    return () => {
      active = false;
    };
  }, []);

  const signOut = async (everywhere: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XHR' },
        body: JSON.stringify({ everywhere }),
      });
      if (!response.ok) {
        setError(await messageOf(response));
        setBusy(false);
        return;
      }
    } catch {
      setError("Couldn't reach the server to sign out. Check your connection and try again.");
      setBusy(false);
      return;
    }
    onSignedOut();
    window.location.assign('/login');
  };

  // Esc: the browser fires "cancel"; keep the card while a sign-out is in flight.
  const handleCancel = (event: React.SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!busy) onClose();
  };

  // A click on the dialog element itself (not the card inside it) is a click on the backdrop.
  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget && !busy) onClose();
  };

  const count = sessions.kind === 'ready' ? sessions.count : 0;
  let devicesText: string | null = null;
  if (sessions.kind === 'loading') devicesText = 'Checking…';
  else if (sessions.kind === 'ready') {
    devicesText = count > 1 ? `You're signed in on ${count} devices.` : "You're signed in on this device only.";
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      data-testid="signout-dialog"
      aria-labelledby="signout-dialog-title"
      aria-describedby={devicesText ? 'signout-dialog-devices' : undefined}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
    >
      <div className={styles.card}>
        <h2 id="signout-dialog-title" className={styles.title}>
          Sign out
        </h2>
        {devicesText && (
          <p id="signout-dialog-devices" className={styles.text} aria-live="polite">
            {devicesText}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert" data-testid="signout-error">
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <button
            ref={primaryRef}
            type="button"
            className={PRIMARY_BUTTON}
            data-testid="signout-this"
            disabled={busy}
            onClick={() => void signOut(false)}
          >
            Sign out of this device
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            data-testid="signout-all"
            disabled={busy}
            onClick={() => void signOut(true)}
          >
            {count > 1 ? `Sign out of all devices (${count})` : 'Sign out of all devices'}
          </button>
          <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
};
