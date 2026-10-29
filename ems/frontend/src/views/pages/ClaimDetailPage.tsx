// Claim detail (wireframe 4): expenses on the left; Progress and Comments on the right.
// Approvers act on their lines inline; Finance acts from the Finance review screen or here.
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMe } from "../../controllers/useAuth";
import { useResource } from "../../controllers/useAsync";
import { useClaimActions } from "../../controllers/useClaimActions";
import { refreshBadges } from "../../controllers/useNotifications";
import { lookupsApi } from "../../models/api";
import { date, dateTime, FLAG, LEVEL, money } from "../../models/format";
import type { ClaimDetail, Line, Step } from "../../models/types";
import { Icon } from "../components/Icon";
import {
  AdvancePill, Alert, Button, ConfirmDialog, ErrorAlert, Field, LinePill, Modal, PageHead, Pill, ReasonDialog, SelfApprovedPill, Skeleton,
  Spinner, StatusPill, StepPill, useConfirm,
} from "../components/ui";

export function ClaimDetailPage() {
  const id = Number(useParams().id);
  const me = useMe();
  const c = useClaimActions(id);
  const [sendBack, setSendBack] = useState(false);
  const [withdraw, setWithdraw] = useState(false);

  if (c.loading && !c.data) return <Skeleton rows={8} />;
  if (c.error || !c.data) return <ErrorAlert error={c.error} onRetry={c.reload} />;
  const claim = c.data;
  const mine = claim.employee.id === me.id;
  const myLineSteps = new Map(claim.steps.filter((s) => claim.my_step_ids.includes(s.id) && s.line_id).map((s) => [s.line_id!, s]));
  const canSendBack = claim.my_step_ids.length > 0;
  const done = (ok: boolean) => { if (ok) refreshBadges(); return ok; };
  const editPath = claim.type === "ADVANCE" ? `/advances/${claim.id}/edit` : `/claims/${claim.id}/edit`;
  const back = mine ? ["/claims", "My claims"] : me.roles.includes("ADMIN") ? ["/admin/claims", "All claims"]
    : claim.status === "PENDING_FINANCE" && me.roles.includes("FINANCE") ? ["/finance/review", "Finance review"] : ["/approvals", "Approvals"];
  const total = claim.lines.reduce((s, l) => s + l.amount, 0);

  return (
    <>
      <PageHead
        crumb={<Link to={back[0]}>{back[1]}</Link>}
        title={claim.claim_no ?? "Claim"}
        badge={<StatusPill status={claim.status} />}
        sub={<>
          {!mine && <>{claim.employee.full_name} · {claim.employee.department} · </>}
          {claim.submitted_at ? `Submitted ${date(claim.submitted_at)}` : "Not submitted"}
          {claim.project && ` · ${claim.project}`}
          {claim.purpose && claim.type === "EXPENSE" && ` · ${claim.purpose}`}
        </>}
        action={<span className="actions no-print">
          {claim.can_edit && <Link className="btn btn--primary" to={editPath}>{claim.status === "SENT_BACK" ? "Fix and resubmit" : "Edit and resubmit"}</Link>}
          {claim.can_finance_act && <Link className="btn btn--primary" to={`/finance/review?claim=${claim.id}`}>Review for payment</Link>}
          {canSendBack && !claim.can_finance_act && <button className="btn" onClick={() => setSendBack(true)}><Icon name="undo" /> Return</button>}
          <button className="btn" onClick={() => window.print()}><Icon name="download" /> Download PDF</button>
          {claim.can_withdraw && <button className="btn" onClick={() => setWithdraw(true)}><Icon name="undo" /> Withdraw</button>}
        </span>}
      />

      {claim.return_reason && ["SENT_BACK", "REJECTED"].includes(claim.status) && (
        <Alert tone={claim.status === "REJECTED" ? "danger" : "warning"} title={claim.status === "REJECTED" ? "Rejected" : "Returned"}>{claim.return_reason}</Alert>
      )}
      {claim.status === "PAYMENT_FAILED" && <Alert tone="danger" title="Payment failed">{claim.failure_reason}</Alert>}
      {claim.status === "WITHDRAWN" && mine && <Alert tone="info" title="You withdrew this claim">Edit it and resubmit when ready. Approval starts again from the manager.</Alert>}
      {claim.self_approved && <Alert tone="warning" title="Self-approved">The submitter approved their own step. Finance checks this claim more closely.</Alert>}
      <ErrorAlert error={c.actionError} />

      <div className="two-col">
        <div className="wide stack">
          <section className="panel flush">
            <div className="panel-head"><h2>Expenses</h2></div>
            <ul className="items">
              {claim.lines.map((l) => (
                <ExpenseRow key={l.id} line={l} step={myLineSteps.get(l.id)} actions={c} onDone={done} />
              ))}
            </ul>
            <div className="total"><span>Total</span><span>{money(total)}</span></div>
          </section>
          {(claim.finance_approved_at || claim.type === "ADVANCE") && (
            <section className="panel">
              <h2 style={{ marginBottom: "var(--space-3)" }}>Payment</h2>
              <dl className="kv">
                <dt>Approved</dt><dd className="num">{money(claim.total_approved)}</dd>
                {claim.advance_deducted > 0 && <><dt>Advance adjusted</dt><dd className="num">− {money(claim.advance_deducted)}</dd></>}
                <dt>To be paid</dt><dd className="num">{money(claim.payout_amount)}</dd>
                <dt>Payroll</dt><dd>{claim.paid_at ? `Paid ${dateTime(claim.paid_at)}` : claim.payment_month ?? "—"}</dd>
                {claim.type === "ADVANCE" && <>
                  <dt>Settle by</dt><dd>{date(claim.expected_settlement_date)}</dd>
                  <dt>Balance</dt><dd className="num">{money(claim.advance_balance)} {claim.advance_status && <AdvancePill status={claim.advance_status} />}</dd>
                </>}
              </dl>
            </section>
          )}
        </div>
        <div className="narrow stack">
          <Progress claim={claim} />
          <Comments claim={claim} onSend={c.comment} />
          <History claim={claim} />
          {claim.can_reassign && <Reassign claim={claim} onReassign={c.reassign} />}
        </div>
      </div>

      <ConfirmDialog open={withdraw} onOpenChange={setWithdraw} title="Withdraw this claim?" confirm="Withdraw" busyLabel="Withdrawing"
        body="Approval stops and the claim comes back to you as Withdrawn. You can edit it and resubmit; approval then starts again from the manager."
        onConfirm={c.withdraw} />
      <ReasonDialog open={sendBack} onOpenChange={setSendBack} title="Return to employee" confirm="Return"
        body="The whole claim goes back to the employee. When they resubmit, approval restarts with the manager."
        onConfirm={(r) => c.sendBack(r).then(done)} />
    </>
  );
}

