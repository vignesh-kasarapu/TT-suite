// Approvals (wireframe 6) and Second approval (wireframe 7): one row per claim, bulk Return / Approve, History tab.
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useResource } from "../../controllers/useAsync";
import { refreshBadges } from "../../controllers/useNotifications";
import { approvalsApi, claimsApi } from "../../models/api";
import { date, money } from "../../models/format";
import type { ClaimSummary, InboxItem, Level, UserBrief } from "../../models/types";
import { ResponsiveList } from "../components/ResponsiveList";
import { Icon } from "../components/Icon";
import { Alert, Button, Empty, ErrorAlert, PageHead, Pager, ReasonDialog, Skeleton, StatusPill, Tabs, SelfApprovedPill, useConfirm } from "../components/ui";

interface Row {
  claimId: number; claimNo: string | null; title: string; employee: UserBrief; items: number; amount: number;
  flags: string[]; next: string; since: string; prev: string | null; stepIds: number[]; selfApproved: boolean; onBehalfOf: string | null;
}

function group(items: InboxItem[], level: Level): Row[] {
  const by = new Map<number, Row>();
  for (const i of items.filter((x) => x.level === level)) {
    const r = by.get(i.claim_id) ?? {
      claimId: i.claim_id, claimNo: i.claim_no, title: i.title, employee: i.employee, items: i.line_count, amount: 0, flags: [],
      next: "Finance", since: i.waiting_since, prev: null, stepIds: [], selfApproved: i.self_approved, onBehalfOf: i.on_behalf_of,
    };
    r.amount += i.amount ?? 0;
    r.flags.push(...i.flags);
    r.stepIds.push(i.step_id);
    if (i.next_step === "Level 2") r.next = "Second approver";
    if (i.waiting_since < r.since) r.since = i.waiting_since;
    if (i.prev_approval) r.prev = `${i.prev_approval}, ${date(i.prev_approved_at).slice(0, 6)}`;
    by.set(i.claim_id, r);
  }
  // risky first, then oldest
  return [...by.values()].sort((a, b) => b.flags.length - a.flags.length || a.since.localeCompare(b.since));
}

const PAGE = 10;

