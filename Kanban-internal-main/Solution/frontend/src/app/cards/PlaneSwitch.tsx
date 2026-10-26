// Private / Org plane switch on My board (D-059): a segmented control whose raised thumb slides
// to the active segment. Segments are real links (bookmarkable URLs); the thumb is decoration.
// D-149: the segment pressed last is remembered per person in this browser, so My board reopens
// on it until the other one is pressed. A view preference only - nothing the server decides.
import { Link, useLocation } from 'react-router';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { Icon, type IconName } from '../../components/Icon';
import s from './cards.module.css';

const SEGMENTS = [
  { to: '/', plane: 'private', icon: 'lock', label: 'board.tab.private' as const },
  { to: '/org', plane: 'org', icon: 'users', label: 'board.tab.org' as const },
] as const;

type Plane = (typeof SEGMENTS)[number]['plane'];
const planeKey = (userId: string) => `kanban.myBoardPlane.${userId}`;

/** The My board plane this person picked last here; private when none (or storage is blocked). */
export function rememberedPlane(userId: string): Plane {
  try {
    return localStorage.getItem(planeKey(userId)) === 'org' ? 'org' : 'private';
  } catch {
    return 'private';
  }
}

function remember(userId: string, plane: Plane) {
  try {
    localStorage.setItem(planeKey(userId), plane);
  } catch {
    // Private window or blocked storage: the switch still works, it is just not remembered.
  }
}

export function PlaneSwitch({ userId }: { userId: string }) {
  const { pathname } = useLocation();
  const active = pathname.startsWith('/org') ? 1 : 0;
  return (
    <nav className={s.segmented} aria-label={t('board.planes')} data-testid="plane-switch">
      <span
        className={s.segThumb}
        style={{ transform: `translateX(${active * 100}%)` }}
        aria-hidden="true"
      />
      {SEGMENTS.map((seg, i) => (
        <Link
          key={seg.to}
          to={seg.to}
          onClick={() => remember(userId, seg.plane)}
          className={cx(s.segment, i === active && s.segmentOn)}
          aria-current={i === active ? 'page' : undefined}
        >
          <Icon name={seg.icon} size={18} />
          {t(seg.label)}
        </Link>
      ))}
    </nav>
  );
}

/** Generic two-or-more-way segmented link control with the same sliding thumb. */
export function Segmented({
  label,
  items,
  testId,
}: {
  label: string;
  items: { to: string; label: string; active: boolean; icon?: IconName }[];
  testId?: string;
}) {
  const active = Math.max(
    0,
    items.findIndex((i) => i.active),
  );
  return (
    <nav className={s.segmented} aria-label={label} data-testid={testId}>
      <span
        className={s.segThumb}
        style={{
          width: `calc(${100 / items.length}% - 3px)`,
          transform: `translateX(${active * 100}%)`,
        }}
        aria-hidden="true"
      />
      {items.map((it, i) => (
        <Link
          key={it.to}
          to={it.to}
          className={cx(s.segment, i === active && s.segmentOn)}
          aria-current={i === active ? 'page' : undefined}
        >
          {it.icon ? <Icon name={it.icon} size={18} /> : null}
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
