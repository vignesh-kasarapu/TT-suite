// Seed data (D-081, D-131): reads Solution/seed-data.json (or the file given as the first
// argument) and upserts people by email, teams by name, memberships, team leads and tags.
// Idempotent: re-running adds what is missing and never deletes.
//   npm run seed [-- path/to/file.json]   -> DATABASE_URL (default app_rw@localhost/app)
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

type Trial = {
  users: { name: string; email: string; role?: 'admin' | 'member' }[];
  teams?: { name: string; members: string[]; leads?: string[] }[];
  tags?: string[];
};

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(): string {
  const b = randomBytes(26);
  let out = '';
  for (let i = 0; i < 26; i++) out += ALPHABET[(b[i] as number) % 32];
  return out;
}

export async function seedTrial(url: string, file: string): Promise<void> {
  const trial = JSON.parse(readFileSync(file, 'utf8')) as Trial;
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    const now = new Date();
    const idByEmail = new Map<string, string>();
    for (const u of trial.users) {
      const email = u.email.trim().toLowerCase();
      const row = await c.query<{ id: string }>(
        `INSERT INTO app_user (id, email, name, role, external_id)
         VALUES ($1, $2, $3, $4, NULL)
         ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, status = 'active', updated_at = $5
         RETURNING id`,
        [ulid(), email, u.name.trim(), u.role ?? 'member', now],
      );
      idByEmail.set(email, (row.rows[0] as { id: string }).id);
    }
    for (const t of trial.teams ?? []) {
      const team = await c.query<{ id: string }>(
        `INSERT INTO team (id, name, description, created_at, updated_at)
         VALUES ($1, $2, '', $3, $3)
         ON CONFLICT (lower(name)) DO UPDATE SET updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [ulid(), t.name.trim(), now],
      );
      const teamId = (team.rows[0] as { id: string }).id;
      const leads = new Set((t.leads ?? []).map((e) => e.trim().toLowerCase()));
      for (const m of new Set([...t.members.map((e) => e.trim().toLowerCase()), ...leads])) {
        const userId = idByEmail.get(m);
        if (!userId) throw new Error(`team ${t.name}: ${m} is not in users[]`);
        await c.query(
          `INSERT INTO team_member (team_id, user_id, added_at, added_by, is_lead)
           VALUES ($1, $2, $3, $2, $4)
           ON CONFLICT (team_id, user_id) DO UPDATE SET is_lead = team_member.is_lead OR EXCLUDED.is_lead`,
          [teamId, userId, now, leads.has(m)],
        );
      }
    }
    for (const tag of trial.tags ?? []) {
      await c.query(
        'INSERT INTO tag (id, name) VALUES ($1, $2) ON CONFLICT (lower(name)) DO NOTHING',
        [ulid(), tag.trim()],
      );
    }
    await c.query('COMMIT');
    console.log(
      `seeded ${trial.users.length} users, ${(trial.teams ?? []).length} teams, ${(trial.tags ?? []).length} tags`,
    );
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env['DATABASE_URL'] ?? 'postgres://app_rw:dev@localhost:5432/app';
  const file = process.argv[2] ?? fileURLToPath(new URL('../../seed-data.json', import.meta.url));
  seedTrial(url, file).catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
