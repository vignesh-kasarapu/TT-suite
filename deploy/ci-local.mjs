// `npm run ci:local`: the GitHub pipeline (.github/workflows) on this machine, stage by stage.
//
//   1. database   local PostgreSQL in Docker (deploy/docker-compose.yml, port 5433)
//   2. backends   pytest for suite_core, portal, Kanban, LMS and EMS
//   3. build      the four frontends + dist-suite/ (deploy/build.mjs)
//   4. e2e        the whole suite in a browser (e2e/run.mjs: own database, stub mail)
//
// A failing backend does not stop the others; e2e needs a database and a build.
// Flags: --skip-db --skip-backends --skip-build --skip-e2e; anything after `--` goes to Playwright.
// Output: a summary here and in .ci-local/summary.md, each stage's log in .ci-local/.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, '.ci-local');
const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const flags = new Set(dash === -1 ? argv : argv.slice(0, dash));
const playwrightArgs = dash === -1 ? [] : argv.slice(dash + 1);
const isWin = process.platform === 'win32';
const exe = isWin ? 'Scripts/python.exe' : 'bin/python';

// Each backend's tests with the first Python environment that exists (same rule as run.py).
const BACKENDS = [
  { name: 'suite_core', dir: 'packages/suite_core', venvs: ['.venv-core', '.venv', 'portal/backend/.venv'] },
  { name: 'portal', dir: 'portal/backend', venvs: ['portal/backend/.venv', '.venv'] },
  { name: 'kanban', dir: 'Kanban-internal-main/Solution/backend-py', venvs: ['Kanban-internal-main/Solution/backend-py/.venv-suite', 'Kanban-internal-main/Solution/backend-py/.venv', '.venv'] },
  { name: 'lms', dir: 'lms-2.0-main/lms-2.0-main/backend-py', venvs: ['lms-2.0-main/lms-2.0-main/backend-py/.venv-suite', 'lms-2.0-main/lms-2.0-main/backend-py/.venv', '.venv'] },
  { name: 'expense', dir: 'ems/backend', venvs: ['ems/backend/.venv-suite', 'ems/backend/.venv', '.venv'] },
];
const TEST_ENV = {
  PYTHONPATH: path.join(root, 'packages', 'suite_core'),
  // Kanban's tests (tests/conftest.py) on the suite's PostgreSQL; ignored by the others.
  TEST_PG_HOST: 'localhost:5433',
  TEST_ADMIN_URL: 'postgresql://postgres:postgres@localhost:5433/postgres',
  TEST_TEMPLATE_DB: 'kanban_template',
  TEST_DB_PREFIX: 'kanban_',
};

const results = [];

function pythonFor(venvs) {
  for (const v of venvs) {
    const p = path.join(root, v, exe);
    if (existsSync(p)) return p;
  }
  return 'python';
}

