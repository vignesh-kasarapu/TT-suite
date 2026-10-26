// Notifications: one row per update - icon, message, time. The whole row opens the claim; nothing looks like a hyperlink.
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../controllers/useAsync";
import { refreshBadges } from "../../controllers/useNotifications";
import { notificationsApi } from "../../models/api";
import { dateTime, notificationIcon } from "../../models/format";
import type { Notification } from "../../models/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorAlert, PageHead, Skeleton } from "../components/ui";

function Row({ n }: { n: Notification }) {
  const body = (
    <>
      <span className="notif-ico" aria-hidden="true"><Icon name={notificationIcon(n.message)} /></span>
      <span className="notif-text">
        <span className="notif-msg">{n.message}</span>
        <span className="notif-time">{dateTime(n.created_at)}</span>
      </span>
      {!n.is_read && <span className="notif-dot" aria-label="New" />}
      {n.link && <span className="notif-go" aria-hidden="true"><Icon name="chev" /></span>}
    </>
  );
  const cls = `notif${n.is_read ? "" : " notif--new"}`;
  return <li>{n.link ? <Link to={n.link} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

export function NotificationsPage() {
  const { data, error, loading, reload } = useResource(notificationsApi.list);

  useEffect(() => {
    if (data?.some((n) => !n.is_read)) notificationsApi.readAll().then(refreshBadges).catch(() => {});
  }, [data]);

  const unread = data?.filter((n) => !n.is_read).length ?? 0;
  return (
    <>
      <PageHead title="Notifications" sub={unread ? `${unread} new` : undefined} />
      <ErrorAlert error={error} onRetry={reload} />
      {loading ? <Skeleton /> : !data?.length ? (
        <Empty icon="bell" title="No notifications yet">Updates about your claims and approvals will show here.</Empty>
      ) : (
        <ul className="panel flush notif-list">
          {data.map((n) => <Row key={n.id} n={n} />)}
        </ul>
      )}
    </>
  );
}
