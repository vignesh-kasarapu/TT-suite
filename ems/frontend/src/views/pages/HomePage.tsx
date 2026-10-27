// Dashboard: small figure cards, then what needs attention and recent claims. No sentences.
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useMe } from "../../controllers/useAuth";
import { useResource } from "../../controllers/useAsync";
import { approvalsApi, claimsApi } from "../../models/api";
import { date, money, monthIso } from "../../models/format";
import type { ClaimSummary } from "../../models/types";
import { Icon, type IconName } from "../components/Icon";
import { ResponsiveList } from "../components/ResponsiveList";
import { Empty, ErrorAlert, PageHead, Skeleton, StatusPill, Spinner } from "../components/ui";

interface Todo { key: string; item: string; icon: IconName; claim: string; to: string; action: string }

export function HomePage() {
  const me = useMe();
  const { has } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useResource(() => claimsApi.list("mine"));
  const reviewer = has("APPROVER") || has("FINANCE");
  const inbox = useResource(() => (reviewer ? approvalsApi.inbox() : Promise.resolve([])));
  const claims = data ?? [];

  const count = (s: string[]) => claims.filter((c) => s.includes(c.status)).length;
  const sum = (f: (c: ClaimSummary) => boolean) => claims.filter(f).reduce((s, c) => s + (c.payout_amount ?? 0), 0);
  const waiting = new Set((inbox.data ?? []).map((i) => i.claim_id)).size;
  const open = claims.find((c) => c.type === "ADVANCE" && (c.advance_status === "OPEN" || c.advance_status === "RECOVERY_REQUESTED"));

  type Fig = { label: string; value: string | number; icon: IconName; to?: string };
  const figures: Fig[] = [
    ...(reviewer ? [{ label: "To approve", value: waiting, icon: "inbox" as const, to: has("APPROVER") ? "/approvals" : "/finance/review" }] : []),
    { label: "Under review", value: count(["PENDING_APPROVAL", "PENDING_FINANCE"]), icon: "clock", to: "/claims" },
    { label: "Returned to you", value: count(["SENT_BACK", "WITHDRAWN"]), icon: "undo", to: "/claims" },
    { label: "Due this month", value: money(sum((c) => c.payment_month === monthIso() && c.status !== "PAID")), icon: "receipt" },
    { label: "Paid", value: money(sum((c) => c.status === "PAID")), icon: "wallet" },
    ...(open ? [{ label: "Advance balance", value: money(open.advance_balance), icon: "bank" as const }] : []),
  ];

  const todo: Todo[] = [
    ...claims.filter((c) => c.status === "SENT_BACK").map((c) => ({ key: `sb${c.id}`, item: "Returned", icon: "undo" as const, claim: c.claim_no ?? "—", to: `/claims/${c.id}`, action: "Fix and resubmit" })),
    ...claims.filter((c) => c.status === "WITHDRAWN").map((c) => ({ key: `wd${c.id}`, item: "Withdrawn", icon: "undo" as const, claim: c.claim_no ?? "—", to: `/claims/${c.id}`, action: "Edit and resubmit" })),
    ...claims.filter((c) => c.status === "PAYMENT_FAILED").map((c) => ({ key: `pf${c.id}`, item: "Payment failed", icon: "warn" as const, claim: c.claim_no ?? "—", to: "/profile", action: "Check bank details" })),
    ...(!me.bank_account_no_masked && !me.bank_change_pending ? [{ key: "bank", item: "Bank details missing", icon: "bank" as const, claim: "—", to: "/profile", action: "Add" }] : []),
  ];

  return (
    <>
      <PageHead title="Dashboard" action={<>
        {me.can_request_advance && <Link className="btn" to="/advances/new"><Icon name="wallet" /> Request advance</Link>}
        <Link className="btn btn--primary btn--new-claim" to="/claims/new"><Icon name="plus" /> New claim</Link>
      </>} />

      <div className="minicards">
        {figures.map((f) => {
          const body = (
            <>
              <span className="mc-ico" aria-hidden="true"><Icon name={f.icon} /></span>
              <span className="mc-text"><span className="mc-label">{f.label}</span><span className="mc-value">{loading ? <Spinner /> : f.value}</span></span>
            </>
          );
          return f.to ? <Link key={f.label} to={f.to} className="minicard">{body}</Link> : <div key={f.label} className="minicard">{body}</div>;
        })}
      </div>

      {todo.length > 0 && (
        <section className="stack" style={{ gap: "var(--space-2)" }}>
          <h2 className="flag-line"><Icon name="info" /><span>Needs your attention</span></h2>
          <ResponsiveList<Todo>
            rows={todo} rowKey={(t) => t.key} onRowClick={(t) => navigate(t.to)}
            columns={[
              { header: "Item", cell: (t) => <span className="name flag-line"><Icon name={t.icon} /><span>{t.item}</span></span> },
              { header: "Claim", cell: (t) => t.claim },
              { header: "Action", align: "right", cell: (t) => <Link to={t.to}>{t.action}</Link> },
            ]}
            card={(t) => ({ title: t.item, detail: t.claim, actions: <Link to={t.to}>{t.action}</Link> })}
            empty={null}
          />
        </section>
      )}

      <section className="stack" style={{ gap: "var(--space-2)" }}>
        <div className="spread"><h2>Recent claims</h2><Link to="/claims" className="small">View all</Link></div>
        <ErrorAlert error={error} onRetry={reload} />
        {loading ? <Skeleton /> : (
          <ResponsiveList<ClaimSummary>
            rows={claims.slice(0, 8)} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/claims/${c.id}`)}
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
    </>
  );
}
