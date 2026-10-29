// Admin · Settings (wireframes 11-14): one page, tabs for Users, Approvals, Categories, Policy limits and General.
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, lookupsApi } from "../../../models/api";
import { money } from "../../../models/format";
import type { Settings } from "../../../models/types";
import { Icon } from "../../components/Icon";
import { Alert, Button, ErrorAlert, Field, LastChange, Modal, PageHead, Skeleton, Tabs, IconButton } from "../../components/ui";
import { CategoriesPage } from "./CategoriesPage";
import { LimitsPage } from "./LimitsPage";
import { UsersPage } from "./UsersPage";

type Tab = "users" | "approvals" | "categories" | "limits" | "general";
const TABS: { key: Tab; label: string; entity?: string }[] = [
  { key: "users", label: "Users", entity: "user" }, { key: "approvals", label: "Approvals", entity: "setting" },
  { key: "categories", label: "Categories", entity: "category" }, { key: "limits", label: "Policy limits", entity: "policy_limit" },
  { key: "general", label: "General", entity: "setting" },
];

export function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "users";
  const [changed, setChanged] = useState(0);
  return (
    <>
      <div>
        <PageHead title="Settings" />
        <LastChange refresh={changed} />
      </div>
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={TABS} />
      {tab === "users" && <UsersPage />}
      {tab === "categories" && <CategoriesPage />}
      {tab === "limits" && <LimitsPage />}
      {(tab === "approvals" || tab === "general") && <SettingsForm tab={tab} onSaved={() => setChanged((n) => n + 1)} />}
    </>
  );
}

/** One row of the wireframe settings grid: what it is on the left, the control on the right. */
function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="what"><b>{title}</b>{hint && <span className="hint">{hint}</span>}</div>
      <div>{children}</div>
    </div>
  );
}

