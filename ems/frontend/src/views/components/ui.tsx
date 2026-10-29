// Small shared view components (theme.md §3).
import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState, type ReactNode } from "react";
import { adminApi } from "../../models/api";
import { ADVANCE_STATUS, type Badge, date, LINE_STATUS, STAGE, STATUS, STEP_STATUS, type Tone } from "../../models/format";
import type { ApiError } from "../../models/http";
import type { ClaimStatus } from "../../models/types";
import { Icon, type IconName } from "./Icon";


export const Pill = ({ tone, icon, children }: { tone: Tone; icon?: IconName; children: ReactNode }) => (
  <span className={`pill pill--${tone}`}>{icon && <Icon name={icon} />}{children}</span>
);

const fromMap = (map: Record<string, Badge>, key: string) => {
  const [text, tone, icon] = map[key] ?? [key, "muted" as Tone, undefined];
  return <Pill tone={tone} icon={icon}>{text}</Pill>;
};
export const StatusPill = ({ status }: { status: ClaimStatus }) => fromMap(STATUS, status);
export const StagePill = ({ stage }: { stage: string }) => <Pill tone={STAGE[stage]?.[0] ?? "muted"} icon={STAGE[stage]?.[1]}>{stage}</Pill>;
export const SelfApprovedPill = () => <Pill tone="strong" icon="usercheck">Self-approved</Pill>;
export const LinePill = ({ status }: { status: string }) => fromMap(LINE_STATUS, status);
export const StepPill = ({ status }: { status: string }) => fromMap(STEP_STATUS, status);
export const AdvancePill = ({ status }: { status: string }) => fromMap(ADVANCE_STATUS, status);

export function Alert({ tone, title, children, action }: { tone: "info" | "success" | "warning" | "danger"; title?: string; children?: ReactNode; action?: ReactNode }) {
  const icon: IconName = tone === "success" ? "check" : tone === "info" ? "info" : "warn";
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon name={icon} />
      <div className="stack" style={{ gap: "var(--space-1)" }}>
        {title && <b>{title}</b>}
        {children}
      </div>
      {action && <div className="actions">{action}</div>}
    </div>
  );
}

/** Errors never show a bare code: message plus the list of specifics. */
export function ErrorAlert({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title={error.message} action={onRetry && <button className="btn btn--secondary btn--sm" onClick={onRetry}>Try again</button>}>
      {error.errors.length > 0 && <ul>{error.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
    </Alert>
  );
}

export function Empty({ icon = "inbox", title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="ico"><Icon name={icon} /></div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack skel-wrap" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel" style={{ height: 40 }} />)}
    </div>
  );
}

export function Tile({ value, label }: { icon?: IconName; value: ReactNode; label: string }) {
  return <div className="tile"><b>{value}</b><span>{label}</span></div>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; n?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}>
          {t.label}{t.n !== undefined && <span className="n">{t.n}</span>}
        </button>
      ))}
    </div>
  );
}

/** "1–7 of 13  ‹ 1 2 ›" footer, as in the wireframes. */
export function Pager({ page, size, total, onPage }: { page: number; size: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total === 0) return null;
  return (
    <div className="panel-foot">
      <span className="small muted">{page * size + 1}–{Math.min(total, (page + 1) * size)} of {total}</span>
      <nav className="pager" aria-label="Pages">
        <button className="edge" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)}>‹</button>
        {Array.from({ length: pages }, (_, i) => i).filter((i) => pages <= 7 || Math.abs(i - page) < 3 || i === 0 || i === pages - 1).map((i) => (
          <button key={i} aria-current={i === page ? "page" : undefined} onClick={() => onPage(i)}>{i + 1}</button>
        ))}
        <button className="edge" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>›</button>
      </nav>
    </div>
  );
}

/** The turning arc shown while something loads. */
export const Spinner = () => <span className="spin" style={{ display: "inline-flex" }} aria-hidden="true"><Icon name="spinner" /></span>;

/** Loading button: a turning arc plus the in-progress verb ("Submitting"). */
export function Button({ busy, busyLabel, children, variant = "secondary", small, ...rest }:
  React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; busyLabel?: string; variant?: "primary" | "secondary" | "danger" | "ghost"; small?: boolean }) {
  return (
    <button className={`btn btn--${variant}${small ? " btn--sm" : ""}`} aria-busy={busy || undefined} disabled={busy || rest.disabled} {...rest}>
      {busy ? <><Spinner /> {busyLabel ?? children}</> : children}
    </button>
  );
}

