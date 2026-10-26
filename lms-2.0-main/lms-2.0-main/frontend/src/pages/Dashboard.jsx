import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowUpRight, CalendarClock, PlaneTakeoff, Calendar, ChevronRight,
  ShieldCheck, ListChecks, Stethoscope, Zap, HeartHandshake, CalendarPlus2, PartyPopper,
} from 'lucide-react';
import { getDashboard } from '../api/employees';
import { listHolidays } from '../api/holidays';
import { getApprovalsQueue } from '../api/leaveRequests';
import GlassCard from '../components/common/GlassCard';
import StatusBadge from '../components/common/StatusBadge';
import { PrimaryButton } from '../components/common/GlassButton';
import Topbar from '../components/layout/Topbar';
import EmptyState from '../components/common/EmptyState';
import { useAuth } from '../context/AuthContext';

const LEAVE_TYPE_ICON = {
  ANNUAL: PlaneTakeoff,
  SICK: Stethoscope,
  CASUAL: Zap,
  MATERNITY: HeartHandshake,
  BEREAVEMENT: HeartHandshake,
  COMP_OFF: CalendarPlus2,
};

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [queue, setQueue] = useState([]);
  const [monthHolidays, setMonthHolidays] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { user, hasRole } = useAuth();
  const isApprover = hasRole('MANAGER', 'HR_ADMIN');

  useEffect(() => {
    getDashboard().then((res) => setData(res.data)).catch((err) => setError(err.message)).finally(() => setLoading(false));
    // The holiday calendar is its own endpoint, not part of the dashboard payload. A failure
    // here just hides the panel — it must never take the rest of the dashboard down with it.
    listHolidays()
      .then((res) => {
        const prefix = new Date().toISOString().slice(0, 7); // YYYY-MM
        setMonthHolidays(res.data.filter((h) => h.holiday_date.startsWith(prefix)));
      })
      .catch(() => {});
  }, []);

  // Only approvers have a queue, and the endpoint 403s for anyone else — a failure here
  // just leaves the panel empty rather than breaking the dashboard.
  useEffect(() => {
    if (!isApprover) return;
    getApprovalsQueue().then((res) => setQueue(res.data)).catch(() => {});
  }, [isApprover]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstName = user?.employee?.full_name?.split(' ')[0] || 'Employee';
  const primaryBalance = data?.balances?.[0];
  const pendingCount = data?.pending?.length || 0;

  return (
    <>
      <Topbar title="Dashboard" />

      {/* Greeting + primary CTA */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6"
      >
        <div>
          <h1 className="greet">Good day, {firstName}!</h1>
          <p>Track your leave balances, view upcoming scheduled time off, and manage your leave requests smoothly.</p>
        </div>
        <Link to="/apply" className="shrink-0">
          <PrimaryButton>
            <PlaneTakeoff className="w-4 h-4" /> Apply for leave
          </PrimaryButton>
        </Link>
      </motion.div>

      {error && (
        <div className="alert alert--danger mb-6" role="alert">
          <AlertTriangle />
          <p>Couldn&apos;t load your dashboard: {error}</p>
        </div>
      )}

      {/* `withdrawalWindow` is an array, and an empty array is truthy in JS — without the
          length check this banner showed on every dashboard, for everyone, always. */}
      {data?.withdrawalWindow?.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="alert alert--warning mb-6"
          role="status"
        >
          <AlertTriangle />
          <p>An advance-leave request was rejected. You can still withdraw it before loss of pay applies.</p>
          <div className="actions">
            <Link to="/my-requests" className="btn btn--sm btn--secondary">Review request</Link>
          </div>
        </motion.div>
      )}

      {/* Quick-action cards — tinted 1/2/3 in order, whole card is one link (theme.md §3) */}
      <div className="cards mb-6">
        <Link to="/apply" className="card card--1">
          <span className="ico"><PlaneTakeoff /></span>
          <h3>Apply for leave</h3>
          <p>
            {primaryBalance ? `${primaryBalance.effectiveBalance.toFixed(1)} days of ${primaryBalance.leaveType.type_name} available.` : 'Submit a new leave request.'}
          </p>
          <span className="arrow"><ChevronRight /></span>
        </Link>

        {isApprover ? (
          <Link to="/approvals" className="card card--2">
            <span className="ico"><ShieldCheck /></span>
            <h3>Needs your decision</h3>
            <p>Review leave requests waiting from your team.</p>
            <span className="arrow"><ChevronRight /></span>
          </Link>
        ) : (
          <Link to="/my-requests" className="card card--2">
            <span className="ico"><ListChecks /></span>
            <h3>My requests</h3>
            <p>{pendingCount} request(s) awaiting a decision.</p>
            <span className="arrow"><ChevronRight /></span>
          </Link>
        )}

        <Link to="/team-calendar" className="card card--3">
          <span className="ico"><Calendar /></span>
          <h3>Team calendar</h3>
          <p>See who else is on leave across your team.</p>
          <span className="arrow"><ChevronRight /></span>
        </Link>
      </div>

      {/* Stat tiles — plain surface, icon chip + tabular number + label per leave type */}
      <div className="tiles mb-6">
        {loading && [1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ minHeight: 68, borderRadius: 'var(--radius-md)' }} />)}
        {data?.balances?.map(({ leaveType, effectiveBalance }) => {
          const Icon = LEAVE_TYPE_ICON[leaveType.type_code] || Calendar;
          return (
            <div key={leaveType.leave_type_id} className="tile">
              <span className="ico"><Icon /></span>
              <div>
                <b className="num">{effectiveBalance.toFixed(1)}</b>
                <span>{leaveType.type_name} available</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row2 mb-6">
        {/* For an approver this panel lists what is waiting on THEM; for everyone else it
            lists their own requests awaiting someone else. An approver's own requests are
            rarely pending anyway — and never are for an HR admin at the top of the tree,
            who self-approves — so showing them there left the panel permanently empty
            while their queue was full. */}
        <GlassCard>
          <div className="panel-head">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-accent-text" />
              <h2 className="h2">{isApprover ? 'Awaiting your decision' : 'Pending decisions'}</h2>
            </div>
            <Link to={isApprover ? '/approvals' : '/my-requests'} className="small flex items-center gap-1">
              View all <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {isApprover ? (
            !queue.length ? (
              <EmptyState icon={CalendarClock} title="Approvals queue clear" description="Requests from your team needing a decision will show up here." />
            ) : (
              <ul className="list">
                {queue.map((r) => (
                  <li key={r.request_id}>
                    <span className="date num">{r.start_date} → {r.end_date}</span>
                    <span>
                      <Link to="/approvals" className="name">{r.employee?.full_name}</Link>
                      {' · '}{r.LeaveType?.type_name || 'Leave'}
                      {r.is_escalated && (
                        <span className="pill pill--warning" style={{ marginLeft: 6 }}>
                          (Escalated{r.escalated_from?.full_name ? ` from ${r.escalated_from.full_name}` : ''})
                        </span>
                      )}
                    </span>
                    <StatusBadge state={r.state} />
                  </li>
                ))}
              </ul>
            )
          ) : !data?.pending?.length ? (
            <EmptyState icon={CalendarClock} title="No pending requests" description="Leave applications awaiting review will show up here." />
          ) : (
            <ul className="list">
              {data.pending.map((r) => (
                <li key={r.request_id}>
                  <span className="date num">{r.start_date} → {r.end_date}</span>
                  <span>
                    {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days || 1}</span> working day(s)
                    {r.currentApprover && <span className="muted small"> — with {r.currentApprover.full_name}</span>}
                  </span>
                  <StatusBadge state={r.state} />
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* Upcoming Approved Leaves */}
        <GlassCard>
          <div className="panel-head">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent-text" />
              <h2 className="h2">Upcoming leaves</h2>
            </div>
            <Link to="/team-calendar" className="small flex items-center gap-1">
              Team calendar <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {!data?.upcoming?.length ? (
            <EmptyState icon={PlaneTakeoff} title="No upcoming leaves scheduled" description="Approved leave dates starting soon will be listed here." />
          ) : (
            <ul className="list">
              {data.upcoming.map((r) => (
                <li key={r.request_id}>
                  <span className="date num">{r.start_date} → {r.end_date}</span>
                  <span>
                    {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days || 1}</span> day(s) approved
                    {r.is_self_approved && <span className="muted small"> — self-approved</span>}
                  </span>
                  <StatusBadge state={r.state} />
                </li>
              ))}
            </ul>
          )}
        </GlassCard>
      </div>

      {/* Holidays falling in the current calendar month — upcoming ones first, past ones dimmed
          so the panel still reads as a month view late in the month instead of going empty. */}
      <GlassCard className="mb-6">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <PartyPopper className="w-4 h-4 text-accent-text" />
            <h2 className="h2">Holidays in {thisMonthName}</h2>
          </div>
          <Link to="/holidays" className="small flex items-center gap-1">
            Full calendar <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {!monthHolidays.length ? (
          <EmptyState icon={PartyPopper} title="No holidays this month" description="Published holidays falling in this month will be listed here." />
        ) : (
          <ul className="list">
            {monthHolidays.map((h) => {
              const isPast = h.holiday_date < todayStr;
              return (
                <li key={h.holiday_id} style={{ opacity: isPast ? 0.55 : 1 }}>
                  <span className="date num">{h.holiday_date}</span>
                  <span>
                    {h.holiday_name}{' '}
                    <span className={`pill ${h.is_optional ? 'pill--holiday' : 'pill--muted'}`}>
                      {h.is_optional ? 'Optional' : 'Public holiday'}
                    </span>
                  </span>
                  <span className={`pill ${isPast ? 'pill--muted' : 'pill--success'}`}>
                    {isPast ? 'Passed' : 'Upcoming'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </GlassCard>
    </>
  );
}
