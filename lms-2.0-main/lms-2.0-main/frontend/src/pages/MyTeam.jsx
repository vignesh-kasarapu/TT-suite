import { useEffect, useState } from 'react';
import { Users, Search, AlertTriangle } from 'lucide-react';
import { getMyTeam } from '../api/employees';
import GlassCard from '../components/common/GlassCard';
import EmptyState from '../components/common/EmptyState';
import ResponsiveList from '../components/common/ResponsiveList';
import BalanceCards from '../components/common/BalanceCards';
import Pager, { pageOf } from '../components/common/Pager';
import StandingWatcherControl from '../components/common/StandingWatcherControl';
import CompOffControl from '../components/common/CompOffControl';
import OptionalHolidayControl from '../components/common/OptionalHolidayControl';
import Topbar from '../components/layout/Topbar';

export default function MyTeam() {
  const [team, setTeam] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
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

  // Six people a page, like the other directories. `pageOf` keeps the page inside the list
  // as a search narrows it.
  const { visible, start, current, totalPages } = pageOf(filteredTeam, page);

  const columns = [
    {
      key: 'employee',
      label: 'Employee',
      render: ({ employee }) => (
        <div className="team-who">
          <span className="avatar" style={{ width: 44, height: 44, fontSize: 15 }}>
            {employee.full_name?.slice(0, 2).toUpperCase() || 'EMP'}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="name truncate">{employee.full_name}</p>
              {employee.status && (
                <span className={`pill ${employee.status === 'ACTIVE' ? 'pill--success' : 'pill--muted'}`}>
                  {employee.status === 'ACTIVE' ? 'Active' : employee.status.toLowerCase()}
                </span>
              )}
            </div>
            {/* What identifies the person to a human: the company code and the address they
                are written to. The database row id means nothing to anybody reading this. */}
            <div className="team-id">
              {employee.employee_code && <span className="code">{employee.employee_code}</span>}
              {employee.work_email && <span className="truncate">{employee.work_email}</span>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'designation',
      label: 'Designation',
      render: ({ employee }) => (
        <span className="pill pill--muted">{employee.designation || 'Team member'}</span>
      ),
    },
    {
      key: 'balances',
      label: 'Leave balances',
      render: ({ balances, totals, employee }) => (
        <BalanceCards balances={balances} totals={totals} employeeName={employee.full_name} />
      ),
    },
    {
      // Three different controls live here, not just the watcher one the label named.
      key: 'actions',
      label: 'Quick actions',
      render: ({ employee }) => (
        <div className="icon-actions">
          <StandingWatcherControl compact employeeId={employee.employee_id} employeeName={employee.full_name} />
          <CompOffControl compact employeeId={employee.employee_id} employeeName={employee.full_name} />
          <OptionalHolidayControl compact employeeId={employee.employee_id} employeeName={employee.full_name} />
        </div>
      ),
    },
  ];

  const renderCard = ({ employee, balances, totals }) => (
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
      {balances.length > 0 && (
        <BalanceCards balances={balances} totals={totals} employeeName={employee.full_name} />
      )}
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
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
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
          // `.team-list` only adds the directory's own table manners: a tinted header, a row
          // hover, and room for the balances column (styles/theme-components.css).
          <>
            <div className="team-list">
              <ResponsiveList
                columns={columns}
                rows={visible}
                rowKey={({ employee }) => employee.employee_id}
                renderCard={renderCard}
              />
            </div>
            <Pager
              page={current}
              totalPages={totalPages}
              start={start}
              total={filteredTeam.length}
              onPage={setPage}
              label="team members"
            />
          </>
        )}
      </div>
    </>
  );
}
