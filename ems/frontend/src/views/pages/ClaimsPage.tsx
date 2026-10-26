// My claims (wireframe 2): status tabs, Export CSV, table with expected payout, pages.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMe } from "../../controllers/useAuth";
import { useAction, useResource } from "../../controllers/useAsync";
import { claimsApi } from "../../models/api";
import { date, money } from "../../models/format";
import { download } from "../../models/http";
import type { ClaimStatus, ClaimSummary } from "../../models/types";
import { Icon } from "../components/Icon";
import { ResponsiveList } from "../components/ResponsiveList";
import { Button, Empty, ErrorAlert, PageHead, Pager, Pill, Skeleton, StatusPill, Tabs } from "../components/ui";

const TABS: { key: string; label: string; statuses: ClaimStatus[] | null }[] = [
  { key: "all", label: "All", statuses: null },
  { key: "progress", label: "In progress", statuses: ["PENDING_APPROVAL", "PENDING_FINANCE", "READY_FOR_PAYROLL", "SENT_TO_PAYROLL", "PAYMENT_FAILED"] },
  { key: "returned", label: "Returned", statuses: ["SENT_BACK", "WITHDRAWN", "REJECTED"] },
  { key: "paid", label: "Paid", statuses: ["PAID"] },
];
const PAGE = 10;

export function expectedPayout(c: ClaimSummary): string {
  if (c.status === "PAID") return "Paid";
  if (!c.payment_month) return "—";
  return `${c.payment_month} payroll`;
}

export function ClaimsPage() {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useResource(() => claimsApi.list("mine", { q: q || undefined }), [q]);
  const exporter = useAction();
  useEffect(() => setPage(0), [tab, q]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, (data ?? []).filter((c) => !t.statuses || t.statuses.includes(c.status)).length])), [data]);
  const rows = (data ?? []).filter((c) => { const s = TABS.find((t) => t.key === tab)?.statuses; return !s || s.includes(c.status); });
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <>
      <PageHead title="My claims" sub={q ? <>Showing results for "{q}" · <Link to="/claims">clear search</Link></> : undefined}
        action={<>
          {me.can_request_advance && <Link className="btn" to="/advances/new"><Icon name="wallet" /> Request advance</Link>}
          <Button busy={exporter.busy} busyLabel="Exporting" onClick={() => exporter.run(() => download(claimsApi.exportUrl("mine", { q: q || undefined })))}><Icon name="download" /> Export CSV</Button>
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, n: counts[t.key] }))} />
      <ErrorAlert error={error ?? exporter.error} onRetry={reload} />
      {loading && !data ? <Skeleton rows={6} /> : (
        <ResponsiveList<ClaimSummary>
          rows={shown} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/claims/${c.id}`)}
          columns={[
            { header: "Claim", cell: (c) => <span className="name">{c.claim_no}{c.type === "ADVANCE" && <> <Pill tone="muted" icon="wallet">Advance</Pill></>}</span> },
            { header: "Submitted", cell: (c) => date(c.submitted_at) },
            { header: "Items", align: "right", cell: (c) => c.line_count },
            { header: "Amount", align: "right", cell: (c) => money(c.total_approved ?? c.total_claimed) },
            { header: "Status", cell: (c) => <StatusPill status={c.status} /> },
            { header: "Expected payout", cell: expectedPayout },
          ]}
          card={(c) => ({ title: c.claim_no ?? "—", status: <StatusPill status={c.status} />, meta: [money(c.total_approved ?? c.total_claimed), `${c.line_count} items`, expectedPayout(c)] })}
          footer={<Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />}
          empty={q || tab !== "all"
            ? <Empty title="Nothing matches">Try another tab or search.</Empty>
            : <Empty icon="paper" title="No claims yet" action={<Link className="btn btn--primary" to="/claims/new"><Icon name="plus" /> New claim</Link>}>Your claims will show here.</Empty>}
        />
      )}
    </>
  );
}
