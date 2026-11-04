// `npm run suite:package`: the one folder deployed to the one App Service (B1, Linux, Python 3.13)
// with the VS Code Azure App Service extension ("Deploy to Web App..." -> dist-suite).
//
//   dist-suite/
//     requirements.txt            <- merged from the four backends; Oryx installs it once
//     deploy/run.py               <- startup command: python deploy/run.py
//     packages/suite_core/        <- shared identity library (installed from requirements.txt)
//     apps/{portal,kanban,lms,expense,ams}/ <- each backend (its `app` package, alembic, ...)
//     static/{portal,kanban,lms,expense,ams}/ <- each built SPA (served by the portal gateway)
//
// Flags: --skip-frontend (reuse existing dist folders), --skip-install (no npm install),
// --skip-apps=resume,kanban (or SUITE_SKIP=resume): leave apps out of the package entirely - their
// frontend, backend and requirements (without `resume`: no torch, spaCy or sentence-transformers).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'dist-suite');
const argv = process.argv.slice(2);
const args = new Set(argv);

const ALL_APPS = {
  portal: { backend: 'portal/backend', frontend: 'portal/frontend' },
  kanban: { backend: 'Kanban-internal-main/Solution/backend-py', frontend: 'Kanban-internal-main/Solution/frontend', workspaceRoot: 'Kanban-internal-main' },
  lms: { backend: 'lms-2.0-main/lms-2.0-main/backend-py', frontend: 'lms-2.0-main/lms-2.0-main/frontend' },
  expense: { backend: 'ems/backend', frontend: 'ems/frontend' },
  ams: { backend: 'asset-manager/backend', frontend: 'asset-manager/frontend' },
  resume: { backend: 'ResumeEvaluator-main/backend', frontend: 'ResumeEvaluator-main/frontend' },
};

// Apps left out (same names as SUITE_SKIP in deploy/run.py). The portal is never skipped.
// without-resume branch: the Resume Evaluator is left out unless SUITE_SKIP says otherwise.
const skipArg = argv.find((a) => a.startsWith('--skip-apps='))?.slice('--skip-apps='.length);
const skipped = new Set(
  (skipArg ?? process.env.SUITE_SKIP ?? 'resume').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
);
for (const name of skipped) {
  if (name === 'portal') {
    console.error('SUITE_SKIP: the portal cannot be skipped.');
    process.exit(1);
  }
  if (!ALL_APPS[name]) console.warn(`SUITE_SKIP: unknown app "${name}" ignored (known: ${Object.keys(ALL_APPS).join(', ')})`);
}
const APPS = Object.fromEntries(Object.entries(ALL_APPS).filter(([name]) => !skipped.has(name)));
if (skipped.size) console.log(`skipping: ${[...skipped].filter((n) => ALL_APPS[n]).join(', ')}`);

// npm writes node_modules/.package-lock.json on every install: older than package.json or the
// lock file means packages were added since (e.g. by a merge), so install again.
function needsInstall(dir) {
  const marker = path.join(dir, 'node_modules', '.package-lock.json');
  if (!existsSync(marker)) return true;
  const installed = statSync(marker).mtimeMs;
  return ['package.json', 'package-lock.json'].some((f) => existsSync(path.join(dir, f)) && statSync(path.join(dir, f)).mtimeMs > installed);
}

function run(cmd, cwd) {
  console.log(`> ${cmd}   (${path.relative(root, cwd) || '.'})`);
  const r = spawnSync(cmd, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`failed: ${cmd}`);
    process.exit(r.status ?? 1);
  }
}

// 1. Frontends
for (const [name, a] of Object.entries(APPS)) {
  const dir = path.join(root, a.frontend);
  if (!args.has('--skip-frontend')) {
    const installAt = a.workspaceRoot ? path.join(root, a.workspaceRoot) : dir;
    if (!args.has('--skip-install') && needsInstall(installAt)) run('npm install --no-audit --no-fund', installAt);
    run('npm run build', dir);
  }
  if (!existsSync(path.join(dir, 'dist', 'index.html'))) {
    console.error(`${a.frontend}/dist/index.html is missing - the ${name} frontend build failed.`);
    process.exit(1);
  }
}

