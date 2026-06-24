import { describe, it, expect } from 'vitest';
import { runCli } from '@remogram/cli';

const MISSING_CONFIG_CWD = '/tmp/nonexistent-remogram-cwd-help-586';

async function captureCli(argv, { cwd = MISSING_CONFIG_CWD } = {}) {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  const oldCwd = process.env.REMOGRAM_CWD;
  const oldExit = process.exitCode;
  process.env.REMOGRAM_CWD = cwd;
  process.exitCode = undefined;
  try {
    await runCli(argv, { cwd });
    return logs;
  } finally {
    console.log = origLog;
    process.exitCode = oldExit;
    if (oldCwd == null) delete process.env.REMOGRAM_CWD;
    else process.env.REMOGRAM_CWD = oldCwd;
  }
}

describe('CLI help before validation (#586)', () => {
  it('P586-P1 cr open --help exits without forge config', async () => {
    const logs = await captureCli(['cr', 'open', '--help']);
    expect(process.exitCode).toBeUndefined();
    const text = logs.join('\n');
    expect(text).toMatch(/Usage: remogram cr open/);
    expect(text).toMatch(/--head/);
    expect(text).toMatch(/--base/);
    expect(text).toMatch(/--title/);
    expect(() => JSON.parse(text)).toThrow();
  });

  it('P586-P2 issue open --help prints usage', async () => {
    const logs = await captureCli(['issue', 'open', '--help']);
    expect(logs.join('\n')).toMatch(/Usage: remogram issue open/);
  });

  it('P586-P3 merge execute --help prints usage', async () => {
    const logs = await captureCli(['merge', 'execute', '--help']);
    expect(logs.join('\n')).toMatch(/Usage: remogram merge execute/);
    expect(logs.join('\n')).toMatch(/--expected-base-sha/);
  });

  it('P586-P4 status set --help prints usage', async () => {
    const logs = await captureCli(['status', 'set', '--help']);
    expect(logs.join('\n')).toMatch(/Usage: remogram status set/);
  });

  it('N586-N1 cr open without args still fails closed without forge config', async () => {
    const logs = await captureCli(['cr', 'open', '--json']);
    const packet = JSON.parse(logs[0]);
    expect(packet.ok).toBe(false);
    expect(['invalid_args', 'config_not_found']).toContain(packet.error_code);
  });

  it('N586-N2 cr open -h matches --help', async () => {
    const logs = await captureCli(['cr', 'open', '-h']);
    expect(logs.join('\n')).toMatch(/Usage: remogram cr open/);
  });
});
