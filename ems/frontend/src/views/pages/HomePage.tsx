// Dashboard: figure cards, then recent claims beside what needs attention and where your claims stand. No sentences.
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useMe } from "../../controllers/useAuth";
import { useResource } from "../../controllers/useAsync";
import { approvalsApi, claimsApi } from "../../models/api";
import { date, money, monthIso } from "../../models/format";
import type { ClaimStatus, ClaimSummary } from "../../models/types";
import { Icon, type IconName } from "../components/Icon";
import { ResponsiveList } from "../components/ResponsiveList";
import { Empty, ErrorAlert, PageHead, Skeleton, StatusPill, Spinner } from "../components/ui";

interface Todo { key: string; item: string; icon: IconName; claim: string; to: string; action: string }

/** Where the person's claims stand, in the order a claim moves. */
const STAGES: { label: string; statuses: ClaimStatus[] }[] = [
  { label: "Under review", statuses: ["PENDING_APPROVAL"] },
  { label: "With finance", statuses: ["PENDING_FINANCE"] },
  { label: "Approved for payout", statuses: ["READY_FOR_PAYROLL", "SENT_TO_PAYROLL"] },
  { label: "Paid", statuses: ["PAID"] },
  { label: "Returned", statuses: ["SENT_BACK", "WITHDRAWN"] },
  { label: "Payment failed", statuses: ["PAYMENT_FAILED"] },
  { label: "Rejected", statuses: ["REJECTED"] },
];

