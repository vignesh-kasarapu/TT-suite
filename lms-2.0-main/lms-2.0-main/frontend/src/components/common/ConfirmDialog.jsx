import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from './Modal';
import { DangerButton, GhostButton, PrimaryButton } from './GlassButton';

/** "This is what is about to happen — go ahead?" in the app's own styling.
 *
 *  Used where an action writes to somebody's balance: a ledger entry is permanent (BR-07
 *  never deletes one), so the figures are restated before it is posted. Never the browser's
 *  `confirm`, which freezes the page and ignores the theme.
 *
 *      <ConfirmDialog
 *        open={...} title="Post this adjustment?"
 *        lines={[['Employee', 'Vignesh K'], ['Balance after', '11.0']]}
 *        confirmLabel="Post adjustment" onConfirm={submit} onClose={...}
 *      />
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  lines = [],
  warning,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const Confirm = tone === 'danger' ? DangerButton : PrimaryButton;

  return (
    <Modal open onClose={busy ? () => {} : onClose} title={title} maxWidth="max-w-md">
      <div className="space-y-4">
        {description && <p className="small muted">{description}</p>}

        {lines.length > 0 && (
          <dl className="divide-y divide-border">
            {lines.map(([term, value]) => (
              <div key={term} className="py-2 flex items-center justify-between gap-3">
                <dt className="small muted">{term}</dt>
                <dd className="num">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {warning && (
          <div className="alert alert--warning" role="status">
            <AlertTriangle />
            <p>{warning}</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <GhostButton type="button" onClick={onClose} disabled={busy}>{cancelLabel}</GhostButton>
          <Confirm type="button" onClick={go} disabled={busy} data-testid="confirm-dialog-confirm">
            {busy ? 'Working…' : confirmLabel}
          </Confirm>
        </div>
      </div>
    </Modal>
  );
}
