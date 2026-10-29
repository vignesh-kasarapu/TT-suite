/** Whole days left to withdraw a rejected advance-leave request (rounded up), or null. */
export const daysLeftToWithdraw = (r) => {
  if (r.state !== 'REJECTED_PENDING_WITHDRAWAL' || !r.withdrawal_window_end) return null;
  const end = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(r.withdrawal_window_end) ? r.withdrawal_window_end : `${r.withdrawal_window_end}Z`);
  return Math.max(Math.ceil((end - Date.now()) / 86_400_000), 0);
};
