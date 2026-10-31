import { Fragment, useState } from "react";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, lookupsApi, type CategoryForm } from "../../../models/api";
import { money } from "../../../models/format";
import type { Category } from "../../../models/types";
import { Icon } from "../../components/Icon";
import { Button, Empty, ErrorAlert, Field, Modal, Pill, Skeleton, Toolbar, useConfirm, IconButton } from "../../components/ui";

const BLANK: CategoryForm = {
  name: "", kind: "EXPENSE", group_name: "", description: null, gl_code: "", gst_credit_eligible: false, taxable: false, receipt_required: true, receipt_threshold: null,
  extra_field_label: null, is_active: true,
};

export function CategoriesPage() {
  const cats = useResource(["admin", "categories"], adminApi.categories);
  const save = useAction();
  const remove = useAction();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ id?: number; form: CategoryForm } | null>(null);

  const open = (c?: Category, group = "") => { save.setError(null); setEditing(c ? { id: c.id, form: { ...c } } : { form: { ...BLANK, group_name: group } }); };
  const policy = useResource(["lookups", "policy"], lookupsApi.policy);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const groups = [...(cats.data ?? []).reduce((m, c) => m.set(c.group_name || "Other", [...(m.get(c.group_name || "Other") ?? []), c]), new Map<string, Category[]>())]
    .sort(([a], [b]) => a.localeCompare(b));
  const set = (patch: Partial<CategoryForm>) => editing && setEditing({ ...editing, form: { ...editing.form, ...patch } });
  const submit = async () => {
    if (editing && (await save.run(() => adminApi.saveCategory(editing.form, editing.id)))) { setEditing(null); cats.reload(); policy.reload(); }
  };
  const del = async () => {
    if (editing?.id && (await remove.run(() => adminApi.deleteCategory(editing.id!))) !== undefined) { setEditing(null); cats.reload(); policy.reload(); }
  };
  const f = editing?.form;

  return (
    <>
      <Toolbar sub="Employees pick a category; the group is a heading in the picker. Limits are set on the Policy limits tab, second approval on the Approvals tab. Level 1 is always the employee's reporting manager."
        action={<>
          {confirm.node}
          <button className="btn" onClick={() => setNewGroup("")}><Icon name="plus" /> Add group</button>
          <button className="btn btn--primary" onClick={() => open()}><Icon name="plus" /> Add category</button>
        </>} />
      <ErrorAlert error={cats.error} onRetry={cats.reload} />
      {cats.loading && !cats.data ? <Skeleton /> : !cats.data?.length ? (
        <div className="list-wrap"><Empty icon="list" title="No categories yet">Employees can only pick categories you add here.</Empty></div>
      ) : (
        <div className="list-wrap rl-scroll">
          <table className="plain stack-sm">
            <thead><tr><th>Category</th><th>Limit</th><th>Receipt</th><th>Over limit</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {groups.map(([g, list]) => (
                <Fragment key={g}>
                  <tr className="group"><td colSpan={5}>{g}</td></tr>
                  {list.map((c) => {
                    const p = policy.data?.categories.find((x) => x.id === c.id);
                    return (
                      <tr key={c.id}>
                        <td className="cell-title">{c.name}{c.description && <span className="sub"> · {c.description}</span>} {c.kind === "ADVANCE" && <Pill tone="muted">Advance</Pill>} {!c.is_active && <Pill tone="muted">Inactive</Pill>}<div className="sub">GL {c.gl_code || "—"}</div></td>
                        <td data-label="Limit"><div>{p?.limits.map((l) => <div key={l.text + l.applies_to}>{l.text}{l.applies_to !== "Everyone" && <span className="sub"> · {l.applies_to}</span>}</div>) ?? "—"}{p && !p.limits.length && "No limit"}</div></td>
                        <td className="muted" data-label="Receipt">{!c.receipt_required ? "Not needed" : c.receipt_threshold !== null ? `Above ${money(c.receipt_threshold)}` : "Always"}</td>
                        <td className="muted" data-label="Over limit">{[...new Set(p?.limits.map((l) => l.over_limit) ?? [])].join(", ") || "—"}</td>
                        <td className="r cell-act"><IconButton icon="edit" label={`Edit ${c.name}`} onClick={() => open(c)} /></td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={newGroup !== null} onOpenChange={(o) => !o && setNewGroup(null)} title="Add group">
        <Field label="Group name" id="g-new" hint="For example: Travel, Food, Work tools."><input id="g-new" className="input" value={newGroup ?? ""} onChange={(e) => setNewGroup(e.target.value)} autoFocus /></Field>
        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => setNewGroup(null)}>Cancel</button>
          <button className="btn btn--primary" disabled={!newGroup?.trim()} onClick={() => { const g = newGroup!.trim(); setNewGroup(null); open(undefined, g); }}><Icon name="plus" /> Add its first category</button>
        </div>
      </Modal>
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? `Edit ${f?.name}` : "Add category"}>
        {f && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid2">
              <Field label="Name" id="c-name"><input id="c-name" className="input" value={f.name} onChange={(e) => set({ name: e.target.value })} required /></Field>
              <Field label="Group" id="c-group" hint="Heading in the category picker, e.g. Travel, Food.">
                <input id="c-group" className="input" list="c-groups" value={f.group_name} onChange={(e) => set({ group_name: e.target.value })} />
                <datalist id="c-groups">{[...new Set((cats.data ?? []).map((c) => c.group_name).filter(Boolean))].map((g) => <option key={g} value={g} />)}</datalist>
              </Field>
              <Field label="Short description (optional)" id="c-desc" hint="Shown beside the name in the picker, e.g. Cab, auto, metro.">
                <input id="c-desc" className="input" maxLength={200} value={f.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} />
              </Field>
              <Field label="GL account code" id="c-gl"><input id="c-gl" className="input" value={f.gl_code} onChange={(e) => set({ gl_code: e.target.value })} /></Field>
              <Field label="Used for" id="c-kind">
                <select id="c-kind" className="input" value={f.kind} onChange={(e) => set({ kind: e.target.value as CategoryForm["kind"] })}>
                  <option value="EXPENSE">Expense claims</option><option value="ADVANCE">Cash advances</option>
                </select>
              </Field>
              <Field label="Extra field label (optional)" id="c-extra" hint="For example: Attendees">
                <input id="c-extra" className="input" value={f.extra_field_label ?? ""} onChange={(e) => set({ extra_field_label: e.target.value || null })} />
              </Field>
            </div>
            <div className="row">
              <label className="chk"><input type="checkbox" checked={f.receipt_required} onChange={(e) => set({ receipt_required: e.target.checked })} /> Receipt required</label>
              {f.receipt_required && (
                <label className="chk">only above ₹
                  <input type="number" min="0" className="input num" style={{ width: 110 }} aria-label="Receipt needed above amount"
                    value={f.receipt_threshold ?? ""} onChange={(e) => set({ receipt_threshold: e.target.value === "" ? null : Number(e.target.value) })} />
                </label>
              )}
              <label className="chk"><input type="checkbox" checked={f.gst_credit_eligible} onChange={(e) => set({ gst_credit_eligible: e.target.checked })} /> GST credit eligible</label>
              <label className="chk"><input type="checkbox" checked={f.taxable} onChange={(e) => set({ taxable: e.target.checked })} /> Taxable in payroll</label>
              <label className="chk"><input type="checkbox" checked={f.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Active</label>
            </div>
            <ErrorAlert error={save.error ?? remove.error} />
            <div className="actions" style={{ justifyContent: "flex-end" }}>
              {editing?.id && <button type="button" className="btn btn--ghost" onClick={() => confirm.ask({
                title: `Delete ${f.name}?`, confirm: "Delete", danger: true, busyLabel: "Deleting", run: del,
                body: "This cannot be undone. A category already used on claims cannot be deleted; untick Active instead.",
              })}><Icon name="trash" /> Delete</button>}
              <button type="button" className="btn btn--secondary" onClick={() => setEditing(null)}>Cancel</button>
              <Button variant="primary" type="submit" busy={save.busy} busyLabel="Saving">Save</Button>
            </div>
            <p className="hint">Changes apply to claims submitted from now on. Claims already in progress keep their routing.</p>
          </form>
        )}
      </Modal>
    </>
  );
}
