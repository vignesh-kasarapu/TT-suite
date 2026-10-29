import { useState } from "react";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, claimsApi } from "../../../models/api";
import { LEVEL, money, todayIso } from "../../../models/format";
import { download } from "../../../models/http";
import type { KeyAmount, Level } from "../../../models/types";
import { DonutChart } from "../../components/DonutChart";
import { Icon } from "../../components/Icon";
import { Alert, Button, ErrorAlert, PageHead, Skeleton, Tile, useConfirm } from "../../components/ui";

function Bars({ title, rows }: { title: string; rows: KeyAmount[] }) {
  const max = Math.max(1, ...rows.map((r) => r.amount));
  return (
    <section className="panel">
      <h3 style={{ marginBottom: "var(--space-3)" }}>{title}</h3>
      {rows.length === 0 ? <p className="muted">No approved spend in this period.</p> : (
        <ul className="bars">
          {rows.map((r) => (
            <li key={r.key}>
              <span>{r.key}</span>
              <span className="track" aria-hidden="true"><span className="fill" style={{ display: "block", width: `${(r.amount / max) * 100}%` }} /></span>
              <span className="num small">{money(r.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The first and last day of one calendar month, or of the whole year when no month is picked. */
function rangeOf(year: number, month: string): { start: string; end: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!month) return { start: `${year}-01-01`, end: `${year}-12-31` };
  const m = Number(month);
  return { start: `${year}-${pad(m)}-01`, end: `${year}-${pad(m)}-${pad(new Date(year, m, 0).getDate())}` };
}

export function ReportsPage() {
  const today = todayIso();
  const thisYear = Number(today.slice(0, 4));
  const [month, setMonth] = useState(String(Number(today.slice(5, 7))));  // default: the current month
  const [year, setYear] = useState(thisYear);
  const range = rangeOf(year, month);
  const { data: d, error, loading, reload } = useResource(["admin", "dashboard", range.start, range.end], () => adminApi.dashboard(range.start, range.end));
  const act = useAction();
  const confirm = useConfirm();
  const [ran, setRan] = useState<string | null>(null);
  const levels: Level[] = ["L1", "L2", "FINANCE"];

  return (
    <>
      <PageHead title="Reports" sub="Approved spend, approval speed, GST and self-approvals."
        action={<>
          <Button small onClick={() => act.run(() => download(claimsApi.exportUrl("all")))}><Icon name="download" /> All claims (Excel)</Button>
          <Button small onClick={() => confirm.ask({
            title: "Send reminders now?", confirm: "Send reminders", busyLabel: "Sending",
            body: "Approvers with claims waiting longer than the reminder days get a reminder; those past the escalation days are escalated to their manager.",
            run: async () => { const r = await act.run(adminApi.runReminders); if (r) setRan(`Sent ${r.reminded} reminders, escalated ${r.escalated}.`); },
          })}><Icon name="bell" /> Run reminders now</Button>
        </>} />
      <div className="row">
        <div className="field">
          <label htmlFor="r-month">Month</label>
          <select id="r-month" className="input" value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">Whole year</option>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="r-year">Year</label>
          <select id="r-year" className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      {ran && <Alert tone="success">{ran}</Alert>}
      {confirm.node}
      <ErrorAlert error={error ?? act.error} onRetry={reload} />
      {loading || !d ? <Skeleton rows={6} /> : (
        <>
          <div className="tiles">
            <Tile icon="wallet" value={money(d.total_spend)} label="Approved spend" />
            <Tile icon="clock" value={levels.reduce((s, l) => s + (d.pending_by_level[l] ?? 0), 0)} label="Pending steps" />
            <Tile icon="warn" value={(d.policy_violations.FLAG ?? 0) + (d.policy_violations.WARN ?? 0)} label="Policy flags and warnings" />
            <Tile icon="check" value={money(d.gst.eligible)} label="GST credit eligible" />
          </div>
          <div className="grid2">
            <Bars title="By month" rows={d.by_month} />
            <DonutChart title="By category" rows={d.by_category} />
            <DonutChart title="By department" rows={d.by_department} />
            <DonutChart title="By location" rows={d.by_location} />
            <section className="panel">
              <h3 style={{ marginBottom: "var(--space-3)" }}>Approvals by level</h3>
              <table className="rl-table">
                <thead><tr><th>Level</th><th className="r">Pending</th><th className="r">Avg. hours to act</th></tr></thead>
                <tbody>{levels.map((l) => <tr key={l}><td>{LEVEL[l]}</td><td className="r">{d.pending_by_level[l] ?? 0}</td><td className="r">{d.avg_hours_by_level[l] ?? "—"}</td></tr>)}</tbody>
              </table>
              <p className="hint" style={{ marginTop: "var(--space-3)" }}>GST not eligible for credit (booked as cost): {money(d.gst.not_eligible)}</p>
            </section>
          </div>
          <div className="grid2">
            <section className="panel">
              <h3 style={{ marginBottom: "var(--space-3)" }}>Level 2 approvals by category</h3>
              {d.level2_by_category.length === 0 ? <p className="muted">None yet.</p> : (
                <table className="rl-table"><thead><tr><th>Category</th><th className="r">Count</th><th className="r">Amount</th></tr></thead>
                  <tbody>{d.level2_by_category.map((r) => <tr key={r.key}><td>{r.key}</td><td className="r">{r.count}</td><td className="r">{money(r.amount)}</td></tr>)}</tbody></table>
              )}
            </section>
            <section className="panel">
              <h3 style={{ marginBottom: "var(--space-3)" }}>Self-approved claims</h3>
              {d.self_approved.length === 0 ? <p className="muted">None yet.</p> : (
                <table className="rl-table"><thead><tr><th>Person</th><th>Month</th><th className="r">Count</th><th className="r">Value</th></tr></thead>
                  <tbody>{d.self_approved.map((r) => <tr key={r.person + r.month}><td>{r.person}</td><td>{r.month}</td><td className="r">{r.count}</td><td className="r">{money(r.amount)}</td></tr>)}</tbody></table>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
