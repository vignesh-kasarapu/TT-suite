// Org-plane read pages (Teams: ./Teams.tsx, D-157): Programs & projects, project/program
// detail with dependency tree and history. Presentation only. (Search: ./Search.tsx.)
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Alert, Button, EmptyState, Pill, Skeleton } from '../../components';
import { t } from '../../i18n/t';
import { pageTitleClass } from '../Shell';
import { useProjectAttachmentMutations, useProjectDocuments } from '../cards/api';
import { AttachmentForm, AttachmentList } from '../cards/Files';
import { fieldErrorsOf, problemBanner, type Problem } from '../../api/client';
import { useContextData } from '../auth/useMe';
import { eventLabel, show } from '../cards/CardDetail';
import { PriorityPill } from '../cards/Board';
import c from '../cards/cards.module.css';
import s from './org.module.css';
import {
  useOrgEvents,
  usePrograms,
  useProgram,
  useProject,
  useProjects,
  useTree,
  type Project,
} from './api';

export function ProgramsPage() {
  const programs = usePrograms();
  const [includeClosed, setIncludeClosed] = useState(false); // CR-12
  const projects = useProjects({ includeClosed });
  const loose = (projects.data?.items ?? []).filter((p) => p.program === null);
  return (
    <div className={c.page} data-testid="programs-page">
      <h1 className={pageTitleClass}>{t('programs.title')}</h1>
      <label className={c.check}>
        <input
          type="checkbox"
          checked={includeClosed}
          onChange={(e) => setIncludeClosed(e.target.checked)}
          data-testid="programs-include-closed"
        />
        {t('projects.includeClosed')}
      </label>
      {programs.isPending || projects.isPending ? (
        <Skeleton lines={4} label={t('skeleton.label')} />
      ) : (
        <>
          {(programs.data?.items ?? []).length === 0 && loose.length === 0 ? (
            <EmptyState title={t('programs.empty.title')} body={t('programs.empty.body')} />
          ) : null}
          {(programs.data?.items ?? []).map((p) => (
            <section key={p.id} className={s.section} data-testid={`program-${p.id}`}>
              <h2 className={s.sectionTitle}>
                <Link to={`/programs/${p.id}`}>{p.name}</Link>
                <span className={c.hint}>
                  {t('programs.target', { date: p.targetDate ?? t('card.none') })}
                  {' · '}
                  {t('programs.derived', { date: p.derivedTargetDate ?? t('card.none') })}
                </span>
              </h2>
              <ProjectList
                items={(projects.data?.items ?? []).filter((x) => x.program?.id === p.id)}
              />
            </section>
          ))}
          {loose.length ? (
            <section className={s.section}>
              <h2 className={s.sectionTitle}>{t('programs.noProgram')}</h2>
              <ProjectList items={loose} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function ProjectList({ items }: { items: Project[] }) {
  if (items.length === 0) return <p className={c.hint}>{t('programs.noProjects')}</p>;
  return (
    <ul className={s.cardList}>
      {items.map((p) => (
        <li key={p.id} className={s.cardItem} data-testid={`project-${p.id}`}>
          <Link to={`/projects/${p.id}`} className={s.cardTitle}>
            {p.name}
          </Link>
          <span className={c.hint}>
            {p.team.name}
            {' · '}
            {t('projects.open', { open: String(p.openCardCount), total: String(p.cardCount) })}
            {p.targetDate ? ` · ${t('programs.target', { date: p.targetDate })}` : ''}
            {p.closedAt
              ? ` · ${t('projects.closed')}`
              : !p.accepting
                ? ` · ${t('projects.stopped')}`
                : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ProjectPage() {
  const { id = '' } = useParams();
  const project = useProject(id);
  const me = useContextData();
  if (project.isPending) return <Skeleton lines={4} label={t('skeleton.label')} />;
  if (!project.data) return <Alert tone="danger">{t('problem.NOT_FOUND')}</Alert>;
  const p = project.data;
  const opensTeam = me.user.role === 'admin' || me.teams.some((tm) => tm.id === p.team.id); // CR-14
  return (
    <div className={c.page} data-testid="project-page">
      <span className={c.hint}>{t('projects.one')}</span>
      <h1 className={pageTitleClass}>{p.name}</h1>
      <p className={c.hint}>
        {opensTeam ? <Link to={`/teams/${p.team.id}`}>{p.team.name}</Link> : p.team.name}
        {p.program ? (
          <>
            {' · '}
            <Link to={`/programs/${p.program.id}`}>{p.program.name}</Link>
          </>
        ) : null}
        {' · '}
        {t('programs.target', { date: p.targetDate ?? t('card.none') })}
        {' · '}
        {t('projects.open', { open: String(p.openCardCount), total: String(p.cardCount) })}
      </p>
      {p.description ? <p>{p.description}</p> : null}
      <Documents project={p} />
      <Tree kind="projects" id={p.id} />
      <OrgHistory kind="projects" id={p.id} />
    </div>
  );
}

export function ProgramPage() {
  const { id = '' } = useParams();
  const program = useProgram(id);
  if (program.isPending) return <Skeleton lines={4} label={t('skeleton.label')} />;
  if (!program.data) return <Alert tone="danger">{t('problem.NOT_FOUND')}</Alert>;
  const p = program.data;
  return (
    <div className={c.page} data-testid="program-page">
      <span className={c.hint}>{t('programs.one')}</span>
      <h1 className={pageTitleClass}>{p.name}</h1>
      <p className={c.hint}>
        {t('programs.target', { date: p.targetDate ?? t('card.none') })}
        {' · '}
        {t('programs.derived', { date: p.derivedTargetDate ?? t('card.none') })}
      </p>
      {p.description ? <p>{p.description}</p> : null}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>{t('programs.projects')}</h2>
        <ProjectList items={p.projects} />
      </section>
      <Tree kind="programs" id={p.id} />
      <OrgHistory kind="programs" id={p.id} />
    </div>
  );
}

/** Dependency tree (FR-033): roots = cards nothing depends on; predecessors nest beneath. */
export function Tree({ kind, id }: { kind: 'projects' | 'programs'; id: string }) {
  const tree = useTree(kind, id);
  if (tree.isPending) return <Skeleton lines={3} label={t('skeleton.label')} />;
  if (!tree.data) return null;
  const { nodes, edges, cycles } = tree.data;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>();
  const hasSuccessor = new Set<string>();
  for (const e of edges) {
    preds.set(e.fromId, [...(preds.get(e.fromId) ?? []), e.toId]);
    hasSuccessor.add(e.toId);
  }
  const roots = nodes.filter((n) => !hasSuccessor.has(n.id) && !n.external);
  // Cards only reachable through a cycle have no root; show them as roots too.
  const reached = new Set<string>();
  const walk = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const p of preds.get(id) ?? []) walk(p);
  };
  for (const r of roots) walk(r.id);
  for (const n of nodes) if (!n.external && !reached.has(n.id)) roots.push(n);
  const inCycle = new Set(cycles.flat());

  const render = (nodeId: string, path: Set<string>, depth: number): React.ReactNode => {
    const n = byId.get(nodeId);
    if (!n) return null;
    const children = preds.get(nodeId) ?? [];
    const loop = path.has(nodeId);
    return (
      <li key={`${nodeId}-${depth}`} className={s.treeNode} data-testid="tree-node">
        <span className={s.treeRow}>
          <Link to={`/cards/${n.key}`} className={c.key}>
            {n.key}
          </Link>
          <span>{n.title}</span>
          <PriorityPill priority={n.priority} />
          <Pill tone="muted">{t(`state.${n.state}` as 'state.backlog')}</Pill>
          {n.external ? <Pill tone="warning">{t('tree.external')}</Pill> : null}
          {inCycle.has(n.id) ? <Pill tone="danger">{t('tree.cycle')}</Pill> : null}
        </span>
        {children.length && !loop ? (
          <ul className={s.treeChildren}>
            {children.map((cid) => render(cid, new Set([...path, nodeId]), depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <section className={s.section} data-testid="tree">
      <h2 className={s.sectionTitle}>{t('tree.title')}</h2>
      <p className={c.hint}>{t('tree.lead')}</p>
      {cycles.length ? (
        <Alert tone="warning">
          {t('tree.cycles', {
            list: cycles
              .map((cy) => cy.map((cid) => byId.get(cid)?.key ?? cid).join(' → '))
              .join('; '),
          })}
        </Alert>
      ) : null}
      {nodes.length === 0 ? (
        <p className={c.hint}>{t('tree.empty')}</p>
      ) : (
        <ul className={s.treeRoot}>{roots.map((r) => render(r.id, new Set(), 0))}</ul>
      )}
    </section>
  );
}

export function OrgHistory({ kind, id }: { kind: 'teams' | 'programs' | 'projects'; id: string }) {
  const events = useOrgEvents(kind, id);
  const [open, setOpen] = useState(false);
  return (
    <section className={s.section} data-testid="org-history">
      <h2 className={s.sectionTitle}>
        {t('orgHistory.title')}
        <Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {t(open ? 'orgHistory.hide' : 'orgHistory.show')}
        </Button>
      </h2>
      {open ? (
        events.isPending ? (
          <Skeleton lines={3} label={t('skeleton.label')} />
        ) : (
          <ol className={c.eventList}>
            {(events.data?.items ?? []).map((ev) => (
              <li key={ev.id} className={c.event} data-testid="org-event">
                <div className={c.commentHead}>
                  <Pill tone={ev.field === 'created' ? 'success' : 'muted'}>
                    {eventLabel(ev.field)}
                  </Pill>
                  <span
                    className={c.hint}
                  >{`${ev.actor.name} - ${new Date(ev.createdAt).toLocaleString()}`}</span>
                </div>
                {ev.field !== 'created' ? (
                  <div className={c.diff}>
                    <span className={c.old}>{show(ev.oldValue)}</span>
                    {' → '}
                    <span>{show(ev.newValue)}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}

/** Documents (FR-048 / CR-05): common links first, then card links grouped by card. List only. */
export function Documents({ project }: { project: Project }) {
  const me = useContextData();
  const docs = useProjectDocuments(project.id);
  const { add, remove } = useProjectAttachmentMutations(project.id);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // UX hint only (D-069): the project's team or an admin may add common links.
  const canEdit = me.user.role === 'admin' || me.teams.some((tm) => tm.id === project.team.id);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setErrors({});
    try {
      await fn();
      return true;
    } catch (p) {
      setError(problemBanner(p as Problem));
      setErrors(fieldErrorsOf(p as Problem));
      return false;
    }
  }
  return (
    <section className={s.section} data-testid="documents">
      <h2 className={s.sectionTitle}>{t('docs.title')}</h2>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {docs.isPending ? (
        <Skeleton lines={3} label={t('skeleton.label')} />
      ) : (
        <>
          <h3 className={c.hint}>{t('docs.common')}</h3>
          <AttachmentList
            items={docs.data?.common ?? []}
            onRemove={canEdit ? (id) => void run(() => remove.mutateAsync(id)) : undefined}
          />
          {canEdit ? (
            <AttachmentForm
              onSubmit={(b) => run(() => add.mutateAsync(b))}
              busy={add.isPending}
              errors={errors}
              testId="project-attachment-form"
            />
          ) : null}
          {(docs.data?.byCard ?? []).map((g) => (
            <div key={g.card.id} data-testid={`docs-card-${g.card.key}`}>
              <h3 className={c.hint}>
                <Link to={`/cards/${g.card.key}`} className={c.key}>
                  {g.card.key}
                </Link>{' '}
                {g.card.title}
              </h3>
              <AttachmentList items={g.items} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}
