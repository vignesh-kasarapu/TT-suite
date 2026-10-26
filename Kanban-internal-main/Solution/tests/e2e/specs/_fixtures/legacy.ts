// CR-22: the API no longer creates a team-less org card, but the legacy ones still exist and the
// Unassigned board's "No-Team" view serves them. A spec makes one by creating a card normally and
// taking its team away in the Compose database (the same URL scripts/e2e.mjs seeds through).
import pg from 'pg';

const URL = process.env['E2E_DATABASE_URL'] ?? 'postgres://app_rw:dev@localhost:5432/app';

export async function makeTeamless(key: string): Promise<void> {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('UPDATE card SET team_id = NULL, project_id = NULL WHERE number = $1', [
      Number(key.slice(2)),
    ]);
  } finally {
    await c.end();
  }
}

/**
 * D-147: the API gives every new card a holder, and releasing one drops it to Backlog (CR-17).
 * A card nobody holds in a later column (a lead moved it on, or it predates D-147) is made the
 * same way as a team-less one: create it normally, then clear its assignee in the database.
 */
export async function makeUnheld(key: string): Promise<void> {
  const c = new pg.Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query('UPDATE card SET assignee_id = NULL WHERE number = $1', [Number(key.slice(2))]);
  } finally {
    await c.end();
  }
}
