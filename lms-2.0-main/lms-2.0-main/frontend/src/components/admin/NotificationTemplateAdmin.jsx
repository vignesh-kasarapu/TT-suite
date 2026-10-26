import { useEffect, useState } from 'react';
import { MessageSquareText, Save, Plus, Trash2, ShieldAlert, AlertTriangle } from 'lucide-react';
import {
  listNotificationTemplates, createNotificationTemplate, updateNotificationTemplate,
  setNotificationTemplateActive, deleteNotificationTemplate,
} from '../../api/admin';
import GlassCard from '../common/GlassCard';
import Modal from '../common/Modal';
import { PrimaryButton, SecondaryButton, GhostButton, DangerButton } from '../common/GlassButton';

const emptyNew = { templateKey: '', subjectTemplate: '', bodyTemplate: '' };

// Keep this list in sync with backend/src/services/notificationAdmin.service.js's
// PROTECTED_TEMPLATE_KEYS. Those keys are referenced directly by business logic, so the
// backend refuses to hard-delete them (disabling is still fully supported). This copy
// is display-only — it just lets the UI show a "Protected" badge and steer the delete
// confirmation toward "disable instead"; the backend remains the actual enforcement.
const PROTECTED_TEMPLATE_KEYS = new Set([
  'BALANCE_ADJUSTED', 'CARRY_FORWARD_APPLIED', 'SLA_REMINDER', 'ESCALATION_NOTICE_TO_PRIOR_APPROVER',
  'NEW_REQUEST_AWAITING_DECISION', 'LOSS_OF_PAY_APPLIED', 'COMP_OFF_CREDITED', 'DELEGATE_ASSIGNED_TO_YOU',
  'EMPLOYEE_ONBOARDING_INVITE', 'MANAGER_REASSIGNED', 'LEAVE_ENCASHMENT_POSTED', 'REQUEST_AWAITING_DECISION',
  'EXTENDED_SICK_LEAVE_ALERT', 'REQUEST_SUBMITTED_CONFIRMATION', 'LONG_LEAVE_SUPERVISOR_NOTICE',
  'REQUEST_APPROVED', 'REQUEST_REJECTED', 'CANCELLATION_REQUEST_AWAITING_DECISION', 'CANCELLATION_APPROVED',
  'CANCELLATION_REJECTED', 'SELF_APPROVAL_GRANTED', 'WATCHED_REQUEST_SUBMITTED', 'WATCHED_REQUEST_APPROVED',
  'WATCHED_REQUEST_REJECTED', 'WATCHED_REQUEST_CANCELLED',
]);

