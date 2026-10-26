// `npm run scan` (non-gating, NFR-016): npm audit and pip-audit always; osv-scanner and trivy
// when installed.
import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(`${cmd} ${args.join(' ')}`, { stdio: 'inherit', shell: true });
  return r.status;
}
function present(cmd) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(`${lookup} ${cmd}`, { stdio: 'ignore', shell: true }).status === 0;
}

run('npm', ['audit', '--omit=dev']);
run('node', ['scripts/py.mjs', '-m', 'pip_audit', '-r', 'requirements.txt']);
if (present('osv-scanner')) run('osv-scanner', ['--lockfile', 'package-lock.json']);
else console.log('osv-scanner not installed — skipped');
if (present('trivy')) run('trivy', ['image', '--severity', 'HIGH,CRITICAL', 'app/app:local']);
else console.log('trivy not installed — skipped');
console.log('\nscan: non-gating, exit 0');
