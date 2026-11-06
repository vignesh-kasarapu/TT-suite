import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, X, Inbox, Clock, ChevronRight, ArrowLeft, ExternalLink, CheckCircle2 } from 'lucide-react';
import { listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from '../../api/notifications';
import { categoryOf, groupByCategory } from '../../utils/notificationCategories';
import { destinationOf } from '../../utils/notificationDestinations';
import SuiteIcon from './SuiteIcon';
import { timeAgo, formatServerDateTime } from '../../utils/serverTime';

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const [category, setCategory] = useState('ALL');
  const [selectedNotification, setSelectedNotification] = useState(null);
  const navigate = useNavigate();

  const load = () => {
    listNotifications()
      .then((res) => setNotifications(res.data))
      .catch(() => {});
    getUnreadCount()
      .then((res) => setUnreadCount(res.data.count))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const toggleOpen = (e) => {
    e.stopPropagation();
    if (!open) {
      setSelectedNotification(null);
      load();
    }
    setOpen((o) => !o);
  };

  const inspectNotification = async (n, e) => {
    if (e) e.stopPropagation();
    if (!n.read_at) {
      try {
        await markNotificationRead(n.notification_id);
      } catch {
        // Non-critical — still open the notification even if marking it read failed.
      }
    }
    setSelectedNotification(n);
    load();
  };

  // A notification about somebody else's request belongs in the approvals queue, not in
  // My Requests — sending an approver to /my-requests/{id} showed them a request they
  // never raised, on a page that is meant to list their own. `destinationOf` holds that
  // rule; this only closes the centre and goes there.
  const handleNavigateToRequest = (n, e) => {
    if (e) e.stopPropagation();
    const destination = destinationOf(n);
    if (!destination) return;
    // Opening the thing a notification points at counts as reading it, so the badge drops
    // even when the inbox row's shortcut is used and the detail view is skipped.
    if (!n.read_at) markNotificationRead(n.notification_id).then(load).catch(() => {});
    setOpen(false);
    setSelectedNotification(null);
    navigate(destination.path);
  };

  const markAll = async (e) => {
    e.stopPropagation();
    try {
      await markAllNotificationsRead();
    } catch {
      // Non-critical — the periodic poll will pick the real state back up regardless.
    }
    load();
  };

  const unreadFiltered = filterUnreadOnly
    ? notifications.filter((n) => !n.read_at)
    : notifications;
  // Categories are derived from whatever the unread filter left, so the chip counts always
  // match what is actually on screen rather than the whole inbox.
  const groups = groupByCategory(unreadFiltered);
  const displayedGroups = category === 'ALL' ? groups : groups.filter((g) => g.key === category);
  const displayedNotifications = displayedGroups.flatMap((g) => g.items);

  return (
    <>
      <button onClick={toggleOpen} type="button" className="top-action" title="Notifications"
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'} data-testid="bell">
        <SuiteIcon name="mail" size={20} />
        {unreadCount > 0 && <span className="bell-count" aria-hidden="true">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-2 sm:p-8">
            <div className="fixed inset-0 bg-black/50" onClick={() => { setOpen(false); setSelectedNotification(null); }} />

            <div
              className="relative w-full max-w-4xl h-[calc(100dvh-1rem)] sm:h-[85vh] flex flex-col overflow-hidden z-10"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 px-4 py-4 sm:px-6 sm:py-5 border-b border-border shrink-0 relative">
                <div className="flex items-center gap-3 min-w-0 pr-12 sm:pr-0">
                  {selectedNotification ? (
                    <button type="button" onClick={() => setSelectedNotification(null)} className="btn btn--secondary btn--sm">
                      <ArrowLeft className="w-4 h-4" /> Back to inbox
                    </button>
                  ) : (
                    <span className="ico" style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-tint-2)', display: 'grid', placeItems: 'center', color: 'var(--color-accent-text)' }}>
                      <SuiteIcon name="mail" size={24} />
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h2 className="h2">{selectedNotification ? 'Notification details' : 'Notification centre'}</h2>
                      {!selectedNotification && unreadCount > 0 && <span className="pill pill--accent">{unreadCount} unread</span>}
                    </div>
                    <p className="muted small mt-0.5">
                      {selectedNotification ? 'Review this notification.' : 'Leave approvals and system alerts.'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                  {!selectedNotification && (
                    <>
                      <div className="seg">
                        <button type="button" aria-pressed={!filterUnreadOnly} onClick={() => setFilterUnreadOnly(false)}>All ({notifications.length})</button>
                        <button type="button" aria-pressed={filterUnreadOnly} onClick={() => setFilterUnreadOnly(true)}>Unread ({unreadCount})</button>
                      </div>
                      {unreadCount > 0 && (
                        <button type="button" onClick={markAll} className="btn btn--secondary btn--sm">
                          <CheckCheck className="w-4 h-4" /> Mark all read
                        </button>
                      )}
                    </>
                  )}
                  <button type="button" onClick={() => { setOpen(false); setSelectedNotification(null); }} className="btn btn--ghost btn--sm !px-2 absolute top-3 right-3 sm:static" title="Close" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {!selectedNotification && groups.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap px-4 sm:px-6 py-3 border-b border-border shrink-0 max-h-[30vh] overflow-y-auto sm:max-h-none sm:overflow-visible">
                  <button
                    type="button"
                    onClick={() => setCategory('ALL')}
                    className={`pill ${category === 'ALL' ? 'pill--accent' : 'pill--muted'}`}
                    style={{ cursor: 'pointer' }}
                  >
                    All ({unreadFiltered.length})
                  </button>
                  {groups.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      onClick={() => setCategory(g.key)}
                      title={g.hint}
                      className={`pill ${category === g.key ? 'pill--accent' : 'pill--muted'}`}
                      style={{ cursor: 'pointer' }}
                    >
                      {/* "(14, 14 new)" is noise when nothing has been read yet — the
                          suffix only earns its place when the two numbers differ. */}
                      {g.label} ({g.items.length}
                      {g.unread && g.unread !== g.items.length ? `, ${g.unread} new` : ''})
                    </button>
                  ))}
                </div>
              )}

              <div className="flex-1 overflow-y-auto p-4 sm:p-6" style={{ background: 'var(--color-bg)' }}>
                {selectedNotification ? (
                  <div className="panel space-y-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-border">
                      <div>
                        {/* Was a hard-coded "System notification" label, which told the
                            reader nothing; the category does. */}
                        <span className="pill pill--accent mb-2">{categoryOf(selectedNotification).label}</span>
                        <h3 className="h2">{selectedNotification.subject}</h3>
                        <p className="muted small mt-1 flex items-center gap-1.5">
                          <Clock className="w-4 h-4" /> Sent {timeAgo(selectedNotification.created_at)} ({formatServerDateTime(selectedNotification.created_at)})
                        </p>
                      </div>
                      <span className="pill pill--success"><CheckCircle2 className="w-3.5 h-3.5" /> Read</span>
                    </div>

                    <div className="space-y-2">
                      <h4 className="small font-medium muted">Message content</h4>
                      <div className="panel" style={{ background: 'var(--color-tint-2)' }}>
                        {selectedNotification.body || selectedNotification.subject}
                      </div>
                    </div>

                    {/* Where the thing this notification talks about can be seen: the request
                        itself, the approvals queue, Reports > Balance history, comp-off... */}
                    {destinationOf(selectedNotification) && (
                    <div className="panel flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" style={{ background: 'var(--color-tint-3)' }}>
                      <div>
                        <p className="font-medium">{selectedNotification.related_request_id ? 'Related request record' : 'Where to see this'}</p>
                        <p className="muted small mt-0.5">
                          {selectedNotification.related_request_id
                            ? `Request reference #${selectedNotification.related_request_id}`
                            : `${destinationOf(selectedNotification).short}: ${destinationOf(selectedNotification).label.toLowerCase()}.`}
                        </p>
                      </div>
                      <button type="button" onClick={(e) => handleNavigateToRequest(selectedNotification, e)} className="btn btn--primary btn--sm shrink-0">
                        {destinationOf(selectedNotification).label} <ExternalLink className="w-4 h-4" />
                      </button>
                    </div>
                    )}

                    <button type="button" onClick={() => setSelectedNotification(null)} className="btn btn--secondary btn--sm">
                      Return to notification list
                    </button>
                  </div>
                ) : !displayedNotifications.length ? (
                  <div className="empty">
                    <span className="ico"><Inbox /></span>
                    <h3>No notifications found</h3>
                    <p>{filterUnreadOnly ? 'You have read all your notifications.' : 'Your notification inbox is currently clear.'}</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {displayedGroups.map((group) => (
                      <section key={group.key} className="space-y-3">
                        {/* The heading is the whole point when viewing All; with one
                            category selected the chip above already says which. */}
                        {category === 'ALL' && (
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                            <h3 className="h3">{group.label}</h3>
                            <span className="muted small">{group.hint}</span>
                          </div>
                        )}
                        {group.items.map((n) => {
                          const destination = destinationOf(n);
                          return (
                      <div
                        key={n.notification_id}
                        onClick={(e) => inspectNotification(n, e)}
                        data-urgency={!n.read_at ? 'near' : undefined}
                        className="rl-card cursor-pointer flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4"
                      >
                        <div className="flex items-start gap-4 min-w-0 flex-1">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <h4 className="font-medium leading-snug">{n.subject}</h4>
                              {!n.read_at && <span className="pill pill--accent">New</span>}
                            </div>
                            {n.body && <p className="muted small mt-1.5 line-clamp-2">{n.body}</p>}
                            <div className="flex items-center gap-2 muted small mt-2.5">
                              <Clock className="w-3.5 h-3.5" />
                              <span>{timeAgo(n.created_at)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="actions shrink-0">
                          {/* Straight to the request this is about, skipping the detail
                              view — the usual thing wanted from a row that says your leave
                              was approved or that one is waiting on you. */}
                          {destination && (
                            <button type="button" onClick={(e) => handleNavigateToRequest(n, e)} className="btn btn--primary btn--sm">
                              {destination.short} <ExternalLink className="w-4 h-4" />
                            </button>
                          )}
                          <button type="button" onClick={(e) => inspectNotification(n, e)} className="btn btn--secondary btn--sm">
                            View <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                          );
                        })}
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
