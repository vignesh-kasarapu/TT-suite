import { useEffect, useState } from 'react';
import { UserCog, Info, Mail, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getEligibleDelegates, getMyDelegations, createDelegation, revokeDelegation } from '../api/delegations';
import DelegationAdmin from '../components/admin/DelegationAdmin';
import { getMyDigestPreference, setMyDigestPreference } from '../api/employees';
import GlassCard from '../components/common/GlassCard';
import { GhostButton, PrimaryButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';
import EmptyState from '../components/common/EmptyState';

export default function Delegation() {
  const { hasRole } = useAuth();
  const isHrAdmin = hasRole('HR_ADMIN');
  // Roles are independent grants (see auth.middleware.js) — an HR_ADMIN isn't automatically
  // also a MANAGER, and vice versa. Someone holding both must still reach their own
  // self-service nominate/revoke/digest panel, not just the org-wide admin view.
  const isManager = hasRole('MANAGER');
  const [eligible, setEligible] = useState({ candidates: [], fallbackUsed: false });
  const [mine, setMine] = useState([]);
  const [form, setForm] = useState({ delegateId: '', fromDate: '', toDate: '' });
  const [saving, setSaving] = useState(false);
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestSaving, setDigestSaving] = useState(false);

  const load = () => {
    getEligibleDelegates().then((res) => setEligible(res.data));
    getMyDelegations().then((res) => setMine(res.data));
    getMyDigestPreference().then((res) => setDigestEnabled(res.data.digestEnabled));
  };

  useEffect(() => {
    if (isManager) load();
  }, [isManager]);

  const toggleDigest = async () => {
    setDigestSaving(true);
    try {
      await setMyDigestPreference(!digestEnabled);
      setDigestEnabled(!digestEnabled);
    } finally {
      setDigestSaving(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createDelegation(form);
      setForm({ delegateId: '', fromDate: '', toDate: '' });
      load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Topbar title="Delegation Management" />

      {isManager && (
      <>
      {/* Daily Digest Feature Panel */}
      <GlassCard className="mb-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="avatar shrink-0" style={{ width: 44, height: 44 }}>
              <Mail className="w-5 h-5" />
            </span>
            <div>
              <p className="h3 flex flex-wrap items-center gap-2">
                Daily Digest Email Summary
                <span className="pill pill--accent">Notification control</span>
              </p>
              <p className="small muted mt-0.5">
                Receive one combined daily summary email of pending approvals instead of individual alerts.
              </p>
            </div>
          </div>

          {/* Right Side ON/OFF Toggle Switch & Status Pill */}
          <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
            <span className={`pill ${digestEnabled ? 'pill--success' : 'pill--muted'}`}>
              {digestEnabled ? 'On' : 'Off'}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={digestEnabled}
              aria-label="Daily digest email"
              onClick={toggleDigest}
              disabled={digestSaving}
              className="switch"
              title={digestEnabled ? 'Turn off daily digest' : 'Turn on daily digest'}
            />
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Nominate Delegate Form */}
        <GlassCard className="lg:col-span-2">
          <div className="panel-head">
            <h3 className="h3 flex items-center gap-2">
              <UserCog className="w-4 h-4 muted" />
              Nominate a Delegate
            </h3>
          </div>

          {eligible.fallbackUsed && eligible.candidates.length > 0 && (
            <div className="alert alert--info mb-4" role="status">
              <Info />
              <p>No peer manager found — your supervisor is offered as the fallback delegate.</p>
            </div>
          )}

          {!eligible.candidates.length && (
            <div className="alert alert--warning mb-4" role="status">
              <Info />
              <p>You have no peer managers under your supervisor, and no supervisor is on record — there&rsquo;s no one eligible to delegate to yet.</p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <fieldset disabled={!eligible.candidates.length} className="space-y-4 disabled:opacity-40">
              <div className="field">
                <label htmlFor="delegateId">Select delegate officer</label>
                <select
                  id="delegateId"
                  className="input"
                  value={form.delegateId}
                  onChange={(e) => setForm((f) => ({ ...f, delegateId: e.target.value }))}
                  required
                >
                  <option value="">Choose an eligible delegate…</option>
                  {eligible.candidates.map((c) => (
                    <option key={c.employee_id} value={c.employee_id}>
                      {c.full_name} ({c.designation || 'Manager'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid2">
                <div className="field">
                  <label htmlFor="fromDate">From date</label>
                  <input
                    id="fromDate"
                    type="date"
                    className="input"
                    value={form.fromDate}
                    onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="toDate">To date</label>
                  <input
                    id="toDate"
                    type="date"
                    className="input"
                    value={form.toDate}
                    onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <PrimaryButton type="submit" disabled={saving || !eligible.candidates.length} className="w-full">
                {saving ? 'Creating delegation…' : 'Confirm delegation assignment'}
              </PrimaryButton>
            </fieldset>
          </form>
        </GlassCard>

        {/* Current Delegations List */}
        <GlassCard className="lg:col-span-3">
          <div className="panel-head">
            <h3 className="h3">Active &amp; Scheduled Delegations</h3>
            <span className="pill pill--accent">{mine.length} total</span>
          </div>

          {!mine.length ? (
            <EmptyState icon={UserCog} title="No active delegations" description="Delegated approval permissions will be listed here." />
          ) : (
            <ul className="list">
              {mine.map((d) => (
                <li key={d.delegation_id}>
                  <span className="avatar shrink-0">
                    <UserCheck className="w-5 h-5" />
                  </span>
                  <div>
                    <p className="font-medium">
                      {d.nominator_name} <span className="muted">→</span> {d.delegate_name}
                    </p>
                    <p className="small muted mt-0.5">
                      Active: <span className="num">{d.from_date}</span> to <span className="num">{d.to_date}</span>
                      {d.revoked_at && <span className="pill pill--danger ml-2">Revoked</span>}
                    </p>
                  </div>
                  {!d.revoked_at && (
                    <GhostButton
                      onClick={() => revokeDelegation(d.delegation_id).then(load)}
                      className="btn--sm"
                    >
                      Revoke access
                    </GhostButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>
      </>
      )}

      {isHrAdmin && (
        <div className={isManager ? 'mt-6' : ''}>
          <DelegationAdmin />
        </div>
      )}
    </>
  );
}

