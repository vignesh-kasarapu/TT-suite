import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, X, Inbox, Clock, ChevronRight, ArrowLeft, ExternalLink, CheckCircle2 } from 'lucide-react';
import { listNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead } from '../../api/notifications';
import { categoryOf, groupByCategory } from '../../utils/notificationCategories';

/** Notifications that mean "somebody else's request needs you" — these open the approvals
 * queue. Everything else is about the recipient's own request and opens its detail page.
 * Watcher notifications are deliberately absent: a watcher has no decision to make, and
 * the request detail already serves them the masked projection. */
const DECISION_TEMPLATE_KEYS = new Set([
  'REQUEST_AWAITING_DECISION',
  'NEW_REQUEST_AWAITING_DECISION',
  'CANCELLATION_REQUEST_AWAITING_DECISION',
  'SLA_REMINDER',
]);

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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

  const handleNavigateToRequest = (n) => {
    setOpen(false);
    setSelectedNotification(null);
    // A notification about somebody else's request belongs in the approvals queue, not in
    // My Requests — sending an approver to /my-requests/{id} showed them a request they
    // never raised, on a page that is meant to list their own.
    if (DECISION_TEMPLATE_KEYS.has(n.template_key)) {
      navigate('/approvals');
    } else if (n.related_request_id) {
      navigate(`/my-requests/${n.related_request_id}`);
    } else {
      navigate('/my-requests');
    }
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
      <button onClick={toggleOpen} type="button" className="btn btn--ghost btn--sm !px-2 relative" title="Notifications">
        <Bell className="w-5 h-5" strokeWidth={2} />
        {unreadCount > 0 && <span className="badge" style={{ position: 'absolute', top: -4, right: -4 }}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-8">
            <div className="fixed inset-0 bg-black/50" onClick={() => { setOpen(false); setSelectedNotification(null); }} />

            <div
              className="relative w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden z-10"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)', border: '1px solid var(--color-border)' }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-5 border-b border-border shrink-0">
                <div className="flex items-center gap-3">
                  {selectedNotification ? (
                    <button type="button" onClick={() => setSelectedNotification(null)} className="btn btn--secondary btn--sm">
                      <ArrowLeft className="w-4 h-4" /> Back to inbox
                    </button>
                  ) : (
                    <span className="ico" style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: 'var(--color-tint-2)', display: 'grid', placeItems: 'center', color: 'var(--color-accent-text)' }}>
                      <Bell className="w-6 h-6" />
                    </span>
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="h2">{selectedNotification ? 'Notification details' : 'Notification centre'}</h2>
                      {!selectedNotification && unreadCount > 0 && <span className="pill pill--accent">{unreadCount} unread</span>}
                    </div>
                    <p className="muted small mt-0.5">
                      {selectedNotification ? 'Review this notification.' : 'Leave approvals and system alerts.'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
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
                  <button type="button" onClick={() => { setOpen(false); setSelectedNotification(null); }} className="btn btn--ghost btn--sm !px-2" title="Close" aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {!selectedNotification && groups.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap px-6 py-3 border-b border-border shrink-0">
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

              <div className="flex-1 overflow-y-auto p-6" style={{ background: 'var(--color-bg)' }}>
                {selectedNotification ? (
                  <div className="panel space-y-6">
                    <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
                      <div>
                        {/* Was a hard-coded "System notification" label, which told the
                            reader nothing; the category does. */}
                        <span className="pill pill--accent mb-2">{categoryOf(selectedNotification).label}</span>
                        <h3 className="h2">{selectedNotification.subject}</h3>
                        <p className="muted small mt-1 flex items-center gap-1.5">
                          <Clock className="w-4 h-4" /> Sent {timeAgo(selectedNotification.created_at)} ({new Date(selectedNotification.created_at).toLocaleString()})
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

                    <div className="panel flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4" style={{ background: 'var(--color-tint-3)' }}>
                      <div>
                        <p className="font-medium">Related request record</p>
                        <p className="muted small mt-0.5">
                          {selectedNotification.related_request_id
                            ? `Request reference #${selectedNotification.related_request_id}`
                            : 'This notification is tied to your employee leave account.'}
                        </p>
                      </div>
                      <button type="button" onClick={() => handleNavigateToRequest(selectedNotification)} className="btn btn--primary btn--sm shrink-0">
                        View my requests <ExternalLink className="w-4 h-4" />
                      </button>
                    </div>

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
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="h3">{group.label}</h3>
                            <span className="muted small">{group.hint}</span>
                          </div>
                        )}
                        {group.items.map((n) => (
                      <div
                        key={n.notification_id}
                        onClick={(e) => inspectNotification(n, e)}
                        data-urgency={!n.read_at ? 'near' : undefined}
                        className="rl-card cursor-pointer flex items-start justify-between gap-4"
                      >
                        <div className="flex items-start gap-4 min-w-0 flex-1">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3">
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
                        <button type="button" onClick={(e) => inspectNotification(n, e)} className="btn btn--secondary btn--sm shrink-0">
                          View <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                        ))}
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
