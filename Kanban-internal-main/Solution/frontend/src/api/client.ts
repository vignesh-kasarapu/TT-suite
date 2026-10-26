// Typed API client (openapi-fetch over the generated contract types). Adds the CSRF header
// (ADR-006) and maps problem codes to strings. No business logic here: the client only
// carries what the server returns.
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema';
import { hasMessage, t } from '../i18n/t';

export interface Problem {
  type?: string;
  title?: string;
  status: number;
  code: string;
  detail?: string;
  correlationId?: string;
  errors?: { field?: string; code: string; message: string }[];
}

export const headersMiddleware: Middleware = {
  onRequest({ request }) {
    request.headers.set('X-Requested-With', 'XHR');
    // A body-less POST/DELETE must not claim application/json: Fastify answers 400 for an
    // empty JSON body (sign-out, inbox/seen).
    if (request.body === null) request.headers.delete('content-type');
    return request;
  },
};

/** Name of the window event raised when a call (other than sign-in) answers 401. */
export const UNAUTHENTICATED_EVENT = 'app:unauthenticated';

export const unauthenticatedMiddleware: Middleware = {
  async onResponse({ request, response }) {
    if (typeof window === 'undefined') return response;
    if (response.status === 401 && !request.url.includes('/auth/'))
      window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT));
    // TT Suite (SUITE-CONTRACT §3.4): signed in, but no Kanban access -> the portal dashboard.
    if (response.status === 403) {
      const body = (await response
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      if (body?.code === 'NO_APP_ACCESS') window.location.assign('/?denied=kanban');
    }
    return response;
  },
};

/** Kanban's API behind the suite gateway: `/kanban/api/v1` (Vite `base` is `/kanban/`). */
export const API_BASE = `${import.meta.env.BASE_URL}api/v1`;

export function createApi(fetchImpl?: typeof fetch, baseUrl = API_BASE) {
  const client = createClient<paths>({ baseUrl, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  client.use(headersMiddleware);
  client.use(unauthenticatedMiddleware);
  return client;
}

export const api = createApi();

/** Returns the body of an ok response or throws the Problem (or a NETWORK stand-in). */
export function unwrap<T>(res: { data?: T; error?: unknown; response: Response }): T {
  if (res.data !== undefined) return res.data;
  throw (
    asProblem(res.error) ?? {
      status: res.response.status,
      code: res.response.status ? 'HTTP_' + String(res.response.status) : 'NETWORK',
    }
  );
}

/** Throws unless the response is ok (for 202/204 operations without a body). */
export function ensureOk(res: { error?: unknown; response: Response }): void {
  if (res.response.ok) return;
  throw asProblem(res.error) ?? { status: res.response.status, code: 'NETWORK' };
}

export function asProblem(err: unknown): Problem | undefined {
  if (err && typeof err === 'object' && 'code' in err && 'status' in err) return err as Problem;
  return undefined;
}

/** Problem `code` -> externalised message. Unknown codes fall back to a generic line. */
export function problemMessage(problem: Problem | undefined): string {
  const key = problem ? `problem.${problem.code}` : 'problem.NETWORK';
  return t(hasMessage(key) ? key : 'problem.unknown');
}

/** Server `errors[]` keyed by field (first message wins), for forms that show errors by field. */
export function fieldErrorsOf(problem: Problem | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of problem?.errors ?? []) if (e.field && !out[e.field]) out[e.field] = e.message;
  return out;
}

/** What to show in a form's banner: the server's `detail` when it has one, else the mapped code. */
export function problemBanner(problem: Problem | undefined): string {
  return problem?.detail ?? problemMessage(problem);
}
