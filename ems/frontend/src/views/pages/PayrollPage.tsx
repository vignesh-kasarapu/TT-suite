import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useResource } from "../../controllers/useAsync";
import { financeApi } from "../../models/api";
import { dateTime, money, monthIso } from "../../models/format";
import { download } from "../../models/http";
import type { Batch, BatchPreview, ClaimSummary } from "../../models/types";
import { Icon } from "../components/Icon";
import { ResponsiveList } from "../components/ResponsiveList";
import { Alert, Button, Empty, ErrorAlert, Modal, PageHead, ReasonDialog, Skeleton, StatusPill, Tabs, useConfirm } from "../components/ui";

type Tab = "ready" | "sent" | "failed" | "batches";

export function PayrollPage() {
  const navigate = useNavigate();
  const queue = useResource(["finance", "queue"], financeApi.queue);
  const batches = useResource(["finance", "batches"], financeApi.batches);
  const act = useAction();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>("ready");
  const [month, setMonth] = useState(monthIso());
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [failing, setFailing] = useState<ClaimSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = () => { queue.reload(); batches.reload(); };
  const openPreview = async () => {
    const p = await act.run(() => financeApi.preview(month));
    if (p) setPreview(p);
  };
  const send = async () => {
    if (!preview) return;
    const b = await act.run(() => financeApi.sendBatch(preview.month, preview.claim_count));
    setPreview(null);
    if (b) {
      setNotice(`Batch #${b.id} sent: ${b.claim_count} claims, ${money(b.total_amount)}. Claims are now locked.`);
      reload();
    }
  };
  const run = async (fn: () => Promise<unknown>) => { if (await act.run(fn)) reload(); };

  const q = queue.data;
  const counts = { ready: q?.ready.length ?? 0, sent: q?.sent.length ?? 0, failed: q?.failed.length ?? 0 };
  const rows = tab === "batches" ? [] : q?.[tab] ?? [];

  const actions = (c: ClaimSummary) =>
    tab === "sent" ? (
      <span className="actions">
        <button className="btn btn--secondary btn--sm" onClick={(e) => { e.stopPropagation(); confirm.ask({
          title: `Mark ${c.claim_no} as paid?`, confirm: "Mark paid", busyLabel: "Saving", run: () => run(() => financeApi.paid(c.id)),
          body: <>Only do this once payroll has paid {money(c.payout_amount)} to {c.employee.full_name}. The employee is told it is paid.</>,
        }); }}><Icon name="wallet" /> Mark paid</button>
        <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setFailing(c); }}>Failed</button>
      </span>
    ) : tab === "failed" ? (
      <button className="btn btn--secondary btn--sm" onClick={(e) => { e.stopPropagation(); confirm.ask({
        title: `Retry ${c.claim_no} in the next batch?`, confirm: "Retry", busyLabel: "Saving", run: () => run(() => financeApi.retry(c.id)),
        body: "Check the employee's bank details first. The claim goes back to Ready and is included in the next payroll batch.",
      }); }}>Retry next batch</button>
    ) : null;

  return (
    <>
      <PageHead title="Payroll" sub="Send approved claims to payroll in one batch, then record what payroll paid." />
      {confirm.node}
      <section className="panel row" style={{ alignItems: "flex-end" }}>
        <div className="field">
          <label htmlFor="pm">Payroll month</label>
          <input id="pm" type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <Button variant="primary" onClick={openPreview} busy={act.busy} busyLabel="Loading">Review batch</Button>
        <span className="hint">Includes every approved claim due up to this month, plus advance recoveries.</span>
      </section>
      {notice && <Alert tone="success" action={<button className="btn btn--ghost btn--sm" onClick={() => setNotice(null)}>Dismiss</button>}>{notice}</Alert>}
      <ErrorAlert error={queue.error ?? act.error} onRetry={reload} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { key: "ready", label: `Ready, ${counts.ready}` }, { key: "sent", label: `With payroll, ${counts.sent}` },
        { key: "failed", label: `Failed, ${counts.failed}` }, { key: "batches", label: "Batches" },
      ]} />
      {tab === "batches" ? (
        <ResponsiveList<Batch>
          rows={batches.data ?? []} rowKey={(b) => b.id}
          columns={[
            { header: "Batch", cell: (b) => <span className="name">#{b.id}</span> },
            { header: "Month", cell: (b) => b.month },
            { header: "Sent", cell: (b) => dateTime(b.created_at) },
            { header: "Claims", align: "right", cell: (b) => b.claim_count },
            { header: "Total", align: "right", cell: (b) => money(b.total_amount) },
            { header: "Recoveries", align: "right", cell: (b) => money(b.recovery_total) },
            { header: "", align: "right", cell: (b) => <button className="btn btn--ghost btn--sm" onClick={() => act.run(() => download(financeApi.batchExportUrl(b.id)))}><Icon name="download" /> Excel</button> },
          ]}
          card={(b) => ({ title: `Batch #${b.id} · ${b.month}`, detail: `${b.claim_count} claims · ${money(b.total_amount)}`, meta: [dateTime(b.created_at)],
            actions: <button className="btn btn--ghost btn--sm" onClick={() => act.run(() => download(financeApi.batchExportUrl(b.id)))}>Excel</button> })}
          empty={<Empty icon="wallet" title="No batches sent yet">Review a batch above to send the first one.</Empty>}
        />
      ) : queue.loading && !q ? <Skeleton /> : (
        <ResponsiveList<ClaimSummary>
          rows={rows} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/claims/${c.id}`)} edge={() => (tab === "failed" ? "bad" : undefined)}
          columns={[
            { header: "Claim", cell: (c) => <span className="name">{c.claim_no}</span> },
            { header: "Employee", cell: (c) => `${c.employee.full_name} (${c.employee.employee_code})` },
            { header: "Status", cell: (c) => <StatusPill status={c.status} /> },
            { header: "Month", cell: (c) => c.payment_month },
            { header: "Payout", align: "right", cell: (c) => money(c.payout_amount) },
            { header: "", align: "right", cell: actions },
          ]}
          card={(c) => ({ title: c.claim_no, status: <StatusPill status={c.status} />, detail: c.employee.full_name, meta: [money(c.payout_amount), c.payment_month ?? ""], actions: actions(c) })}
          empty={<Empty icon="check" title="Nothing here">Claims move here as they are approved and paid.</Empty>}
        />
      )}

      <Modal open={!!preview} onOpenChange={(o) => !o && setPreview(null)} title={`Send ${preview?.month} batch to payroll?`}>
        {preview && (
          <>
            <dl className="kv">
              <dt>Claims</dt><dd className="num">{preview.claim_count}</dd>
              <dt>Total payout</dt><dd className="num"><b>{money(preview.total_amount)}</b></dd>
              <dt>Advance recoveries</dt><dd className="num">{preview.recoveries.length} · {money(preview.recovery_total)}</dd>
            </dl>
            <p className="muted">After sending, these claims are locked and cannot be changed.</p>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn btn--secondary" onClick={() => setPreview(null)}>Cancel</button>
              <Button variant="primary" busy={act.busy} busyLabel="Sending" disabled={!preview.claim_count && !preview.recoveries.length} onClick={send}><Icon name="send" /> Send batch</Button>
            </div>
          </>
        )}
      </Modal>
      <ReasonDialog open={!!failing} onOpenChange={(o) => !o && setFailing(null)} title={`Payment failed for ${failing?.claim_no}`} confirm="Mark failed" danger
        body="Enter the reason payroll gave. The claim comes back to Finance." onConfirm={async (r) => { await run(() => financeApi.failed(failing!.id, r)); }} />
    </>
  );
}
