// Every notification LMS sends must open somewhere the user can see what it is about
// (src/utils/notificationDestinations.js). Runs before `vite build`; fails on a notification
// key with no entry there, so a new notification cannot silently fall back to My Requests.
//
//   node scripts/check-notification-links.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '../../backend-py');
const { DESTINATIONS } = await import(pathToFileURL(path.resolve(here, '../src/utils/notificationDestinations.js')).href);

const keys = new Set();
// The templates (email + in-app) ...
const reference = JSON.parse(readFileSync(path.join(backend, 'seed/reference.json'), 'utf8'));
for (const t of reference.notification_templates) keys.add(t.key);
// ... and in-app notifications sent with a key in the code (template_key="X", or advance LOP's helper).
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = path.join(dir, name);
  if (name === '__pycache__') return [];
  return statSync(full).isDirectory() ? walk(full) : full.endsWith('.py') ? [full] : [];
});
for (const file of walk(path.join(backend, 'app'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/template_key="([A-Z_]+)"/g)) keys.add(m[1]);
  for (const m of text.matchAll(/_tell_both\(\s*db,\s*request,\s*"([A-Z_]+)"/g)) keys.add(m[1]);
}

const missing = [...keys].filter((k) => !(k in DESTINATIONS)).sort();
if (missing.length) {
  console.error(`Notifications with no destination in src/utils/notificationDestinations.js: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`notification links: all ${keys.size} notifications have a destination`);
