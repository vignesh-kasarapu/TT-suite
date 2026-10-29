import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMe } from "../../controllers/useAuth";
import { useAction } from "../../controllers/useAsync";
import { claimsApi } from "../../models/api";
import { money, todayIso } from "../../models/format";
import { Icon } from "../components/Icon";
import { Alert, Button, Empty, ErrorAlert, Field, PageHead, useConfirm } from "../components/ui";

export function AdvanceFormPage() {
  const me = useMe();
  const { id } = useParams();
  const navigate = useNavigate();
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [settle, setSettle] = useState("");
  const [returnReason, setReturnReason] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const confirm = useConfirm();

  useEffect(() => {
    if (!id) return;
    claimsApi.get(Number(id)).then((c) => {
      setAmount(String(c.total_claimed));
      setPurpose(c.title);
      setSettle(c.expected_settlement_date ?? "");
      setReturnReason(c.return_reason);
    });
  }, [id]);

  if (!me.can_request_advance) {
    return <Empty icon="wallet" title="Only Managers and Admins can request cash advances">Ask your manager if you need one for a trip.</Empty>;
  }

  const submit = async () => {
    const body = { amount: Number(amount), purpose, expected_settlement_date: settle };
    const done = await run(() => (id ? claimsApi.resubmitAdvance(Number(id), body) : claimsApi.requestAdvance(body)));
    if (done) navigate(`/claims/${done.id}`);
    return !!done;
  };
  const askSubmit = () => confirm.ask({
    title: id ? "Resubmit this advance?" : "Request this cash advance?", confirm: id ? "Resubmit" : "Request", busyLabel: "Submitting", run: submit,
    body: <>{money(Number(amount))}, to be settled by {settle}. If it is within your self-approval limit it goes straight to Finance; larger amounts also need the second approver.</>,
  });

  return (
    <>
      <PageHead title={id ? "Resubmit cash advance" : "Request a cash advance"}
        sub="It is approved like a claim and paid in payroll. Later claims are adjusted against it until it is settled." />
      {returnReason && <Alert tone="warning" title="Sent back to you">{returnReason}</Alert>}
      {confirm.node}
      <form className="panel stack form-narrow" onSubmit={(e) => { e.preventDefault(); askSubmit(); }}>
        <div className="grid2">
          <Field label="Amount (₹)" id="adv-amount">
            <input id="adv-amount" type="number" min="1" step="0.01" inputMode="decimal" className="input num" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Expected settlement date" id="adv-settle" hint="By when you expect to claim the expenses.">
            <input id="adv-settle" type="date" min={todayIso()} className="input" value={settle} onChange={(e) => setSettle(e.target.value)} required />
          </Field>
        </div>
        <Field label="Purpose" id="adv-purpose">
          <textarea id="adv-purpose" className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)} required minLength={3} />
        </Field>
        <ErrorAlert error={error} />
        <div className="actions"><Button variant="primary" type="submit" busy={busy} busyLabel="Submitting"><Icon name="send" /> Submit request</Button></div>
      </form>
    </>
  );
}
