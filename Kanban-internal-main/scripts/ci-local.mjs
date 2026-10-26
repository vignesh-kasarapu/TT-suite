// `npm run ci:local -- [--stage S1] [--report-only] [--continue] [--quick]`: runs the
// local CI chain step by step, tees every step's output to Outputs/TestEvidence/<stage>/logs/,
// collects pass/fail counts from the Vitest and Playwright JSON reports, and writes the
// evidence summary (Outputs/TestEvidence/<stage>/summary.md — the `report` step, TC-031).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const stage = args.includes('--stage')
  ? args[args.indexOf('--stage') + 1]
  : (process.env.BUILD_STAGE ?? 'S1');
const reportOnly = args.includes('--report-only');
// --continue: keep running after a gating failure so the report shows every step (the exit
// code and the GREEN/RED verdict still reflect the failure).
const continueOnFailure = args.includes('--continue');
// --quick (D-087): lint, types, unit and integration only - no image build, no e2e - for a fast
// check of a cosmetic change. It is not the gate: it writes no summary and no results file, and
// the full chain still runs before every commit.
const quick = args.includes('--quick');
const QUICK_STEPS = [
  'contract:check',
  'lint',
  'format',
  'typecheck',
  'py:lint',
  'test:unit',
  'db:up',
  'py:test',
];
const evidenceDir = path.join(root, 'Outputs/TestEvidence', stage);
const logDir = path.join(evidenceDir, 'logs');
const resultsFile = path.join(evidenceDir, 'ci-results.json');
const e2eDir = path.join(root, 'Solution/tests/e2e');
mkdirSync(logDir, { recursive: true });

const STEPS = [
  // The contract is FastAPI's generated OpenAPI; the committed copy must match it (D-109).
  { name: 'contract:check', cmd: 'npm run contract:check' },
  { name: 'lint', cmd: 'npm run lint' },
  { name: 'format', cmd: 'npm run format' },
  { name: 'typecheck', cmd: 'npm run typecheck' },
  { name: 'py:lint', cmd: 'npm run py:lint' }, // ruff, ruff format, mypy --strict
  {
    name: 'test:unit',
    cmd: `npx vitest run --project unit --reporter=default --reporter=json --outputFile="${path.join(logDir, 'vitest-unit.json')}"`,
  },
  { name: 'db:up', cmd: 'npm run db:up' },
  // Backend unit + integration + migrations (pytest, one database per module).
  {
    name: 'py:test',
    cmd: `node scripts/py.mjs -m pytest -q --junitxml="${path.join(logDir, 'pytest.xml')}"`,
  },
  { name: 'build', cmd: 'npm run build' },
  { name: 'image:build', cmd: 'npm run image:build' },
  // D-098: the e2e suite shares the Compose `app` database, which outlives a run, and every spec
  // leaves its cards and teams behind (2,450 cards by 2026-09-25 - boards slow enough to time out).
  // Start each e2e run from an empty database: test:e2e brings db + app back up, the app migrates
  // itself at boot and the fixture seed runs. Compose project `app` only - the trial is
  // `kanban-trial` and is never touched. ~20-30 s.
  { name: 'e2e:reset', cmd: 'docker compose -f Solution/docker-compose.yml down -v' },
  { name: 'test:e2e', cmd: 'npm run test:e2e' },
  { name: 'scan', cmd: 'npm run scan', gating: false },
];

function runStep(step) {
  const started = Date.now();
  console.log(`\n=== ${step.name} ===`);
  const r = spawnSync(step.cmd, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(output);
  writeFileSync(path.join(logDir, `${step.name.replace(':', '-')}.log`), output);
  const status = r.status ?? 1;
  return {
    name: step.name,
    status,
    gating: step.gating !== false,
    durationMs: Date.now() - started,
    passed: status === 0,
  };
}

function vitestCounts(file) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return {
    total: j.numTotalTests,
    passed: j.numPassedTests,
    failed: j.numFailedTests,
    skipped: j.numPendingTests + (j.numTodoTests ?? 0),
  };
}

function playwrightCounts(file) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const perProject = {};
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        const p = (perProject[t.projectName] ??= {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          titles: [],
        });
        p.total++;
        if (t.status === 'expected') p.passed++;
        else if (t.status === 'skipped') p.skipped++;
        else p.failed++;
        p.titles.push(`${spec.title} — ${t.status === 'expected' ? 'pass' : t.status}`);
      }
    }
    for (const s of suite.suites ?? []) visit(s);
  };
  for (const s of j.suites ?? []) visit(s);
  return perProject;
}

