// Base presentational components (plan B01 task 13). Presentation only; no rules here.
import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Link, NavLink } from 'react-router';
import s from './components.module.css';
import { Icon, type IconName } from './Icon';
import { t } from '../i18n/t';
import { MQ, useMediaQuery } from './useMediaQuery';
import { cx } from '../styles/cx';

// ---------- Button ----------
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Replaces the label while an action is in flight (theme.md §3 Loading). */
  busyLabel?: string | undefined;
  busy?: boolean | undefined;
}
export function Button({
  variant = 'secondary',
  busy,
  busyLabel,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-busy={busy || undefined}
      disabled={rest.disabled || busy}
      className={cx(s.btn, s[variant], className)}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = 'secondary',
  children,
}: {
  to: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={cx(s.btn, s[variant])}>
      {children}
    </Link>
  );
}

// ---------- Field (label + input + error, theme.md §3 Input) ----------
export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
}
export function Field({ id, label, error, hint, className, ...rest }: FieldProps) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.fieldLabel}>
        {label}
      </label>
      <input
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(s.input, error && s.inputInvalid, className)}
      />
      {hint ? (
        <p id={`${id}-hint`} className={s.fieldHint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={s.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------- Pill ----------
export type PillTone = 'muted' | 'accent' | 'success' | 'warning' | 'danger' | 'holiday';
const PILL: Record<PillTone, string> = {
  muted: s.pillMuted ?? '',
  accent: s.pillAccent ?? '',
  success: s.pillSuccess ?? '',
  warning: s.pillWarning ?? '',
  danger: s.pillDanger ?? '',
  holiday: s.pillHoliday ?? '',
};
export function Pill({
  tone = 'muted',
  title,
  children,
}: {
  tone?: PillTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx(s.pill, PILL[tone])} title={title}>
      {children}
    </span>
  );
}

// ---------- Alert ----------
export type AlertTone = 'info' | 'success' | 'warning' | 'danger';
const ALERT: Record<AlertTone, { cls: string; icon: IconName; role: 'status' | 'alert' }> = {
  info: { cls: s.alertInfo ?? '', icon: 'info', role: 'status' },
  success: { cls: s.alertSuccess ?? '', icon: 'check', role: 'status' },
  warning: { cls: s.alertWarning ?? '', icon: 'warn', role: 'status' },
  danger: { cls: s.alertDanger ?? '', icon: 'warn', role: 'alert' },
};
export function Alert({
  tone = 'info',
  children,
  action,
}: {
  tone?: AlertTone;
  children: ReactNode;
  action?: ReactNode;
}) {
  const a = ALERT[tone];
  return (
    <div role={a.role} className={cx(s.alert, a.cls)}>
      <Icon name={a.icon} size={20} />
      <p>{children}</p>
      {action ? <div className={s.alertActions}>{action}</div> : null}
    </div>
  );
}

// ---------- Skeleton ----------
export function Skeleton({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <div
      className={s.skelStack}
      role="status"
      aria-live="polite"
      aria-label={label ?? t('skeleton.label')}
      data-testid="skeleton"
    >
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={s.skel} style={{ width: `${100 - i * 15}%` }} />
      ))}
    </div>
  );
}

// ---------- Empty / error state ----------
export interface StateProps {
  title: string;
  body: string;
  action?: ReactNode;
  /** h1 when the state is the whole page (404, permission denied); h2 inside a page. */
  heading?: 'h1' | 'h2';
}
export function EmptyState({ title, body, action, heading: H = 'h2' }: StateProps) {
  return (
    <div className={s.state} data-testid="empty-state">
      <div className={s.stateIcon}>
        <Icon name="info" size={24} />
      </div>
      <H>{title}</H>
      <p>{body}</p>
      {action ? <div className={s.stateAction}>{action}</div> : null}
    </div>
  );
}
export function ErrorState({ title, body, action, heading: H = 'h2' }: StateProps) {
  return (
    <div className={s.state} role="alert" data-testid="error-state">
      <div className={cx(s.stateIcon, s.stateIconDanger)}>
        <Icon name="warn" size={24} />
      </div>
      <H>{title}</H>
      <p>{body}</p>
      {action ? <div className={s.stateAction}>{action}</div> : null}
    </div>
  );
}

