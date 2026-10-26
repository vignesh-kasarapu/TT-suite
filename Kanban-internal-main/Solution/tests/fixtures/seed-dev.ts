// Deterministic dev/test fixture users. Idempotent: re-running resets every fixture row.
//   npm run db:seed:dev   -> DATABASE_URL (default app_rw@localhost/app)
//   seedDev(url)       -> from integration tests (per-file database)
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import pg from 'pg';

/** Stable, contract-valid ULID-shaped id per fixture code (sha256 -> Crockford base32). */
export function fixtureId(code: string): string {
  const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const h = createHash('sha256').update(`fixture:${code}`).digest();
  let out = '';
  for (let i = 0; i < 26; i++) out += ALPHABET[(h[i] as number) % 32];
  return out;
}

export interface FixtureUser {
  code: string;
  name: string;
  role: 'member' | 'admin';
  status?: 'active' | 'inactive';
}

export const USERS: readonly FixtureUser[] = [
  { code: 'ADMIN', name: 'Asha Admin', role: 'admin' },
  { code: 'M1', name: 'Meera Member', role: 'member' },
  { code: 'M2', name: 'Mohan Member', role: 'member' },
  { code: 'GONE', name: 'Gone Person', role: 'member', status: 'inactive' },
];

/** Fixture teams (S2): Platform = M1, Web = M2; ADMIN belongs to no team (D-012 tests). */
export const TEAMS: readonly { code: string; name: string; members: string[] }[] = [
  { code: 'TEAM_PLATFORM', name: 'Platform', members: ['M1'] },
  { code: 'TEAM_WEB', name: 'Web', members: ['M2'] },
];

/** Fixture tag vocabulary (D-062): what the tests and the trial start with. */
export const TAGS: readonly string[] = ['urgent', 'e2e', 'idea', 'keep', 'zzfind', 'docs', 'bug'];

export function emailOf(code: string): string {
  return `${code.toLowerCase()}@example.test`;
}

export async function seedDev(url: string): Promise<void> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    for (const u of USERS) {
      // The boot seed may already own a fixture email under another id: re-key it to the fixture id.
      const args = [emailOf(u.code), fixtureId(u.code)];
      await c.query(
        'DELETE FROM session WHERE user_id IN (SELECT id FROM app_user WHERE lower(email) = $1 AND id <> $2)',
        args,
      );
      await c.query(
        'DELETE FROM user_preference WHERE user_id IN (SELECT id FROM app_user WHERE lower(email) = $1 AND id <> $2)',
        args,
      );
      await c.query('DELETE FROM app_user WHERE lower(email) = $1 AND id <> $2', args);
      await c.query(
        `INSERT INTO app_user (id, email, name, role, status, external_id)
         VALUES ($1, $2, $3, $4, $5, NULL)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
           role = EXCLUDED.role, status = EXCLUDED.status, updated_at = now()`,
        [fixtureId(u.code), emailOf(u.code), u.name, u.role, u.status ?? 'active'],
      );
    }
    await c.query('DELETE FROM user_preference WHERE user_id = ANY($1)', [
      USERS.map((u) => fixtureId(u.code)),
    ]);
    for (const name of TAGS)
      await c.query(
        // A tag of that name may already exist (backfilled by 0005_tags): keep it and its id.
        `INSERT INTO tag (id, name) VALUES ($1, $2) ON CONFLICT (lower(name)) DO NOTHING`,
        [fixtureId(`TAG_${name}`), name],
      );
    for (const t of TEAMS) {
      await c.query(
        `INSERT INTO team (id, name) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
        [fixtureId(t.code), t.name],
      );
      await c.query('DELETE FROM team_member WHERE team_id = $1', [fixtureId(t.code)]);
      for (const m of t.members)
        await c.query(
          'INSERT INTO team_member (team_id, user_id, added_at, added_by) VALUES ($1, $2, now(), $3)',
          [fixtureId(t.code), fixtureId(m), fixtureId('ADMIN')],
        );
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    await c.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env['DATABASE_URL'] ?? 'postgres://app_rw:dev@localhost:5432/app';
  seedDev(url).then(
    () =>
      console.log(
        `seeded ${USERS.length} fixture users, ${TEAMS.length} teams, ${TAGS.length} tags`,
      ),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}
