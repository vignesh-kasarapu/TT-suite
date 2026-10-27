import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getMySessions, signOut } from '../../api/portal';

/** The suite's sign-out card: a native modal <dialog> opened in place (not a page).
 * Shows how many devices the user is signed in on and offers "this device" / "all devices".
 * Esc and a click on the backdrop close it; focus goes into the card on open and back to
 * whatever opened it on close. */
export default function SignOutDialog({ open, onClose }) {
  const dialogRef = useRef(null);
  const primaryRef = useRef(null);
  const triggerRef = useRef(null);
  const [sessions, setSessions] = useState({ status: 'idle', count: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    if (!open) {
      if (dialog.open) dialog.close();
      return undefined;
    }

    triggerRef.current = document.activeElement;
    setError('');
    setBusy(false);
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    primaryRef.current?.focus();

    let cancelled = false;
    setSessions({ status: 'loading', count: 0 });
    getMySessions()
      .then((items) => { if (!cancelled) setSessions({ status: 'ready', count: items.length }); })
      .catch(() => { if (!cancelled) setSessions({ status: 'error', count: 0 }); });

    return () => {
      cancelled = true;
      const trigger = triggerRef.current;
      if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus();
    };
  }, [open]);

  // Esc fires 'cancel' then 'close'; any close (Esc, backdrop, Cancel) reports back.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const handleClose = () => onClose?.();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  const close = () => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else onClose?.();
  };

  // The <dialog> has no padding, so a click whose target is the dialog itself is on the backdrop.
  const onBackdropClick = (e) => {
    if (e.target === dialogRef.current && !busy) close();
  };

  const onCancel = (e) => {
    if (busy) e.preventDefault();
  };

  const doSignOut = async (everywhere) => {
    setBusy(true);
    setError('');
    try {
      await signOut({ everywhere });
    } catch (err) {
      setError(err?.message || 'Sign out failed. Please try again.');
      setBusy(false);
    }
  };

  const { status, count } = sessions;
  let deviceText = null;
  if (status === 'loading') deviceText = 'Checking…';
  else if (status === 'ready') {
    deviceText = count > 1 ? `You're signed in on ${count} devices.` : "You're signed in on this device only.";
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className="signout-dialog"
      data-testid="signout-dialog"
      aria-labelledby="signout-dialog-title"
      onClick={onBackdropClick}
      onCancel={onCancel}
    >
      {open && (
        <div className="signout-card">
          <h2 id="signout-dialog-title">Sign out</h2>
          {deviceText && <p aria-live="polite">{deviceText}</p>}
          {error && <p className="error-msg" role="alert">{error}</p>}
          <div className="signout-actions">
            <button ref={primaryRef} type="button" className="btn btn--primary" data-testid="signout-this"
              disabled={busy} onClick={() => doSignOut(false)}>
              Sign out of this device
            </button>
            <button type="button" className="btn btn--secondary" data-testid="signout-all"
              disabled={busy} onClick={() => doSignOut(true)}>
              {`Sign out of all devices${status === 'ready' && count > 1 ? ` (${count})` : ''}`}
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </dialog>,
    document.body,
  );
}
