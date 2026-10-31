// Admin > Users. Only the TT Suite global admin (in the portal) adds people, sets their roles and access,
// and owns their name and email. Here the Expense Admin edits Expense-only details (employee code,
// reporting manager, department...) and asks the global admin for a role change.
import { useState } from "react";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, lookupsApi, type UserDetails } from "../../../models/api";
import { ROLE_NAMES } from "../../../models/format";
import type { AdminUser, SuiteRole } from "../../../models/types";
import { Icon } from "../../components/Icon";
import { ResponsiveList } from "../../components/ResponsiveList";
import { Alert, Button, Empty, ErrorAlert, Field, IconButton, Modal, Pager, Pill, Skeleton, Toolbar } from "../../components/ui";

const ACCESS_NOTE = "People are added, and their roles and access set, by the TT Suite global admin. Their name comes from their TT Suite profile. Use \"Request role change\" to ask the global admin for a different role.";
type RoleChoice = SuiteRole | "none";
const ROLE_CHOICES: { value: RoleChoice; label: string }[] = [
  { value: "member", label: "Member" }, { value: "approver", label: "Approver" }, { value: "finance", label: "Finance" },
  { value: "admin", label: "Admin" }, { value: "none", label: "No access" },
];
const requestLabel = (role: SuiteRole | null) => ROLE_CHOICES.find((c) => c.value === (role ?? "none"))!.label;

/** The person's current Expense role in suite terms (highest held). */
function currentRole(u: AdminUser): RoleChoice {
  if (!u.is_active) return "none";
  if (u.roles.includes("ADMIN")) return "admin";
  if (u.roles.includes("FINANCE")) return "finance";
  if (u.roles.includes("APPROVER")) return "approver";
  return "member";
}

const detailsOf = (u: AdminUser): UserDetails => ({
  employee_code: u.employee_code, department: u.department, location: u.location,
  manager_id: u.manager_id, phone: u.phone, designation: u.designation,
});

