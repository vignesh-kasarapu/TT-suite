// Sign out as a card over the page (not the portal's /signout page): says how many devices are signed in
// (portal GET /api/me/sessions), then signs out of this device or all of them. Esc, the backdrop and
// Cancel close it; focus goes into the card on open and back to whatever opened it on close.
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { useAuth } from "../../controllers/useAuth";
import { Button } from "./ui";

interface Session { current: boolean; userAgent?: string; createdAt?: string; lastSeenAt?: string }

export function SignOutDialog({ open, onOpenChange, returnFocus }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** Where focus goes when the card closes (the button that opened it, or a fallback if that is gone). */
  returnFocus?: () => HTMLElement | null;
}) {
  const { signOut } = useAuth();
  const [devices, setDevices] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"this" | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null); setBusy(null); setDevices(null); setLoading(true);
    fetch("/api/me/sessions", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: Session[] }) => { if (live) setDevices(Array.isArray(d.items) ? d.items.length : null); })
      .catch(() => { if (live) setDevices(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open]);

  const go = async (everywhere: boolean) => {
    setError(null); setBusy(everywhere ? "all" : "this");
    try {
      await signOut(everywhere);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't sign you out. Try again.");
      setBusy(null);
    }
  };

  const status = loading ? "Checking…"
    : devices === null ? null
    : devices > 1 ? `You're signed in on ${devices} devices.` : "You're signed in on this device only.";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog signout-card" data-testid="signout-dialog" aria-describedby={status ? "signout-status" : undefined}
          onCloseAutoFocus={(e) => {
            const el = returnFocus?.();
            if (el && el.isConnected) { e.preventDefault(); el.focus(); }
          }}>
          <Dialog.Title>Sign out</Dialog.Title>
          {status && <p id="signout-status" className="muted" aria-live="polite">{status}</p>}
          {error && <p className="error-msg" role="alert">{error}</p>}
          <div className="signout-actions">
            <Button variant="primary" data-testid="signout-this" busy={busy === "this"} busyLabel="Signing out" disabled={!!busy} onClick={() => go(false)}>
              Sign out of this device
            </Button>
            <Button variant="secondary" data-testid="signout-all" busy={busy === "all"} busyLabel="Signing out" disabled={!!busy} onClick={() => go(true)}>
              {`Sign out of all devices${devices !== null && devices > 1 ? ` (${devices})` : ""}`}
            </Button>
            <Dialog.Close asChild>
              <button type="button" className="btn btn--ghost" disabled={!!busy}>Cancel</button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
