import { useEffect, useState } from 'react';
import { UserCog, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  listAllDelegations, listDelegationManagers, getEligibleDelegatesForManager,
  createDelegationOnBehalf,
} from '../../api/delegations';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import ResponsiveList from '../common/ResponsiveList';
import { PrimaryButton } from '../common/GlassButton';

// The API returns the two people flat as `nominator_name`/`delegate_name`, not as the nested
// `nominator`/`delegate` objects Sequelize used to eager-load.
const COLUMNS = [
  { key: 'nominator', label: 'Manager', render: (d) => d.nominator_name },
  { key: 'delegate', label: 'Delegate', render: (d) => d.delegate_name },
  { key: 'from', label: 'From', nowrap: true, render: (d) => d.from_date },
  { key: 'to', label: 'To', nowrap: true, render: (d) => d.to_date },
  { key: 'status', label: 'Status', render: (d) => (d.revoked_at ? <span className="pill pill--muted">Revoked</span> : <span className="pill pill--success">Active</span>) },
];

export default function DelegationAdmin() {
  const [delegations, setDelegations] = useState([]);
  const [managers, setManagers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [nominatorId, setNominatorId] = useState('');
  const [delegateId, setDelegateId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => listAllDelegations().then((res) => setDelegations(res.data));

  useEffect(() => {
    Promise.all([load(), listDelegationManagers().then((res) => setManagers(res.data))])
      .finally(() => setLoading(false));
  }, []);

  const selectManager = (id) => {
    setNominatorId(id);
    setDelegateId('');
    setCandidates([]);
    setError(null);
    setSuccess(null);
    if (id) getEligibleDelegatesForManager(id).then((res) => setCandidates(res.data)).catch((err) => setError(err.message));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (!nominatorId || !delegateId || !fromDate || !toDate) {
      setError('Select the manager, delegate, start date, and end date.');
      return;
    }
    if (toDate < fromDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setSaving(true);
    try {
      await createDelegationOnBehalf({ nominatorId, delegateId, fromDate, toDate });
      setSuccess('Delegation created successfully.');
      setNominatorId('');
      setDelegateId('');
      setCandidates([]);
      setFromDate('');
      setToDate('');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GlassCard>
      <h3 className="h3 mb-1 flex items-center gap-2">
        <UserCog className="w-4 h-4 text-accent-text" /> Delegations
      </h3>
      <p className="small muted mb-4">HR/Admin can set a delegate for any manager. Only same-level peer managers are offered.</p>

      <div className="mb-6 rounded-md bg-tint-2 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-accent-text" />
          <h4 className="text-sm font-medium">Set delegation for a manager</h4>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="field">
            <label>Manager being covered</label>
            <select className="input" value={nominatorId} onChange={(e) => selectManager(e.target.value)} required>
              <option value="">Select manager</option>
              {managers.map((manager) => (
                <option key={manager.employee_id} value={manager.employee_id}>{manager.full_name} ({manager.employee_code})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Appoint delegate</label>
            <select className="input" value={delegateId} onChange={(e) => setDelegateId(e.target.value)} disabled={!nominatorId} required>
              <option value="">{nominatorId ? (candidates.length ? 'Select same-level manager' : 'No eligible peer managers') : 'Select manager first'}</option>
              {candidates.map((candidate) => (
                <option key={candidate.employee_id} value={candidate.employee_id}>{candidate.full_name} ({candidate.employee_code})</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>From date</label>
            <input type="date" className="input" value={fromDate} onChange={(e) => setFromDate(e.target.value)} required />
          </div>
          <div className="field">
            <label>To date</label>
            <input type="date" className="input" value={toDate} onChange={(e) => setToDate(e.target.value)} required />
          </div>
          {error && <p className="md:col-span-2 error-msg flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> {error}</p>}
          {success && <p className="md:col-span-2 small text-success">{success}</p>}
          <div className="md:col-span-2 flex justify-end">
            <PrimaryButton type="submit" disabled={saving || !candidates.length}>{saving ? 'Saving…' : 'Create delegation'}</PrimaryButton>
          </div>
        </form>
      </div>

      <h4 className="text-sm font-medium mb-3">All delegations</h4>
      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48 }} />)}</div>
      ) : !delegations.length ? (
        <EmptyState icon={UserCog} title="No delegations exist yet" />
      ) : (
        <ResponsiveList
          columns={COLUMNS}
          rows={delegations}
          rowKey={(d) => d.delegation_id}
          renderCard={(d) => (
            <>
              <header>
                <span className="name">{d.nominator_name} → {d.delegate_name}</span>
                {d.revoked_at ? <span className="pill pill--muted">Revoked</span> : <span className="pill pill--success">Active</span>}
              </header>
              <div className="meta">
                <span>{d.from_date} to {d.to_date}</span>
              </div>
            </>
          )}
        />
      )}
    </GlassCard>
  );
}
