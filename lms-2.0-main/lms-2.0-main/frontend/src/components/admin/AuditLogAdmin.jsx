import { useEffect, useState } from 'react';
import { History, AlertTriangle } from 'lucide-react';
import { getAuditLog } from '../../api/reports';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';
import ResponsiveList from '../common/ResponsiveList';

/** The entity a row refers to, as a phrase rather than `employees #1`. */
const ENTITY_LABELS = {
  employees: 'Employee',
  leave_requests: 'Leave request',
  leave_ledger: 'Ledger entry',
  holidays: 'Holiday',
  delegations: 'Delegation',
  projects: 'Project',
  project_assignments: 'Project assignment',
  self_approval_permissions: 'Self-approval grant',
  working_patterns: 'Working pattern',
  notification_templates: 'Notification template',
};

const entityLabel = (r) => `${ENTITY_LABELS[r.entity_type] || r.entity_type} #${r.entity_id}`;

/** Values are stored as JSON strings. Rendered as `key: value` pairs, because a raw
 * `{"role_code": "MANAGER"}` in a table cell is not something an HR user should have to
 * parse — and a malformed row must not take the whole log down. */
function formatValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  if (parsed === null || typeof parsed !== 'object') return String(parsed);
  const pairs = Object.entries(parsed).map(
    ([k, v]) => `${k.replaceAll('_', ' ')}: ${v === null ? '—' : typeof v === 'object' ? JSON.stringify(v) : v}`,
  );
  return pairs.join(' · ') || null;
}

function ChangeCell({ row }) {
  const before = formatValue(row.prior_value);
  const after = formatValue(row.new_value);
  if (!before && !after) return <span className="muted">—</span>;
  return (
    <div className="min-w-0 small">
      {before && <p className="muted" style={{ textDecoration: 'line-through' }}>{before}</p>}
      {after && <p>{after}</p>}
    </div>
  );
}

const actorOf = (r) => (r.is_system_actor ? 'System' : r.actor_name || (r.actor_id ? `#${r.actor_id}` : 'Unknown'));

const COLUMNS = [
  {
    key: 'actor',
    label: 'Who',
    render: (r) => (
      <span className={r.is_system_actor ? 'pill pill--muted' : 'name'}>{actorOf(r)}</span>
    ),
  },
  { key: 'action', label: 'Action', render: (r) => r.action.replaceAll('_', ' ').toLowerCase() },
  { key: 'entity', label: 'On', nowrap: true, render: entityLabel },
  { key: 'change', label: 'Change', render: (r) => <ChangeCell row={r} /> },
  { key: 'timestamp', label: 'When', nowrap: true, numeric: true, render: (r) => new Date(r.timestamp).toLocaleString() },
];

export default function AuditLogAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionFilter, setActionFilter] = useState('');

  useEffect(() => {
    getAuditLog({}).then((res) => setRows(res.data)).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, []);

  const actions = [...new Set(rows.map((r) => r.action))].sort();
  const visible = actionFilter ? rows.filter((r) => r.action === actionFilter) : rows;

  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <h3 className="h3 flex items-center gap-2">
          <History className="w-4 h-4 text-accent-text" /> Audit log
        </h3>
        {actions.length > 0 && (
          <select className="input w-auto" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="">All actions ({rows.length})</option>
            {actions.map((a) => (
              <option key={a} value={a}>{a.replaceAll('_', ' ').toLowerCase()}</option>
            ))}
          </select>
        )}
      </div>
      <p className="small muted mb-4">
        Append-only. Every mutating action writes one row here and nothing ever edits or deletes them.
      </p>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 48 }} />)}</div>
      ) : error ? (
        <EmptyState icon={AlertTriangle} title="Couldn't load the audit log" description={error} />
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          <ResponsiveList
            columns={COLUMNS}
            rows={visible}
            rowKey={(r) => r.audit_id}
            empty={<EmptyState icon={History} title="No audit events match this filter" />}
            renderCard={(r) => (
              <>
                <header>
                  <span className="name">{actorOf(r)}</span>
                  <span className="muted small">{new Date(r.timestamp).toLocaleString()}</span>
                </header>
                <div className="meta">
                  <span>{r.action.replaceAll('_', ' ').toLowerCase()}</span>
                  <span>{entityLabel(r)}</span>
                </div>
                <ChangeCell row={r} />
              </>
            )}
          />
        </div>
      )}
    </GlassCard>
  );
}
