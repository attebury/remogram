import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '../../remogram-cli/bin/remogram.js');

export function remogramCwd() {
  return process.env.REMOGRAM_CWD || process.cwd();
}

export function runRemogramCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args, '--json'], {
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
