// Teams page (D-135; D-157 the user's mockup): every team, with search, All / My teams tabs and a
// sort; each row shows an icon, the name and description, its people (leads first) and count,
// "Open board" for members and admins (CR-14), and a "..." menu. "Create team" is for admins and
// "Add member" for admins and the team's leads - the same people Administration lets do it; the
// server checks both again (D-012).
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Button, EmptyState, Pill, Skeleton } from '../../components';
import { Avatar } from '../../components/Avatar';
import { Icon, type IconName } from '../../components/Icon';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { t } from '../../i18n/t';
import { cx } from '../../styles/cx';
import { pageTitleClass } from '../Shell';
import { useContextData } from '../auth/useMe';
import { projectHue } from '../cards/projectColor';
import c from '../cards/cards.module.css';
import s from './teams.module.css';
import { useTeam, useTeamMutations, useTeams, useUsers, type Team } from './api';

type Tab = 'all' | 'mine';
type Sort = 'name' | 'nameDesc' | 'members' | 'newest';
const SORTS: Sort[] = ['name', 'nameDesc', 'members', 'newest'];
const ICONS: IconName[] = ['users', 'board', 'chart', 'book', 'shield', 'list', 'inbox', 'cal'];
const AVATARS = 8;

/** A team's icon and colour, chosen from its name (display only). */
function TeamIcon({ team }: { team: Team }) {
  const hue = projectHue(team.id);
  return (
    <span
      className={s.icon}
      style={{ '--team-hue': String(hue) } as Record<string, string>}
      aria-hidden="true"
    >
      <Icon name={ICONS[(hue / 30) % ICONS.length] ?? 'users'} size={24} />
    </span>
  );
}

/** Add one active user to the team: a small popover with a person picker. */
function AddMember({ teamId, memberIds }: { teamId: string; memberIds: Set<string> }) {
  const users = useUsers();
  const { addMember } = useTeamMutations();
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDetailsElement>(null);
  // The same people Administration offers: everyone the directory lists who is not in yet.
  const candidates = (users.data?.items ?? []).filter((u) => !memberIds.has(u.id));
  return (
    <details ref={ref} className={s.add} data-popover data-testid={`team-add-${teamId}`}>
      <summary className={s.addButton}>
        <span className={s.addIcon} aria-hidden="true">
          <Icon name="plus" size={16} />
        </span>
        {t('admin.addMember')}
      </summary>
      <form
        className={s.addPanel}
        onSubmit={(e) => {
          e.preventDefault();
          if (!userId) return;
          setError(null);
          addMember
            .mutateAsync({ id: teamId, userId })
            .then(() => {
              setUserId('');
              ref.current?.removeAttribute('open');
            })
            .catch((p: unknown) => setError(problemBanner(p as Problem)));
        }}
      >
        <label className={s.field}>
          <span>{t('teams.addWho')}</span>
          <select
            className={c.input}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            data-testid={`team-add-select-${teamId}`}
          >
            <option value="">{t('admin.pickUser')}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {`${u.name} (${u.email})`}
              </option>
            ))}
          </select>
        </label>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Button
          type="submit"
          variant="primary"
          busy={addMember.isPending}
          disabled={!userId}
          data-testid={`team-add-submit-${teamId}`}
        >
          {t('admin.addMember')}
        </Button>
      </form>
    </details>
  );
}