// 2. Package
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const SKIP = /[\\/](__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv[^\\/]*|node_modules|tests|uploads|storage|data|\.env)([\\/]|$)/;
// LMS seed data is local-only (lms backend-py/seed/README.md): a package carries the
// environment-neutral reference.json and the *.example.json templates, and nothing else — a demo
// org, a company's own leave policy or a holiday list left on the build machine never travels
// with the image.
const LOCAL_SEED = /[\/]seed[\/](?!reference\.json$)(?![^\/]*\.example\.json$)[^\/]+\.json$/;
const skip = (src) => !SKIP.test(src) && !/\.pyc$/.test(src) && !/[\\/]\.env$/.test(src) && !LOCAL_SEED.test(src);

for (const [name, a] of Object.entries(APPS)) {
  cpSync(path.join(root, a.backend), path.join(out, 'apps', name), { recursive: true, filter: skip });
  cpSync(path.join(root, a.frontend, 'dist'), path.join(out, 'static', name), { recursive: true });
}
cpSync(path.join(root, 'packages/suite_core'), path.join(out, 'packages/suite_core'), { recursive: true, filter: skip });
cpSync(path.join(root, 'deploy/run.py'), path.join(out, 'deploy/run.py'));

// 3. One requirements.txt: first pin wins in the order portal, kanban, lms, expense, ams (the portal
//    and Kanban pins are the reference, D-109); every disagreement is printed for review.
const pins = new Map();
const conflicts = [];
const options = new Set(); // pip options such as --extra-index-url: once each, at the top
const norm = (n) => n.toLowerCase().replace(/[-_.]+/g, '-').replace(/\[.*\]/, '');
for (const [name, a] of Object.entries(APPS)) {
  const file = path.join(root, a.backend, 'requirements.txt');
  if (!existsSync(file)) continue;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || line.startsWith('-e') || line.startsWith('-r') || line.includes('suite_core') || line.includes('suite-core')) continue;
    if (line.startsWith('--')) {
      options.add(line.replace(/\s+/g, ' '));
      continue;
    }
    const m = line.match(/^([A-Za-z0-9_.\-\[\],]+)\s*(.*)$/);
    if (!m) continue;
    const key = norm(m[1]);
    const extras = (m[1].match(/\[(.*)\]/)?.[1] ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    if (!pins.has(key)) {
      pins.set(key, { name: m[1].replace(/\[.*\]/, ''), spec: line.slice(m[1].length), extras: new Set(extras), from: name, line });
      continue;
    }
    const kept = pins.get(key);
    for (const e of extras) kept.extras.add(e); // keep what every backend asks for (e.g. uvicorn[standard])
    const sameVersion = kept.spec.replace(/\s/g, '') === line.slice(m[1].length).replace(/\s/g, '');
    if (!sameVersion) conflicts.push(`${key}: ${kept.from} "${kept.line}" kept over ${name} "${line}"`);
  }
}
const pinLine = (p) => `${p.name}${p.extras.size ? `[${[...p.extras].sort().join(',')}]` : ''}${p.spec}`;
const merged = [
  '# Generated by deploy/build.mjs - do not edit. Merged from every backend (first version kept, extras combined).',
  ...options,
  ...[...pins.values()].map(pinLine).sort((x, y) => x.localeCompare(y)),
  './packages/suite_core',
  '',
].join('\n');
writeFileSync(path.join(out, 'requirements.txt'), merged);
writeFileSync(
  path.join(out, 'README.txt'),
  'Built by `npm run suite:package` - do not edit. Deploy this folder to the App Service.\n' +
    'Startup command: python deploy/run.py\nSee deploy/README.md in the repository for the settings.\n',
);
if (conflicts.length) {
  console.log('\nrequirement pins that differ between backends (first kept):');
  for (const c of conflicts) console.log(`  - ${c}`);
}
console.log(`\nsuite:package -> ${path.relative(root, out)} (deploy this folder; startup: python deploy/run.py)`);
