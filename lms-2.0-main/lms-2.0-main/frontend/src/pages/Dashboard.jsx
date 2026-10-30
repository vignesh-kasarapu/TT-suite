import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle, ArrowUpRight, CalendarClock, PlaneTakeoff, Calendar, ChevronRight,
  ShieldCheck, ListChecks, Stethoscope, Zap, HeartHandshake, CalendarPlus2, PartyPopper,
} from 'lucide-react';
import { getDashboard } from '../api/employees';
import { listHolidays } from '../api/holidays';
import { daysLeftToWithdraw } from '../utils/withdrawWindow';
import HolidayCard from '../components/common/HolidayCard';
import LossOfPayPanel from '../components/common/LossOfPayPanel';
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

/** "12 Nov → 16 Nov 2025", or a single date when the range is one day. Parsed as local
 * dates so the day never slips backwards against the browser's timezone. */
function formatRange(startIso, endIso) {
  const day = (iso, opts) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
  };
  const full = { day: 'numeric', month: 'short', year: 'numeric' };
  if (startIso === endIso) return day(startIso, full);
  return `${day(startIso, { day: 'numeric', month: 'short' })} → ${day(endIso, full)}`;
}

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
        // This month's holidays (past ones dimmed) plus the next upcoming ones, so a holiday
        // early next month shows now rather than only once that month starts.
        const prefix = new Date().toISOString().slice(0, 7); // YYYY-MM
        const today = new Date().toISOString().slice(0, 10);
        const thisMonth = res.data.filter((h) => h.holiday_date.startsWith(prefix));
        const later = res.data.filter((h) => h.holiday_date > today && !h.holiday_date.startsWith(prefix));
        setMonthHolidays([...thisMonth, ...later.slice(0, Math.max(1, 6 - thisMonth.length))]);
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

  const firstName = user?.employee?.full_name?.split(' ')[0] || 'Employee';
  // Only types this employee can actually apply for. The dashboard used to list every
  // balance the server returned, so a gender-restricted type (Maternity) showed a tile
  // with days "available" that the Apply picker greys out and the server refuses.
  const balances = (data?.balances || []).filter(({ leaveType }) => leaveType.is_eligible !== false);
  const primaryBalance = balances[0];
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

      {/* Approved leave beyond the balance: the LOP days and the 24-hour decision on them. */}
      <LossOfPayPanel items={data?.lossOfPay || []} onChange={() => getDashboard().then((res) => setData(res.data))} />

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
          <div>
            {data.withdrawalWindow.map((r) => {
              const left = daysLeftToWithdraw(r);
              return (
                <p key={r.request_id}>
                  Your advance leave <span className="num">{r.start_date} → {r.end_date}</span> ({r.deducted_days} day(s)) was
                  rejected. <b>{left > 0 ? `Withdraw it within ${left} day(s)` : 'Withdraw it today'}</b>, or those days become
                  loss of pay.
                </p>
              );
            })}
          </div>
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
        {balances.map(({ leaveType, effectiveBalance, daysTaken = 0 }) => {
          const Icon = LEAVE_TYPE_ICON[leaveType.type_code] || Calendar;
          // Loss of Pay is never credited, so its balance only ever runs negative, and
          // Compensatory Off is asked about as "how much have I used". Both lead with the
          // days taken this leave year instead of a balance that says nothing.
          const showsUsage = leaveType.is_balance_affecting === false || leaveType.type_code === 'COMP_OFF';
          return (
            <div key={leaveType.leave_type_id} className="tile">
              <span className="ico"><Icon /></span>
              <div>
                <b className="num">{(showsUsage ? daysTaken : effectiveBalance).toFixed(1)}</b>
                <span>{leaveType.type_name} {showsUsage ? 'taken this year' : 'available'}</span>
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
              <div className="panel-rows">
                {queue.map((r) => (
                  <div key={r.request_id} className="panel-row">
                    <div className="min-w-0">
                      <Link to="/approvals" className="when">{r.employee?.full_name}</Link>
                      <p className="what">
                        {r.LeaveType?.type_name || 'Leave'} · {formatRange(r.start_date, r.end_date)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 justify-end">
                      {r.is_escalated && (
                        <span className="pill pill--warning">
                          Escalated{r.escalated_from?.full_name ? ` from ${r.escalated_from.full_name}` : ''}
                        </span>
                      )}
                      <StatusBadge state={r.state} />
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : !data?.pending?.length ? (
            <EmptyState icon={CalendarClock} title="No pending requests" description="Leave applications awaiting review will show up here." />
          ) : (
            <div className="panel-rows">
              {data.pending.map((r) => (
                <Link key={r.request_id} to={`/my-requests/${r.request_id}`} className="panel-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="min-w-0">
                    <span className="when">{formatRange(r.start_date, r.end_date)}</span>
                    <p className="what">
                      {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days || 1}</span> working day(s)
                      {r.currentApprover && ` — with ${r.currentApprover.full_name}`}
                    </p>
                  </div>
                  <StatusBadge state={r.state} />
                </Link>
              ))}
            </div>
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
            <div className="panel-rows">
              {data.upcoming.map((r) => (
                <Link key={r.request_id} to={`/my-requests/${r.request_id}`} className="panel-row" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="min-w-0">
                    <span className="when">{formatRange(r.start_date, r.end_date)}</span>
                    <p className="what">
                      {r.LeaveType?.type_name || 'Leave'} · <span className="num">{r.deducted_days || 1}</span> day(s) approved
                      {r.is_self_approved && ' — self-approved'}
                    </p>
                  </div>
                  <StatusBadge state={r.state} />
                </Link>
              ))}
            </div>
          )}
        </GlassCard>
      </div>

      {/* This month's holidays (past ones dimmed) and the next upcoming ones after it. */}
      <GlassCard className="mb-6">
        <div className="panel-head">
          <div className="flex items-center gap-2">
            <PartyPopper className="w-4 h-4 text-accent-text" />
            <h2 className="h2">Holidays</h2>
          </div>
          <Link to="/holidays" className="small flex items-center gap-1">
            Full calendar <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {!monthHolidays.length ? (
          <EmptyState icon={PartyPopper} title="No upcoming holidays"
            description="Holidays for all regions and for your own region of working are listed here." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {monthHolidays.map((h) => {
              const isPast = h.holiday_date < todayStr;
              return (
                <HolidayCard
                  key={h.holiday_id}
                  holiday={h}
                  dimmed={isPast}
                  extraPills={(
                    <span className={`pill ${isPast ? 'pill--muted' : 'pill--success'}`}>
                      {isPast ? 'Passed' : 'Upcoming'}
                    </span>
                  )}
                />
              );
            })}
          </div>
        )}
      </GlassCard>
    </>
  );
}
