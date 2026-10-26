// `npm run test:e2e` (plan B01 task 14/15): bring up the built app image + db with Compose, run
// the three gating Chromium viewports natively, run the @smoke engines (WebKit, Firefox,
// mobile WebKit) in the official Playwright container (Windows 11 Smart App Control blocks
// Playwright's unsigned Firefox/WebKit binaries on the build machine — see
// Solution/tests/e2e/Dockerfile.smoke), then tear Compose down. Exit code = first failure.
//
//   E2E_SMOKE=docker (default on Windows/Linux) | native | hybrid (default on macOS) | skip
// hybrid (D-107): WebKit on the host, Firefox in the container - Playwright's Firefox build
// does not start on macOS 27 ("Could not find profile folder").
// Host smoke projects run in the same Playwright run as the gating ones: a second run would
// wipe test-results/ (and the gating results.json) first.
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const compose = ['compose', '-f', 'Solution/docker-compose.yml'];
const config = 'Solution/tests/e2e/playwright.config.ts';
const smokeMode = process.env.E2E_SMOKE ?? (process.platform === 'darwin' ? 'hybrid' : 'docker');
const smokeProjects = ['desktop-webkit', 'desktop-firefox', 'mobile-webkit'];
const split = {
  docker: [[], smokeProjects],
  native: [smokeProjects, []],
  hybrid: [['desktop-webkit', 'mobile-webkit'], ['desktop-firefox']],
};
const [hostSmoke, dockerSmoke] = split[smokeMode] ?? [[], []];
const gatingProjects = ['desktop-chromium', 'tablet-chromium', 'mobile-chromium', 'short-chromium'];

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  // `npm`/`npx` are .cmd shims on Windows (need a shell); docker is an .exe and must NOT go
  // through a shell, otherwise arguments with spaces (this repo's OneDrive path) split.
  const viaShell = process.platform === 'win32' && (cmd === 'npm' || cmd === 'npx');
  const r = viaShell
    ? spawnSync(`${cmd} ${args.join(' ')}`, { cwd: root, stdio: 'inherit', shell: true, ...opts })
    : spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  return r.status ?? 1;
}

let status = 0;
try {
  if (run('docker', [...compose, 'up', '-d', '--no-build', '--wait', 'app', 'db']) !== 0)
    throw new Error('compose up failed');
  // Deterministic fixture people + passwords (plan B02 task 14); idempotent, resets credentials.
  if (
    run('npm', ['run', 'db:seed:dev'], {
      env: { ...process.env, DATABASE_URL: 'postgres://app_rw:dev@localhost:5432/app' },
    }) !== 0
  )
    throw new Error('db:seed:dev failed');

  status = run(
    'npx',
    [
      'playwright',
      'test',
      '-c',
      config,
      ...[...gatingProjects, ...hostSmoke].map((p) => `--project=${p}`),
    ],
    {
      env: { ...process.env, E2E_BASE_URL: 'http://localhost:8080' },
    },
  );

  if (dockerSmoke.length > 0) {
    if (
      run('docker', [
        'build',
        '-f',
        'Solution/tests/e2e/Dockerfile.smoke',
        '-t',
        'app/e2e-smoke:local',
        '.',
      ]) !== 0
    ) {
      throw new Error('smoke image build failed');
    }
    const out = path.join(root, 'Solution/tests/e2e/test-results-smoke');
    mkdirSync(out, { recursive: true });
    const s = run('docker', [
      'run',
      '--rm',
      // Reach the Compose app through the published host port: Firefox refuses the single-label
      // host `app` on the Compose network (HTTPS-first upgrade → SSL_ERROR_UNKNOWN).
      '--add-host=host.docker.internal:host-gateway',
      '-e',
      'E2E_BASE_URL=http://host.docker.internal:8080',
      '-v',
      `${out}:/work/Solution/tests/e2e/test-results`,
      'app/e2e-smoke:local',
      ...['npx', 'playwright', 'test', '-c', config],
      ...dockerSmoke.map((p) => `--project=${p}`),
    ]);
    status ||= s;
  } else if (hostSmoke.length === 0) {
    console.log('E2E_SMOKE=skip: smoke engines not run');
  }
} catch (err) {
  console.error(err.message);
  status = 1;
} finally {
  run('docker', [...compose, 'down']);
}
process.exit(status);
