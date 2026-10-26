// Time log API hooks (D-116): my week, week note, days off, team time. Presentation only - the
// server computes every total, target and shortfall.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ensureOk, unwrap, type Problem } from '../../api/client';
import type { components } from '../../api/schema';
import type { TimeEntry, TimeEntryBody } from '../cards/api';

export type MyWeek = components['schemas']['MyWeek'];
export type TeamWeek = components['schemas']['TeamWeek'];
export type TeamMemberWeek = components['schemas']['TeamMemberWeek'];
export type TimeDay = components['schemas']['TimeDay'];
export type WeekEntry = components['schemas']['WeekEntry'];
export type DayOffKind = components['schemas']['DayOffRequest']['kind'];

const MY_TIME = ['my-time'] as const;
const TEAM_TIME = ['team-time'] as const;

/** A week (any date in it, '' = this week) or, with `month` (YYYY-MM), a calendar month. */
export function useMyWeek(week: string, month = '') {
  return useQuery({
    queryKey: [...MY_TIME, week, month],
    queryFn: async () =>
      unwrap(
        await api.GET('/me/time', {
          params: { query: month ? { month } : week ? { week } : {} },
        }),
      ),
  });
}

export function useTimeTeams() {
  return useQuery({
    queryKey: [...TEAM_TIME, 'teams'],
    queryFn: async () => unwrap(await api.GET('/time/teams')),
  });
}

export function useTeamWeek(teamId: string, week: string, month = '') {
  return useQuery({
    queryKey: [...TEAM_TIME, teamId, week, month],
    queryFn: async () =>
      unwrap(
        await api.GET('/teams/{teamId}/time', {
          params: { path: { teamId }, query: month ? { month } : week ? { week } : {} },
        }),
      ),
    enabled: teamId !== '',
  });
}

/** Writes from the My time page; every one refreshes the week (and the card for a log). */
export function useMyTimeMutations() {
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: MY_TIME });
  };
  const log = useMutation<TimeEntry, Problem, { key: string; body: TimeEntryBody }>({
    mutationFn: async ({ key, body }) =>
      unwrap(await api.POST('/cards/{key}/time', { params: { path: { key } }, body })),
    onSuccess: async (_e, { key }) => {
      await done();
      await qc.invalidateQueries({ queryKey: ['card', key] });
    },
  });
  const note = useMutation<void, Problem, { weekStart: string; note: string }>({
    mutationFn: async ({ weekStart, note }) =>
      ensureOk(
        await api.PUT('/me/time/weeks/{weekStart}/note', {
          params: { path: { weekStart } },
          body: { note },
        }),
      ),
    onSuccess: done,
  });
  const dayOff = useMutation<void, Problem, { date: string; kind: DayOffKind | '' }>({
    mutationFn: async ({ date, kind }) =>
      ensureOk(
        kind
          ? await api.PUT('/me/time/days/{date}/off', {
              params: { path: { date } },
              body: { kind },
            })
          : await api.DELETE('/me/time/days/{date}/off', { params: { path: { date } } }),
      ),
    onSuccess: done,
  });
  return { log, note, dayOff };
}

/** `2026-06` + n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** `2026-06-15` + n days, as an ISO date (UTC arithmetic, no time zone involved). */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** D-138, a UX hint only (the server decides): time on a card is logged by its assignee, a lead
 *  of its team or an admin - the same people who may move it. */
export function canLogTime(
  card: { assigneeId: string | null; teamId: string | null },
  me: { user: { id: string; role: string }; leadTeamIds: readonly string[] },
): boolean {
  if (me.user.role === 'admin') return true;
  if (card.teamId !== null && me.leadTeamIds.includes(card.teamId)) return true;
  return card.assigneeId === me.user.id;
}
