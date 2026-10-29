// Claim form controller: line editing, receipt upload, live policy check, submit (all or nothing - no drafts).
import { useEffect, useMemo, useRef, useState } from "react";
import { claimsApi, lookupsApi } from "../models/api";
import { ApiError } from "../models/http";
import { todayIso } from "../models/format";
import type { Category, ClaimDetail, Flag, LineInput, Lists } from "../models/types";
import { useAction } from "./useAsync";

export const emptyLine = (category_id = 0): LineInput => ({
  id: null, category_id, expense_date: todayIso(), merchant: "", description: "", amount: 0, cost_centre: "", state: "",
  invoice_no: "", supplier_gstin: "", buyer_gstin: "", cgst: 0, sgst: 0, igst: 0, extra_field_value: "",
  justification: "", receipt_path: null, receipt_name: null,
});

/** Same rules as the backend (claim_service.MAX_RECEIPT_BYTES and ALLOWED_RECEIPTS). */
export const MAX_RECEIPT_MB = 3;
export const RECEIPT_TYPES = [".jpg", ".jpeg", ".png", ".webp", ".heic", ".pdf"];
export const RECEIPT_RULE = `JPG, PNG, WEBP, HEIC or PDF · up to ${MAX_RECEIPT_MB} MB`;

const toInput = (c: ClaimDetail): LineInput[] =>
  c.lines.map((l) => ({
    id: l.id, category_id: l.category_id, expense_date: l.expense_date, merchant: l.merchant, description: l.description,
    amount: l.amount, cost_centre: l.cost_centre, state: l.state, invoice_no: l.invoice_no, supplier_gstin: l.supplier_gstin,
    buyer_gstin: l.buyer_gstin, cgst: l.cgst, sgst: l.sgst, igst: l.igst, extra_field_value: l.extra_field_value,
    justification: l.justification, receipt_path: l.receipt_path, receipt_name: l.receipt_name,
  }));


export function useClaimForm(claimId?: number) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [purpose, setPurpose] = useState("");
  const [lists, setLists] = useState<Lists | null>(null);
  const [lines, setLines] = useState<LineInput[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [gstins, setGstins] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Flag[][]>([]);
  const [checking, setChecking] = useState(false);  // live policy check in flight
  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  // The "Add an expense" box: a line being added (editing = null) or edited (editing = its index)
  const [editor, setEditor] = useState<LineInput>(emptyLine(0));
  const [editing, setEditing] = useState<number | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const action = useAction();
  const loaded = useRef(false);
  const initial = useRef("");  // the form as loaded, to spot unsaved changes

  useEffect(() => {
    Promise.all([lookupsApi.categories(), lookupsApi.companyGstins(), lookupsApi.lists(), claimId ? claimsApi.get(claimId) : Promise.resolve(null)])
      .then(([cats, g, l, c]) => {
        setCategories(cats);
        setGstins(g);
        setLists(l);
        if (c) {
          setClaim(c);
          setTitle(c.title);
          setProject(c.project);
          setPurpose(c.purpose);
          setLines(toInput(c));
        }
        initial.current = JSON.stringify(c ? { title: c.title, project: c.project, purpose: c.purpose, lines: toInput(c) } : { title: "", project: "", purpose: "", lines: [] });
        setEditor(emptyLine(0));
        loaded.current = true;
      })
      .catch((e) => setLoadError(e));
  }, [claimId]);

  // FR-5.10: policy check while filling, debounced.
  useEffect(() => {
    if (!loaded.current) return;
    const ready = lines.filter((l) => l.category_id && l.amount > 0);
    if (ready.length !== lines.length) { setChecking(false); return; }
    setChecking(true);
    let stale = false;
    const t = setTimeout(() => {
      claimsApi.policyCheck(lines, claimId).then((r) => !stale && setFlags(r)).catch(() => !stale && setFlags([])).finally(() => !stale && setChecking(false));
    }, 500);
    return () => { stale = true; clearTimeout(t); };
  }, [lines, claimId]);

  const update = (i: number, patch: Partial<LineInput>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const add = () => setLines((ls) => [...ls, emptyLine(categories[0]?.id)]);
  const remove = (i: number) => setLines((ls) => ls.filter((_, j) => j !== i));

  const upload = async (i: number, file: File) => {
    setUploading(i);
    const res = await action.run(() => claimsApi.uploadReceipt(file));
    setUploading(null);
    if (res) update(i, res);
  };

  const patchEditor = (patch: Partial<LineInput>) => setEditor((e) => ({ ...e, ...patch }));
  const uploadEditor = async (file: File) => {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!RECEIPT_TYPES.includes(ext)) return setEditorError(`That file type can't be used. Allowed: ${RECEIPT_RULE}.`);
    if (file.size > MAX_RECEIPT_MB * 1024 * 1024) return setEditorError(`The receipt is larger than ${MAX_RECEIPT_MB} MB. Allowed: ${RECEIPT_RULE}.`);
    setEditorError(null);
    setUploading(-1);
    const res = await action.run(() => claimsApi.uploadReceipt(file));
    setUploading(null);
    if (res) patchEditor(res);
  };
  const startEdit = (i: number) => { setEditing(i); setEditor({ ...lines[i] }); setEditorError(null); };
  const cancelEdit = () => { setEditing(null); setEditor(emptyLine(0)); setEditorError(null); };
  const commitEditor = () => {
    if (!editor.category_id) return setEditorError("Choose a category and a sub-category.");
    if (!editor.expense_date) return setEditorError("Enter the date.");
    if (!(editor.amount > 0)) return setEditorError("Enter the amount.");
    setEditorError(null);
    if (editing === null) setLines((ls) => [...ls, editor]);
    else setLines((ls) => ls.map((l, j) => (j === editing ? editor : l)));
    setEditing(null);
    setEditor(emptyLine(0));
  };

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0), [lines]);
  const categoryOf = (id: number) => categories.find((c) => c.id === id);

  // Categories grouped by their heading, for the <optgroup> picker
  const groups = useMemo(() => {
    const m = new Map<string, Category[]>();
    categories.forEach((c) => m.set(c.group_name || "Other", [...(m.get(c.group_name || "Other") ?? []), c]));
    // Travel, Food, Work tools first (as in the policy), any new groups next, Other last
    const rank = (g: string) => { const i = ["Travel", "Food", "Work tools"].indexOf(g); return g === "Other" ? 99 : i < 0 ? 50 : i; };
    return [...m.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
  }, [categories]);

  const body = () => ({ title, project, purpose, lines });
  // One request saves and submits; if it fails nothing is saved and the form keeps what was typed.
  const submit = () => action.run(() => (claim ? claimsApi.resubmit(claim.id, body()) : claimsApi.submitNew(body())));
  const dirty = loaded.current && (JSON.stringify(body()) !== initial.current || editor.category_id !== 0 || editor.amount > 0);

  return {
    title, setTitle, project, setProject, purpose, setPurpose, lists, groups,
    lines, update, add, remove, upload, uploading, categories, categoryOf, gstins, flags, checking, total,
    editor, patchEditor, uploadEditor, editing, startEdit, cancelEdit, commitEditor, editorError,
    claim, loadError, submit, dirty, busy: action.busy, error: action.error,
  };
}
