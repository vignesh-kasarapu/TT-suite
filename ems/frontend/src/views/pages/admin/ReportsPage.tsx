import { useState } from "react";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, claimsApi } from "../../../models/api";
import { LEVEL, money } from "../../../models/format";
import { download } from "../../../models/http";
import type { KeyAmount, Level } from "../../../models/types";
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

export function ReportsPage() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const { data: d, error, loading, reload } = useResource(() => adminApi.dashboard(start || undefined, end || undefined), [start, end]);
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
        <div className="field"><label htmlFor="r-start">Expense date from</label><input id="r-start" type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
        <div className="field"><label htmlFor="r-end">to</label><input id="r-end" type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
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
            <Bars title="By category" rows={d.by_category} />
            <Bars title="By department" rows={d.by_department} />
            <Bars title="By location" rows={d.by_location} />
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
