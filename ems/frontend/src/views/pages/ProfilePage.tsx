// Profile (wireframe 5): details from HR (read-only), bank details for reimbursement, notification choices, sign-in.
import { useState, type ReactNode } from "react";
import { useAuth, useMe } from "../../controllers/useAuth";
import { useAction } from "../../controllers/useAsync";
import { authApi } from "../../models/api";
import type { NotifyKind, Preset } from "../../models/types";
import { MODE_NAMES, nextMode, PRESET_NAMES, PRESETS } from "../../theme/theme-switch";
import { roleLabel } from "../components/Shell";
import { Alert, Button, ConfirmDialog, ErrorAlert, Field, Modal, PageHead } from "../components/ui";

const KINDS: { key: NotifyKind; label: string }[] = [
  { key: "APPROVED", label: "Approved" }, { key: "RETURNED", label: "Returned" },
  { key: "PAID", label: "Paid" }, { key: "COMMENT", label: "Commented on" },
];

const Fact = ({ label, children }: { label: string; children: ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>;

export function ProfilePage() {
  const me = useMe();
  const { savePreferences, logout, refresh, prefs: theme } = useAuth();
  const prefs = useAction();
  const look = useAction();
  const out = useAction();
  const [bankOpen, setBankOpen] = useState(false);
  const [confirm, setConfirm] = useState<"one" | "all" | null>(null);

  const togglePref = (k: NotifyKind, on: boolean) => prefs.run(async () => refresh(await authApi.saveNotifyPrefs({ ...me.notify_prefs, [k]: on })));
  // Ends every TT Suite session (all apps, all devices), so go straight to the portal sign-in
  const signOutAll = async () => { if ((await out.run(authApi.signOutEverywhere)) !== undefined) window.location.assign("/login"); };
  const saveLook = (preset: Preset, mode = theme.mode) => look.run(() => savePreferences(preset, mode));

  return (
    <div className="stack" style={{ maxWidth: 740 }}>
      <PageHead title="Profile" sub="Personal and reporting details are managed by your admin." />
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
      <section className="panel stack">
        <h2>Appearance</h2>
        <p className="small muted">Your theme is shared by every TT Suite app.</p>
        <ErrorAlert error={look.error} />
        <div className="row">
          <label htmlFor="pref-preset" className="small muted">Theme</label>
          <select id="pref-preset" className="input" style={{ width: "auto" }} value={theme.preset}
            onChange={(e) => saveLook(e.target.value as Preset)}>
            {PRESETS.map((p) => <option key={p} value={p}>{PRESET_NAMES[p]}</option>)}
          </select>
          <span className="small muted">Colour mode</span>
          <button className="btn btn--sm" aria-label={`Colour mode: ${MODE_NAMES[theme.mode]}, press to change`}
            onClick={() => saveLook(theme.preset, nextMode(theme.mode))}>{MODE_NAMES[theme.mode]}</button>
        </div>
      </section>
      <section className="panel">
        <div className="spread">
          <div><h2>Sign-in</h2><p className="small muted">Signed in as {me.email} with Microsoft through the TT Suite.</p></div>
          <div className="actions">
            <button className="btn" onClick={() => setConfirm("one")}>Sign out</button>
            <Button onClick={() => setConfirm("all")} busy={out.busy} busyLabel="Signing out">Log out of all devices</Button>
          </div>
        </div>
        <ErrorAlert error={out.error} />
      </section>
      <BankDialog open={bankOpen} onOpenChange={setBankOpen} />
      <ConfirmDialog open={confirm === "one"} onOpenChange={(o) => !o && setConfirm(null)} title="Sign out?"
        body="You will be signed out of every TT Suite app and need to sign in again." confirm="Sign out" busyLabel="Signing out" onConfirm={logout} />
      <ConfirmDialog open={confirm === "all"} onOpenChange={(o) => !o && setConfirm(null)} title="Log out of all devices?"
        body="You will be signed out of every TT Suite app, here and on every other phone or computer where you are signed in." confirm="Log out everywhere" busyLabel="Signing out" onConfirm={signOutAll} />
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
