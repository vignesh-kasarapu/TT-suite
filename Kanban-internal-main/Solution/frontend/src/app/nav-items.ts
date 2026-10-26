// Navigation sets, derived from the role the server returned in getMe (never from a
// client-side rule). Add app items here; `bar` marks the 4-item mobile bottom bar.
import type { IconName } from '../components/Icon';
import type { MessageKey } from '../i18n/t';

export interface NavItem {
  key: string;
  to: string;
  label: MessageKey;
  icon: IconName;
  /** In the 4-item mobile bottom bar (the rest go to the "More" sheet). */
  bar?: boolean;
}

export type Role = 'member' | 'admin';

const home: NavItem = { key: 'home', to: '/', label: 'nav.board', icon: 'home', bar: true };
const teams: NavItem = { key: 'teams', to: '/teams', label: 'nav.teams', icon: 'users', bar: true };
const programs: NavItem = { key: 'programs', to: '/programs', label: 'nav.programs', icon: 'list' };
const search: NavItem = { key: 'search', to: '/search', label: 'nav.search', icon: 'search' };
const reports: NavItem = { key: 'reports', to: '/reports', label: 'nav.reports', icon: 'chart' };
const time: NavItem = { key: 'time', to: '/time', label: 'nav.time', icon: 'clock', bar: true };
const teamTime: NavItem = { key: 'teamTime', to: '/team-time', label: 'nav.teamTime', icon: 'cal' };
const preferences: NavItem = {
  key: 'preferences',
  to: '/preferences',
  label: 'nav.preferences',
  icon: 'gear',
};
const administration: NavItem = {
  key: 'admin',
  to: '/admin',
  label: 'nav.administration',
  icon: 'shield',
};

/**
 * Side nav / icon rail order and the mobile bar membership for a role. Team leads (CR-11)
 * get Administration too; the page itself shows them only their own teams and projects.
 * Everyone gets My time; leads and admins also Team time (D-116). The Inbox is the top bar's
 * bell (D-119), not a nav item (D-122). Unassigned is not either (D-145): a card nobody holds
 * drops to its team's Backlog (CR-17); the /unassigned page stays for legacy team-less cards.
 */
export function navFor(role: Role, isLead = false): NavItem[] {
  const manage = role === 'admin' || isLead;
  const items: NavItem[] = [home, teams, programs, reports, time];
  if (manage) items.push(teamTime);
  items.push(search, preferences);
  if (manage) items.push(administration);
  return items;
}

/** Mobile bar order. */
export function barOrder(items: NavItem[]): NavItem[] {
  return items.filter((i) => i.bar);
}

/** "More" sheet: everything not in the bar, in nav order. */
export function moreOrder(items: NavItem[]): NavItem[] {
  return items.filter((i) => !i.bar);
}

/** Every route the nav can point at. */
export const ALL_NAV_PATHS: readonly string[] = [...new Set(navFor('admin').map((i) => i.to))];
