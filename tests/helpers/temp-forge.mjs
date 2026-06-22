import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
}

export function setupTempForge({ config, remoteUrl }) {
  const dir = mkdtempSync(join(tmpdir(), 'remogram-test-'));
  writeFileSync(join(dir, '.remogram.json'), `${JSON.stringify(config, null, 2)}\n`);

  git(dir, ['init', '--template=']);
  git(dir, ['config', 'user.email', 'test@remogram.local']);
  git(dir, ['config', 'user.name', 'remogram-test']);
  writeFileSync(join(dir, 'README.md'), 'test\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'init']);
  git(dir, ['branch', '-M', 'main']);

  const remoteName = config.remote || 'origin';
  if (remoteUrl) {
    git(dir, ['remote', 'add', remoteName, remoteUrl]);
  }

  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function captureCliOutput(run) {
  const logs = [];
  const errLogs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => errLogs.push(a.join(' '));
  return run()
    .then((result) => ({ ...result, logs, errLogs }))
    .finally(() => {
      console.log = origLog;
      console.error = origErr;
    });
}
