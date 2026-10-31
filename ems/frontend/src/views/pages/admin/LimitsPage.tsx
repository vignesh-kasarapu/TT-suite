import { useState } from "react";
import { useAction, useResource } from "../../../controllers/useAsync";
import { adminApi, lookupsApi } from "../../../models/api";
import { date, money, todayIso } from "../../../models/format";
import type { Limit } from "../../../models/types";
import { ResponsiveList } from "../../components/ResponsiveList";
import { Icon } from "../../components/Icon";
import { Button, Empty, ErrorAlert, Field, Modal, Pill, Skeleton, Toolbar, IconButton } from "../../components/ui";

const SCOPES = { EMPLOYEE: "Employee", DEPARTMENT: "Department", COMPANY: "Whole company" } as const;
const PER = { LINE: "Expense", DAY: "Day", MONTH: "Month", YEAR: "Financial year" } as const;
const ACTIONS = { BLOCK: ["Block", "bad"], FLAG: ["Flag (needs reason)", "warn"], WARN: ["Warn only", "accent"] } as const;

export function LimitsPage() {
  const limits = useResource(["admin", "limits"], adminApi.limits);
  const cats = useResource(["admin", "categories"], adminApi.categories);
  const users = useResource(["lookups", "users"], lookupsApi.users);
  const save = useAction();
  const [editing, setEditing] = useState<Limit | null>(null);
  const catName = (id: number) => cats.data?.find((c) => c.id === id)?.name ?? "—";
  const scopeText = (l: Limit) =>
    l.scope === "COMPANY" ? "Whole company" : l.scope === "EMPLOYEE" ? users.data?.find((u) => String(u.id) === l.scope_value)?.full_name ?? l.scope_value : `${SCOPES[l.scope]} ${l.scope_value}`;

  const open = (l?: Limit) => {
    save.setError(null);
    setEditing(l ? { ...l } : { category_id: cats.data?.find((c) => c.kind === "EXPENSE")?.id ?? 0, scope: "COMPANY", scope_value: null, period: "LINE", amount: 0, action: "FLAG", effective_from: todayIso(), effective_to: null, is_active: true });
  };
  const set = (patch: Partial<Limit>) => editing && setEditing({ ...editing, ...patch });
  const submit = async () => { if (editing && (await save.run(() => adminApi.saveLimit(editing, editing.id)))) { setEditing(null); limits.reload(); } };
  const pill = (l: Limit) => <Pill tone={ACTIONS[l.action][1]}>{ACTIONS[l.action][0]}</Pill>;

  return (
    <>
      <Toolbar sub="When several limits match, the most specific wins: employee, then department, then company."
        action={<button className="btn btn--primary" onClick={() => open()}><Icon name="plus" /> Add limit</button>} />
      <ErrorAlert error={limits.error} onRetry={limits.reload} />
      {limits.loading && !limits.data ? <Skeleton /> : (
        <ResponsiveList<Limit>
          rows={limits.data ?? []} rowKey={(l) => l.id!} onRowClick={open}
          columns={[
            { header: "Category", cell: (l) => <><span className="name">{catName(l.category_id)}</span> {!l.is_active && <Pill tone="muted">Off</Pill>}</> },
            { header: "Applies to", cell: scopeText },
            { header: "Per", cell: (l) => PER[l.period] },
            { header: "Limit", align: "right", cell: (l) => money(l.amount) },
            { header: "Action", cell: pill },
            { header: "Active", cell: (l) => `${date(l.effective_from)} – ${l.effective_to ? date(l.effective_to) : "open"}` },
            { header: <span className="sr-only">Actions</span>, align: "right", cell: (l) => <IconButton icon="edit" label={`Edit ${catName(l.category_id)} limit`} onClick={(e) => { e.stopPropagation(); open(l); }} /> },
          ]}
          card={(l) => ({ title: catName(l.category_id), status: pill(l), detail: `${money(l.amount)} per ${PER[l.period].toLowerCase()} · ${scopeText(l)}`, meta: [`${date(l.effective_from)} – ${l.effective_to ? date(l.effective_to) : "open"}`, ...(l.is_active ? [] : ["Off"])],
            actions: <button className="btn btn--sm" onClick={() => open(l)}><Icon name="edit" /> Edit</button> })}
          empty={<Empty icon="shield" title="No limits yet">Add a limit to flag or block claims over an amount.</Empty>}
        />
      )}
      <Modal open={!!editing} onOpenChange={(o) => !o && setEditing(null)} title={editing?.id ? "Edit limit" : "Add limit"}>
        {editing && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <div className="grid2">
              <Field label="Category" id="l-cat">
                <select id="l-cat" className="input" value={editing.category_id} onChange={(e) => set({ category_id: Number(e.target.value) })}>
                  {(cats.data ?? []).filter((c) => c.kind === "EXPENSE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Applies to" id="l-scope">
                <select id="l-scope" className="input" value={editing.scope} onChange={(e) => set({ scope: e.target.value as Limit["scope"], scope_value: null })}>
                  {Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              {editing.scope === "EMPLOYEE" && (
                <Field label="Employee" id="l-emp">
                  <select id="l-emp" className="input" value={editing.scope_value ?? ""} onChange={(e) => set({ scope_value: e.target.value })} required>
                    <option value="">Choose</option>{(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </Field>
              )}
              {editing.scope === "DEPARTMENT" && (
                <Field label="Department" id="l-dept"><input id="l-dept" className="input" value={editing.scope_value ?? ""} onChange={(e) => set({ scope_value: e.target.value })} required /></Field>
              )}
              <Field label="Per" id="l-period">
                <select id="l-period" className="input" value={editing.period} onChange={(e) => set({ period: e.target.value as Limit["period"] })}>
                  <option value="LINE">Each expense</option><option value="DAY">Day</option><option value="MONTH">Calendar month</option>
                  <option value="YEAR">Financial year (April–March)</option>
                </select>
              </Field>
              <Field label="Limit (₹)" id="l-amt"><input id="l-amt" type="number" min="1" className="input num" value={editing.amount || ""} onChange={(e) => set({ amount: Number(e.target.value) })} required /></Field>
              <Field label="When over the limit" id="l-act">
                <select id="l-act" className="input" value={editing.action} onChange={(e) => set({ action: e.target.value as Limit["action"] })}>
                  {Object.entries(ACTIONS).map(([k, [v]]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Active from" id="l-from"><input id="l-from" type="date" className="input" value={editing.effective_from} onChange={(e) => set({ effective_from: e.target.value })} required /></Field>
              <Field label="Active until (optional)" id="l-to"><input id="l-to" type="date" className="input" value={editing.effective_to ?? ""} onChange={(e) => set({ effective_to: e.target.value || null })} /></Field>
            </div>
            <label className="chk"><input type="checkbox" checked={editing.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Active</label>
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
