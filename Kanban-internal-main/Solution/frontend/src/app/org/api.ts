// Org-plane API hooks: teams, programs, projects, users, trees, org events. Presentation only.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureOk, unwrap, type Problem } from '../../api/client';
import type { components } from '../../api/schema';

export type Team = components['schemas']['Team'];
export type TeamDetail = components['schemas']['TeamDetail'];
export type TeamRef = components['schemas']['TeamRef'];
export type Program = components['schemas']['Program'];
export type ProgramDetail = components['schemas']['ProgramDetail'];
export type Project = components['schemas']['Project'];
export type UserRef = components['schemas']['UserRef'];
export type OrgEvent = components['schemas']['OrgEvent'];
export type DependencyTree = components['schemas']['DependencyTree'];
export type Tag = components['schemas']['Tag'];
export type ProjectClosure = components['schemas']['CloseProjectRequest'];

export const TEAMS_KEY = ['teams'] as const;
export const PROGRAMS_KEY = ['programs'] as const;
export const PROJECTS_KEY = ['projects'] as const;
export const USERS_KEY = ['users'] as const;
export const TAGS_KEY = ['tags'] as const;

export function useTeams() {
  return useQuery({ queryKey: TEAMS_KEY, queryFn: async () => unwrap(await api.GET('/teams')) });
}
export function useTeam(id: string) {
  return useQuery({
    queryKey: [...TEAMS_KEY, id],
    queryFn: async () => unwrap(await api.GET('/teams/{id}', { params: { path: { id } } })),
    enabled: id !== '',
  });
}
export function usePrograms() {
  return useQuery({
    queryKey: PROGRAMS_KEY,
    queryFn: async () => unwrap(await api.GET('/programs')),
  });
}
export function useProgram(id: string) {
  return useQuery({
    queryKey: [...PROGRAMS_KEY, id],
    queryFn: async () => unwrap(await api.GET('/programs/{id}', { params: { path: { id } } })),
  });
}
export function useProjects(
  filter: { teamId?: string; programId?: string; includeClosed?: boolean } = {},
) {
  const query: Record<string, string | boolean> = {};
  if (filter.teamId) query['teamId'] = filter.teamId;
  if (filter.programId) query['programId'] = filter.programId;
  // CR-12: closed projects are off every list and picker unless asked for.
  if (filter.includeClosed) query['includeClosed'] = true;
  return useQuery({
    queryKey: [...PROJECTS_KEY, query],
    queryFn: async () => unwrap(await api.GET('/projects', { params: { query } })),
  });
}
export function useProject(id: string) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, id],
    queryFn: async () => unwrap(await api.GET('/projects/{id}', { params: { path: { id } } })),
  });
}
export function useUsers() {
  return useQuery({ queryKey: USERS_KEY, queryFn: async () => unwrap(await api.GET('/users')) });
}
/** D-083: admins see invited and inactive people too. */
export function useAllUsers() {
  return useQuery({
    queryKey: [...USERS_KEY, 'all'],
    queryFn: async () => unwrap(await api.GET('/users', { params: { query: { status: 'all' } } })),
  });
}
export function useTags() {
  return useQuery({ queryKey: TAGS_KEY, queryFn: async () => unwrap(await api.GET('/tags')) });
}
export function useTree(kind: 'projects' | 'programs', id: string) {
  return useQuery({
    queryKey: [kind, id, 'tree'],
    queryFn: async () =>
      unwrap(
        kind === 'projects'
          ? await api.GET('/projects/{id}/tree', { params: { path: { id } } })
          : await api.GET('/programs/{id}/tree', { params: { path: { id } } }),
      ),
  });
}
export function useOrgEvents(kind: 'teams' | 'programs' | 'projects', id: string) {
  return useQuery({
    queryKey: [kind, id, 'events'],
    queryFn: async () => {
      const params = { path: { id }, query: { limit: 100 } };
      if (kind === 'teams') return unwrap(await api.GET('/teams/{id}/events', { params }));
      if (kind === 'programs') return unwrap(await api.GET('/programs/{id}/events', { params }));
      return unwrap(await api.GET('/projects/{id}/events', { params }));
    },
  });
}

function useInvalidateOrg() {
  const qc = useQueryClient();
  return async () => {
    await Promise.all(
      [TEAMS_KEY, PROGRAMS_KEY, PROJECTS_KEY, USERS_KEY, TAGS_KEY, ['me'], ['board'], ['card']].map(
        (k) => qc.invalidateQueries({ queryKey: k }),
      ),
    );
  };
}

type TeamCreate = components['schemas']['CreateTeamRequest'];
type TeamPatch = components['schemas']['UpdateTeamRequest'];
type ProgramCreate = components['schemas']['CreateProgramRequest'];
type ProgramPatch = components['schemas']['UpdateProgramRequest'];
type ProjectCreate = components['schemas']['CreateProjectRequest'];
type ProjectPatch = components['schemas']['UpdateProjectRequest'];

