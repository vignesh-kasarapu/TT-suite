// Card API hooks. No rules here: the server decides order, visibility and transitions.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureOk, unwrap, type Problem } from '../../api/client';
import type { components } from '../../api/schema';
import { ME_KEY } from '../auth/useMe';

export type Card = components['schemas']['Card'];
export type CardSummary = components['schemas']['CardSummary'];
export type CardState = components['schemas']['Card']['state'];
export type Board = components['schemas']['Board'];
export type CardEvent = components['schemas']['CardEvent'];
export type Comment = components['schemas']['Comment'];
export type CardPatch = components['schemas']['CardPatchRequest'];
export type CardCreate = components['schemas']['CardCreateRequest'];
export type CardCopy = components['schemas']['CardCopyRequest'];
export type CardLink = components['schemas']['CardLink'];
export type LinkType = components['schemas']['CardLink']['type'];
export type Attachment = components['schemas']['Attachment'];
export type AttachmentCreate = components['schemas']['AttachmentCreate'];
export type InboxItem = components['schemas']['InboxItem'];

export const STATES: CardState[] = [
  'backlog',
  'in_prep',
  'ready',
  'in_development',
  'uat',
  'delivered',
  'cancelled',
];
export const LINK_TYPES: LinkType[] = ['relates_to', 'depends_on', 'blocks'];

/** Which board: the caller's private one, a team's, or the Unassigned backlog (D-054). */
export type BoardScope =
  | { kind: 'private' }
  | { kind: 'mine' } // My board > Org tab: my teams' org cards + any assigned to me (D-130)
  | { kind: 'team'; teamId: string }
  | { kind: 'unassigned' };

export interface BoardFilter {
  /** Unassigned board only (CR-17): `all` = no assignee or no team, `no_team` = no team at all. */
  mode?: 'all' | 'no_team';
  q?: string;
  tag?: string;
  priority?: number;
  includeClosed?: boolean;
  projectId?: string;
  programId?: string;
  assigneeId?: string;
}

export const BOARD_KEY = ['board'] as const;
export const cardKey = (key: string) => ['card', key] as const;

export function useBoard(scope: BoardScope, filter: BoardFilter) {
  const query: Record<string, string | number | boolean> = {};
  if (filter.q) query['q'] = filter.q;
  if (filter.tag) query['tag'] = filter.tag;
  if (filter.priority) query['priority'] = filter.priority;
  if (filter.includeClosed) query['includeClosed'] = true;
  if (filter.projectId) query['projectId'] = filter.projectId;
  if (filter.programId) query['programId'] = filter.programId;
  if (filter.assigneeId) query['assigneeId'] = filter.assigneeId;
  if (filter.mode) query['mode'] = filter.mode;
  return useQuery({
    queryKey: [...BOARD_KEY, scope, query],
    queryFn: async () => {
      if (scope.kind === 'private')
        return unwrap(await api.GET('/boards/private', { params: { query } }));
      if (scope.kind === 'mine')
        return unwrap(await api.GET('/boards/my-org', { params: { query } }));
      if (scope.kind === 'unassigned')
        return unwrap(await api.GET('/boards/unassigned', { params: { query } }));
      return unwrap(
        await api.GET('/boards/teams/{teamId}', {
          params: { path: { teamId: scope.teamId }, query },
        }),
      );
    },
    // Freshness (D-033): refetch on focus and every 30 s.
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}

export function useCard(key: string) {
  return useQuery({
    queryKey: cardKey(key),
    queryFn: async () => unwrap(await api.GET('/cards/{key}', { params: { path: { key } } })),
  });
}

export function useCardEvents(key: string, field?: string) {
  return useQuery({
    queryKey: [...cardKey(key), 'events', field ?? ''],
    queryFn: async () =>
      unwrap(
        await api.GET('/cards/{key}/events', {
          params: { path: { key }, query: { limit: 100, ...(field ? { field } : {}) } },
        }),
      ),
  });
}

export function useComments(key: string) {
  return useQuery({
    queryKey: [...cardKey(key), 'comments'],
    queryFn: async () =>
      unwrap(await api.GET('/cards/{key}/comments', { params: { path: { key } } })),
  });
}

export function useCardLinks(key: string) {
  return useQuery({
    queryKey: [...cardKey(key), 'links'],
    queryFn: async () => unwrap(await api.GET('/cards/{key}/links', { params: { path: { key } } })),
  });
}

export type SearchQuery = Record<string, string | number | boolean>;

/** Text plus every board filter (D-063); enabled once anything is set. */
export function useSearch(query: SearchQuery) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: async () =>
      unwrap(await api.GET('/cards', { params: { query: { limit: 50, ...query } } })),
    enabled: Object.keys(query).length > 0,
  });
}