function ExpenseRow({ line: l, step, actions: c, onDone }: {
  line: Line; step?: Step; actions: ReturnType<typeof useClaimActions>; onDone: (ok: boolean) => boolean;
}) {
  const [amount, setAmount] = useState(String(step?.amount ?? l.amount));
  const [reject, setReject] = useState(false);
  const [clear, setClear] = useState(false);
  const confirm = useConfirm();
  const gst = l.cgst + l.sgst + l.igst;
  const dupes = l.duplicate_cleared_reason ? [] : l.duplicate_flags;
  const extra = [l.description, l.extra_field_value].filter(Boolean).join(", ");

  return (
    <li>
      {l.receipt_path
        ? <button className="thumb" onClick={() => c.openReceipt(l.id)} disabled={c.opening === l.id} aria-busy={c.opening === l.id || undefined}
            aria-label={`View receipt for ${l.category_name}`}>{c.opening === l.id ? <Spinner /> : <Icon name="paper" />}</button>
        : <span className="thumb" aria-hidden="true" />}
      <div className="grow">
        <div className="strong">{l.category_name}{l.merchant && ` · ${l.merchant}`}</div>
        <div className="small muted">{date(l.expense_date)}{extra && ` · ${extra}`}{!l.receipt_path && " · No receipt"}</div>
      </div>
      {l.status === "REJECTED" && <LinePill status={l.status} />}
      <span className="amt">
        {l.approved_amount !== null && l.approved_amount !== l.amount && l.status !== "REJECTED"
          ? <><s className="muted small">{money(l.amount)}</s> {money(l.approved_amount)}</> : money(l.amount)}
      </span>
      {(l.policy_flags.length > 0 || dupes.length > 0 || l.reject_reason || l.justification || gst > 0 || l.duplicate_cleared_reason || step) && (
        <div className="detail">
          {gst > 0 && <span className="hint">GST {money(gst)} · {l.gst_credit_eligible ? "credit eligible" : "not eligible, booked as cost"}{l.invoice_no && ` · invoice ${l.invoice_no}`}</span>}
          {l.policy_flags.map((f, i) => <span key={`p${i}`} className="small flag-line"><Icon name={FLAG[f.action][1]} /><span><b>{f.action === "WARN" ? "Note" : "Over limit"}:</b> {f.message}</span></span>)}
          {l.justification && <span className="small">Employee's reason: {l.justification}</span>}
          {dupes.map((f, i) => (
            <span key={`d${i}`} className="small">
              <Icon name="warn" /> <b>Possible duplicate:</b> {f.message} Other claim {f.other_claim_no} by {f.other_employee}, {date(f.other_date)}, {money(Number(f.other_amount))}.{" "}
              {step && <button className="linkbtn" onClick={() => setClear(true)}>Not a duplicate</button>}
            </span>
          ))}
          {l.duplicate_cleared_reason && <span className="hint">Duplicate match cleared: {l.duplicate_cleared_reason}</span>}
          {l.reject_reason && <span className="small flag-line"><Icon name="x" /><span><b>Rejected:</b> {l.reject_reason}</span></span>}
          {step && (
            <div className="row no-print" style={{ alignItems: "flex-end" }}>
              <Field label={`${LEVEL[step.level]} · approve amount (₹)`} id={`amt-${l.id}`}>
                <input id={`amt-${l.id}`} type="number" min="0.01" max={step.amount ?? undefined} step="0.01" className="input num" style={{ width: 140 }}
                  value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Button variant="primary" busy={c.busy} busyLabel="Approving" onClick={() => confirm.ask({
                title: `Approve ${l.category_name}?`, confirm: "Approve", busyLabel: "Approving",
                body: <>Approve {money(Number(amount))}{Number(amount) < (step.amount ?? l.amount) ? <> (lowered from {money(step.amount ?? l.amount)})</> : null}.
                  {" "}It then moves to {step.level === "L1" ? "second approval if it is above the Level 2 amount, otherwise Finance" : "Finance"}.</>,
                run: () => c.approve(step.id, Number(amount)).then(onDone),
              })}><Icon name="check" /> Approve</Button>
              <button className="btn" onClick={() => setReject(true)}>Reject line</button>
            </div>
          )}
        </div>
      )}
      {step && (
        <>
          {confirm.node}
          <ReasonDialog open={reject} onOpenChange={setReject} title={`Reject ${l.category_name} line`} confirm="Reject line" danger
            body="Only this line is rejected. The other lines carry on." onConfirm={(r) => c.rejectLine(step.id, r).then(onDone)} />
          <ReasonDialog open={clear} onOpenChange={setClear} title="Clear duplicate match" confirm="Clear match"
            body="Say why this is not a duplicate. It is recorded in the audit log." onConfirm={(r) => c.clearDuplicate(l.id, r)} />
        </>
      )}
    </li>
  );
}

/** FR-6.6 progress, drawn as the wireframe's vertical steps. */
function Progress({ claim }: { claim: ClaimDetail }) {
  if (!claim.submitted_at) return null;
  const now = claim.steps.filter((s) => s.round === claim.round);
  const state = (level: Step["level"]) => {
    const st = now.filter((s) => s.level === level);
    if (!st.length) return "";
    if (st.some((s) => s.status === "PENDING")) return "current";
    if (st.some((s) => ["REJECTED", "SENT_BACK", "CANCELLED"].includes(s.status))) return "stopped";
    return "done";
  };
  const text = (level: Step["level"], idle: string) => {
    const st = now.filter((s) => s.level === level);
    const pending = st.find((s) => s.status === "PENDING");
    if (pending) return `With ${pending.current_approver_name ?? "—"} since ${date(pending.activated_at).slice(0, 6)}`;
    const acted = st.filter((s) => s.acted_by_name);
    if (!acted.length) return st.length ? "Skipped" : idle;
    const last = acted[acted.length - 1];
    const verb = last.status === "APPROVED" ? (last.self_approved ? "Self-approved" : "Approved by") : last.status === "REJECTED" ? "Rejected by" : "Returned by";
    return `${verb} ${last.self_approved ? "" : last.acted_by_name}, ${date(last.acted_at).slice(0, 6)}`.replace("  ", " ");
  };
  const paid = claim.status === "PAID";
  const rows: [string, string, string][] = [
    ["Submitted", "done", dateTime(claim.submitted_at)],
    ["Manager approval", state("L1"), text("L1", "—")],
    ["Second approval", state("L2") || "skip", text("L2", "Not needed for these amounts")],
    ["Finance review", state("FINANCE"), text("FINANCE", "After approvals")],
    ["Paid", paid ? "done" : "", paid ? dateTime(claim.paid_at) : claim.payment_month ? `Expected in ${claim.payment_month} payroll` : "Expected after finance review"],
  ];
  return (
    <section className="panel">
      <h2 style={{ marginBottom: "var(--space-3)" }}>Progress</h2>
      <ul className="steps">
        {rows.map(([label, st, t]) => (
          <li key={label} className={st}>
            <span className="dot" aria-hidden="true" />
            <div><div className={st === "skip" ? "" : "strong"}>{label}</div><div className="small muted">{t}</div></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comments({ claim, onSend }: { claim: ClaimDetail; onSend: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    if (await onSend(body.trim())) setBody("");
    setBusy(false);
  };
  return (
    <section className="panel stack">
      <h2>Comments</h2>
      {claim.comments.length === 0 && <p className="hint">No comments yet.</p>}
      {claim.comments.map((m) => (
        <div key={m.id} className="comment">
          <div className="small"><span className="strong">{m.author_name}</span> <span className="muted">· {date(m.created_at).slice(0, 6)}</span></div>
          <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
        </div>
      ))}
      <div className="field no-print">
        <label htmlFor="comment">{claim.comments.length ? "Reply" : "Add a comment"}</label>
        <textarea id="comment" className="input" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="no-print"><Button busy={busy} busyLabel="Sending" disabled={!body.trim()} onClick={send}>Send</Button></div>
    </section>
  );
}

function History({ claim }: { claim: ClaimDetail }) {
  const lineNo = new Map(claim.lines.map((l, i) => [l.id, i + 1]));
  const steps = [...claim.steps].reverse();
  if (!steps.length) return null;
  return (
    <details className="panel">
      <summary className="strong" style={{ cursor: "pointer" }}>Approval history ({steps.length})</summary>
      <ul className="timeline" style={{ marginTop: "var(--space-3)" }}>
        {steps.map((s) => (
          <li key={s.id}>
            <span className="dot" aria-hidden="true"><Icon name={s.status === "APPROVED" ? "check" : s.status === "PENDING" ? "clock" : s.status === "REJECTED" ? "x" : "chev"} /></span>
            <div>
              <div className="row" style={{ gap: "var(--space-2)" }}>
                <span className="strong">{LEVEL[s.level]}{s.line_id ? ` · line ${lineNo.get(s.line_id)}` : ""}</span>
                <StepPill status={s.status} />
                {s.self_approved && <SelfApprovedPill />}
                {s.escalated && <Pill tone="warn" icon="clock">Escalated</Pill>}
              </div>
              <div className="small muted">
                {s.status === "PENDING" ? <>With {s.current_approver_name ?? "—"} since {dateTime(s.activated_at)}</>
                  : <>{s.acted_by_name ?? s.approver_name ?? "—"}{s.on_behalf_of_name && ` for ${s.on_behalf_of_name}`}{s.acted_at && ` · ${dateTime(s.acted_at)}`}</>}
                {s.approved_amount !== null && s.status === "APPROVED" && <> · {money(s.approved_amount)}</>}
              </div>
              {s.comment && <div className="hint">{s.comment}</div>}
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function Reassign({ claim, onReassign }: { claim: ClaimDetail; onReassign: (stepId: number, userId: number) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const pending = claim.steps.filter((s) => s.status === "PENDING");
  const [stepId, setStepId] = useState(pending[0]?.id ?? 0);
  const [userId, setUserId] = useState(0);
  const users = useResource(["lookups", "users"], lookupsApi.users);
  const step = pending.find((s) => s.id === stepId);
  const role = step?.level === "FINANCE" ? "FINANCE" : "APPROVER";
  const candidates = (users.data ?? []).filter((u) => u.roles.includes(role) && u.id !== claim.employee.id);

  return (
    <section className="panel stack no-print">
      <h2>Stuck claim?</h2>
      <p className="hint">As Admin you cannot approve, but you can choose who does.</p>
      <div><button className="btn" onClick={() => setOpen(true)}>Reassign a step</button></div>
      <Modal open={open} onOpenChange={setOpen} title="Reassign a pending step">
        <Field label="Step" id="ra-step">
          <select id="ra-step" className="input" value={stepId} onChange={(e) => setStepId(Number(e.target.value))}>
            {pending.map((s) => <option key={s.id} value={s.id}>{LEVEL[s.level]} · now {s.current_approver_name}</option>)}
          </select>
        </Field>
        <Field label="New approver" id="ra-user">
          <select id="ra-user" className="input" value={userId} onChange={(e) => setUserId(Number(e.target.value))}>
            <option value={0}>Choose</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.employee_code})</option>)}
          </select>
        </Field>
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <Button variant="primary" disabled={!userId} onClick={async () => { if (await onReassign(stepId, userId)) setOpen(false); }}>Reassign</Button>
        </div>
      </Modal>
    </section>
  );
}
