import { useState } from "react";
import { useMe } from "../../controllers/useAuth";
import { useAction, useResource } from "../../controllers/useAsync";
import { delegationsApi, lookupsApi } from "../../models/api";
import { date, todayIso } from "../../models/format";
import type { Delegation } from "../../models/types";
import { ResponsiveList } from "../components/ResponsiveList";
import { Alert, Button, Empty, ErrorAlert, Field, PageHead, Pill, Skeleton, useConfirm } from "../components/ui";

export function DelegationPage() {
  const me = useMe();
  const list = useResource(delegationsApi.list);
  const users = useResource(lookupsApi.users);
  const create = useAction();
  const cancel = useAction();
  const [delegate, setDelegate] = useState(0);
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const confirm = useConfirm();

  // A22: the delegate must hold the same approval roles.
  const myRoles = me.roles.filter((r) => r === "APPROVER" || r === "FINANCE");
  const candidates = (users.data ?? []).filter((u) => u.id !== me.id && myRoles.every((r) => u.roles.includes(r)));

  const submit = async () => {
    const ok = await create.run(() => delegationsApi.create({ delegate_id: delegate, start_date: start, end_date: end, reason }));
    if (ok) {
      setDelegate(0); setEnd(""); setReason("");
      list.reload();
    }
  };

  const askCreate = () => confirm.ask({
    title: "Hand over your approvals?", confirm: "Hand over", busyLabel: "Saving", run: submit,
    body: <>From {date(start)} to {date(end)}, everything waiting for you goes to {candidates.find((u) => u.id === delegate)?.full_name}. You cannot approve until it ends or you cancel it.</>,
  });
  const askCancel = (d: Delegation) => confirm.ask({
    title: "Cancel this delegation?", confirm: "Cancel delegation", danger: true, busyLabel: "Cancelling",
    body: <>Items waiting with {d.delegate.full_name} come back to you straight away.</>,
    run: () => cancel.run(() => delegationsApi.cancel(d.id)).then(list.reload),
  });

  const status = (d: Delegation) =>
    d.cancelled_at ? <Pill tone="muted" icon="ban">Cancelled</Pill> : d.is_active_now ? <Pill tone="ok" icon="check">Active now</Pill>
      : d.end_date < todayIso() ? <Pill tone="muted">Ended</Pill> : <Pill tone="accent" icon="clock">Scheduled</Pill>;

  return (
    <>
      <PageHead title="Delegation" sub="Hand over all your approvals while you are away." />
      {confirm.node}
      <Alert tone="info">
        During the dates you choose, everything waiting for you, and anything new, goes to your delegate only. You cannot act until the
        delegation ends or you cancel it; then the remaining items come back to you. A delegate never approves their own claim.
      </Alert>
      <form className="panel stack" onSubmit={(e) => { e.preventDefault(); askCreate(); }}>
        <h2>New delegation</h2>
        <div className="grid3">
          <Field label="Delegate" id="dg-user" hint="Only people with the same approval role are listed.">
            <select id="dg-user" className="input" value={delegate} onChange={(e) => setDelegate(Number(e.target.value))} required>
              <option value={0}>Choose a person</option>
              {candidates.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.employee_code})</option>)}
            </select>
          </Field>
          <Field label="From" id="dg-start"><input id="dg-start" type="date" className="input" min={todayIso()} value={start} onChange={(e) => setStart(e.target.value)} required /></Field>
          <Field label="To" id="dg-end"><input id="dg-end" type="date" className="input" min={start} value={end} onChange={(e) => setEnd(e.target.value)} required /></Field>
        </div>
        <Field label="Reason (optional)" id="dg-reason"><input id="dg-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <ErrorAlert error={create.error} />
        <div><Button variant="primary" type="submit" busy={create.busy} busyLabel="Saving" disabled={!delegate || !end}>Hand over approvals</Button></div>
      </form>

      <ErrorAlert error={list.error ?? cancel.error} onRetry={list.reload} />
      {list.loading && !list.data ? <Skeleton /> : (
        <>
          <section className="stack">
            <h2>Handed over by you</h2>
            <ResponsiveList<Delegation>
              rows={list.data?.given ?? []} rowKey={(d) => d.id}
              columns={[
                { header: "Delegate", cell: (d) => d.delegate.full_name },
                { header: "Dates", cell: (d) => `${date(d.start_date)} – ${date(d.end_date)}` },
                { header: "Status", cell: status },
                { header: "", align: "right", cell: (d) => !d.cancelled_at && d.end_date >= todayIso() && (
                  <button className="btn btn--secondary btn--sm" onClick={() => askCancel(d)}>Cancel</button>
                ) },
              ]}
              card={(d) => ({
                title: d.delegate.full_name, status: status(d), detail: `${date(d.start_date)} – ${date(d.end_date)}`,
                actions: !d.cancelled_at && d.end_date >= todayIso() && <button className="btn btn--secondary btn--sm" onClick={() => askCancel(d)}>Cancel</button>,
              })}
              empty={<Empty icon="swap" title="No delegations yet">Set one before you go on leave.</Empty>}
            />
          </section>
          {(list.data?.received.length ?? 0) > 0 && (
            <section className="stack">
              <h2>Handed to you</h2>
              <ResponsiveList<Delegation>
                rows={list.data!.received} rowKey={(d) => d.id}
                columns={[
                  { header: "From", cell: (d) => d.delegator.full_name },
                  { header: "Dates", cell: (d) => `${date(d.start_date)} – ${date(d.end_date)}` },
                  { header: "Status", cell: status },
                ]}
                card={(d) => ({ title: d.delegator.full_name, status: status(d), detail: `${date(d.start_date)} – ${date(d.end_date)}` })}
                empty={null}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
