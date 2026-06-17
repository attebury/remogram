import { describe, it, expect } from 'vitest';
import { runCli } from '@remogram/cli';

describe('remogram cli envelope', () => {
  it('errors without config', async () => {
    const logs = [];
    const errLogs = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...a) => logs.push(a.join(' '));
    console.error = (...a) => errLogs.push(a.join(' '));
    const oldCwd = process.env.REMOGRAM_CWD;
    process.env.REMOGRAM_CWD = '/tmp/nonexistent-remogram-cwd-xyz';
    try {
      await runCli(['repo', 'status', '--json']);
      const packet = JSON.parse(logs[0]);
      expect(packet.ok).toBe(false);
      expect(packet.schema_version).toBe(1);
    } finally {
      console.log = origLog;
      console.error = origErr;
      if (oldCwd == null) delete process.env.REMOGRAM_CWD;
      else process.env.REMOGRAM_CWD = oldCwd;
    }
  });
});
