// Expense profile (wireframe 5): details from HR (read-only), bank details for reimbursement, notification choices.
// Name, theme and sign-out live in the TT Suite profile (/profile at the site root, outside the /expense router).
import { useState, type ReactNode } from "react";
import { useAuth, useMe } from "../../controllers/useAuth";
import { useAction } from "../../controllers/useAsync";
import { authApi } from "../../models/api";
import type { NotifyKind } from "../../models/types";
import { roleLabel } from "../components/Shell";
import { Alert, Button, ErrorAlert, Field, Modal, PageHead } from "../components/ui";

const KINDS: { key: NotifyKind; label: string }[] = [
  { key: "APPROVED", label: "Approved" }, { key: "RETURNED", label: "Returned" },
  { key: "PAID", label: "Paid" }, { key: "COMMENT", label: "Commented on" },
];

const Fact = ({ label, children }: { label: string; children: ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

export function ProfilePage() {
  const me = useMe();
  const { refresh } = useAuth();
  const prefs = useAction();
  const [bankOpen, setBankOpen] = useState(false);

  const togglePref = (k: NotifyKind, on: boolean) => prefs.run(async () => refresh(await authApi.saveNotifyPrefs({ ...me.notify_prefs, [k]: on })));

  return (
    <div className="stack" style={{ maxWidth: 740 }}>
      <PageHead title="Bank & notifications" sub="Personal and reporting details are managed by your admin." />
      <p className="small muted">Your name, theme and sign-out are in your <a href="/profile">TT Suite profile</a>.</p>
      <section className="panel stack">
        <h2>Personal details</h2>
        <dl className="facts">
          <Fact label="Name">{me.full_name}</Fact>
          <Fact label="Employee ID">{me.employee_code}</Fact>
          <Fact label="Email">{me.email}</Fact>
          <Fact label="Phone">{me.phone || "—"}</Fact>
          <Fact label="Department">{me.department || "—"}</Fact>
          <Fact label="Designation">{me.designation || "—"}</Fact>
        </dl>
      </section>
      <section className="panel stack">
        <h2>Reporting</h2>
        <dl className="facts">
          <Fact label="Role">{roleLabel(me)}</Fact>
          <Fact label="Reporting manager">{me.manager_name ?? "—"}</Fact>
        </dl>
      </section>
      <section className="panel stack">
        <div className="spread"><h2>Bank details for reimbursement</h2><button className="btn" onClick={() => setBankOpen(true)}>Change</button></div>
        {me.bank_change_pending && <Alert tone="info">Your new bank details are waiting for Finance to verify them. Payouts use the details below until then.</Alert>}
        <dl className="facts">
          <Fact label="Account holder">{me.bank_account_holder || "—"}</Fact>
          <Fact label="Account number">{me.bank_account_no_masked || "Not added"}</Fact>
          <Fact label="IFSC">{me.bank_ifsc || "—"}</Fact>
          <Fact label="UPI ID">{me.bank_upi || "Not added"}</Fact>
        </dl>
        <p className="small muted">Changes are verified by finance before the next payout.</p>
      </section>
      <section className="panel stack">
        <h2>Notify me when a claim is</h2>
        <ErrorAlert error={prefs.error} />
        <div className="row" style={{ gap: "var(--space-5)" }}>
          {KINDS.map((k) => (
            <label key={k.key} className="chk">
              <input type="checkbox" checked={me.notify_prefs[k.key] !== false} onChange={(e) => togglePref(k.key, e.target.checked)} /> {k.label}
            </label>
          ))}
        </div>
      </section>
      <BankDialog open={bankOpen} onOpenChange={setBankOpen} />
    </div>
  );
}

function BankDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { refresh } = useAuth();
  const me = useMe();
  const [form, setForm] = useState({ account_holder: me.full_name, account_no: "", ifsc: "", upi: "" });
  const { busy, error, run } = useAction();
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const save = async () => {
    const updated = await run(() => authApi.changeBank(form));
    if (updated) { refresh(updated); onOpenChange(false); }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Change bank details">
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Account holder" id="b-holder"><input id="b-holder" className="input" value={form.account_holder} onChange={(e) => set({ account_holder: e.target.value })} required /></Field>
        <Field label="Account number" id="b-acc"><input id="b-acc" className="input num" inputMode="numeric" autoComplete="off" value={form.account_no} onChange={(e) => set({ account_no: e.target.value })} required /></Field>
        <Field label="IFSC" id="b-ifsc" hint="For example HDFC0001234."><input id="b-ifsc" className="input" maxLength={11} value={form.ifsc} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} required /></Field>
        <Field label="UPI ID (optional)" id="b-upi"><input id="b-upi" className="input" value={form.upi} onChange={(e) => set({ upi: e.target.value })} /></Field>
        <ErrorAlert error={error} />
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>Cancel</button>
          <Button variant="primary" type="submit" busy={busy} busyLabel="Saving">Send for verification</Button>
        </div>
      </form>
    </Modal>
  );
}