export default function NotificationTemplateAdmin() {
  const [templates, setTemplates] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [draft, setDraft] = useState({ subjectTemplate: '', bodyTemplate: '' });
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTemplate, setNewTemplate] = useState(emptyNew);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [error, setError] = useState(null);
  // Mirrors Approvals.jsx's processingId pattern — tracks which template key currently
  // has an in-flight enable/disable request so a rapid double-click can't fire it twice.
  const [togglingKey, setTogglingKey] = useState(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = () => listNotificationTemplates().then((res) => {
    setTemplates(res.data);
    if (!selectedKey && res.data.length) selectTemplate(res.data[0]);
  });
  useEffect(() => { load(); }, []);

  const selectTemplate = (t) => {
    setSelectedKey(t.template_key);
    setDraft({ subjectTemplate: t.subject_template, bodyTemplate: t.body_template });
    setError(null);
  };

  const selected = templates.find((t) => t.template_key === selectedKey);
  const selectedIsProtected = !!selected && PROTECTED_TEMPLATE_KEYS.has(selected.template_key);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateNotificationTemplate(selectedKey, draft);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (togglingKey) return; // in-flight guard — ignore a second click while one is pending
    setTogglingKey(selectedKey);
    setError(null);
    try {
      await setNotificationTemplateActive(selectedKey, !selected.is_active);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setTogglingKey(null);
    }
  };

  const remove = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteNotificationTemplate(selectedKey);
      setConfirmingDelete(false);
      setSelectedKey(null);
      await load();
    } catch (err) {
      // Surfaces the backend's own "used directly by the application... disable it
      // instead" message when it refuses to hard-delete a protected key.
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const disableInstead = async () => {
    setDeleting(true);
    setError(null);
    try {
      await setNotificationTemplateActive(selectedKey, false);
      setConfirmingDelete(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const submitNew = async (e) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const res = await createNotificationTemplate(newTemplate);
      setNewTemplate(emptyNew);
      setAdding(false);
      await load();
      selectTemplate(res.data);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <GlassCard className="lg:col-span-2">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h3 className="h3 flex items-center gap-2">
            <MessageSquareText className="w-4 h-4 text-accent-text" /> Templates
          </h3>
          <GhostButton onClick={() => setAdding(true)} className="btn--sm" title="Add a new template">
            <Plus className="w-3.5 h-3.5" /> New
          </GhostButton>
        </div>
        <div className="space-y-1 max-h-[440px] overflow-y-auto">
          {templates.map((t) => (
            <button
              key={t.template_key}
              type="button"
              onClick={() => selectTemplate(t)}
              className={`side-link ${selectedKey === t.template_key ? 'is-active' : ''}`}
            >
              <span className="truncate flex-1 small">{t.template_key}</span>
              <span className="flex items-center gap-1 shrink-0">
                {PROTECTED_TEMPLATE_KEYS.has(t.template_key) && (
                  <span title="Used directly by the application — cannot be deleted, only disabled" className="pill pill--accent">
                    <ShieldAlert className="w-3 h-3" /> Protected
                  </span>
                )}
                {!t.is_active && <span className="pill pill--muted">Disabled</span>}
              </span>
            </button>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="lg:col-span-3">
        {!selected ? (
          <p className="small muted">Select a template to edit.</p>
        ) : (
          <div className="space-y-3">
            {selectedIsProtected && (
              <div className="alert alert--info" role="status">
                <ShieldAlert />
                <p>This template is used directly by the application and can&apos;t be deleted — you can still edit or disable it.</p>
              </div>
            )}
            <div className="field">
              <label>Subject</label>
              <input className="input" value={draft.subjectTemplate} onChange={(e) => setDraft((d) => ({ ...d, subjectTemplate: e.target.value }))} />
            </div>
            <div className="field">
              <label>Body — use {'{{tokenName}}'} for substitutions</label>
              <textarea className="input min-h-[140px] resize-none font-mono" value={draft.bodyTemplate} onChange={(e) => setDraft((d) => ({ ...d, bodyTemplate: e.target.value }))} />
            </div>
            {error && (
              <div className="alert alert--danger" role="alert">
                <AlertTriangle /> <p>{error}</p>
              </div>
            )}
            <div className="actions">
              <PrimaryButton onClick={save} disabled={saving}>
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save template'}
              </PrimaryButton>
              <GhostButton onClick={toggleActive} disabled={togglingKey === selectedKey}>
                {togglingKey === selectedKey ? 'Working…' : selected.is_active ? 'Disable' : 'Enable'}
              </GhostButton>
              <DangerButton type="button" onClick={() => setConfirmingDelete(true)} className="ml-auto">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </DangerButton>
            </div>
          </div>
        )}
      </GlassCard>

      <Modal open={adding} onClose={() => setAdding(false)} title="New notification template" maxWidth="max-w-lg">
        <form onSubmit={submitNew} className="space-y-3">
          <div className="field">
            <label>Template key</label>
            <input className="input font-mono" placeholder="e.g. CUSTOM_REMINDER" value={newTemplate.templateKey}
              onChange={(e) => setNewTemplate((t) => ({ ...t, templateKey: e.target.value.toUpperCase().replace(/\s+/g, '_') }))} required />
          </div>
          <div className="field">
            <label>Subject</label>
            <input className="input" value={newTemplate.subjectTemplate}
              onChange={(e) => setNewTemplate((t) => ({ ...t, subjectTemplate: e.target.value }))} required />
          </div>
          <div className="field">
            <label>Body — use {'{{tokenName}}'} for substitutions</label>
            <textarea className="input min-h-[120px] resize-none font-mono" value={newTemplate.bodyTemplate}
              onChange={(e) => setNewTemplate((t) => ({ ...t, bodyTemplate: e.target.value }))} required />
          </div>
          {createError && <p className="error-msg">{createError}</p>}
          <PrimaryButton type="submit" disabled={creating} className="w-full">
            {creating ? 'Creating…' : 'Create template'}
          </PrimaryButton>
        </form>
      </Modal>

      <Modal open={confirmingDelete} onClose={() => setConfirmingDelete(false)} title="Delete this template?" maxWidth="max-w-md">
        <div className="space-y-4">
          {selectedIsProtected ? (
            <p className="small">
              <strong className="font-mono">{selectedKey}</strong> is used directly by the application and cannot be
              deleted — disable it instead if you don&apos;t want it sent.
            </p>
          ) : (
            <p className="small">
              Really delete <strong className="font-mono">{selectedKey}</strong>? This cannot be undone.
            </p>
          )}
          {error && <p className="error-msg">{error}</p>}
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setConfirmingDelete(false)} disabled={deleting}>Cancel</GhostButton>
            {selectedIsProtected ? (
              <SecondaryButton type="button" onClick={disableInstead} disabled={deleting}>
                {deleting ? 'Disabling…' : 'Disable instead'}
              </SecondaryButton>
            ) : (
              <DangerButton type="button" onClick={remove} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </DangerButton>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
