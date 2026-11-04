import { useState } from 'react';
import { CalendarDays, CalendarCheck2, HeartPulse, Layers, Plane, Sparkles } from 'lucide-react';
import Modal from './Modal';

/** How many cards a row shows before the rest move behind "View all". Six fits a desktop
 *  row beside the other columns; HR can configure any number of leave types and the row
 *  still holds its shape. */
const INLINE_LIMIT = 6;

/** Days read as people say them: 15, not 15.0 — but 7.5 keeps its half. */
export const formatDays = (value) => {
  const n = Number(value ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/** The part of the name that distinguishes it, in words rather than database spelling:
 *  "Annual Leave" and "Annual-Leaves" -> "Annual", "Sick + Casual Leave" and "sick_casual"
 *  -> "Sick/Casual". HR's own wording is kept wherever it already reads as a name. */
export const friendlyName = (name) => {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const parts = raw
    .split(/[_+/]+/)
    .map((part) => part.replace(/[-\s]*leaves?$/i, '').trim())
    .filter(Boolean)
    .map((part) => (part === part.toLowerCase() ? part.charAt(0).toUpperCase() + part.slice(1) : part));
  return parts.join('/') || raw;
};

/** An icon per leave type, chosen from its name rather than a hardcoded list of codes, so a
 *  type HR invents tomorrow still gets something sensible. */
const iconFor = (name) => {
  const text = String(name || '').toLowerCase();
  if (text.includes('sick') || text.includes('medical')) return HeartPulse;
  if (text.includes('casual')) return Sparkles;
  if (text.includes('annual') || text.includes('earned') || text.includes('privilege')) return Plane;
  if (text.includes('comp')) return CalendarCheck2;
  return CalendarDays;
};

/** The tints cycle, so any number of leave types stays readable. */
const TONES = ['', 'bal-card--alt', 'bal-card--warm'];

function Card({ icon: Icon, value, label, title, className = '' }) {
  return (
    <div className={`bal-card ${className}`} title={title}>
      <span className="bal-ico" aria-hidden="true"><Icon className="w-4 h-4" /></span>
      <span>
        <b>{formatDays(value)}</b>
        <span>{label}</span>
      </span>
    </div>
  );
}

/**
 * One person's balances: the total first, then a card per leave type (a shared pool counts
 * once, because the server already returns one entry per target).
 *
 * Three to five cards sit on one row; six to eight wrap onto a second; beyond that the row
 * keeps the first six and the rest open in a dialog, so one employee with many leave types
 * cannot stretch the table.
 */
export default function BalanceCards({ balances = [], totals, employeeName }) {
  const [showAll, setShowAll] = useState(false);
  const overflow = Math.max(balances.length - INLINE_LIMIT, 0);
  const inline = overflow > 0 ? balances.slice(0, INLINE_LIMIT) : balances;

  const card = (b, index) => {
    const negative = b.effectiveBalance < 0;
    const name = friendlyName(b.leaveType);
    return (
      <Card
        key={b.targetKey || b.leaveType}
        icon={iconFor(b.leaveType)}
        value={b.effectiveBalance}
        label={name}
        title={`${b.leaveType}: ${formatDays(b.effectiveBalance)} day(s) available of ${formatDays(b.totalDays ?? b.entitlement)}, ${formatDays(b.used)} used`}
        className={negative ? 'bal-card--negative' : TONES[index % TONES.length]}
      />
    );
  };

  return (
    <>
      <div className="bal-cards">
        {totals && (
          <Card
            icon={Layers}
            value={totals.available}
            label="Total"
            title={`${formatDays(totals.available)} day(s) available of ${formatDays(totals.total ?? totals.entitlement)}, ${formatDays(totals.used)} used`}
            className="bal-card--total"
          />
        )}
        {inline.map(card)}
        {overflow > 0 && (
          <button type="button" className="bal-more" onClick={() => setShowAll(true)}>
            View all (+{overflow})
          </button>
        )}
      </div>

      {showAll && (
        <Modal
          open
          onClose={() => setShowAll(false)}
          title={`${employeeName || 'Leave'} balances`}
          maxWidth="max-w-lg"
        >
          <div className="bal-cards">
            {totals && (
              <Card icon={Layers} value={totals.available} label="Total" className="bal-card--total" />
            )}
            {balances.map(card)}
          </div>
        </Modal>
      )}
    </>
  );
}
