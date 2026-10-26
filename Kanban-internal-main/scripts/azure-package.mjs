// `npm run azure:package` (D-128): the folder the VS Code Azure App Service extension deploys to a
// Linux Python 3.13 web app ("Deploy to Web App..." -> dist-azure, see .vscode/settings.json).
//
//   dist-azure/
//     requirements.txt              <- at the root, so the App Service build (Oryx) installs it
//     Solution/backend-py/app, alembic, alembic.ini
//     Solution/frontend/dist        <- the built SPA, where the backend looks for it (as in Docker)
//
// Startup command on the web app: `cd Solution/backend-py && python -m app` (migrates, then serves).
// Steps and settings: Solution/docs/azure-code-deploy.md.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'dist-azure');
const backend = path.join(root, 'Solution/backend-py');

const build = spawnSync('npm run build -w Solution/frontend', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const skip = (src) =>
  !/[\\/](__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache)([\\/]|$)/.test(src);
for (const part of ['app', 'alembic', 'alembic.ini'])
  cpSync(path.join(backend, part), path.join(out, 'Solution/backend-py', part), {
    recursive: true,
    filter: skip,
  });
cpSync(path.join(backend, 'requirements.txt'), path.join(out, 'requirements.txt'));
const dist = path.join(root, 'Solution/frontend/dist');
if (!existsSync(path.join(dist, 'index.html'))) {
  console.error('Solution/frontend/dist/index.html is missing - the frontend build failed.');
  process.exit(1);
}
cpSync(dist, path.join(out, 'Solution/frontend/dist'), { recursive: true });
writeFileSync(
  path.join(out, 'README.txt'),
  'Built by `npm run azure:package` - do not edit. Deploy this folder with the Azure App ' +
    'Service extension.\nStartup command: cd Solution/backend-py && python -m app\n',
);
console.log(`azure:package -> ${path.relative(root, out)} (deploy this folder)`);