export function HomePage() {
  const me = useMe();
  const { has } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useResource(["claims", "mine", ""], () => claimsApi.list("mine"));
  const reviewer = has("APPROVER") || has("FINANCE");
  const inbox = useResource(reviewer ? ["approvals", "inbox"] : ["approvals", "none"], () => (reviewer ? approvalsApi.inbox() : Promise.resolve([])));
  const claims = data ?? [];

  const count = (s: string[]) => claims.filter((c) => s.includes(c.status)).length;
  const sum = (f: (c: ClaimSummary) => boolean) => claims.filter(f).reduce((s, c) => s + (c.payout_amount ?? 0), 0);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const waiting = new Set((inbox.data ?? []).map((i) => i.claim_id)).size;
  const open = claims.find((c) => c.type === "ADVANCE" && (c.advance_status === "OPEN" || c.advance_status === "RECOVERY_REQUESTED"));
  const due = claims.filter((c) => c.payment_month === monthIso() && c.status !== "PAID");
  const paid = claims.filter((c) => c.status === "PAID");

  type Fig = { label: string; value: string | number; icon: IconName; foot: string; to?: string };
  const figures: Fig[] = [
    ...(reviewer ? [{ label: "To approve", value: waiting, icon: "inbox" as const, foot: waiting ? "Waiting on you" : "All clear", to: has("APPROVER") ? "/approvals" : "/finance/review" }] : []),
    { label: "Under review", value: count(["PENDING_APPROVAL", "PENDING_FINANCE"]), icon: "clock", foot: "With approvers or finance", to: "/claims" },
    { label: "Returned to you", value: count(["SENT_BACK", "WITHDRAWN"]), icon: "undo", foot: "Fix and resubmit", to: "/claims" },
    { label: "Due this month", value: money(sum((c) => c.payment_month === monthIso() && c.status !== "PAID")), icon: "receipt", foot: plural(due.length, "claim") },
    { label: "Paid", value: money(sum((c) => c.status === "PAID")), icon: "wallet", foot: plural(paid.length, "claim") },
    ...(open ? [{ label: "Advance balance", value: money(open.advance_balance), icon: "bank" as const, foot: "Open advance" }] : []),
  ];

  const todo: Todo[] = [
    ...claims.filter((c) => c.status === "SENT_BACK").map((c) => ({ key: `sb${c.id}`, item: "Returned", icon: "undo" as const, claim: c.claim_no ?? "—", to: `/claims/${c.id}`, action: "Fix and resubmit" })),
    ...claims.filter((c) => c.status === "WITHDRAWN").map((c) => ({ key: `wd${c.id}`, item: "Withdrawn", icon: "undo" as const, claim: c.claim_no ?? "—", to: `/claims/${c.id}`, action: "Edit and resubmit" })),
    ...claims.filter((c) => c.status === "PAYMENT_FAILED").map((c) => ({ key: `pf${c.id}`, item: "Payment failed", icon: "warn" as const, claim: c.claim_no ?? "—", to: "/profile", action: "Check bank details" })),
    ...(!me.bank_account_no_masked && !me.bank_change_pending ? [{ key: "bank", item: "Bank details missing", icon: "bank" as const, claim: "Needed for payouts", to: "/profile", action: "Add" }] : []),
  ];

  const stages = STAGES.map((s) => ({ ...s, n: count(s.statuses) })).filter((s) => s.n > 0);
  const most = Math.max(1, ...stages.map((s) => s.n));

  return (
    <>
      <PageHead title="Dashboard" sub={`Welcome back, ${me.full_name.split(" ")[0]}`} action={<>
        {me.can_request_advance && <Link className="btn" to="/advances/new"><Icon name="wallet" /> Request advance</Link>}
      </>} />

      <div className="kpis">
        {figures.map((f) => {
          const body = (
            <>
              <span className="kpi-top"><span className="kpi-label">{f.label}</span><span className="kpi-ico" aria-hidden="true"><Icon name={f.icon} /></span></span>
              <span className="kpi-value">{loading ? <Spinner /> : f.value}</span>
              <span className="kpi-foot">{f.foot}</span>
            </>
          );
          return f.to ? <Link key={f.label} to={f.to} className="kpi">{body}</Link> : <div key={f.label} className="kpi">{body}</div>;
        })}
      </div>

      <div className="dash-grid">
        <section className="panel flush">
          <div className="panel-head"><h2>Recent claims</h2><Link to="/claims" className="small">View all</Link></div>
          <ErrorAlert error={error} onRetry={reload} />
          {loading ? <div style={{ padding: 14 }}><Skeleton /></div> : (
            <ResponsiveList<ClaimSummary>
              rows={claims.slice(0, 6)} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/claims/${c.id}`)}
              columns={[
                { header: "Claim", cell: (c) => <><span className="name">{c.claim_no}</span><div className="sub">{c.line_count} {c.line_count === 1 ? "item" : "items"}</div></> },
                { header: "Submitted", cell: (c) => date(c.submitted_at) },
                { header: "Amount", align: "right", cell: (c) => money(c.total_approved ?? c.total_claimed) },
                { header: "Status", cell: (c) => <StatusPill status={c.status} /> },
              ]}
              card={(c) => ({ title: c.claim_no ?? "—", status: <StatusPill status={c.status} />, meta: [money(c.total_approved ?? c.total_claimed), date(c.submitted_at)] })}
              empty={<Empty icon="paper" title="No claims yet">Start one with New claim.</Empty>}
            />
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <h2 style={{ marginBottom: "var(--space-3)" }}>Needs your attention</h2>
            {loading ? <Skeleton rows={2} /> : todo.length === 0 ? (
              <p className="flag-line hint"><Icon name="check" /><span>All caught up</span></p>
            ) : (
              <ul className="todo-list">
                {todo.map((t) => (
                  <li key={t.key}>
                    <span className="todo-ico" aria-hidden="true"><Icon name={t.icon} /></span>
                    <span className="todo-text"><span className="name">{t.item}</span><span className="sub">{t.claim}</span></span>
                    <Link to={t.to}>{t.action}</Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {stages.length > 0 && (
            <section className="panel">
              <h2 style={{ marginBottom: "var(--space-3)" }}>Your claims by status</h2>
              <ul className="stage-list">
                {stages.map((s) => (
                  <li key={s.label}>
                    <span>{s.label}</span>
                    <span className="track" aria-hidden="true"><span className="fill" style={{ width: `${(s.n / most) * 100}%` }} /></span>
                    <span className="num strong">{s.n}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