/** pytest's JUnit XML: counts and `name — status` per test. */
function pytestResults(file) {
  if (!existsSync(file)) return null;
  const xml = readFileSync(file, 'utf8');
  const titles = [];
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const m of xml.matchAll(
    /<testcase classname="([^"]*)" name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g,
  )) {
    const body = m[4] ?? '';
    const status = /<(failure|error)/.test(body)
      ? 'failed'
      : /<skipped/.test(body)
        ? 'skipped'
        : 'passed';
    counts.total++;
    counts[status]++;
    titles.push(`${m[1]}::${m[2]} — ${status}`);
  }
  return { counts, titles };
}

function tcIds(titles) {
  const ids = new Set();
  for (const t of titles)
    for (const m of t.matchAll(/TC-(\d{3})(?:\/(\d{3}))*/g)) {
      // "TC-007/008/009" → TC-007, TC-008, TC-009
      const parts = m[0].slice(3).split('/');
      for (const p of parts) ids.add(`TC-${p}`);
    }
  return [...ids].sort();
}

function vitestTitles(file) {
  if (!existsSync(file)) return [];
  const j = JSON.parse(readFileSync(file, 'utf8'));
  const out = [];
  for (const f of j.testResults ?? [])
    for (const a of f.assertionResults ?? []) out.push(`${a.fullName} — ${a.status}`);
  return out;
}