/** Run a command; `log` captures its output to .ci-local/<log> (shown on failure), else it streams. */
function run(cmd, cmdArgs, { cwd = root, env = {}, log } = {}) {
  // Windows needs a shell for npm/npx/docker; the line is then passed whole (our own arguments).
  const shell = isWin && !cmd.endsWith('.exe');
  const r = spawnSync(shell ? [cmd, ...cmdArgs].join(' ') : cmd, shell ? [] : cmdArgs, {
    cwd,
    env: { ...process.env, ...env },
    shell,
    encoding: 'utf8',
    stdio: log ? 'pipe' : 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (log) writeFileSync(path.join(out, log), text);
  return { ok: r.status === 0, text };
}

function stage(name, fn) {
  console.log(`\n=== ${name} ===`);
  const started = Date.now();
  let outcome;
  try {
    outcome = fn();
  } catch (err) {
    outcome = { ok: false, note: String(err.message ?? err) };
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  results.push({ name, ok: outcome.ok, skipped: outcome.skipped, note: outcome.note ?? '', seconds });
  console.log(`${outcome.skipped ? 'SKIPPED' : outcome.ok ? 'PASSED' : 'FAILED'}: ${name} (${seconds}s)${outcome.note ? ` - ${outcome.note}` : ''}`);
  return outcome.ok;
}

const tail = (text, lines = 40) => text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
const skipped = (note) => ({ ok: true, skipped: true, note });

mkdirSync(out, { recursive: true });

const dbOk = flags.has('--skip-db')
  ? (stage('database', () => skipped('--skip-db')), true)
  : stage('database', () => {
      const r = run('docker', ['compose', '-f', 'deploy/docker-compose.yml', 'up', '-d', '--wait'], { log: 'database.log' });
      if (!r.ok) console.log(tail(r.text));
      return { ok: r.ok, note: r.ok ? 'PostgreSQL on localhost:5433' : 'is Docker Desktop running?' };
    });

for (const b of BACKENDS) {
  stage(`backend: ${b.name}`, () => {
    if (flags.has('--skip-backends')) return skipped('--skip-backends');
    if (!dbOk) return { ok: false, note: 'no database' };
    if (!existsSync(path.join(root, b.dir))) return { ok: false, note: `${b.dir} is missing (README, "Get the code")` };
    const py = pythonFor(b.venvs);
    const r = run(py, ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'], { cwd: path.join(root, b.dir), env: TEST_ENV, log: `backend-${b.name}.log` });
    const summary = r.text.trimEnd().split(/\r?\n/).filter((l) => /passed|failed|error/i.test(l)).pop() ?? '';
    if (!r.ok) console.log(tail(r.text));
    return { ok: r.ok, note: summary.replace(/=+/g, '').trim() };
  });
}

const buildOk = stage('build', () => {
  if (flags.has('--skip-build')) return existsSync(path.join(root, 'dist-suite', 'static', 'portal', 'index.html')) ? skipped('--skip-build (using the existing dist-suite)') : { ok: false, note: '--skip-build but there is no dist-suite yet' };
  const r = run('node', ['deploy/build.mjs'], { log: 'build.log' });
  if (!r.ok) console.log(tail(r.text));
  return { ok: r.ok, note: r.ok ? 'dist-suite/ ready' : 'see .ci-local/build.log' };
});

stage('e2e', () => {
  if (flags.has('--skip-e2e')) return skipped('--skip-e2e');
  if (!dbOk || !buildOk) return { ok: false, note: 'needs the database and the build' };
  const e2e = path.join(root, 'e2e');
  if (!existsSync(path.join(e2e, 'node_modules', '@playwright', 'test'))) {
    const install = run('npm', [existsSync(path.join(e2e, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd: e2e });
    if (!install.ok) return { ok: false, note: 'npm install in e2e/ failed' };
  }
  const cli = path.join(e2e, 'node_modules', '@playwright', 'test', 'cli.js');
  if (!run(process.execPath, [cli, 'install', 'chromium'], { cwd: e2e }).ok) return { ok: false, note: 'could not install the Playwright browser' };
  const r = run(process.execPath, ['e2e/run.mjs', '--', ...playwrightArgs]);
  return { ok: r.ok, note: r.ok ? 'report: e2e/playwright-report/index.html' : 'report: npm run e2e:report' };
});

const failed = results.filter((r) => !r.ok);
const lines = [
  '| Stage | Result | Time | Notes |',
  '|---|---|---|---|',
  ...results.map((r) => `| ${r.name} | ${r.skipped ? 'skipped' : r.ok ? 'passed' : '**FAILED**'} | ${r.seconds}s | ${r.note} |`),
];
writeFileSync(path.join(out, 'summary.md'), `# ci:local ${new Date().toISOString()}\n\n${lines.join('\n')}\n`);
console.log(`\n${lines.join('\n')}\n`);
console.log(failed.length ? `${failed.length} stage(s) failed. Logs: .ci-local/` : 'All stages passed.');
process.exitCode = failed.length ? 1 : 0;