export function UsersPage() {
  const users = useResource(["admin", "users"], adminApi.users);
  const lists = useResource(["lookups", "lists"], lookupsApi.lists);
  const requests = useResource(["admin", "role-requests"], adminApi.roleRequests);
  const save = useAction();
  const ask = useAction();
  const [editing, setEditing] = useState<{ user: AdminUser; form: UserDetails } | null>(null);
  const [asking, setAsking] = useState<{ user: AdminUser; role: RoleChoice; note: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const settings = useResource(["admin", "settings"], adminApi.settings);
  const roleText = (u: AdminUser) => [
    ...(u.roles.includes("ADMIN") ? ["Admin"] : []), ...(u.roles.includes("FINANCE") ? ["Finance reviewer"] : []),
    ...(u.roles.includes("APPROVER") ? [settings.data?.level2_approver_id === u.id ? "Second approver" : "Manager"] : []),
  ].join(", ") || "Employee";
  const byId = new Map((users.data ?? []).map((u) => [u.id, u]));
  const pending = new Map((requests.data ?? []).map((r) => [r.email.toLowerCase(), r]));
  const rows = (users.data ?? []).filter((u) => `${u.full_name} ${u.email} ${u.employee_code} ${u.department}`.toLowerCase().includes(q.toLowerCase()));

  const open = (u: AdminUser) => { save.setError(null); setEditing({ user: u, form: detailsOf(u) }); };
  const set = (patch: Partial<UserDetails>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  const store = async () => {
    if (editing && await save.run(() => adminApi.saveUserDetails(editing.user.id, editing.form))) { setEditing(null); users.reload(); }
  };
  const openAsk = (u: AdminUser) => { ask.setError(null); setAsking({ user: u, role: currentRole(u), note: "" }); };
  const sendAsk = async () => {
    if (!asking) return;
    const role = asking.role === "none" ? null : asking.role;
    if (await ask.run(() => adminApi.requestRole(asking.user.id, role, asking.note))) {
      setSent(`${asking.user.full_name}: ${requestLabel(role)}. Sent to the global admin for approval.`);
      setAsking(null);
      requests.reload();
    }
  };
  const badge = (u: AdminUser) => {
    const r = pending.get(u.email.toLowerCase());
    return r ? <Pill tone="strong">Requested: {requestLabel(r.role)}</Pill> : null;
  };
  const f = editing?.form;

  return (
    <>
      <Toolbar sub={`${users.data?.length ?? 0} users`} />
      <p className="hint">{ACCESS_NOTE}</p>
      {sent && <Alert tone="success" action={<button className="btn btn--ghost btn--sm" onClick={() => setSent(null)}>Dismiss</button>}>{sent}</Alert>}
      <input className="input" placeholder="Search name, email, code or department" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorAlert error={users.error} onRetry={users.reload} />
      {users.loading && !users.data ? <Skeleton /> : (
        <ResponsiveList<AdminUser>
          rows={rows.slice(page * 10, page * 10 + 10)} rowKey={(u) => u.id} onRowClick={open}
          footer={<Pager page={page} size={10} total={rows.length} onPage={setPage} />}
          columns={[
            { header: "Name", cell: (u) => <><span className="name">{u.full_name}</span><div className="sub">{u.email}</div></> },
            { header: "Department", cell: (u) => u.department || "—" },
            { header: "Role", cell: (u) => <>{roleText(u)} {badge(u)}</> },
            { header: "Reports to", cell: (u) => (u.manager_id ? byId.get(u.manager_id)?.full_name : "—") },
            { header: "Status", cell: (u) => <Pill tone={u.is_active ? "muted" : "strong"}>{u.is_active ? "Active" : "Deactivated"}</Pill> },
            { header: <span className="sr-only">Actions</span>, align: "right", cell: (u) => (
              <div className="actions" style={{ justifyContent: "flex-end" }}>
                <button className="btn btn--sm" onClick={(e) => { e.stopPropagation(); openAsk(u); }}>Request role change</button>
                <IconButton icon="edit" label={`Edit ${u.full_name}`} onClick={(e) => { e.stopPropagation(); open(u); }} />
              </div>
            ) },
          ]}
          card={(u) => ({ title: u.full_name, status: badge(u) ?? (!u.is_active ? <Pill tone="muted">Inactive</Pill> : undefined),
            detail: <><div className="sub" style={{ overflowWrap: "anywhere" }}>{u.email}</div>{[u.employee_code, u.department].filter(Boolean).join(" · ")}</>,
            meta: [...u.roles.map((r) => ROLE_NAMES[r]), ...(u.manager_id ? [`Reports to ${byId.get(u.manager_id)?.full_name ?? "—"}`] : [])],
            actions: <>
              <button className="btn btn--sm" onClick={() => openAsk(u)}>Request role change</button>
              <button className="btn btn--sm" onClick={() => open(u)}><Icon name="edit" /> Edit</button>
            </> })}
          empty={q ? <Empty title="Nothing matches your search">Try another name or code.</Empty>
            : <Empty icon="users" title="No users yet">The TT Suite global admin adds people from the portal.</Empty>}
        />
      )}
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing ? `Edit ${editing.user.full_name}` : "Edit user"}>
        {editing && f && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); store(); }}>
            <p className="small muted">{editing.user.email} · {roleText(editing.user)}{editing.user.is_active ? "" : " · Deactivated"}</p>
            <div className="grid2">
              <Field label="Employee code" id="u-code"><input id="u-code" className="input" value={f.employee_code} onChange={(e) => set({ employee_code: e.target.value })} required /></Field>
              <Field label="Department" id="u-dept">
                {lists.data?.departments.length ? (
                  <select id="u-dept" className="input" value={f.department} onChange={(e) => set({ department: e.target.value })}>
                    <option value="">None</option>
                    {[...new Set([...lists.data.departments, f.department].filter(Boolean))].map((d) => <option key={d}>{d}</option>)}
                  </select>
                ) : <input id="u-dept" className="input" value={f.department} onChange={(e) => set({ department: e.target.value })} />}
              </Field>
              <Field label="Designation" id="u-desig"><input id="u-desig" className="input" value={f.designation} onChange={(e) => set({ designation: e.target.value })} /></Field>
              <Field label="Phone" id="u-phone"><input id="u-phone" type="tel" className="input" value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></Field>
              <Field label="Location" id="u-loc"><input id="u-loc" className="input" value={f.location} onChange={(e) => set({ location: e.target.value })} /></Field>
              <Field label="Reporting manager" id="u-mgr" hint="Approves this person's claims at Level 1. Only Managers are listed.">
                <select id="u-mgr" className="input" value={f.manager_id ?? ""} onChange={(e) => set({ manager_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">None</option>{(users.data ?? []).filter((u) => u.id !== editing.user.id && u.is_active && u.roles.includes("APPROVER")).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </Field>
            </div>
            <p className="hint">{ACCESS_NOTE}</p>
            <ErrorAlert error={save.error} />
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn--secondary" onClick={() => setEditing(null)}>Cancel</button>
              <Button variant="primary" type="submit" busy={save.busy} busyLabel="Saving">Save</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal open={!!asking} onOpenChange={(o) => !o && setAsking(null)} title={asking ? `Request role change for ${asking.user.full_name}` : "Request role change"}>
        {asking && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); sendAsk(); }}>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: "var(--space-2)" }}>
              <legend className="label">New Expense role</legend>
              <div className="row">
                {ROLE_CHOICES.map((c) => (
                  <label key={c.value} className="chk"><input type="radio" name="rr-role" value={c.value} checked={asking.role === c.value}
                    onChange={() => setAsking({ ...asking, role: c.value })} /> {c.label}</label>
                ))}
              </div>
              <p className="hint">Approvers are Managers. A Manager cannot also be a Finance Reviewer or an Admin; the global admin sees if a change is refused for that.</p>
            </fieldset>
            <Field label="Note (optional)" id="rr-note">
              <textarea id="rr-note" className="input" maxLength={1000} value={asking.note} onChange={(e) => setAsking({ ...asking, note: e.target.value })} />
            </Field>
            <ErrorAlert error={ask.error} />
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn--secondary" onClick={() => setAsking(null)}>Cancel</button>
              <Button variant="primary" type="submit" busy={ask.busy} busyLabel="Sending">Send request</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
