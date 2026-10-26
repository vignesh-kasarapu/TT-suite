const cron = require('node-cron');
const { runSlaSweep, runLopConversionSweep } = require('./escalation.job');
const { runPeriodicAccrual } = require('./accrual.job');
const { runDailyDigest } = require('./digest.job');
const { runYearEndCarryForward } = require('./carryForward.job');

/** Wraps a job function with a simple in-flight guard so a cron tick never starts a second,
 * overlapping run while the previous run of the same job is still executing (e.g. a run that
 * takes longer than the schedule interval, or hangs). This is only a concurrency guard, not the
 * correctness guard — per-period idempotency inside each job (ScheduledJobRun keyed on
 * (job_type, period_key), or a per-employee source_reference check) is what makes a rerun safe. */
function withOverlapGuard(name, fn) {
  let running = false;
  return async (...args) => {
    if (running) {
      console.warn(`Skipping ${name} run: previous invocation is still in progress`);
      return;
    }
    running = true;
    try {
      await fn(...args);
    } finally {
      running = false;
    }
  };
}

/** All scheduled-job timings are operational config, not business rules — safe to keep here. */
function start() {
  const guardedSlaSweep = withOverlapGuard('SLA sweep', runSlaSweep);
  const guardedLopSweep = withOverlapGuard('LOP sweep', runLopConversionSweep);
  const guardedDigest = withOverlapGuard('Digest run', runDailyDigest);
  const guardedAccrual = withOverlapGuard('Accrual run', runPeriodicAccrual);
  const guardedYearEndCheck = withOverlapGuard('Year-end rollover check', async () => {
    const { LeaveYear } = require('../models');
    const current = await LeaveYear.findOne({ where: { is_current: true } });
    if (current && new Date(current.end_date) < new Date()) {
      await runYearEndCarryForward(current.leave_year_id);
    }
  });

  cron.schedule('*/15 * * * *', () => guardedSlaSweep().catch((e) => console.error('SLA sweep failed', e)));
  cron.schedule('0 1 * * *', () => guardedLopSweep().catch((e) => console.error('LOP sweep failed', e)));
  cron.schedule('0 8 * * *', () => guardedDigest().catch((e) => console.error('Digest run failed', e)));
  cron.schedule('0 2 1 * *', () => {
    const periodKey = new Date().toISOString().slice(0, 7);
    guardedAccrual(periodKey).catch((e) => console.error('Accrual run failed', e));
  });
  // Daily check: has the current leave year ended? If so, roll it over.
  cron.schedule('30 2 * * *', () => guardedYearEndCheck().catch((e) => console.error('Year-end rollover check failed', e)));
}

module.exports = { start };
