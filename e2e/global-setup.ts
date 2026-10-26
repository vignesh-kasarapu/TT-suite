import { request, type FullConfig } from '@playwright/test';
import { ADMIN, XHR } from './support/suite';

/** Wait until the suite answers and the seeded admin holds admin in every app (the portal seeds
 * in the background, retrying until each app is listening). */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:8000';
  const api = await request.newContext({ baseURL });
  const deadline = Date.now() + 180_000;
  let last = 'no answer';
  try {
    while (Date.now() < deadline) {
      try {
        const signIn = await api.post('/api/auth/dev/sign-in', { data: { email: ADMIN }, headers: XHR });
        if (signIn.status() === 204) {
          const me = await (await api.get('/api/me')).json();
          if (Object.values(me.access).every((role) => role === 'admin')) return;
          last = `admin access so far: ${JSON.stringify(me.access)}`;
        } else {
          last = `sign-in answered ${signIn.status()}`;
        }
      } catch (err) {
        last = String(err);
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new Error(`The suite at ${baseURL} is not ready: ${last}`);
  } finally {
    await api.dispose();
  }
}
