import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, lookupsApi, type AuditFilter } from "../../../models/api";
import { dateTime, LEVEL, money } from "../../../models/format";
import { download } from "../../../models/http";
import type { AuditRow, Level } from "../../../models/types";
import { Icon } from "../../components/Icon";
import { ResponsiveList } from "../../components/ResponsiveList";
import { Button, Empty, ErrorAlert, PageHead, Pill, Skeleton } from "../../components/ui";

export function AuditPage() {
  const users = useResource(lookupsApi.users);
  const [filter, setFilter] = useState<AuditFilter>({});
  const [applied, setApplied] = useState<AuditFilter>({});
  const rows = useResource(() => adminApi.audit(applied), [JSON.stringify(applied)]);
  const exp = useAction();
  const set = (patch: AuditFilter) => setFilter({ ...filter, ...patch });

  const who = (r: AuditRow) => <>{r.actor_name}{r.on_behalf_of_name && <span className="muted"> for {r.on_behalf_of_name}</span>}</>;
  const details = (r: AuditRow) => {
    const d = r.details ?? {};
    if ("reason" in d && d.reason) return String(d.reason);
    if ("old" in d || "new" in d) return "Changed (old and new values in export)";
    return Object.keys(d).length ? JSON.stringify(d) : "";
  };

  return (
    <>
      <PageHead title="Audit log" sub="Every action and change. Entries cannot be edited or deleted."
        action={<Button small busy={exp.busy} busyLabel="Exporting" onClick={() => exp.run(() => download(adminApi.auditExportUrl(applied)))}><Icon name="download" /> Excel</Button>} />
      <form className="grid4" onSubmit={(e) => { e.preventDefault(); setApplied(filter); }}>
        <select className="input" aria-label="User" value={filter.user_id ?? ""} onChange={(e) => set({ user_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Everyone</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <input className="input" placeholder="Claim number, e.g. CLM-000012" aria-label="Claim number" value={filter.claim_no ?? ""} onChange={(e) => set({ claim_no: e.target.value })} />
        <select className="input" aria-label="Level" value={filter.level ?? ""} onChange={(e) => set({ level: e.target.value })}>
          <option value="">All levels</option><option value="L1">Level 1</option><option value="L2">Level 2</option><option value="FINANCE">Finance</option>
        </select>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input type="date" className="input" aria-label="From" value={filter.start ?? ""} onChange={(e) => set({ start: e.target.value })} />
          <input type="date" className="input" aria-label="To" value={filter.end ?? ""} onChange={(e) => set({ end: e.target.value })} />
        </div>
        <div><button className="btn btn--secondary" type="submit">Apply</button></div>
      </form>
      <ErrorAlert error={rows.error ?? exp.error} onRetry={rows.reload} />
      {rows.loading && !rows.data ? <Skeleton rows={8} /> : (
        <ResponsiveList<AuditRow>
          rows={rows.data ?? []} rowKey={(r) => r.id}
          columns={[
            { header: "When", cell: (r) => <span className="small">{dateTime(r.at)}</span> },
            { header: "Who", cell: who },
            { header: "Action", cell: (r) => <>{r.action.replaceAll("_", " ").toLowerCase()} {r.self_approved && <Pill tone="warn" icon="usercheck">Self-approved</Pill>}</> },
            { header: "Claim", cell: (r) => (r.claim_id ? <Link to={`/claims/${r.claim_id}`}>{r.claim_no}</Link> : `${r.entity} ${r.entity_id}`) },
            { header: "Level", cell: (r) => (r.level ? LEVEL[r.level as Level] : "") },
            { header: "Amount", align: "right", cell: (r) => (r.amount !== null ? money(r.amount) : "") },
            { header: "Details", cell: (r) => <span className="small">{details(r)}</span> },
          ]}
          card={(r) => ({ title: r.action.replaceAll("_", " ").toLowerCase(), detail: who(r), meta: [dateTime(r.at), r.claim_no ?? "", r.amount !== null ? money(r.amount) : ""].filter(Boolean) })}
          empty={<Empty icon="paper" title="Nothing matches your filter">Try a wider date range or another person.</Empty>}
        />
      )}
    </>
  );
}
