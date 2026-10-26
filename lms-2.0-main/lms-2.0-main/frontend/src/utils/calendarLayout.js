/** Month-grid helpers for a Google/Outlook style calendar.
 *
 * The hard part is laying multi-day events out as continuous bars: an event has to be cut
 * at week boundaries, and bars that share a day have to stack into lanes without
 * overlapping. Kept separate from the component so the maths can be reasoned about — and
 * tested — on its own.
 */

export const ymd = (date) => {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
};

/** Six weeks starting on the Sunday on or before the 1st, so every month renders the same
 * height and bars never reflow as you page through. Days outside the month are included
 * (as Google and Outlook do) and flagged, not blanked — a bar running from 29 Jan to 2 Feb
 * has to be drawable. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w += 1) {
    const days = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
      days.push({ date, ymd: ymd(date), day: date.getDate(), inMonth: date.getMonth() === month });
    }
    weeks.push(days);
  }
  return weeks;
}

/**
 * Cuts each entry to the part of it that falls inside this week and assigns it a lane.
 *
 * Lanes are filled greedily after sorting by start day, then by longest first — the same
 * rule calendars use, and the reason a long bar sits above the short ones it overlaps
 * instead of being pushed around by them.
 */
export function layOutWeek(week, entries) {
  const weekStart = week[0].ymd;
  const weekEnd = week[6].ymd;

  const segments = entries
    .filter((e) => e.start_date <= weekEnd && e.end_date >= weekStart)
    .map((e) => {
      const startIndex = e.start_date <= weekStart ? 0 : week.findIndex((d) => d.ymd >= e.start_date);
      let endIndex = 6;
      for (let i = 6; i >= 0; i -= 1) {
        if (week[i].ymd <= e.end_date) { endIndex = i; break; }
      }
      return {
        entry: e,
        startIndex,
        endIndex,
        span: endIndex - startIndex + 1,
        continuesLeft: e.start_date < weekStart,
        continuesRight: e.end_date > weekEnd,
      };
    })
    .sort((a, b) => a.startIndex - b.startIndex || b.span - a.span
      || String(a.entry.employee_name).localeCompare(String(b.entry.employee_name)));

  const lanes = []; // lanes[i] = array of [startIndex, endIndex] already taken
  for (const segment of segments) {
    let lane = 0;
    for (;;) {
      const taken = lanes[lane] || [];
      const clashes = taken.some(([s, e]) => segment.startIndex <= e && s <= segment.endIndex);
      if (!clashes) {
        lanes[lane] = [...taken, [segment.startIndex, segment.endIndex]];
        segment.lane = lane;
        break;
      }
      lane += 1;
    }
  }
  return segments;
}

/** How many bars each day has hidden, given only `maxLanes` are drawn. */
export function overflowPerDay(segments, maxLanes) {
  const counts = new Array(7).fill(0);
  for (const s of segments) {
    if (s.lane < maxLanes) continue;
    for (let i = s.startIndex; i <= s.endIndex; i += 1) counts[i] += 1;
  }
  return counts;
}

/** One colour per leave type, so a bar is identifiable before you read it. Mixed into the
 * surface rather than used flat, which keeps it legible in both light and dark themes. */
const TYPE_COLOURS = {
  ANNUAL: '#2e6b45',
  SICK: '#b4524a',
  CASUAL: '#b07d2b',
  MATERNITY: '#7a5ea8',
  BEREAVEMENT: '#5b6b7a',
  COMP_OFF: '#2f7d8c',
  LOP: '#8a8f98',
};
export const DEFAULT_COLOUR = '#6b7280';
export const colourFor = (typeCode) => TYPE_COLOURS[typeCode] || DEFAULT_COLOUR;
export const TYPE_COLOUR_ENTRIES = Object.entries(TYPE_COLOURS);