/** Invalidate everything that shows the card after a write. */
function useInvalidate() {
  const qc = useQueryClient();
  return async (key?: string) => {
    await qc.invalidateQueries({ queryKey: BOARD_KEY });
    if (key) await qc.invalidateQueries({ queryKey: cardKey(key) });
  };
}

export function useCreateCard() {
  const invalidate = useInvalidate();
  return useMutation<Card, Problem, CardCreate>({
    mutationFn: async (body) => unwrap(await api.POST('/cards', { body })),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCard(key: string) {
  const invalidate = useInvalidate();
  return useMutation<Card, Problem, CardPatch>({
    mutationFn: async (body) =>
      unwrap(await api.PATCH('/cards/{key}', { params: { path: { key } }, body })),
    onSettled: () => invalidate(key),
  });
}

/** Claim (FR-018) and re-team are the same PATCH; kept separate so boards can use it by key. */
export function usePatchCard() {
  const invalidate = useInvalidate();
  return useMutation<Card, Problem, { key: string; body: CardPatch }>({
    mutationFn: async ({ key, body }) =>
      unwrap(await api.PATCH('/cards/{key}', { params: { path: { key } }, body })),
    onSettled: (_d, _e, v) => invalidate(v.key),
  });
}

export function useMoveCard() {
  const invalidate = useInvalidate();
  return useMutation<Card, Problem, { key: string; state: CardState; version: number }>({
    mutationFn: async ({ key, state, version }) =>
      unwrap(
        await api.POST('/cards/{key}/move', {
          params: { path: { key } },
          body: { state, version },
        }),
      ),
    onSettled: (_d, _e, v) => invalidate(v.key),
  });
}

export function useCopyCard(key: string) {
  const invalidate = useInvalidate();
  return useMutation<Card, Problem, CardCopy>({
    mutationFn: async (body) =>
      unwrap(await api.POST('/cards/{key}/copies', { params: { path: { key } }, body })),
    onSettled: () => invalidate(key),
  });
}

export function useLinkMutations(key: string) {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['card'] });
    await qc.invalidateQueries({ queryKey: BOARD_KEY });
  };
  const add = useMutation<CardLink, Problem, { type: LinkType; targetKey: string }>({
    mutationFn: async (body) =>
      unwrap(await api.POST('/cards/{key}/links', { params: { path: { key } }, body })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (linkId) =>
      ensureOk(
        await api.DELETE('/cards/{key}/links/{linkId}', { params: { path: { key, linkId } } }),
      ),
    onSuccess: done,
  });
  return { add, remove };
}

export function useCommentMutations(key: string) {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: cardKey(key) });
  };
  const add = useMutation<Comment, Problem, { body: string; parentId?: string }>({
    mutationFn: async (body) =>
      unwrap(await api.POST('/cards/{key}/comments', { params: { path: { key } }, body })),
    onSuccess: done,
  });
  const vote = useMutation<Comment, Problem, { id: string; value: -1 | 0 | 1 }>({
    mutationFn: async ({ id, value }) =>
      unwrap(
        await api.PUT('/cards/{key}/comments/{commentId}/vote', {
          params: { path: { key, commentId: id } },
          body: { value },
        }),
      ),
    onSuccess: done,
  });
  const edit = useMutation<Comment, Problem, { id: string; body: string }>({
    mutationFn: async ({ id, body }) =>
      unwrap(
        await api.PATCH('/cards/{key}/comments/{commentId}', {
          params: { path: { key, commentId: id } },
          body: { body },
        }),
      ),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (id) =>
      ensureOk(
        await api.DELETE('/cards/{key}/comments/{commentId}', {
          params: { path: { key, commentId: id } },
        }),
      ),
    onSuccess: done,
  });
  return { add, edit, remove, vote };
}

// ---- attachments (FR-047/048)
export function useCardAttachments(key: string) {
  return useQuery({
    queryKey: [...cardKey(key), 'attachments'],
    queryFn: async () =>
      unwrap(await api.GET('/cards/{key}/attachments', { params: { path: { key } } })),
  });
}
export function useAttachmentMutations(key: string) {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: cardKey(key) });
  };
  const add = useMutation<Attachment, Problem, AttachmentCreate>({
    mutationFn: async (body) =>
      unwrap(await api.POST('/cards/{key}/attachments', { params: { path: { key } }, body })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (attachmentId) =>
      ensureOk(
        await api.DELETE('/cards/{key}/attachments/{attachmentId}', {
          params: { path: { key, attachmentId } },
        }),
      ),
    onSuccess: done,
  });
  return { add, remove };
}
export function useProjectDocuments(id: string) {
  return useQuery({
    queryKey: ['projects', id, 'documents'],
    queryFn: async () =>
      unwrap(await api.GET('/projects/{id}/documents', { params: { path: { id } } })),
  });
}
export function useProjectAttachmentMutations(id: string) {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['projects', id] });
  };
  const add = useMutation<Attachment, Problem, AttachmentCreate>({
    mutationFn: async (body) =>
      unwrap(await api.POST('/projects/{id}/attachments', { params: { path: { id } }, body })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (attachmentId) =>
      ensureOk(
        await api.DELETE('/projects/{id}/attachments/{attachmentId}', {
          params: { path: { id, attachmentId } },
        }),
      ),
    onSuccess: done,
  });
  return { add, remove };
}

