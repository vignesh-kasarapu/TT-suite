import { useNavigate } from "react-router-dom";
import { useAction, useResource } from "../../controllers/useAsync";
import { financeApi } from "../../models/api";
import { date, money } from "../../models/format";
import type { AdvanceRow } from "../../models/types";
import { ResponsiveList } from "../components/ResponsiveList";
import { AdvancePill, Empty, ErrorAlert, PageHead, Pill, Skeleton, useConfirm } from "../components/ui";

export function AdvancesPage() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useResource(["finance", "advances"], financeApi.advances);
  const act = useAction();
  const confirm = useConfirm();
  const recover = async (id: number) => { if (await act.run(() => financeApi.recover(id))) reload(); };

  const action = (a: AdvanceRow) => a.claim.advance_status === "OPEN" && (
    <button className="btn btn--secondary btn--sm" onClick={(e) => { e.stopPropagation(); confirm.ask({
      title: `Recover ${a.claim.claim_no} through payroll?`, confirm: "Recover", busyLabel: "Saving", run: () => recover(a.claim.id),
      body: <>{money(a.claim.advance_balance)} will be deducted from {a.claim.employee.full_name}'s salary in the next payroll batch.</>,
    }); }}>Recover via payroll</button>
  );

  return (
    <>
      <PageHead title="Cash advances" sub="Balances are reduced automatically as the employee's claims pass Finance." />
      {confirm.node}
      <ErrorAlert error={error ?? act.error} onRetry={reload} />
      {loading && !data ? <Skeleton /> : (
        <ResponsiveList<AdvanceRow>
          rows={data ?? []} rowKey={(a) => a.claim.id} onRowClick={(a) => navigate(`/claims/${a.claim.id}`)}
          edge={(a) => (a.overdue ? "bad" : undefined)}
          columns={[
            { header: "Advance", cell: (a) => <span className="name">{a.claim.claim_no}</span> },
            { header: "Employee", cell: (a) => a.claim.employee.full_name },
            { header: "Status", cell: (a) => <>{a.claim.advance_status && <AdvancePill status={a.claim.advance_status} />} {a.overdue && <Pill tone="bad" icon="clock">Overdue</Pill>}</> },
            { header: "Settle by", cell: (a) => date(a.due_date) },
            { header: "Approved", align: "right", cell: (a) => money(a.claim.total_approved) },
            { header: "Balance", align: "right", cell: (a) => money(a.claim.advance_balance) },
            { header: "", align: "right", cell: action },
          ]}
          card={(a) => ({
            title: `${a.claim.claim_no} · ${a.claim.employee.full_name}`,
            status: a.overdue ? <Pill tone="bad" icon="clock">Overdue</Pill> : a.claim.advance_status ? <AdvancePill status={a.claim.advance_status} /> : undefined,
            detail: <>Balance <b className="num">{money(a.claim.advance_balance)}</b> of {money(a.claim.total_approved)}</>,
            meta: [`Settle by ${date(a.due_date)}`], actions: action(a),
          })}
          empty={<Empty icon="wallet" title="No cash advances yet">Approved advances and their balances will show here.</Empty>}
        />
      )}
    </>
  );
}
