import { useEffect, useState } from 'react';
import { Building2, Lock, PlaneTakeoff, ListChecks } from 'lucide-react';
import { getOrganizationBalances } from '../../api/admin';
import GlassCard from '../common/GlassCard';
import EmptyState from '../common/EmptyState';

/** The admin's picture of the whole organisation: entitlement, usage, what is held back and
 *  what is left — per leave type or shared entitlement, per department and per person.
 *
 *  Every number comes from the same calculation an employee's own dashboard reads, so an
 *  admin and an employee can never be looking at different figures. A shared pool is counted
 *  once, never once per member type. */
export default function OrganizationBalanceAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('targets');

  useEffect(() => {
    getOrganizationBalances().then((res) => setData(res.data)).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error-msg">{error}</p>;
  if (!data) return <div className="skel" style={{ minHeight: 160, borderRadius: 'var(--radius-md)' }} />;

  const departmentName = (id) => (id === null || id === undefined ? 'Unassigned' : `Department ${id}`);

  return (
    <div className="space-y-5">
      <div className="tiles">
        <div className="tile">
          <span className="ico"><Building2 /></span>
          <div><b className="num">{data.employee_count}</b><span>Active employees · {data.leave_year.year_code}</span></div>
        </div>
        <div className="tile">
          <span className="ico"><ListChecks /></span>
          <div><b className="num">{data.totals.entitlement.toFixed(1)}</b><span>Days granted in all</span></div>
        </div>
        <div className="tile">
          <span className="ico"><PlaneTakeoff /></span>
          <div><b className="num">{data.totals.used.toFixed(1)}</b><span>Days used</span></div>
        </div>
        <div className="tile">
          <span className="ico"><Lock /></span>
          <div>
            <b className="num">{data.totals.restricted.toFixed(1)}</b>
            <span>
              Held back · {data.restrictions.active} active
              {data.restrictions.awaiting_release > 0 && `, ${data.restrictions.awaiting_release} expired`}
            </span>
          </div>
        </div>
        <div className="tile">
          <span className="ico"><PlaneTakeoff /></span>
          <div><b className="num">{data.totals.available.toFixed(1)}</b><span>Days available</span></div>
        </div>
      </div>

      <GlassCard>
        <div className="flex items-center justify-between gap-2 mb-4 pb-3 border-b border-border">
          <h3 className="h3">Balances</h3>
          <div className="tabs" role="tablist">
            {[['targets', 'By leave type'], ['departments', 'By department'], ['employees', 'By employee']].map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={tab === key}
                className={`tab ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === 'targets' && (
          <div className="divide-y divide-border">
            {data.by_target.map((row) => (
              <div key={row.target_key} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{row.target_name}</p>
                    {row.target_kind === 'POOL' && (
                      <span className="pill pill--accent">shared by {row.leave_types.map((t) => t.type_name).join(', ')}</span>
                    )}
                  </div>
                  <p className="small muted mt-1">
                    {row.configured_entitlement} day(s) each · {row.used.toFixed(1)} used · {row.restricted.toFixed(1)} held back
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="num">{row.available.toFixed(1)}</p>
                  <p className="small muted">of {row.entitlement.toFixed(1)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'departments' && (
          <div className="divide-y divide-border">
            {data.by_department.map((row) => (
              <div key={String(row.department_id)} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{departmentName(row.department_id)}</p>
                  <p className="small muted">{row.employees} employee(s) · {row.used.toFixed(1)} used</p>
                </div>
                <div className="text-right">
                  <p className="num">{row.available.toFixed(1)}</p>
                  <p className="small muted">of {row.entitlement.toFixed(1)}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'employees' && (
          !data.employees.length ? (
            <EmptyState icon={Building2} title="Nobody yet" description="No active employees in this leave year." />
          ) : (
            <div className="divide-y divide-border">
              {data.employees.map((row) => (
                <div key={row.employee_id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{row.employee_name}</p>
                    <p className="small muted">
                      {row.employee_code} · {row.used.toFixed(1)} used
                      {row.restricted > 0 && ` · ${row.restricted.toFixed(1)} held back`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="num">{row.available.toFixed(1)}</p>
                    <p className="small muted">of {row.entitlement.toFixed(1)}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </GlassCard>
    </div>
  );
}
