// Finance review (wireframe 8): list of claims waiting on the left, the selected claim checked line by line on the right.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAction, useResource } from "../../controllers/useAsync";
import { refreshBadges } from "../../controllers/useNotifications";
import { approvalsApi, claimsApi, lookupsApi } from "../../models/api";
import { date, money } from "../../models/format";
import { ApiError, download } from "../../models/http";
import type { ClaimDetail, Line } from "../../models/types";
import { Icon } from "../components/Icon";
import { Alert, Button, Empty, ErrorAlert, PageHead, SelfApprovedPill, Skeleton, useConfirm } from "../components/ui";

export function FinanceReviewPage() {
  const [params, setParams] = useSearchParams();
  const inbox = useResource(approvalsApi.inbox);
  const policy = useResource(lookupsApi.policy);
  const queue = useMemo(() => (inbox.data ?? []).filter((i) => i.level === "FINANCE"), [inbox.data]);
  const selectedId = Number(params.get("claim")) || queue[0]?.claim_id || 0;
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const act = useAction();
  const confirm = useConfirm();

  useEffect(() => {
    setClaim(null);
    setNote("");
    if (selectedId) claimsApi.get(selectedId).then(setClaim).catch(() => setClaim(null));
  }, [selectedId]);

  const limitText = (l: Line) => policy.data?.categories.find((c) => c.id === l.category_id)?.limits[0]?.text ?? "—";
  const receipt = (l: Line) => (l.receipt_path ? "Attached" : policy.data?.categories.find((c) => c.id === l.category_id)?.receipt === "Not needed" ? "Not needed" : "Missing");
  const checkText = (l: Line) => {
    const mark = (icon: Parameters<typeof Icon>[0]["name"], text: string, strong = true) =>
      <span className={`flag-line ${strong ? "strong" : "muted"}`}><Icon name={icon} /><span>{text}</span></span>;
    if (l.status === "REJECTED") return mark("x", "Rejected", false);
    if (l.duplicate_flags.length && !l.duplicate_cleared_reason) return mark("warn", "Possible duplicate");
    if (l.policy_flags.some((f) => f.action !== "WARN")) return mark("flag", "Over limit");
    if (receipt(l) === "Missing") return mark("receipt", "Receipt missing");
    return mark("check", "Within policy", false);
  };

  const after = (msg: string) => { setDone(msg); inbox.reload(); refreshBadges(); setParams({}); };
  const approve = async () => { if (claim && (await act.run(() => approvalsApi.financeApprove(claim.id, note || undefined)))) after(`${claim.claim_no} approved for payment.`); };
  const needNote = () => { if (!note.trim()) { act.setError(new ApiError("Write a note to the employee first.", 400)); return false; } return true; };
  const giveBack = async () => { if (claim && needNote() && (await act.run(() => approvalsApi.sendBack(claim.id, note)))) after(`${claim.claim_no} returned to the employee.`); };
  const reject = async () => { if (claim && needNote() && (await act.run(() => approvalsApi.financeReject(claim.id, note)))) after(`${claim.claim_no} rejected.`); };

  return (
    <>
      <PageHead title="Finance review" sub="Check each claim against the expense policy before it is paid." />
      {confirm.node}
      {done && <Alert tone="success" action={<button className="linkbtn" onClick={() => setDone(null)}>Dismiss</button>}>{done}</Alert>}
      <ErrorAlert error={inbox.error} onRetry={inbox.reload} />
      {inbox.loading && !inbox.data ? <Skeleton rows={6} /> : queue.length === 0 ? (
        <div className="list-wrap"><Empty icon="check" title="Nothing waiting for review">Claims appear here once their approvers are done.</Empty></div>
      ) : (
        <div className="md">
          <section className="panel flush master">
            <div className="panel-head"><h3>Waiting for review · {queue.length}</h3></div>
            {queue.map((i) => (
              <button key={i.claim_id} aria-current={i.claim_id === selectedId ? "true" : undefined} onClick={() => { setDone(null); setParams({ claim: String(i.claim_id) }); }}>
                <div className="strong">{i.claim_no} {i.self_approved && <SelfApprovedPill />}</div>
                <div className="small muted">{i.employee.full_name} · {money(i.amount)}{i.flags.length > 0 && ` · ${i.flags.length} flagged`}</div>
              </button>
            ))}
          </section>
          <section className="panel flush detail">
            {!claim ? <div style={{ padding: 14 }}><Skeleton rows={4} /></div> : (
              <>
                <div className="spread" style={{ padding: "12px 14px", alignItems: "flex-start" }}>
                  <div>
                    <h2><Link to={`/claims/${claim.id}`} style={{ textDecoration: "none" }}>{claim.claim_no}</Link></h2>
                    <div className="small muted">{claim.employee.full_name} · {claim.employee.department || "—"}{claim.project && ` · ${claim.project}`}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="strong" style={{ fontSize: "var(--text-section-size)", lineHeight: "var(--text-section-lh)" }}>{money(claim.total_approved)}</div>
                  </div>
                </div>
                <div className="rl-scroll">
                  <table className="plain">
                    <thead><tr><th>Date</th><th>Category</th><th className="r">Amount</th><th>Policy limit</th><th>Receipt</th><th>Check</th></tr></thead>
                    <tbody>
                      {claim.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{date(l.expense_date).slice(0, 6)}</td>
                          <td>{l.category_name}{l.merchant && <div className="sub">{l.merchant}</div>}</td>
                          <td className="r">{money(l.status === "REJECTED" ? 0 : l.approved_amount ?? l.amount)}</td>
                          <td className="muted">{limitText(l)}</td>
                          <td>{l.receipt_path
                            ? <button className="linkbtn" onClick={() => act.run(() => download(claimsApi.receiptUrl(claim.id, l.id), true))}>View</button>
                            : receipt(l)}</td>
                          <td>{checkText(l)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="stack" style={{ padding: "12px 14px", borderTop: "1px solid var(--color-border)" }}>
                  <ErrorAlert error={act.error} />
                  <div className="row" style={{ alignItems: "flex-end" }}>
                    <div className="field" style={{ flex: "1 1 260px" }}>
                      <label htmlFor="note">Note to employee</label>
                      <input id="note" className="input" placeholder="Required when returning or rejecting" value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                    <div className="actions">
                      <button className="btn" disabled={act.busy} onClick={() => needNote() && confirm.ask({
                        title: `Reject ${claim.claim_no}?`, confirm: "Reject claim", danger: true, busyLabel: "Rejecting", run: reject,
                        body: "The whole claim is rejected and will not be paid. The employee sees your note.",
                      })}><Icon name="x" /> Reject</button>
                      <button className="btn" disabled={act.busy} onClick={() => needNote() && confirm.ask({
                        title: `Return ${claim.claim_no} to the employee?`, confirm: "Return", busyLabel: "Returning", run: giveBack,
                        body: "The employee sees your note, fixes the claim and resubmits it. Approval then starts again from the manager.",
                      })}><Icon name="undo" /> Return to employee</button>
                      <Button variant="primary" busy={act.busy} busyLabel="Approving" onClick={() => confirm.ask({
                        title: `Approve ${claim.claim_no} for payment?`, confirm: "Approve for payment", busyLabel: "Approving", run: approve,
                        body: <>{money(claim.total_approved)} goes into the next payroll batch for {claim.employee.full_name}.</>,
                      })}><Icon name="check" /> Approve for payment</Button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