/** Runs the app-builder CLI `verify-tests` (frozen test-case check) and reports its real output. */
function verifyTests() {
  const cli =
    process.env.APP_BUILDER_CLI ??
    'C:/Users/vinna/.claude/plugins/cache/vinna-local/app-builder/0.2.0/scripts/cli.js';
  if (!existsSync(cli)) return ['- `verify-tests`: not run (CLI not found)'];
  const r = spawnSync(process.execPath, [cli, 'verify-tests'], { cwd: root, encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/).join('\n  ');
  return [
    `- \`verify-tests\` (exit ${r.status ?? 'null'}):`,
    '',
    '  ```',
    `  ${out || '(no output)'}`,
    '  ```',
  ];
}

function writeSummary(results) {
  const unit = vitestCounts(path.join(logDir, 'vitest-unit.json'));
  const py = pytestResults(path.join(logDir, 'pytest.xml'));
  const e2e = playwrightCounts(path.join(e2eDir, 'test-results/results.json')) ?? {};
  const smoke = playwrightCounts(path.join(e2eDir, 'test-results-smoke/results.json')) ?? {};
  const e2eAll = { ...e2e, ...smoke };
  const row = (label, c) =>
    c
      ? `| ${label} | ${c.total} | ${c.passed} | ${c.failed} | ${c.skipped} |`
      : `| ${label} | — | — | — | — |`;
  const lines = [];
  lines.push(`# Test evidence summary — ${stage}`, '');
  lines.push(`- **Date/time:** ${new Date().toISOString()}`);
  lines.push(`- **Commit:** (uncommitted working tree; the orchestrator commits on approval)`);
  lines.push(`- **Model (builder, as reported):** Claude Opus 5 (claude-opus-5)`);
  lines.push(
    `- **Command(s) run:** \`npm run ci:local -- --stage ${stage}\` = ${STEPS.map((s) => s.name).join(' → ')} → report`,
  );
  lines.push('');
  lines.push(
    '## CI chain steps',
    '',
    '| Step | Result | Gating | Duration | Log |',
    '|---|---|---|---|---|',
  );
  for (const r of results)
    lines.push(
      `| ${r.name} | ${r.passed ? 'passed' : `FAILED (exit ${r.status})`} | ${r.gating ? 'yes' : 'no'} | ${(r.durationMs / 1000).toFixed(1)} s | logs/${r.name.replace(':', '-')}.log |`,
    );
  lines.push('| report | passed | yes | — | this file |');
  lines.push('');
  lines.push(
    '## Results per level',
    '',
    '| Level | Total | Passed | Failed | Skipped |',
    '|---|---|---|---|---|',
  );
  lines.push(row('UNIT (vitest --project unit)', unit));
  lines.push(row('Backend UNIT + INT + API + SEC + migrations (pytest)', py?.counts));
  for (const [project, c] of Object.entries(e2eAll)) lines.push(row(`E2E ${project}`, c));
  lines.push('');
  lines.push('## Test cases covered (IDs) and result', '');
  const unitT = vitestTitles(path.join(logDir, 'vitest-unit.json'));
  const intT = py?.titles ?? [];
  const e2eT = Object.entries(e2eAll).flatMap(([p, c]) => c.titles.map((t) => `[${p}] ${t}`));
  lines.push(`- UNIT: ${tcIds(unitT).join(', ') || '—'}`);
  lines.push(`- INT/API/SEC: ${tcIds(intT).join(', ') || '—'}`);
  lines.push(`- E2E: ${tcIds(e2eT).join(', ') || '—'}`);
  lines.push('');
  lines.push('<details><summary>Every automated test (name — status)</summary>', '');
  for (const t of [...unitT, ...intT, ...e2eT]) lines.push(`- ${t}`);
  lines.push('', '</details>', '');
  lines.push('## Failures and fixes during the stage', '');
  // Builder-written notes (TC → test mapping, defects, decisions) live in notes.md so the
  // generated summary can be regenerated without losing them.
  const notes = path.join(evidenceDir, 'notes.md');
  lines.push(
    existsSync(notes) ? readFileSync(notes, 'utf8').trim() : 'See `Outputs/TestCases/defects.md`.',
    '',
  );
  lines.push(
    '## Integrity checks',
    '',
    ...verifyTests(),
    '- test-integrity-guard verdict: (pending)',
    '- api-boundary-reviewer verdict: (pending)',
    '- code-reviewer verdict (and deferred Medium/Low findings with decision IDs): (pending)',
    '',
  );
  lines.push('## Local evidence (not committed)', '');
  lines.push(
    `- Step logs: \`Outputs/TestEvidence/${stage}/logs/*.log\`, Vitest JSON: \`logs/vitest-*.json\``,
  );
  lines.push(
    `- Playwright: \`Solution/tests/e2e/test-results/\` (Chromium viewports, results.json, screenshots/, axe/), \`Solution/tests/e2e/test-results-smoke/\` (smoke engines run in the Playwright container; on macOS only Firefox, WebKit reports in \`test-results/\`, D-107), HTML report \`Solution/tests/e2e/playwright-report/\``,
  );
  lines.push(
    `- Copies: \`Outputs/TestEvidence/${stage}/screenshots/\` and \`Outputs/TestEvidence/${stage}/axe/\``,
  );
  lines.push('');
  writeFileSync(path.join(evidenceDir, 'summary.md'), lines.join('\n'));
  // Copy screenshots + axe artefacts next to the summary (local only; .gitignore keeps them out).
  for (const [from, to] of [
    [path.join(e2eDir, 'test-results/screenshots'), path.join(evidenceDir, 'screenshots')],
    [path.join(e2eDir, 'test-results-smoke/screenshots'), path.join(evidenceDir, 'screenshots')],
    [path.join(e2eDir, 'test-results/axe'), path.join(evidenceDir, 'axe')],
    [path.join(e2eDir, 'test-results-smoke/axe'), path.join(evidenceDir, 'axe')],
  ]) {
    if (existsSync(from)) cpSync(from, to, { recursive: true });
  }
  console.log(`\nreport: wrote ${path.relative(root, path.join(evidenceDir, 'summary.md'))}`);
}

let results = [];
if (quick) {
  for (const step of STEPS.filter((s) => QUICK_STEPS.includes(s.name))) {
    const r = runStep(step);
    results.push(r);
    if (!r.passed && r.gating && !continueOnFailure) break;
  }
  const ok = results.every((r) => r.passed || !r.gating);
  console.log(
    `
ci:local --quick ${ok ? 'GREEN' : 'RED'} (not a commit gate): ${results.map((r) => `${r.name}=${r.passed ? 'ok' : 'FAIL'}`).join(' ')}`,
  );
  process.exit(ok ? 0 : 1);
}
if (reportOnly) {
  results = existsSync(resultsFile) ? JSON.parse(readFileSync(resultsFile, 'utf8')) : [];
} else {
  rmSync(resultsFile, { force: true });
  for (const step of STEPS) {
    const r = runStep(step);
    results.push(r);
    writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    if (!r.passed && r.gating) {
      console.error(`\nci:local FAILED at ${step.name}`);
      if (!continueOnFailure) {
        writeSummary(results);
        process.exit(r.status || 1);
      }
    }
  }
}
writeSummary(results);
const green = results.every((r) => r.passed || !r.gating);
console.log(
  `\nci:local ${green ? 'GREEN' : 'RED'}: ${results.map((r) => `${r.name}=${r.passed ? 'ok' : 'FAIL'}`).join(' ')}`,
);
if (!green) process.exit(1);
