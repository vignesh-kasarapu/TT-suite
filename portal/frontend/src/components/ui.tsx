import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { roleLabel } from '../api';
import s from '../styles/portal.module.css';

export function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null }) {
  if (photoUrl) return <img className={s.avatar} src={photoUrl} alt="" />;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return (
    <span className={s.avatar} aria-hidden="true">
      {initials || '?'}
    </span>
  );
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  return <span className={role ? s.badge : `${s.badge} ${s.badgeNone}`}>{roleLabel(role)}</span>;
}

export function Banner({ tone = 'warn', children, onClose }: { tone?: 'warn' | 'danger' | 'ok'; children: ReactNode; onClose?: () => void }) {
  const cls = tone === 'danger' ? `${s.banner} ${s.bannerDanger}` : tone === 'ok' ? `${s.banner} ${s.bannerOk}` : s.banner;
  return (
    <div className={cls} role={tone === 'ok' ? 'status' : 'alert'}>
      <Icon name={tone === 'ok' ? 'check' : 'alert'} />
      <div className={s.bannerBody}>{children}</div>
      {onClose ? (
        <button type="button" className={s.iconButton} onClick={onClose} aria-label="Dismiss">
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/** A native <dialog> (focus trap, Esc and backdrop handled by the browser). */
export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog ref={ref} className={s.dialog} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-labelledby="dialog-title">
      <div className={s.dialogHead}>
        <h2 id="dialog-title" className={s.cardTitle}>{title}</h2>
        <button type="button" className={s.iconButton} onClick={onClose} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className={s.dialogBody}>{children}</div>
      <div className={s.dialogFoot}>{footer}</div>
    </dialog>
  );
}

export const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