function TeamRow({
  team,
  canOpen,
  canManage,
}: {
  team: Team;
  canOpen: boolean;
  canManage: boolean;
}) {
  const detail = useTeam(team.id);
  const members = [...(detail.data?.members ?? [])].sort(
    (a, b) => Number(b.isLead) - Number(a.isLead) || a.name.localeCompare(b.name),
  );
  const shown = members.slice(0, AVATARS);
  return (
    <li className={s.row} data-testid={`team-${team.id}`}>
      <TeamIcon team={team} />
      <div className={s.main}>
        <div className={s.titleLine}>
          {canOpen ? (
            <Link to={`/teams/${team.id}`} className={s.name}>
              {team.name}
            </Link>
          ) : (
            <span className={s.name}>{team.name}</span>
          )}
          {team.isMember ? <Pill tone="accent">{t('teams.mine')}</Pill> : null}
        </div>
        {team.description ? <p className={s.description}>{team.description}</p> : null}
        <div className={s.people}>
          <ul
            className={s.avatars}
            aria-label={t('teams.memberList')}
            data-testid={`team-members-${team.id}`}
          >
            {shown.map((m) => (
              <li
                key={m.id}
                className={cx(s.person, m.status === 'invited' && s.invited)}
                title={
                  m.status === 'invited'
                    ? `${m.name} (${t('teams.invited')})`
                    : m.isLead
                      ? t('teams.leadTip', { name: m.name })
                      : m.name
                }
              >
                <Avatar user={m} size={32} />
                <span className="visually-hidden">
                  {m.status === 'invited' ? `${m.name} (${t('teams.invited')})` : m.name}
                </span>
                {m.isLead ? <Pill tone="success">{t('admin.lead')}</Pill> : null}
              </li>
            ))}
            {members.length > shown.length ? (
              <li className={s.more}>{`+${members.length - shown.length}`}</li>
            ) : null}
          </ul>
          {canManage ? (
            <AddMember teamId={team.id} memberIds={new Set(members.map((m) => m.id))} />
          ) : null}
        </div>
      </div>
      <div className={s.side}>
        <span className={s.count}>
          {t(team.memberCount === 1 ? 'teams.member1' : 'teams.members', {
            n: String(team.memberCount),
          })}
        </span>
        {canOpen ? (
          <Link to={`/teams/${team.id}`} className={s.open} data-testid={`team-open-${team.id}`}>
            {t('teams.openBoard')}
            <Icon name="chev" size={16} />
          </Link>
        ) : (
          <span className={s.noAccess} title={t('teams.noAccessTip')}>
            <Icon name="lock" size={16} />
            {t('teams.noAccess')}
          </span>
        )}
        {canOpen ? (
          <details className={c.cardMenu} data-popover data-testid={`team-menu-${team.id}`}>
            <summary
              className={c.cardMenuButton}
              aria-label={t('teams.actions', { name: team.name })}
              title={t('teams.actions', { name: team.name })}
            >
              <Icon name="more" size={18} />
            </summary>
            <div className={cx(c.cardMenuPanel, s.menuPanel)}>
              <Link to={`/teams/${team.id}`} className={s.menuItem}>
                {t('teams.openBoard')}
              </Link>
              <Link to={`/teams/${team.id}/backlog`} className={s.menuItem}>
                {t('teams.openBacklog')}
              </Link>
              {canManage ? (
                <Link to={`/team-time?team=${team.id}`} className={s.menuItem}>
                  {t('nav.teamTime')}
                </Link>
              ) : null}
              {canManage ? (
                <Link to={`/admin/teams/${team.id}`} className={s.menuItem}>
                  {t('teams.manage')}
                </Link>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/** Admins create a team here, as in Administration (name, optional description). */
function CreateTeamDialog({ onClose }: { onClose: () => void }) {
  const { create } = useTeamMutations();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  return (
    <dialog
      ref={(el) => {
        ref.current = el;
        if (el && !el.open) el.showModal();
      }}
      className={c.dialog}
      aria-labelledby="create-team-title"
      onClose={onClose}
      data-testid="create-team-dialog"
    >
      <form
        className={c.form}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setErrors({});
          setBanner(null);
          create
            .mutateAsync({ name: name.trim(), description: description.trim() })
            .then(() => {
              ref.current?.close();
              onClose();
            })
            .catch((p: unknown) => {
              setBanner(problemBanner(p as Problem));
              setErrors(fieldErrorsOf(p as Problem));
            });
        }}
      >
        <h2 id="create-team-title" className={c.dialogTitle}>
          {t('teams.create')}
        </h2>
        {banner ? <Alert tone="danger">{banner}</Alert> : null}
        <label className={c.field}>
          <span>{t('teams.nameLabel')}</span>
          <input
            className={cx(c.input, errors['name'] && c.invalid)}
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="create-team-name"
          />
          {errors['name'] ? <span className={c.fieldError}>{errors['name']}</span> : null}
        </label>
        <label className={c.field}>
          <span>{t('teams.descriptionLabel')}</span>
          <textarea
            className={cx(c.input, c.textarea)}
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="create-team-description"
          />
        </label>
        <div className={c.dialogActions}>
          <Button variant="secondary" onClick={() => ref.current?.close()}>
            {t('card.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
            busy={create.isPending}
            data-testid="create-team-submit"
          >
            {t('teams.create')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

export function TeamsPage() {
  const teams = useTeams();
  const me = useContextData();
  const isAdmin = me.user.role === 'admin';
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [sort, setSort] = useState<Sort>('name');
  const [creating, setCreating] = useState(false);
  const all = teams.data?.items ?? [];
  const mine = all.filter((tm) => tm.isMember);
  const list = (tab === 'mine' ? mine : all)
    .filter((tm) => {
      const text = q.trim().toLowerCase();
      return (
        !text || tm.name.toLowerCase().includes(text) || tm.description.toLowerCase().includes(text)
      );
    })
    .sort((a, b) =>
      sort === 'nameDesc'
        ? b.name.localeCompare(a.name)
        : sort === 'members'
          ? b.memberCount - a.memberCount || a.name.localeCompare(b.name)
          : sort === 'newest'
            ? b.createdAt.localeCompare(a.createdAt)
            : a.name.localeCompare(b.name),
    );
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: 'all', label: t('teams.tabAll'), n: all.length },
    { key: 'mine', label: t('teams.tabMine'), n: mine.length },
  ];
  return (
    <div className={c.page} data-testid="teams-page">
      <div className={s.head}>
        <div className={s.headText}>
          <h1 className={pageTitleClass}>{t('teams.title')}</h1>
          <p className={c.subtitle}>{t('teams.subtitle')}</p>
        </div>
        <label className={s.search}>
          <Icon name="search" size={18} />
          <input
            type="search"
            className={s.searchInput}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('teams.search')}
            aria-label={t('teams.search')}
            data-testid="teams-search"
          />
        </label>
        {isAdmin ? (
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="create-team-open"
          >
            <Icon name="plus" size={18} />
            {t('teams.create')}
          </Button>
        ) : null}
      </div>
      <div className={s.bar}>
        <div className={s.tabs} role="tablist" aria-label={t('teams.tabs')}>
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              role="tab"
              aria-selected={tab === tb.key}
              className={cx(s.tab, tab === tb.key && s.tabOn)}
              onClick={() => setTab(tb.key)}
              data-testid={`teams-tab-${tb.key}`}
            >
              {tb.label}
              <span className={s.tabCount}>{tb.n}</span>
            </button>
          ))}
        </div>
        <label className={s.sort}>
          <span>{t('teams.sortBy')}</span>
          <select
            className={c.input}
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            data-testid="teams-sort"
          >
            {SORTS.map((o) => (
              <option key={o} value={o}>
                {t(`teams.sort.${o}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {teams.isPending ? (
        <Skeleton lines={4} label={t('skeleton.label')} />
      ) : all.length === 0 ? (
        <EmptyState title={t('teams.empty.title')} body={t('teams.empty.body')} />
      ) : list.length === 0 ? (
        <p className={c.hint}>{t('teams.noMatch')}</p>
      ) : (
        <ul className={s.list}>
          {list.map((tm) => (
            <TeamRow
              key={tm.id}
              team={tm}
              // CR-14: only members and admins may open a team's board
              canOpen={tm.isMember || isAdmin}
              // CR-11: admins and the team's leads manage its members
              canManage={isAdmin || me.leadTeamIds.includes(tm.id)}
            />
          ))}
        </ul>
      )}
      {creating ? <CreateTeamDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