export function ApprovalsPage({ level }: { level: "L1" | "L2" }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = (params.get("q") ?? "").toLowerCase();
  const inbox = useResource(approvalsApi.inbox);
  const act = useAction();
  const [tab, setTab] = useState<"waiting" | "history">("waiting");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [returning, setReturning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => group(inbox.data ?? [], level)
    .filter((r) => !q || `${r.employee.full_name} ${r.title} ${r.claimNo}`.toLowerCase().includes(q)), [inbox.data, level, q]);
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  const chosen = rows.filter((r) => selected.has(r.claimId));
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = shown.length > 0 && shown.every((r) => selected.has(r.claimId));

  const finish = (msg: string) => { setResult(msg); setSelected(new Set()); inbox.reload(); refreshBadges(); };
  const confirm = useConfirm();
  const approve = async () => {
    const out = await act.run(() => approvalsApi.bulkApprove(chosen.flatMap((r) => r.stepIds)));
    if (out) finish(out.failed.length ? `Some items could not be approved: ${out.failed.map((f) => f.error).join(" ")}` : `Approved ${chosen.length} ${chosen.length === 1 ? "claim" : "claims"}.`);
  };
  const flagged = chosen.filter((r) => r.flags.length).length;
  const askApprove = () => confirm.ask({
    title: `Approve ${chosen.length} ${chosen.length === 1 ? "claim" : "claims"}?`, confirm: "Approve", busyLabel: "Approving", run: approve,
    body: <>Every line is approved in full, {money(chosen.reduce((s, r) => s + r.amount, 0))} in total.{flagged > 0 && <> <b>{flagged} of them {flagged === 1 ? "is" : "are"} over a limit or flagged.</b></>} To lower an amount or reject one line, open the claim instead.</>,
  });
  const giveBack = async (reason: string) => {
    const out = await act.run(() => approvalsApi.bulkSendBack(chosen.map((r) => r.claimId), reason));
    if (out) finish(`Returned ${out.returned.length} ${out.returned.length === 1 ? "claim" : "claims"} to the employee.`);
    return !!out;
  };
  const policy = (r: Row) => (r.flags.length
    ? <span className="strong flag-line"><Icon name="flag" /><span>{r.flags.length} over limit or flagged</span></span>
    : <span className="muted flag-line"><Icon name="check" /><span>Within policy</span></span>);
  const check = (r: Row) => (
    <input type="checkbox" aria-label={`Select ${r.claimNo}`} checked={selected.has(r.claimId)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.claimId)} />
  );

  const isL1 = level === "L1";
  return (
    <>
      <PageHead title={isL1 ? "Approvals" : "Second approval"}
        sub={isL1 ? "Amounts in a category's Level 2 range go to a second approver after you, then to finance."
          : "Claims in a Level 2 amount range that a manager has already approved. After you, they go to finance."} />
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "waiting", label: "Waiting on you", n: rows.length }, { key: "history", label: "History" }]} />
      {tab === "history" ? <History /> : (
        <>
          <ErrorAlert error={inbox.error ?? act.error} onRetry={inbox.reload} />
          {result && <Alert tone="success" action={<button className="linkbtn" onClick={() => setResult(null)}>Dismiss</button>}>{result}</Alert>}
          <div className="bulkbar">
            <span className={chosen.length ? "strong" : "muted"}>{chosen.length ? `${chosen.length} selected` : "Select claims to act on them together"}</span>
            <div className="actions">
              <button className="btn" disabled={!chosen.length} onClick={() => setReturning(true)}><Icon name="undo" /> Return</button>
              <Button variant={chosen.length ? "primary" : "secondary"} disabled={!chosen.length} busy={act.busy} busyLabel="Approving" onClick={askApprove}><Icon name="check" />{" "}
                Approve{chosen.length ? ` ${chosen.length}` : ""}
              </Button>
            </div>
          </div>
          {inbox.loading && !inbox.data ? <Skeleton rows={6} /> : (
            <ResponsiveList<Row>
              rows={shown} rowKey={(r) => r.claimId} onRowClick={(r) => navigate(`/claims/${r.claimId}`)}
              edge={(r) => (r.flags.length ? "warn" : undefined)}
              columns={[
                { header: <input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(shown.map((r) => r.claimId)))} />, cell: check },
                { header: "Employee", cell: (r) => <><span className="name">{r.employee.full_name}</span>{r.onBehalfOf && <div className="sub">For {r.onBehalfOf}</div>}</> },
                { header: "Claim", cell: (r) => <><span className="name">{r.claimNo}</span><div className="sub">{r.items} {r.items === 1 ? "item" : "items"}</div>{r.selfApproved && <SelfApprovedPill />}</> },
                isL1 ? { header: "Submitted", cell: (r: Row) => date(r.since).slice(0, 6) } : { header: "Manager approved", cell: (r: Row) => r.prev ?? "—" },
                { header: "Amount", align: "right", cell: (r) => money(r.amount) },
                { header: "Policy", cell: policy },
                ...(isL1 ? [{ header: "Goes to next", cell: (r: Row) => r.next }] : []),
                { header: <span className="sr-only">Actions</span>, align: "right", cell: () => <span style={{ textDecoration: "underline", fontSize: 13 }}>Review</span> },
              ]}
              card={(r) => ({ title: r.employee.full_name, status: check(r), detail: <>{r.claimNo} · <b>{money(r.amount)}</b></>,
                meta: [r.claimNo ?? "", r.flags.length ? `${r.flags.length} flagged` : "Within policy", isL1 ? `Next: ${r.next}` : `Manager: ${r.prev ?? "—"}`] })}
              footer={<Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />}
              empty={<Empty icon="check" title={q ? "Nothing matches your search" : "You're all caught up"}>{q ? "Try another name or claim." : "New claims routed to you will show here."}</Empty>}
            />
          )}
          <ReasonDialog open={returning} onOpenChange={setReturning} title={`Return ${chosen.length} to the employee`} confirm="Return"
            body="Each whole claim goes back to its employee. When they resubmit, approval restarts with the manager." onConfirm={giveBack} />
          {confirm.node}
        </>
      )}
    </>
  );
}

/** Claims this person has acted on or that were routed to them. */
function History() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useResource(() => claimsApi.list("routed"));
  if (loading && !data) return <Skeleton rows={6} />;
  const rows = data ?? [];
  return (
    <>
      <ErrorAlert error={error} onRetry={reload} />
      <ResponsiveList<ClaimSummary>
        rows={rows.slice(page * PAGE, page * PAGE + PAGE)} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/claims/${c.id}`)}
        columns={[
          { header: "Employee", cell: (c) => <span className="name">{c.employee.full_name}</span> },
          { header: "Claim", cell: (c) => <><span className="name">{c.claim_no}</span><div className="sub">{c.line_count} items</div></> },
          { header: "Submitted", cell: (c) => date(c.submitted_at) },
          { header: "Amount", align: "right", cell: (c) => money(c.total_approved ?? c.total_claimed) },
          { header: "Status", cell: (c) => <StatusPill status={c.status} /> },
        ]}
        card={(c) => ({ title: c.employee.full_name, status: <StatusPill status={c.status} />, detail: c.claim_no ?? "—", meta: [money(c.total_approved ?? c.total_claimed)] })}
        footer={<Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />}
        empty={<Empty icon="list" title="No history yet">Claims you approve or return will show here.</Empty>}
      />
    </>
  );
}
