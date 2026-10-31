// New expense claim (wireframe 3): claim details on the left, expenses and the "Add an expense" box on the right.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RECEIPT_RULE, RECEIPT_TYPES, useClaimForm } from "../../controllers/useClaimForm";
import { useMe } from "../../controllers/useAuth";
import { date, money, todayIso, FLAG } from "../../models/format";
import type { Category } from "../../models/types";
import { Icon, type IconName } from "../components/Icon";
import { Picker } from "../components/Picker";
import { Alert, Button, ErrorAlert, Field, PageHead, Skeleton, useConfirm, IconButton, Spinner } from "../components/ui";

/** An icon for a category group, chosen from its name. */
function groupIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/travel|flight|trip/.test(n)) return "plane";
  if (/food|meal/.test(n)) return "food";
  if (/work|tool|office/.test(n)) return "briefcase";
  if (/train|course|learn/.test(n)) return "book";
  return "grid";
}

/** An icon for a sub-category, chosen from its name. */
function subIcon(c: Category): IconName {
  const n = c.name.toLowerCase();
  if (/training|course/.test(n)) return "book";
  if (/hotel|stay|lodg/.test(n)) return "bed";
  if (/cab|taxi|transport|fuel|car|vehicle|mileage/.test(n)) return "car";
  if (/flight|train|travel/.test(n)) return "plane";
  if (/meal|food|lunch|dinner/.test(n)) return "food";
  if (/phone|internet|mobile/.test(n)) return "phone";
  if (/software|subscription/.test(n)) return "grid";
  if (/train|course/.test(n)) return "book";
  if (/office|suppl|equip/.test(n)) return "briefcase";
  return "receipt";
}


