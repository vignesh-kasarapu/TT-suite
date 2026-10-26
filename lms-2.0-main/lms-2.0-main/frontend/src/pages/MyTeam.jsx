import { useEffect, useState } from 'react';
import { Users, Search, AlertTriangle } from 'lucide-react';
import { getMyTeam } from '../api/employees';
import GlassCard from '../components/common/GlassCard';
import EmptyState from '../components/common/EmptyState';
import ResponsiveList from '../components/common/ResponsiveList';
import StandingWatcherControl from '../components/common/StandingWatcherControl';
import CompOffControl from '../components/common/CompOffControl';
import OptionalHolidayControl from '../components/common/OptionalHolidayControl';
import Topbar from '../components/layout/Topbar';

/** A row of balance chips — the number is the thing being scanned, so it leads at a larger
 * size with the leave type as a quiet caption beneath, rather than both as one run of text.
 * Only a negative balance is coloured; tinting all six would make none of them stand out. */
function BalanceChips({ balances }) {
  return (
    <div className="flex flex-wrap gap-2">
      {balances.map((b) => {
        const isNegative = b.effectiveBalance < 0;
        return (
          <div
            key={b.leaveType}
            className="px-2.5 py-1.5 text-center"
            style={{
              borderRadius: 'var(--radius-sm)',
              background: isNegative ? 'var(--color-danger-bg, var(--color-tint-2))' : 'var(--color-tint-2)',
              border: `1px solid ${isNegative ? 'var(--color-danger)' : 'transparent'}`,
              minWidth: 62,
            }}
            title={`${b.leaveType}: ${b.effectiveBalance.toFixed(1)} day(s) available`}
          >
            <p
              className={`num ${isNegative ? 'text-danger-text' : ''}`}
              style={{ fontSize: 15, lineHeight: 1.2, fontWeight: 'var(--font-weight-medium)' }}
            >
              {b.effectiveBalance.toFixed(1)}
            </p>
            <p className="muted" style={{ fontSize: 11, lineHeight: 1.3 }}>{b.leaveType}</p>
          </div>
        );
      })}
    </div>
  );
}

export default function MyTeam() {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    getMyTeam()
      .then((res) => setTeam(res.data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredTeam = team.filter(({ employee }) => {
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return (
      employee.full_name?.toLowerCase().includes(query) ||
      employee.designation?.toLowerCase().includes(query)
    );
  });

  const columns = [
    {
      key: 'employee',
      label: 'Employee',
      render: ({ employee }) => (
        <div className="flex items-center gap-3">
          <span className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>
            {employee.full_name?.slice(0, 2).toUpperCase() || 'EMP'}
          </span>
          <div>
            <p className="name">{employee.full_name}</p>
            <p className="muted small" style={{ fontFamily: 'monospace' }}>ID #{employee.employee_id}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'designation',
      label: 'Designation',
      nowrap: true,
      render: ({ employee }) => employee.designation || 'Team member',
    },
    {
      key: 'balances',
      label: 'Balances',
      render: ({ balances }) => <BalanceChips balances={balances} />,
    },
    {
      // Three different controls live here, not just the watcher one the label named.
      key: 'actions',
      label: 'Actions',
      render: ({ employee }) => (
        <div className="flex flex-col gap-1.5">
          <StandingWatcherControl employeeId={employee.employee_id} employeeName={employee.full_name} />
          <CompOffControl employeeId={employee.employee_id} employeeName={employee.full_name} />
          <OptionalHolidayControl employeeId={employee.employee_id} employeeName={employee.full_name} />
        </div>
      ),
    },
  ];

  const renderCard = ({ employee, balances }) => (
    <>
      <header>
        <div className="flex items-center gap-3">
          <span className="avatar" style={{ width: 40, height: 40, fontSize: 13 }}>
            {employee.full_name?.slice(0, 2).toUpperCase() || 'EMP'}
          </span>
          <div>
            <p className="name">{employee.full_name}</p>
            <p className="muted small">{employee.designation || 'Team member'}</p>
          </div>
        </div>
      </header>
      {balances.length > 0 && <BalanceChips balances={balances} />}
      <div className="flex flex-col gap-1.5">
        <StandingWatcherControl employeeId={employee.employee_id} employeeName={employee.full_name} />
        <CompOffControl employeeId={employee.employee_id} employeeName={employee.full_name} />
        <OptionalHolidayControl employeeId={employee.employee_id} employeeName={employee.full_name} />
      </div>
    </>
  );

  return (
    <>
      <Topbar title="My Team" />

      <GlassCard className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="ico" style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-tint-2)', display: 'grid', placeItems: 'center', color: 'var(--color-accent-text)' }}>
            <Users />
          </span>
          <div>
            <h2 className="h2 flex items-center gap-2 flex-wrap">
              My team directory
              <span className="pill pill--accent">{team.length} member{team.length === 1 ? '' : 's'}</span>
            </h2>
            <p className="muted small">Employees reporting to you, their leave balances, and standing watcher assignments.</p>
          </div>
        </div>

        <div className="field w-full md:w-72">
          <div className="relative">
            <Search className="w-4 h-4 muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>
      </GlassCard>

      <div className="mt-4">
        {loading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skel" style={{ height: 56, borderRadius: 'var(--radius-md)' }} />)}
          </div>
        ) : error ? (
          <GlassCard>
            <EmptyState icon={AlertTriangle} title="Couldn't load your team" description={error} />
          </GlassCard>
        ) : !filteredTeam.length ? (
          <GlassCard>
            <EmptyState
              icon={Users}
              title={search ? 'No team members match your search' : 'No team members assigned'}
              description={search ? 'Try clearing your search query to see all team members.' : 'Employees reporting to you, at any depth, will appear here.'}
            />
          </GlassCard>
        ) : (
          <ResponsiveList
            columns={columns}
            rows={filteredTeam}
            rowKey={({ employee }) => employee.employee_id}
            renderCard={renderCard}
          />
        )}
      </div>
    </>
  );
}
