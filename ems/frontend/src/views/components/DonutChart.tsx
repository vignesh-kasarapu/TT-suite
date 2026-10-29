// Donut chart for "share of approved spend" reports: gaps between slices, the total (or the hovered slice) in the centre,
// and a legend that lists every slice's amount and share, so nothing depends on colour alone.
import { useMemo, useState } from "react";
import { money } from "../../models/format";
import type { KeyAmount } from "../../models/types";

const MAX_SLICES = 7;        // chart-1..7; anything beyond folds into "Other"
const R = 42;                // ring radius in a 120 x 120 viewBox
const C = 2 * Math.PI * R;
const GAP = 1.6;             // surface-coloured gap between slices (viewBox units)

interface Slice { key: string; amount: number; share: number; start: number; color: string }

function slicesOf(rows: KeyAmount[]): Slice[] {
  const sorted = rows.filter((r) => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const shown = sorted.length > MAX_SLICES ? sorted.slice(0, MAX_SLICES - 1) : sorted;
  const rest = sorted.slice(shown.length).reduce((s, r) => s + r.amount, 0);
  const all = rest > 0 ? [...shown, { key: "Other", amount: rest }] : shown;
  const total = all.reduce((s, r) => s + r.amount, 0);
  let start = 0;
  return all.map((r, i) => {
    const share = r.amount / total;
    const slice = { key: r.key, amount: r.amount, share, start, color: rest > 0 && i === all.length - 1 ? "var(--chart-other)" : `var(--chart-${i + 1})` };
    start += share;
    return slice;
  });
}

const pct = (share: number) => `${Math.round(share * 1000) / 10}%`;

export function DonutChart({ title, rows, empty = "No approved spend in this period." }: { title: string; rows: KeyAmount[]; empty?: string }) {
  const slices = useMemo(() => slicesOf(rows), [rows]);
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + x.amount, 0);
  const on = active === null ? null : slices[active];
  const clip = (s: string) => (s.length > 15 ? `${s.slice(0, 14)}…` : s);

  return (
    <section className="panel">
      <h3 style={{ marginBottom: "var(--space-3)" }}>{title}</h3>
      {slices.length === 0 ? <p className="muted">{empty}</p> : (
        <div className={`donut${on ? " has-hover" : ""}`}>
          <svg viewBox="0 0 120 120" role="img" aria-label={`${title}: ${slices.map((s) => `${s.key} ${pct(s.share)}`).join(", ")}`}>
            <g transform="rotate(-90 60 60)">
              {slices.map((s, i) => {
                const len = s.share * C;
                const solo = slices.length === 1;
                const dash = solo ? C : Math.max(len - GAP, 0.5);
                return (
                  <circle key={s.key} className={`slice${active === i ? " on" : ""}`} cx="60" cy="60" r={R} style={{ stroke: s.color }}
                    strokeDasharray={`${dash} ${C}`} strokeDashoffset={solo ? 0 : -(s.start * C + GAP / 2)}
                    tabIndex={0} aria-label={`${s.key}: ${money(s.amount)}, ${pct(s.share)}`}
                    onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
                );
              })}
            </g>
            <text className="donut-value" x="60" y={on ? 55 : 60} textAnchor="middle">{money(on ? on.amount : total)}</text>
            <text className="donut-label" x="60" y={on ? 67 : 72} textAnchor="middle">{on ? `${clip(on.key)} · ${pct(on.share)}` : "Total"}</text>
          </svg>
          <ul className="donut-legend">
            {slices.map((s, i) => (
              <li key={s.key} className={active === i ? "on" : undefined} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
                <span className="swatch" style={{ background: s.color }} aria-hidden="true" />
                <span className="name">{s.key}</span>
                <span className="num small">{money(s.amount)}</span>
                <span className="num small muted">{pct(s.share)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