export function ClaimFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const f = useClaimForm(id ? Number(id) : undefined);
  const me = useMe();
  const confirm = useConfirm();

  if (f.loadError) return <ErrorAlert error={f.loadError} />;
  if (!f.lists) return <Skeleton rows={8} />;

  const onSubmit = async () => {
    const done = await f.submit();
    if (done) navigate(`/claims/${done.id}`);
    return !!done;
  };
  const leavePath = f.claim ? `/claims/${f.claim.id}` : "/claims";
  const goesTo = me.can_request_advance
    ? "If it is within policy and your self-approval limit, it is self-approved and goes straight to Finance; otherwise it goes to your manager."
    : `It goes to ${me.manager_name ?? "your manager"} for approval, then to Finance.`;
  const askSubmit = () => confirm.ask({
    title: f.claim ? "Resubmit this claim?" : "Submit this claim?",
    body: <>{money(f.total)} for {f.lines.length} {f.lines.length === 1 ? "expense" : "expenses"}. {goesTo} You cannot edit it while it is being approved.</>,
    confirm: f.claim ? "Resubmit" : "Submit", busyLabel: "Submitting", run: onSubmit,
  });
  const askLeave = () => (f.dirty
    ? confirm.ask({ title: "Discard your changes?", body: "Nothing you entered on this page will be kept.", confirm: "Discard", danger: true, run: () => navigate(leavePath) })
    : navigate(leavePath));
  const receiptText = (i: number) => {
    const l = f.lines[i];
    const cat = f.categoryOf(l.category_id);
    if (l.receipt_path) return <span className="small muted">Receipt attached</span>;
    const needed = cat?.receipt_required && (cat.receipt_threshold === null || l.amount > cat.receipt_threshold);
    return needed ? <span className="small strong">Receipt missing</span> : <span className="small muted">No receipt needed</span>;
  };

  return (
    <>
      <PageHead
        crumb={<><Link to="/claims">My claims</Link> / {f.claim ? f.claim.claim_no : "New claim"}</>}
        title={f.claim ? "Edit expense claim" : "New expense claim"}
        action={<>
          <button className="btn" onClick={askLeave}>Cancel</button>
          <Button variant="primary" onClick={askSubmit} busy={f.busy} busyLabel="Submitting" disabled={!f.lines.length}><Icon name="send" /> {f.claim ? "Resubmit claim" : "Submit claim"}</Button>
        </>}
      />
      {f.claim?.status === "SENT_BACK" && f.claim.return_reason && (
        <Alert tone="warning" title="Returned to you">{f.claim.return_reason} Resubmitting restarts approval from the manager.</Alert>
      )}
      {f.claim?.status === "WITHDRAWN" && (
        <Alert tone="info" title="You withdrew this claim">Make your changes, then resubmit. Approval starts again from the manager.</Alert>
      )}
      {confirm.node}
      <ErrorAlert error={f.error} />

      <div className="claim-form">
        <section className="panel stack claim-details">
          <h2>Claim details</h2>
          <Field label="Claim title" id="title">
            <input id="title" className="input" placeholder="e.g. Client visit, Bengaluru" value={f.title} onChange={(e) => f.setTitle(e.target.value)} />
          </Field>
          <Field label={f.lists.require_project ? "Project" : "Project (optional)"} id="project">
            {f.lists.projects.length ? (
              <Picker id="project" value={f.project} onChange={f.setProject} placeholder="Select a project"
                options={f.lists.projects.map((p) => ({ value: p, label: p }))} />
            ) : <input id="project" className="input" value={f.project} onChange={(e) => f.setProject(e.target.value)} />}
          </Field>
          <Field label={f.lists.require_purpose ? "Business purpose" : "Business purpose (optional)"} id="purpose">
            <input id="purpose" className="input" placeholder="One line" value={f.purpose} onChange={(e) => f.setPurpose(e.target.value)} />
          </Field>
          <dl className="kv small" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-3)" }}>
            <dt>Items</dt><dd>{f.lines.length}</dd>
            <dt>Total</dt><dd className="strong">{money(f.total)}</dd>
          </dl>
        </section>

        <section className="panel flush">
          <div className="panel-head"><h2>Expenses</h2><span className="small muted">{f.lines.length} {f.lines.length === 1 ? "item" : "items"}</span></div>
          <ul className="items">
            {f.lines.map((l, i) => {
              const cat = f.categoryOf(l.category_id);
              const flags = f.flags[i] ?? [];
              return (
                <li key={l.id ?? `n${i}`} style={f.editing === i ? { background: "var(--color-tint-3)" } : undefined}>
                  <span className="thumb" aria-hidden="true">{cat && <Icon name={subIcon(cat)} />}</span>
                  <div className="grow">
                    <div className="strong">{cat?.name ?? "Category"}</div>
                    <div className="small muted">{[cat?.group_name, l.merchant, date(l.expense_date).slice(0, 6)].filter(Boolean).join(" · ")}</div>
                  </div>
                  {receiptText(i)}
                  <span className="amt">{money(l.amount)}</span>
                  <IconButton icon="edit" label={`Edit ${cat?.name ?? "expense"}`} onClick={() => f.startEdit(i)} />
                  <IconButton icon="trash" danger label={`Remove ${cat?.name ?? "expense"}`} onClick={() => confirm.ask({
                    title: "Remove this expense?", body: <>{cat?.name ?? "Expense"} · {money(l.amount)} is taken off this claim.</>,
                    confirm: "Remove", danger: true, run: () => f.remove(i),
                  })} />
                  {flags.length > 0 && (
                    <div className="detail">
                      {flags.map((fl, j) => (
                        <span key={j} className={`flag-line ${fl.action === "BLOCK" ? "error-msg" : "hint"}`}>
                          <Icon name={FLAG[fl.action][1]} />
                          <span>{fl.action === "BLOCK" ? "Not allowed: " : fl.action === "FLAG" ? "Over limit, add a reason: " : "Note: "}{fl.message}</span>
                        </span>
                      ))}
                      {flags.some((x) => x.action === "FLAG") && (
                        <input className="input" aria-label="Reason for going over the limit" placeholder="Reason for going over the limit"
                          value={l.justification} onChange={(e) => f.update(i, { justification: e.target.value })} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {f.lines.length === 0 && <li className="muted small">No expenses yet. Add one below.</li>}
          </ul>
          {f.checking && <div className="small muted" role="status"><Spinner /> Checking policy…</div>}
          <div className="total"><span>Total</span><span>{money(f.total)}</span></div>
          <ExpenseEditor f={f} />
        </section>
      </div>
    </>
  );
}

function ExpenseEditor({ f }: { f: ReturnType<typeof useClaimForm> }) {
  const e = f.editor;
  const cat = f.categoryOf(e.category_id);
  const [group, setGroup] = useState(cat?.group_name || "");
  useEffect(() => setGroup(f.categoryOf(f.editor.category_id)?.group_name || ""), [f.editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const subs = f.groups.find(([g]) => g === (group || "Other"))?.[1] ?? [];

  const pickGroup = (g: string) => {
    setGroup(g);
    const inGroup = f.groups.find(([x]) => x === g)?.[1] ?? [];
    // One sub-category only? Pick it. Otherwise ask, unless the current one already belongs here.
    if (inGroup.length === 1) f.patchEditor({ category_id: inGroup[0].id });
    else if (!inGroup.some((c) => c.id === e.category_id)) f.patchEditor({ category_id: 0 });
  };

  const num = (v: string) => (v === "" ? 0 : Number(v));
  const companyGstins = Object.entries(f.gstins);

  // GST fields show only for GST invoices: ticked by hand, or when any of them already has a value
  const hasGst = !!(e.invoice_no || e.supplier_gstin || e.buyer_gstin || e.cgst || e.sgst || e.igst);
  const [gstOn, setGstOn] = useState(false);
  useEffect(() => setGstOn(false), [f.editing, f.lines.length]);
  const showGst = gstOn || hasGst;
  const toggleGst = (on: boolean) => {
    setGstOn(on);
    if (!on) f.patchEditor({ invoice_no: "", supplier_gstin: "", buyer_gstin: "", cgst: 0, sgst: 0, igst: 0 });
  };

  return (
    <div className="addbox">
      <div className="spread">
        <h3>{f.editing === null ? "Add an expense" : "Edit expense"}</h3>
        <span className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap", minWidth: 0 }}>
          {e.receipt_name && <span className="small muted receipt-name" title={e.receipt_name}>{e.receipt_name}</span>}
          <label className="btn btn--sm" title={`Attach a photo or PDF of the receipt. ${RECEIPT_RULE}.`}>
            {f.uploading === -1 ? <><Spinner /> Uploading</> : <><Icon name="upload" /> {e.receipt_name ? "Change receipt" : "Attach receipt"}</>}
            <input type="file" accept={RECEIPT_TYPES.join(",")} aria-describedby="receipt-rule" className="sr-only"
              onChange={(ev) => { if (ev.target.files?.[0]) f.uploadEditor(ev.target.files[0]); ev.target.value = ""; }} />
          </label>
        </span>
      </div>
      <p className="hint" id="receipt-rule" style={{ textAlign: "right", marginTop: "calc(-1 * var(--space-2))" }}>Receipt: {RECEIPT_RULE}</p>

      <div className="grid2">
        <Field label="Category" id="x-group">
          <Picker id="x-group" value={group} onChange={pickGroup} placeholder="Choose a category"
            options={f.groups.map(([g]) => ({ value: g, label: g, icon: groupIcon(g) }))} />
        </Field>
        <Field label="Sub-category" id="x-cat">
          <Picker id="x-cat" value={e.category_id ? String(e.category_id) : ""} onChange={(v) => f.patchEditor({ category_id: Number(v) })}
            placeholder={group ? "Choose a sub-category" : "Choose a category first"} disabled={!group}
            options={subs.map((c) => ({ value: String(c.id), label: c.name, icon: subIcon(c), hint: c.description ?? undefined }))} />
        </Field>
      </div>
      <div className="grid3 grid3-even">
        <Field label="Date" id="x-date">
          <input id="x-date" type="date" className="input" max={todayIso()} value={e.expense_date} onChange={(ev) => f.patchEditor({ expense_date: ev.target.value })} />
        </Field>
        <Field label="Amount (₹)" id="x-amt">
          <input id="x-amt" type="number" min="0" step="0.01" inputMode="decimal" className="input num" placeholder="0" value={e.amount || ""}
            onChange={(ev) => f.patchEditor({ amount: num(ev.target.value) })} />
        </Field>
        <Field label="Merchant" id="x-merchant">
          <input id="x-merchant" className="input" value={e.merchant} onChange={(ev) => f.patchEditor({ merchant: ev.target.value })} />
        </Field>
      </div>
      <div className={cat?.extra_field_label ? "grid2" : undefined}>
        <Field label="Description (optional)" id="x-desc">
          <input id="x-desc" className="input" placeholder="e.g. Hyderabad to Bengaluru" value={e.description} onChange={(ev) => f.patchEditor({ description: ev.target.value })} />
        </Field>
        {cat?.extra_field_label && (
          <Field label={cat.extra_field_label} id="x-extra"><input id="x-extra" className="input" value={e.extra_field_value} onChange={(ev) => f.patchEditor({ extra_field_value: ev.target.value })} /></Field>
        )}
      </div>

      <label className="chk">
        <input type="checkbox" checked={showGst} onChange={(ev) => toggleGst(ev.target.checked)} />
        GST invoice <span className="hint">(the bill shows a GSTIN)</span>
      </label>
      {showGst && (
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          {companyGstins.length > 0 && (
            <span className="hint">Ask the vendor to bill our GSTIN: {companyGstins.map(([s, g]) => <span key={g}><b>{g}</b> ({s}) </span>)}</span>
          )}
          <div className="grid3 grid3-even">
            <Field label="Invoice number" id="x-inv"><input id="x-inv" className="input" value={e.invoice_no} onChange={(ev) => f.patchEditor({ invoice_no: ev.target.value })} /></Field>
            <Field label="Supplier GSTIN" id="x-sg"><input id="x-sg" className="input" maxLength={15} value={e.supplier_gstin} onChange={(ev) => f.patchEditor({ supplier_gstin: ev.target.value.toUpperCase() })} /></Field>
            <Field label="Billed to GSTIN" id="x-bg"><input id="x-bg" className="input" maxLength={15} value={e.buyer_gstin} onChange={(ev) => f.patchEditor({ buyer_gstin: ev.target.value.toUpperCase() })} /></Field>
            {(["cgst", "sgst", "igst"] as const).map((k) => (
              <Field key={k} label={`${k.toUpperCase()} (₹)`} id={`x-${k}`}>
                <input id={`x-${k}`} type="number" min="0" step="0.01" className="input num" value={e[k] || ""} onChange={(ev) => f.patchEditor({ [k]: num(ev.target.value) })} />
              </Field>
            ))}
          </div>
        </div>
      )}

      {f.editorError && <span className="error-msg">{f.editorError}</span>}
      <div className="actions" style={{ justifyContent: "flex-end" }}>
        {f.editing !== null && <button className="btn btn--ghost" onClick={f.cancelEdit}><Icon name="x" /> Cancel</button>}
        <button className="btn" style={{ borderColor: "var(--color-text)" }} onClick={f.commitEditor}><Icon name={f.editing === null ? "plus" : "check"} /> {f.editing === null ? "Add expense" : "Save expense"}</button>
      </div>
    </div>
  );
}