// ---------- ResponsiveList ----------
export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  numeric?: boolean;
}
export interface ResponsiveListProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** One row/card carrying this text when `rows` is empty (theme.md §3: "nothing yet" vs "nothing matches"). */
  emptyText: string;
  caption?: string;
}
/** One column definition renders a <table> at >= 640 px and a <ul> of cards below; DOM is switched, never both. */
export function ResponsiveList<Row>({
  columns,
  rows,
  rowKey,
  emptyText,
  caption,
}: ResponsiveListProps<Row>) {
  const wide = useMediaQuery(MQ.tabletUp);
  if (!wide) {
    return (
      <ul className={s.cards} data-testid="responsive-list-cards">
        {rows.length === 0 ? (
          <li className={cx(s.card, s.emptyRow)}>{emptyText}</li>
        ) : (
          rows.map((row) => (
            <li key={rowKey(row)} className={s.card}>
              {columns.map((c) => (
                <div key={c.key} className={s.cardRow}>
                  <span className={s.cardLabel}>{c.header}</span>
                  <span className={c.numeric ? 'num' : undefined}>{c.cell(row)}</span>
                </div>
              ))}
            </li>
          ))
        )}
      </ul>
    );
  }
  return (
    // Keyboard users must be able to reach a horizontally scrolling region (axe: scrollable-region-focusable).
    <div className={s.scroll} tabIndex={0} role="region" aria-label={caption}>
      <table className={s.table} data-testid="responsive-list-table">
        {caption ? <caption className="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? s.numeric : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={s.emptyRow}>
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? s.numeric : undefined}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------- SelectField (native <select>; picks up the mode via color-scheme, theme.md §2) ----------
export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  options: SelectOption[];
  /** Label of the empty first option (omit for none). */
  placeholder?: string | undefined;
  error?: string | undefined;
  hint?: string | undefined;
}
export function SelectField({
  id,
  label,
  options,
  placeholder,
  error,
  hint,
  className,
  ...rest
}: SelectFieldProps) {
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.fieldLabel}>
        {label}
      </label>
      <select
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(s.input, error && s.inputInvalid, className)}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className={s.fieldHint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className={s.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------- CheckboxField ----------
export interface CheckboxFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  error?: string | undefined;
}
export function CheckboxField({ id, label, error, ...rest }: CheckboxFieldProps) {
  return (
    <div className={s.field}>
      <label htmlFor={id} className={s.check}>
        <input
          id={id}
          type="checkbox"
          {...rest}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <span>{label}</span>
      </label>
      {error ? (
        <p id={`${id}-error`} className={s.fieldError} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// ---------- TabLinks (underline tabs that are routes, theme.md §3 Tabs) ----------
export function TabLinks({
  label,
  tabs,
}: {
  label: string;
  tabs: { to: string; label: string; end?: boolean }[];
}) {
  return (
    <nav className={s.tabs} aria-label={label}>
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end ?? false}
          className={({ isActive }) => cx(s.tab, isActive && s.tabActive)}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

// ---------- ConfirmDialog (native <dialog>, same pattern as the shell's More sheet) ----------
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** States the consequence of the action (theme.md §3 Dialogs). */
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  busyLabel?: string;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
}
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy,
  busyLabel,
  error,
  onConfirm,
  onCancel,
  testId,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby={`${testId ?? 'confirm'}-title`}
      onClose={onCancel}
      data-testid={testId}
    >
      <h2 id={`${testId ?? 'confirm'}-title`} className={s.dialogTitle}>
        {title}
      </h2>
      <div className={s.dialogBody}>{children}</div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <div className={s.dialogActions}>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button variant="danger" onClick={onConfirm} busy={busy} busyLabel={busyLabel}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
