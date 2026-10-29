// Admin · All claims (wireframe 10): view only, department + period filters, stage tabs, waiting on, days in stage.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAction, useResource } from "../../../controllers/useAsync";
import { claimsApi, lookupsApi } from "../../../models/api";
import { money, todayIso } from "../../../models/format";
import { download } from "../../../models/http";
import type { ClaimSummary } from "../../../models/types";
import { ReceiptLink } from "../../components/ReceiptLink";
import { ResponsiveList } from "../../components/ResponsiveList";
import { Button, Empty, ErrorAlert, PageHead, Pager, Pill, Skeleton, StagePill, Tabs } from "../../components/ui";

const TABS: { key: string; label: string; stages: string[] | null }[] = [
  { key: "all", label: "All", stages: null },
  { key: "approval", label: "In approval", stages: ["Manager approval", "Second approval"] },
  { key: "finance", label: "Finance review", stages: ["Finance review", "Approved for payment", "Payment failed"] },
  { key: "paid", label: "Paid", stages: ["Paid"] },
  { key: "returned", label: "Returned & rejected", stages: ["Returned", "Rejected"] },
];
const PERIODS = [{ key: "90", label: "Last 90 days" }, { key: "30", label: "Last 30 days" }, { key: "fy", label: "This financial year" }, { key: "", label: "All time" }];
const PAGE = 10;

function sinceFor(period: string): string | undefined {
  if (!period) return undefined;
  const t = new Date(`${todayIso()}T00:00:00`);
  if (period === "fy") return `${t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1}-04-01`;
  t.setDate(t.getDate() - Number(period));
  return t.toLocaleDateString("en-CA");
}

export function AllClaimsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const [department, setDepartment] = useState("");
  const [period, setPeriod] = useState("90");
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(0);
  const filter = { q: q || undefined, department: department || undefined, since: sinceFor(period) };
  const { data, error, loading, reload } = useResource(["claims", "all", filter], () => claimsApi.list("all", filter));
  const lists = useResource(["lookups", "lists"], lookupsApi.lists);
  const exporter = useAction();
  useEffect(() => setPage(0), [tab, q, department, period]);

  const rows = useMemo(() => (data ?? []).filter((c) => { const s = TABS.find((t) => t.key === tab)?.stages; return !s || s.includes(c.stage); }), [data, tab]);
  const days = (c: ClaimSummary) => (["Paid", "Rejected"].includes(c.stage) ? "—" : Math.max(0, Math.floor((Date.now() - new Date(c.stage_since).getTime()) / 86_400_000)));
  const waiting = (c: ClaimSummary) => (["Paid", "Rejected"].includes(c.stage) ? "—" : c.stage === "Approved for payment" ? "Payout run" : c.waiting_on);

  return (
    <>
      <PageHead title="All claims" badge={<Pill tone="muted">View only</Pill>} sub={q ? `Showing results for "${q}"` : undefined}
        action={<>
          <select className="input" style={{ width: "auto" }} aria-label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {(lists.data?.departments ?? []).map((d) => <option key={d}>{d}</option>)}
          </select>
          <select className="input" style={{ width: "auto" }} aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <Button busy={exporter.busy} busyLabel="Exporting" onClick={() => exporter.run(() => download(claimsApi.exportUrl("all", filter)))}>Export CSV</Button>
        </>} />
      <Tabs value={tab} onChange={setTab} tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} />
      <ErrorAlert error={error ?? exporter.error} onRetry={reload} />
      {loading && !data ? <Skeleton rows={6} /> : (
        <ResponsiveList<ClaimSummary>
          rows={rows.slice(page * PAGE, page * PAGE + PAGE)} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/claims/${c.id}`)}
          columns={[
            { header: "Claim", cell: (c) => <span className="name">{c.claim_no}</span> },
            { header: "Employee", cell: (c) => c.employee.full_name },
            { header: "Department", cell: (c) => c.employee.department || "—" },
            { header: "Amount", align: "right", cell: (c) => money(c.total_approved ?? c.total_claimed) },
            { header: "Stage", cell: (c) => <StagePill stage={c.stage} /> },
            { header: "Waiting on", cell: waiting },
            { header: "Days in stage", align: "right", cell: days },
            { header: "Receipt", cell: (c) => <ReceiptLink claim={c} /> },
          ]}
          card={(c) => ({ title: c.claim_no ?? "—", status: <StagePill stage={c.stage} />, detail: `${c.employee.full_name} · ${c.employee.department}`,
            meta: [c.claim_no ?? "", money(c.total_approved ?? c.total_claimed), `Waiting on ${waiting(c)}`],
            actions: (c.receipt_line_ids ?? []).length > 0 ? <ReceiptLink claim={c} /> : undefined })}
          footer={<Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />}
          empty={<Empty title="Nothing matches">Try another stage, department or period.</Empty>}
        />
      )}
    </>
  );
}