/** Icon-only action (edit, remove) - the label is the tooltip and what screen readers say. */
export function IconButton({ icon, label, onClick, danger }: { icon: IconName; label: string; onClick: (e: React.MouseEvent) => void; danger?: boolean }) {
  return (
    <button type="button" className={`iconbtn${danger ? " iconbtn--danger" : ""}`} title={label} aria-label={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function Field({ label, hint, error, children, id }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
      {error && <span className="error-msg" id={`${id}-err`}>{error}</span>}
    </div>
  );
}

export function Modal({ open, onOpenChange, title, children, small }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; small?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={small ? "dialog dialog--sm" : "dialog"} aria-describedby={undefined}>
          <Dialog.Title>{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A dialog asking for a reason (Reject, Send Back, mark failed...). */
export function ReasonDialog({ open, onOpenChange, title, body, confirm, danger, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body?: ReactNode; confirm: string; danger?: boolean;
  onConfirm: (reason: string) => Promise<boolean | void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const ok = await onConfirm(reason.trim());
    setBusy(false);
    if (ok !== false) {
      setReason("");
      onOpenChange(false);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      {body && <p className="muted">{body}</p>}
      <Field label="Reason" id="reason">
        <textarea id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <div className="actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn--secondary" onClick={() => onOpenChange(false)}>Cancel</button>
        <Button variant={danger ? "danger" : "primary"} busy={busy} busyLabel="Saving" disabled={!reason.trim()} onClick={submit}>{confirm}</Button>
      </div>
    </Modal>
  );
}

export function PageHead({ title, sub, action, crumb, badge }: { title: string; sub?: ReactNode; action?: ReactNode; crumb?: ReactNode; badge?: ReactNode }) {
  return (
    <header className="page-head stack" style={{ gap: "var(--space-1)" }}>
      {crumb && <nav className="crumb" aria-label="Breadcrumb">{crumb}</nav>}
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="row" style={{ gap: "var(--space-2)" }}><h1 className="page-title">{title}</h1>{badge}</div>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {action && <div className="actions">{action}</div>}
      </div>
    </header>
  );
}

/** "Last change: Asha Admin changed payroll cutoff day, 07 Oct 2026" under admin page titles. */
export function LastChange({ entity, refresh = 0 }: { entity?: string; refresh?: number }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    adminApi.lastChange(entity).then((c) => setText(c ? `Last change: ${c.who} ${c.what}, ${date(c.at)}.` : null)).catch(() => setText(null));
  }, [entity, refresh]);
  return text ? <p className="hint">{text}</p> : null;
}

/** Row above a list inside a Settings tab: a short note on the left, buttons on the right. */
export function Toolbar({ sub, action }: { sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="spread">
      <span className="hint">{sub}</span>
      {action && <div className="actions">{action}</div>}
    </div>
  );
}

/** "Are you sure?" before an action that matters: says what will happen, Cancel has the focus.
 *  onConfirm may return false (the action failed) to keep the dialog open. */
export function ConfirmDialog({ open, onOpenChange, title, body, confirm, onConfirm, busyLabel = "Working", danger }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body: ReactNode; confirm: string;
  onConfirm: () => unknown; busyLabel?: string; danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    const ok = await onConfirm();
    setBusy(false);
    if (ok !== false) onOpenChange(false);
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} small>
      <div className="muted small">{body}</div>
      <div className="actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn--sm" onClick={() => onOpenChange(false)} autoFocus>Cancel</button>
        <Button variant={danger ? "danger" : "primary"} small busy={busy} busyLabel={busyLabel} onClick={go}>{confirm}</Button>
      </div>
    </Modal>
  );
}

/** Holds which confirmation is open: ask({...}) opens one, render `node` once in the page. */
export interface Ask { title: string; body: ReactNode; confirm: string; run: () => unknown; busyLabel?: string; danger?: boolean }
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const node = ask && (
    <ConfirmDialog open onOpenChange={(o) => !o && setAsk(null)} title={ask.title} body={ask.body} confirm={ask.confirm}
      busyLabel={ask.busyLabel} danger={ask.danger} onConfirm={ask.run} />
  );
  return { ask: setAsk, node };
}
