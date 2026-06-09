import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export function remogramCwd() {
  return process.env.REMOGRAM_CWD || process.cwd();
}

export function resolveCliBin() {
  if (process.env.REMOGRAM_CLI) return process.env.REMOGRAM_CLI;
  try {
    return require.resolve('@remogram/cli/bin/remogram.js');
  } catch {
    return join(__dirname, '../remogram-cli/bin/remogram.js');
  }
}

export function runRemogramCli(args) {
  const cliBin = resolveCliBin();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliBin, ...args, '--json'], {
      cwd: remogramCwd(),
      env: { ...process.env, REMOGRAM_CWD: remogramCwd() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export function packetToMcpContent(stdout, stderr, code) {
  let packet;
  let isError = code !== 0;
  try {
    packet = JSON.parse(stdout);
    if (packet && packet.ok === false) isError = true;
  } catch {
    isError = true;
    packet = {
      type: 'forge_error',
      schema_version: 1,
      ok: false,
      error_code: 'unparseable_provider_output',
      error_message: stderr || stdout || 'CLI did not return JSON',
    };
  }
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(packet, null, 2) }],
  };
}
