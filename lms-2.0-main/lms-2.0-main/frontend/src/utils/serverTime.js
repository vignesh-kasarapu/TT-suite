/** Server timestamps are UTC, and most of them arrive without saying so.
 *
 * The backend stores `timestamp without time zone` columns holding UTC (notifications,
 * ledger entries, approvals, audit rows...), so the JSON carries "2026-11-01T11:01:33" with
 * no offset. `new Date()` reads a bare string like that as LOCAL time, which in Asia/Kolkata
 * shifts every timestamp 5½ hours into the past: a notification sent moments ago rendered as
 * "5h ago", at a clock time that never happened.
 *
 * `parseServerDate` appends the missing Z, and leaves anything that already states an
 * offset alone. Same test `LossOfPayPanel` and the LOP report already used inline — this is
 * that rule in one place.
 */
const HAS_TIMEZONE = /[zZ]|[+-]\d\d:?\d\d$/;

export function parseServerDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const raw = String(value);
  // A date with no time ("2026-11-01") is a calendar date, not an instant — leave it to the
  // caller, which should format it without a timezone at all.
  const normalized = raw.includes('T') && !HAS_TIMEZONE.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "just now", "12m ago", "3h ago", "2d ago" — for a server timestamp. */
export function timeAgo(value) {
  const date = parseServerDate(value);
  if (date === null) return '';
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** The local-time clock reading of a server timestamp, date only. */
export const formatServerDate = (value) => parseServerDate(value)?.toLocaleDateString() ?? '—';

/** The local-time clock reading of a server timestamp, date and time. */
export const formatServerDateTime = (value) => parseServerDate(value)?.toLocaleString() ?? '—';
