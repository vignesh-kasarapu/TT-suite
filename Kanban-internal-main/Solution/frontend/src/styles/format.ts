// Display-only formatting (NFR-037): dates DD MMM YYYY, day quantities to one decimal,
// timestamps in the org zone with the zone named. No date/number arithmetic here — the
// backend computes every value (architecture: "no business logic in the frontend").

/** "2026-08-15" → "15 Aug 2026". Calendar dates are org-calendar dates; no zone shift. */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc);
}

/** 9 → "9.0"; 1.5 → "1.5". Quantities arrive from the server already rounded to 0.5 steps. */
export function formatDays(days: number | string): string {
  return Number(days).toFixed(1);
}

/** RFC 3339 UTC instant → "10:00 IST" in the org zone (zone abbreviation named). */
export function formatTime(isoInstant: string, timeZone: string): string {
  const date = new Date(isoInstant);
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(date);
  return `${time} ${zoneName(date, timeZone)}`;
}

/** RFC 3339 UTC instant → "15 Jun 2026, 10:00 IST". */
export function formatDateTime(isoInstant: string, timeZone: string): string {
  const date = new Date(isoInstant);
  const day = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(date);
  return `${day}, ${formatTime(isoInstant, timeZone)}`;
}

function zoneName(date: Date, timeZone: string): string {
  // en-IN carries the IST abbreviation in CLDR; other zones fall back to the GMT offset form.
  const part = new Intl.DateTimeFormat('en-IN', { timeZone, timeZoneName: 'short' })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** "2026-11-16" → "16 Nov": a card face's short date (D-150); formatDate is in its tooltip. */
export function formatDayMonth(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