function SettingsForm({ tab, onSaved }: { tab: "approvals" | "general"; onSaved: () => void }) {
  const res = useResource(["admin", "settings"], adminApi.settings);
  const users = useResource(["lookups", "users"], lookupsApi.users);
  const save = useAction();
  const [s, setS] = useState<Settings | null>(null);
  const [gstRows, setGstRows] = useState<[string, string][]>([]);
  const [saved, setSaved] = useState(false);
  const [list, setList] = useState<"projects" | "departments" | null>(null);

  const reset = () => { if (res.data) { setS(res.data); setGstRows(Object.entries(res.data.company_gstins)); setSaved(false); } };
  useEffect(reset, [res.data]);

  if (!s) return res.error ? <ErrorAlert error={res.error} onRetry={res.reload} /> : <Skeleton rows={6} />;
  const set = (patch: Partial<Settings>) => { setSaved(false); setS({ ...s, ...patch }); };
  const finance = (users.data ?? []).filter((u) => u.roles.includes("FINANCE"));
  const approvers = (users.data ?? []).filter((u) => u.roles.includes("APPROVER"));
  const num = (k: keyof Settings, unit: string, min = 1) => (
    <span className="row" style={{ gap: "var(--space-2)" }}>
      <input type="number" min={min} className="input num" style={{ width: 90 }} aria-label={unit} value={(s[k] as number | null) ?? ""}
        onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<Settings>)} />
      <span className="hint">{unit}</span>
    </span>
  );
  const person = (k: "fallback_approver_id" | "level2_approver_id" | "finance_backup_reviewer_id" | "finance_second_reviewer_id", pool: typeof finance, none: string) => (
    <select className="input" aria-label={k} value={s[k] ?? ""} onChange={(e) => set({ [k]: e.target.value ? Number(e.target.value) : null })}>
      <option value="">{none}</option>
      {pool.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
    </select>
  );
  const submit = async () => {
    const out = await save.run(() => adminApi.saveSettings({ ...s, company_gstins: Object.fromEntries(gstRows.filter(([k, v]) => k.trim() && v.trim())) }));
    if (out) { setS(out); setSaved(true); onSaved(); }
  };
  const LIST_NAMES = { projects: "Projects", departments: "Departments" } as const;

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {tab === "approvals" ? (
        <>
          <section className="panel">
            <h2>Approval route</h2>
            <p className="hint" style={{ marginBottom: "var(--space-3)" }}>Employee → Reporting manager → Second approver (above {money(s.level2_above)}) → Finance review → Paid</p>
            <Row title="Second approval" hint="Any expense above this amount (after the manager approves it) also goes to the second approver. Same for every category.">
              <span className="row" style={{ gap: "var(--space-2)" }}>
                <span className="hint">Above ₹</span>
                <input type="number" min="0" className="input num" style={{ width: 120 }} aria-label="Second approval above amount" value={s.level2_above}
                  onChange={(e) => set({ level2_above: Number(e.target.value) })} />
                <span className="hint">goes to</span>
                {person("level2_approver_id", approvers, "Choose")}
              </span>
            </Row>
            <Row title="Finance review" hint="Which claims finance checks before payment.">
              <select className="input" aria-label="Finance review" disabled><option>Every claim</option></select>
            </Row>
            <Row title="Fallback approver" hint="Used when the employee has no reporting manager who is a Manager. Leave empty to alert the Admin instead.">
              {person("fallback_approver_id", approvers, "Not set")}
            </Row>
          </section>
          <section className="panel">
            <h2 style={{ marginBottom: "var(--space-3)" }}>Reminders</h2>
            <Row title="Remind approvers after">{num("reminder_days", "days pending")}</Row>
            <Row title="Escalate to the approver's manager after" hint="Counted after the reminder starts.">{num("escalation_days", "more days")}</Row>
          </section>
          <section className="panel">
            <h2 style={{ marginBottom: "var(--space-3)" }}>Self-approval and finance checks</h2>
            <Row title="Self-approval limit" hint="Managers and Admins can self-approve claims up to this total (Finance still checks them). Empty = no limit.">
              <span className="row" style={{ gap: "var(--space-2)" }}>
                <span className="hint">₹</span>
                <input type="number" min="1" className="input num" style={{ width: 120 }} aria-label="Self-approval limit" value={s.self_approval_cap ?? ""}
                  onChange={(e) => set({ self_approval_cap: e.target.value ? Number(e.target.value) : null })} />
              </span>
            </Row>
            <Row title="Finance Backup Reviewer" hint="Does the final check on Finance Reviewers' own claims.">{person("finance_backup_reviewer_id", finance, "Not set")}</Row>
            <Row title="Second finance reviewer" hint="Checks the Finance Backup Reviewer's own claims.">{person("finance_second_reviewer_id", finance, "Not set")}</Row>
          </section>
        </>
      ) : (
        <>
          <section className="panel">
            <h2 style={{ marginBottom: "var(--space-3)" }}>Claims</h2>
            <Row title="Submit within" hint="Expenses older than this can't be claimed. 0 = no limit.">{num("late_submission_days", "days of the expense", 0)}</Row>
            <Row title="Required on every claim">
              <span className="row">
                <label className="chk"><input type="checkbox" checked={s.require_project} onChange={(e) => set({ require_project: e.target.checked })} /> Project</label>
                <label className="chk"><input type="checkbox" checked={s.require_purpose} onChange={(e) => set({ require_purpose: e.target.checked })} /> Business purpose</label>
              </span>
            </Row>
            <Row title="Lists" hint="Used in claim dropdowns.">
              <span className="actions">
                {(Object.keys(LIST_NAMES) as (keyof typeof LIST_NAMES)[]).map((k) => (
                  <button key={k} type="button" className="btn" onClick={() => setList(k)}>{LIST_NAMES[k]} <span className="muted">{s[k].filter(Boolean).length}</span></button>
                ))}
              </span>
            </Row>
            <Row title="Duplicate check" hint="Compare new expenses with claims from this many days back.">{num("duplicate_window_days", "days")}</Row>
          </section>
          <section className="panel">
            <h2 style={{ marginBottom: "var(--space-3)" }}>Payments</h2>
            <Row title="Payroll cut-off" hint="Claims approved after this day are paid in next month's payroll.">{num("payroll_cutoff_day", "day of the month")}</Row>
            <Row title="Bank detail changes">
              <label className="chk"><input type="checkbox" checked={s.bank_change_needs_verification} onChange={(e) => set({ bank_change_needs_verification: e.target.checked })} /> Need finance verification</label>
            </Row>
            <Row title="Cash advance limit" hint="Only Managers and Admins can request cash advances.">
              <span className="row" style={{ gap: "var(--space-2)" }}><span className="hint">₹</span>
                <input type="number" min="1" className="input num" style={{ width: 120 }} aria-label="Cash advance limit" value={s.advance_max_amount}
                  onChange={(e) => set({ advance_max_amount: Number(e.target.value) })} /></span>
            </Row>
            <Row title="Advance overdue after">{num("advance_settle_days", "days")}</Row>
          </section>
          <section className="panel">
            <h2 style={{ marginBottom: "var(--space-3)" }}>Company</h2>
            <Row title="Company GSTINs" hint="Employees see the GSTIN for the state of their expense, to give to the vendor.">
              <div className="stack" style={{ gap: "var(--space-2)" }}>
                {gstRows.map(([state, gstin], i) => (
                  <div key={i} className="row" style={{ gap: "var(--space-2)", flexWrap: "nowrap" }}>
                    <input className="input" aria-label="State" placeholder="State" value={state} onChange={(e) => { setSaved(false); setGstRows(gstRows.map((r, j) => (j === i ? [e.target.value, r[1]] : r))); }} />
                    <input className="input" aria-label="GSTIN" placeholder="GSTIN" maxLength={15} value={gstin} onChange={(e) => { setSaved(false); setGstRows(gstRows.map((r, j) => (j === i ? [r[0], e.target.value.toUpperCase()] : r))); }} />
                    <IconButton icon="trash" danger label="Remove this state" onClick={() => setGstRows(gstRows.filter((_, j) => j !== i))} />
                  </div>
                ))}
                <div><button type="button" className="btn btn--sm" onClick={() => setGstRows([...gstRows, ["", ""]])}><Icon name="plus" /> Add state</button></div>
              </div>
            </Row>
            <Row title="Currency and financial year">
              <span className="row" style={{ gap: "var(--space-2)" }}>
                <select className="input" style={{ width: "auto" }} aria-label="Currency" disabled><option>INR (₹)</option></select>
                <select className="input" style={{ width: "auto" }} aria-label="Financial year starts" disabled><option>Starts April</option></select>
              </span>
            </Row>
          </section>
        </>
      )}
      <ErrorAlert error={save.error} />
      {saved && <Alert tone="success">Settings saved.</Alert>}
      <div className="actions" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={reset}>Cancel</button>
        <Button variant="primary" type="submit" busy={save.busy} busyLabel="Saving">Save changes</Button>
      </div>

      <Modal open={list !== null} onOpenChange={(o) => !o && setList(null)} title={list ? LIST_NAMES[list] : ""}>
        {list && (
          <>
            <Field label="One item per line" id="list-edit" hint="An empty list lets people type freely.">
              <textarea id="list-edit" className="input" rows={10} value={s[list].join("\n")} onChange={(e) => set({ [list]: e.target.value.split("\n") } as Partial<Settings>)} />
            </Field>
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn--primary" onClick={() => setList(null)}>Done</button>
            </div>
            <p className="hint">Press Save changes to keep the list.</p>
          </>
        )}
      </Modal>
    </form>
  );
}