// ---- inbox (FR-044 / CR-15 / CR-16 / CR-19)
export type InboxGroup = components['schemas']['InboxGroupTotal']['group'];
export interface InboxFilter {
  teamId?: string;
  projectId?: string;
  assignedToMe?: boolean;
}
/**
 * One page of the inbox. Without `group` the answer is the whole filtered set newest-first and
 * carries every group's true total (CR-16), which is what the page header reads; with `group` it
 * is that section's own page.
 */
export function useInbox(filter: InboxFilter = {}, group?: InboxGroup, limit = 25) {
  const query: Record<string, string | number | boolean> = { limit };
  if (filter.teamId) query['teamId'] = filter.teamId;
  if (filter.projectId) query['projectId'] = filter.projectId;
  if (filter.assignedToMe) query['assignedToMe'] = true;
  if (group) query['group'] = group;
  return useQuery({
    queryKey: ['inbox', query],
    queryFn: async () => unwrap(await api.GET('/inbox', { params: { query } })),
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
}
export function useMarkInboxSeen() {
  return useMutation<void, Problem, void>({
    mutationFn: async () => ensureOk(await api.POST('/inbox/seen')),
  });
}
/** CR-19: opening an entry marks that entry read, without touching the "seen all" stamp. */
export function useMarkInboxRead() {
  const qc = useQueryClient();
  return useMutation<void, Problem, string[]>({
    mutationFn: async (eventIds) => ensureOk(await api.POST('/inbox/read', { body: { eventIds } })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['inbox'] });
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}
/** CR-19: everything at or before this instant leaves my inbox; the card history is untouched. */
export function useClearInbox() {
  const qc = useQueryClient();
  return useMutation<void, Problem, string>({
    mutationFn: async (before) => ensureOk(await api.POST('/inbox/clear', { body: { before } })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['inbox'] });
      await qc.invalidateQueries({ queryKey: ME_KEY });
    },
  });
}

// ---- time entries (FR-043)
export type TimeEntry = components['schemas']['TimeEntry'];
export type TimeEntryBody = components['schemas']['TimeEntryBody'];
export function useTimeEntries(key: string) {
  return useQuery({
    queryKey: [...cardKey(key), 'time'],
    queryFn: async () => unwrap(await api.GET('/cards/{key}/time', { params: { path: { key } } })),
  });
}
export function useTimeMutations(key: string) {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: cardKey(key) });
    await qc.invalidateQueries({ queryKey: BOARD_KEY });
  };
  const add = useMutation<TimeEntry, Problem, TimeEntryBody>({
    mutationFn: async (body) =>
      unwrap(await api.POST('/cards/{key}/time', { params: { path: { key } }, body })),
    onSuccess: done,
  });
  const edit = useMutation<TimeEntry, Problem, { id: string; body: TimeEntryBody }>({
    mutationFn: async ({ id, body }) =>
      unwrap(
        await api.PATCH('/cards/{key}/time/{entryId}', {
          params: { path: { key, entryId: id } },
          body,
        }),
      ),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (entryId) =>
      ensureOk(
        await api.DELETE('/cards/{key}/time/{entryId}', { params: { path: { key, entryId } } }),
      ),
    onSuccess: done,
  });
  return { add, edit, remove };
}

// ---- reports (FR-060..062)
export type ProgressRow = components['schemas']['ProgressRow'];
export function useProgressReport(q: {
  groupBy: 'project' | 'program' | 'person';
  teamId?: string;
  programId?: string;
  /** D-153: a period (both ends) - cards created or closed in it, hours logged in it. */
  from?: string;
  to?: string;
  enabled?: boolean;
}) {
  const query: Record<string, string> = { groupBy: q.groupBy };
  if (q.teamId) query['teamId'] = q.teamId;
  if (q.programId) query['programId'] = q.programId;
  if (q.from && q.to) {
    query['from'] = q.from;
    query['to'] = q.to;
  }
  return useQuery({
    queryKey: ['reports', 'progress', query],
    queryFn: async () =>
      unwrap(
        await api.GET('/reports/progress', {
          params: { query: query as { groupBy: 'project' | 'program' | 'person' } },
        }),
      ),
    enabled: q.enabled ?? true,
  });
}
export function useOverdueReport(groupBy: 'team' | 'project' | 'assignee') {
  return useQuery({
    queryKey: ['reports', 'overdue', groupBy],
    queryFn: async () =>
      unwrap(await api.GET('/reports/overdue', { params: { query: { groupBy } } })),
  });
}
