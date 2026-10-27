// Run the e2e tests against a freshly started suite:
//   1. recreate the e2e database (ttsuite_e2e; never the dev one)
//   2. start all four processes with deploy/run.py: dev sign-in, stub mail, that database
//   3. wait until every service is healthy, then run Playwright
//   4. always stop the suite again, child processes included
//
//   node e2e/run.mjs                       the repository (local)
//   node e2e/run.mjs --packaged dist-suite the built package (GitHub e2e job)
//   node e2e/run.mjs --grep invite         any other argument goes to Playwright
//
// Environment: E2E_PYTHON (runs the suite and the reset; default: the root .venv, the portal's
// .venv, then `python`), E2E_ADMIN_URL (PostgreSQL superuser, default the local Docker one).
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const e2eDir = path.join(root, 'e2e');
const outDir = path.join(root, '.ci-local');
// Our only option is `--packaged <dir>`; every other argument goes to Playwright.
const args = process.argv.slice(2).filter((a) => a !== '--');
const at = args.indexOf('--packaged');
const packagedAt = at === -1 ? null : path.resolve(root, args[at + 1] ?? 'dist-suite');
const playwrightArgs = at === -1 ? args : [...args.slice(0, at), ...args.slice(at + 2)];

const isWin = process.platform === 'win32';
const PORTS = [8000, 8002, 8003, 8004, 8005];
const BASE_URL = 'http://localhost:8000';
const DB = 'ttsuite_e2e';
const HOST = process.env.E2E_PG_HOST ?? 'localhost:5433';
const ADMIN_URL = process.env.E2E_ADMIN_URL ?? `postgresql://postgres:postgres@${HOST}/postgres`;

function python() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  const exe = isWin ? 'Scripts/python.exe' : 'bin/python';
  for (const venv of ['.venv', 'portal/backend/.venv']) {
    const candidate = path.join(root, venv, exe);
    if (existsSync(candidate)) return candidate;
  }
  return 'python';
}

function canListen(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer().once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

// The portal listens on 0.0.0.0, the apps on 127.0.0.1: check both, as either can hold a port.
const portFree = async (port) => (await canListen(port, '0.0.0.0')) && (await canListen(port, '127.0.0.1'));

function stopTree(child) {
  if (!child || child.exitCode !== null) return;
  if (isWin) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}

async function waitHealthy(child, logFile) {
  const deadline = Date.now() + 240_000;
  let last = 'no answer yet';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`the suite exited with ${child.exitCode}; see ${logFile}`);
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      const body = await res.json();
      last = JSON.stringify(body);
      if (Object.values(body.services ?? {}).every((s) => s === 'ok') && Object.keys(body.services ?? {}).length === PORTS.length) return; // portal + every app
    } catch (err) {
      last = String(err.cause?.code ?? err.message);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`the suite did not become healthy: ${last}; see ${logFile}`);
}

async function main() {
  const busy = [];
  for (const port of PORTS) if (!(await portFree(port))) busy.push(port);
  if (busy.length) {
    console.error(`Ports ${busy.join(', ')} are in use. Stop the running suite (npm run suite:run) first.`);
    return 1;
  }

  const py = python();
  const reset = spawnSync(py, [path.join(e2eDir, 'reset_db.py'), ADMIN_URL, DB, 'app_owner', 'app_rw'], { stdio: 'inherit' });
  if (reset.status !== 0) {
    console.error('Could not recreate the e2e database. Is PostgreSQL up (npm run suite:db)?');
    return 1;
  }

  mkdirSync(outDir, { recursive: true });
  const dataDir = path.join(outDir, 'e2e-data');
  rmSync(dataDir, { recursive: true, force: true });
  const logFile = path.join(outDir, 'e2e-suite.log');
  const log = createWriteStream(logFile);

  const suiteRoot = packagedAt ?? root;
  const env = {
    ...process.env,
    SUITE_ENV_FILE: 'none', // never your .env: no real mail, no real Entra
    APP_PROFILE: 'dev',
    AUTH_PROVIDER: 'dev',
    MAIL_PROVIDER: 'stub',
    PORT: '8000',
    PUBLIC_BASE_URL: BASE_URL,
    DATABASE_URL: `postgresql://app_rw:dev@${HOST}/${DB}`,
    DATABASE_OWNER_URL: `postgresql://app_owner:dev@${HOST}/${DB}`,
    INTERNAL_TOKEN: 'e2e-internal-token',
    SEED_GLOBAL_ADMIN_EMAIL: '',
    SEED_FILE: path.join(e2eDir, 'seed.json'),
    STORAGE_DIR: path.join(dataDir, 'lms'),
    UPLOAD_DIR: path.join(dataDir, 'expense', 'uploads'),
    PYTHONUNBUFFERED: '1',
  };
  console.log(`Starting the suite from ${path.relative(root, suiteRoot) || '.'} (log: ${path.relative(root, logFile)})`);
  const suite = spawn(py, [path.join(suiteRoot, 'deploy', 'run.py')], { cwd: suiteRoot, env, detached: !isWin });
  suite.stdout.pipe(log);
  suite.stderr.pipe(log);

  const stop = () => stopTree(suite);
  process.on('SIGINT', () => { stop(); process.exit(130); });
  try {
    await waitHealthy(suite, logFile);
    console.log('Suite is healthy. Running Playwright...');
    const cli = path.join(e2eDir, 'node_modules', '@playwright', 'test', 'cli.js');
    const run = spawnSync(process.execPath, [cli, 'test', ...playwrightArgs], {
      cwd: e2eDir,
      stdio: 'inherit',
      env: { ...process.env, E2E_BASE_URL: BASE_URL },
    });
    return run.status ?? 1;
  } catch (err) {
    console.error(String(err.message ?? err));
    return 1;
  } finally {
    stop();
    log.end();
  }
}

process.exitCode = await main();
