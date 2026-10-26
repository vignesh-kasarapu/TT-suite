import { useState } from "react";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, lookupsApi, type UserForm } from "../../../models/api";
import { ROLE_NAMES } from "../../../models/format";
import type { AdminUser, Role } from "../../../models/types";
import { ResponsiveList } from "../../components/ResponsiveList";
import { Icon } from "../../components/Icon";
import { Alert, Button, Empty, ErrorAlert, Field, Modal, Pager, Pill, Skeleton, Toolbar, useConfirm, IconButton, Spinner } from "../../components/ui";

const BLANK: UserForm = { email: "", full_name: "", employee_code: "", department: "", location: "", manager_id: null, phone: "", designation: "", roles: [], is_active: true };
const CSV_HELP = "email,full_name,employee_code,department,location,manager_email,roles,phone,designation";
const SIGN_IN_NOTE = "People sign in with their Microsoft work account through the TT Suite, so there are no passwords. Adding someone here also gives them Expense on their TT Suite dashboard.";
const ROLES: Role[] = ["APPROVER", "FINANCE", "ADMIN"];

export function UsersPage() {
  const users = useResource(adminApi.users);
  const lists = useResource(lookupsApi.lists);
  const importer = useAction();
  const [imported, setImported] = useState<string | null>(null);
  const runImport = async (file: File) => {
    const r = await importer.run(() => adminApi.importUsers(file));
    if (r) {
      setImported(`Imported: ${r.created} added, ${r.updated} updated.${r.errors.length ? ` ${r.errors.length} rows skipped: ${r.errors.join(" ")}` : ""}`);
      users.reload();
    }
  };
  const save = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ id?: number; form: UserForm } | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const settings = useResource(adminApi.settings);
  const roleText = (u: AdminUser) => [
    ...(u.roles.includes("ADMIN") ? ["Admin"] : []), ...(u.roles.includes("FINANCE") ? ["Finance reviewer"] : []),
    ...(u.roles.includes("APPROVER") ? [settings.data?.level2_approver_id === u.id ? "Second approver" : "Manager"] : []),
  ].join(", ") || "Employee";
  const byId = new Map((users.data ?? []).map((u) => [u.id, u]));
  const rows = (users.data ?? []).filter((u) => `${u.full_name} ${u.email} ${u.employee_code} ${u.department}`.toLowerCase().includes(q.toLowerCase()));

  const open = (u?: AdminUser) => { save.setError(null); setEditing(u ? { id: u.id, form: { ...u } } : { form: { ...BLANK } }); };
  const set = (patch: Partial<UserForm>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  const store = async () => {
    if (!editing) return false;
    if (await save.run(() => adminApi.saveUser(editing.form, editing.id))) { setEditing(null); users.reload(); return true; }
    return false;
  };
  // Deactivating someone moves their pending approvals, so ask first
  const submit = () => {
    const leaving = editing?.id && byId.get(editing.id)?.is_active && !editing.form.is_active;
    if (!leaving) return store();
    confirm.ask({
      title: `Deactivate ${editing!.form.full_name}?`, confirm: "Deactivate", danger: true, busyLabel: "Saving", run: store,
      body: "They lose access to Expense in the TT Suite. Claims waiting for their approval move to their manager, and their delegations end.",
    });
  };
  const f = editing?.form;

  return (
    <>
      <Toolbar sub={`${users.data?.length ?? 0} users`}
        action={<>
          <label className="btn btn--secondary">{importer.busy ? <><Spinner /> Importing</> : <><Icon name="upload" /> Import CSV</>}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { if (e.target.files?.[0]) runImport(e.target.files[0]); e.target.value = ""; }} />
          </label>
          <button className="btn btn--primary" onClick={() => open()}><Icon name="plus" /> Add user</button>
        </>} />
      {confirm.node}
      <p className="small muted">{SIGN_IN_NOTE}</p>
      <details className="small muted"><summary style={{ cursor: "pointer" }}>CSV format for Import</summary>
        Columns: {CSV_HELP}. Roles are separated by ";": APPROVER (Manager), FINANCE or ADMIN. The manager_email must belong to a Manager. Existing users are matched by email.</details>
      {imported && <Alert tone={imported.includes("skipped") ? "warning" : "success"} action={<button className="btn btn--ghost btn--sm" onClick={() => setImported(null)}>Dismiss</button>}>{imported}</Alert>}
      <ErrorAlert error={importer.error} />
      <input className="input" placeholder="Search name, email, code or department" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorAlert error={users.error} onRetry={users.reload} />
      {users.loading && !users.data ? <Skeleton /> : (
        <ResponsiveList<AdminUser>
          rows={rows.slice(page * 10, page * 10 + 10)} rowKey={(u) => u.id} onRowClick={open}
          footer={<Pager page={page} size={10} total={rows.length} onPage={setPage} />}
          columns={[
            { header: "Name", cell: (u) => <><span className="name">{u.full_name}</span><div className="sub">{u.email}</div></> },
            { header: "Department", cell: (u) => u.department || "—" },
            { header: "Role", cell: (u) => roleText(u) },
            { header: "Reports to", cell: (u) => (u.manager_id ? byId.get(u.manager_id)?.full_name : "—") },
            { header: "Status", cell: (u) => <Pill tone={u.is_active ? "muted" : "strong"}>{u.is_active ? "Active" : "Deactivated"}</Pill> },
            { header: <span className="sr-only">Actions</span>, align: "right", cell: (u) => <IconButton icon="edit" label={`Edit ${u.full_name}`} onClick={(e) => { e.stopPropagation(); open(u); }} /> },
          ]}
          card={(u) => ({ title: u.full_name, status: !u.is_active ? <Pill tone="muted">Inactive</Pill> : undefined, detail: `${u.employee_code} · ${u.department}`, meta: u.roles.map((r) => ROLE_NAMES[r]) })}
          empty={q ? <Empty title="Nothing matches your search">Try another name or code.</Empty> : <Empty icon="users" title="No users yet">Add the first user.</Empty>}
        />
      )}
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit user" : "Add user"}>
        {f && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid2">
              <Field label="Full name" id="u-name"><input id="u-name" className="input" value={f.full_name} onChange={(e) => set({ full_name: e.target.value })} required /></Field>
              <Field label="Email" id="u-email"><input id="u-email" type="email" className="input" value={f.email} onChange={(e) => set({ email: e.target.value })} required /></Field>
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
                  <option value="">None</option>{(users.data ?? []).filter((u) => u.id !== editing?.id && u.is_active && u.roles.includes("APPROVER")).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                </select>
              </Field>
            </div>
            <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: "var(--space-2)" }}>
              <legend className="label">Roles</legend>
              <div className="row">
                {ROLES.map((r) => (
                  <label key={r} className="chk"><input type="checkbox" checked={f.roles.includes(r)}
                    onChange={(e) => set({ roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} /> {ROLE_NAMES[r]}</label>
                ))}
              </div>
              <p className="hint">Managers approve their team and, like Admins, can self-approve and request cash advances. A Manager cannot also be a Finance Reviewer or an Admin. Admins never approve.</p>
            </fieldset>
            <label className="chk"><input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Active (untick for a leaver: their pending approvals move to their manager)</label>
            <p className="hint">{SIGN_IN_NOTE}</p>
            <ErrorAlert error={save.error} />
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              <button type="button" className="btn btn--secondary" onClick={() => setEditing(null)}>Cancel</button>
              <Button variant="primary" type="submit" busy={save.busy} busyLabel="Saving">Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
