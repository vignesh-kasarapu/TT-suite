// Finance verifies employees' new bank details before they are used for a payout.
import { useState } from "react";
import { useAction, useResource } from "../../controllers/useAsync";
import { financeApi } from "../../models/api";
import type { BankChange } from "../../models/types";
import { ResponsiveList } from "../components/ResponsiveList";
import { Button, Empty, ErrorAlert, PageHead, ReasonDialog, Skeleton, useConfirm } from "../components/ui";

const show = (d: Record<string, string>) => `${d.bank_account_holder || "—"} · ${d.bank_account_no || "—"} · ${d.bank_ifsc || "—"}${d.bank_upi ? ` · ${d.bank_upi}` : ""}`;

export function BankChangesPage() {
  const { data, error, loading, reload } = useResource(["finance", "bank-changes"], financeApi.bankChanges);
  const act = useAction();
  const [rejecting, setRejecting] = useState<BankChange | null>(null);
  const confirm = useConfirm();
  const verify = async (b: BankChange) => { if ((await act.run(() => financeApi.verifyBank(b.user_id))) !== undefined) reload(); };
  const actions = (b: BankChange) => (
    <span className="actions">
      <Button small variant="primary" busy={act.busy} busyLabel="Verifying" onClick={() => confirm.ask({
        title: `Verify ${b.full_name}'s new bank details?`, confirm: "Verify", busyLabel: "Verifying", run: () => verify(b),
        body: <>From now on payouts go to <b>{show(b.requested)}</b>. Only verify after checking the details with the employee.</>,
      })}>Verify</Button>
      <button className="btn btn--secondary btn--sm" onClick={() => setRejecting(b)}>Reject</button>
    </span>
  );

  return (
    <>
      <PageHead title="Bank detail changes" sub="Check the new details with the employee before verifying. Payouts use the old details until then." />
      <ErrorAlert error={error ?? act.error} onRetry={reload} />
      {confirm.node}
      {loading && !data ? <Skeleton /> : (
        <ResponsiveList<BankChange>
          rows={data ?? []} rowKey={(b) => b.user_id}
          columns={[
            { header: "Employee", cell: (b) => <><span className="name">{b.full_name}</span><div className="hint">{b.employee_code}</div></> },
            { header: "Current", cell: (b) => <span className="small">{show(b.current)}</span> },
            { header: "Requested", cell: (b) => <span className="small"><b>{show(b.requested)}</b></span> },
            { header: "", align: "right", cell: actions },
          ]}
          card={(b) => ({ title: b.full_name, detail: <>New: <b>{show(b.requested)}</b></>, meta: [`Now: ${show(b.current)}`], actions: actions(b) })}
          empty={<Empty icon="check" title="Nothing to verify">New bank detail changes will show here.</Empty>}
        />
      )}
      <ReasonDialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)} title={`Reject ${rejecting?.full_name}'s change`} confirm="Reject change" danger
        body="The employee keeps their current details and sees your reason."
        onConfirm={async (r) => { if ((await act.run(() => financeApi.rejectBank(rejecting!.user_id, r))) !== undefined) reload(); }} />
    </>
  );
}