export function useTeamMutations() {
  const done = useInvalidateOrg();
  const create = useMutation<TeamDetail, Problem, TeamCreate>({
    mutationFn: async (body) => unwrap(await api.POST('/teams', { body })),
    onSuccess: done,
  });
  const update = useMutation<TeamDetail, Problem, { id: string; body: TeamPatch }>({
    mutationFn: async ({ id, body }) =>
      unwrap(await api.PATCH('/teams/{id}', { params: { path: { id } }, body })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (id) =>
      ensureOk(await api.DELETE('/teams/{id}', { params: { path: { id } } })),
    onSuccess: done,
  });
  const addMember = useMutation<void, Problem, { id: string; userId: string }>({
    mutationFn: async ({ id, userId }) =>
      ensureOk(await api.PUT('/teams/{id}/members/{userId}', { params: { path: { id, userId } } })),
    onSuccess: done,
  });
  const removeMember = useMutation<
    { reassigned: number; released: number },
    Problem,
    { id: string; userId: string; reassignments: { key: string; assigneeId: string }[] }
  >({
    mutationFn: async ({ id, userId, reassignments }) =>
      unwrap(
        await api.POST('/teams/{id}/members/{userId}/removal', {
          params: { path: { id, userId } },
          body: { reassignments },
        }),
      ),
    onSuccess: done,
  });
  // CR-11: admins only; the server refuses anyone else.
  const setLead = useMutation<void, Problem, { id: string; userId: string; isLead: boolean }>({
    mutationFn: async ({ id, userId, isLead }) =>
      ensureOk(
        await api.PATCH('/teams/{id}/members/{userId}', {
          params: { path: { id, userId } },
          body: { isLead },
        }),
      ),
    onSuccess: done,
  });
  return { create, update, remove, addMember, removeMember, setLead };
}

export function useProgramMutations() {
  const done = useInvalidateOrg();
  const create = useMutation<ProgramDetail, Problem, ProgramCreate>({
    mutationFn: async (body) => unwrap(await api.POST('/programs', { body })),
    onSuccess: done,
  });
  const update = useMutation<ProgramDetail, Problem, { id: string; body: ProgramPatch }>({
    mutationFn: async ({ id, body }) =>
      unwrap(await api.PATCH('/programs/{id}', { params: { path: { id } }, body })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (id) =>
      ensureOk(await api.DELETE('/programs/{id}', { params: { path: { id } } })),
    onSuccess: done,
  });
  return { create, update, remove };
}

export function useProjectMutations() {
  const done = useInvalidateOrg();
  const create = useMutation<Project, Problem, ProjectCreate>({
    mutationFn: async (body) => unwrap(await api.POST('/projects', { body })),
    onSuccess: done,
  });
  const update = useMutation<Project, Problem, { id: string; body: ProjectPatch }>({
    mutationFn: async ({ id, body }) =>
      unwrap(await api.PATCH('/projects/{id}', { params: { path: { id } }, body })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (id) =>
      ensureOk(await api.DELETE('/projects/{id}', { params: { path: { id } } })),
    onSuccess: done,
  });
  // CR-12
  const close = useMutation<Project, Problem, { id: string; body: ProjectClosure }>({
    mutationFn: async ({ id, body }) =>
      unwrap(await api.POST('/projects/{id}/closure', { params: { path: { id } }, body })),
    onSuccess: done,
  });
  const reopen = useMutation<Project, Problem, string>({
    mutationFn: async (id) =>
      unwrap(await api.DELETE('/projects/{id}/closure', { params: { path: { id } } })),
    onSuccess: done,
  });
  return { create, update, remove, close, reopen };
}

export function useTagMutations() {
  const done = useInvalidateOrg();
  const create = useMutation<Tag, Problem, string>({
    mutationFn: async (name) => unwrap(await api.POST('/tags', { body: { name } })),
    onSuccess: done,
  });
  const rename = useMutation<Tag, Problem, { id: string; name: string }>({
    mutationFn: async ({ id, name }) =>
      unwrap(await api.PATCH('/tags/{id}', { params: { path: { id } }, body: { name } })),
    onSuccess: done,
  });
  const remove = useMutation<void, Problem, string>({
    mutationFn: async (id) =>
      ensureOk(await api.DELETE('/tags/{id}', { params: { path: { id } } })),
    onSuccess: done,
  });
  return { create, rename, remove };
}

export function useUserMutations() {
  const done = useInvalidateOrg();
  const update = useMutation<
    UserRef,
    Problem,
    { id: string; role?: 'member' | 'admin'; status?: 'active' | 'inactive' }
  >({
    mutationFn: async ({ id, ...body }) =>
      unwrap(await api.PATCH('/users/{id}', { params: { path: { id } }, body })),
    onSuccess: done,
  });
  const invite = useMutation<UserRef, Problem, UserInvite>({
    mutationFn: async (body) => unwrap(await api.POST('/users', { body })),
    onSuccess: done,
  });
  const resend = useMutation<void, Problem, string>({
    mutationFn: async (id) =>
      ensureOk(await api.POST('/users/{id}/invite', { params: { path: { id } } })),
  });
  return { update, invite, resend };
}
export type UserInvite = components['schemas']['InviteUserRequest'];
export function useDirectory(q: string) {
  return useQuery({
    queryKey: ['directory', q],
    queryFn: async () => unwrap(await api.GET('/users/directory', { params: { query: { q } } })),
    enabled: q.trim().length >= 2,
    retry: false,
    staleTime: 60_000,
  });
}
