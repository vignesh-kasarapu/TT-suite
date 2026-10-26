// `node scripts/py.mjs <python args>`: runs the backend's Python (Solution/backend-py/.venv,
// created by `python -m venv .venv && pip install -r requirements-dev.txt`) with that folder as
// the working directory, so npm scripts work the same on Windows, macOS and the CI runner.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = path.join(
  path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  'Solution/backend-py',
);
const venv = path.join(
  backend,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
if (!existsSync(venv)) {
  console.error(
    `No Python environment at ${venv}.\nCreate it: cd Solution/backend-py && python -m venv .venv && .venv/${process.platform === 'win32' ? 'Scripts' : 'bin'}/pip install -r requirements-dev.txt`,
  );
  process.exit(1);
}
const r = spawnSync(venv, process.argv.slice(2), { cwd: backend, stdio: 'inherit' });
process.exit(r.status ?? 1);
