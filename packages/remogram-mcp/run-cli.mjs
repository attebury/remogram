import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  forgeErrorPacket,
  unknownForgeContext,
  ERROR_CODES,
  forgeError,
  capText,
  sanitizeField,
} from '@remogram/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAX_OUTPUT_BYTES = 65_536;

function safeCliErrorMessage(stderr, stdout) {
  const raw = stderr || stdout || '';
  const capped = capText(raw, MAX_OUTPUT_BYTES);
  const sanitized = sanitizeField(capped.text);
  if (!sanitized) return 'CLI did not return JSON';
  if (/Bearer\s|ghp_|gho_|glpat-|GITLAB_TOKEN|GITEA_TOKEN/i.test(sanitized)) {
    return 'CLI did not return JSON';
  }
  return sanitized;
}

export function remogramCwd() {
  return process.env.REMOGRAM_CWD || process.cwd();
}

export function resolveCliBin() {
  try {
    return require.resolve('@remogram/cli/bin/remogram.js');
  } catch {
    return join(__dirname, '../remogram-cli/bin/remogram.js');
  }
}

function appendCapped(current, chunk, maxBytes) {
  const next = current + chunk;
  const capped = capText(next, maxBytes);
  return { text: capped.text, truncated: capped.truncated };
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
    let stdoutTruncated = false;
    let stderrTruncated = false;
    child.stdout.on('data', (d) => {
      const chunk = d.toString();
      const capped = appendCapped(stdout, chunk, MAX_OUTPUT_BYTES);
      stdout = capped.text;
      stdoutTruncated = stdoutTruncated || capped.truncated;
    });
    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      const capped = appendCapped(stderr, chunk, MAX_OUTPUT_BYTES);
      stderr = capped.text;
      stderrTruncated = stderrTruncated || capped.truncated;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        stdoutTruncated,
        stderrTruncated,
      });
    });
  });
}

export function packetToMcpContent(stdout, stderr, code, truncated = false) {
  let packet;
  let isError = code !== 0 || truncated;
  try {
    packet = JSON.parse(stdout);
    if (packet && packet.ok === false) isError = true;
  } catch {
    isError = true;
    packet = forgeErrorPacket(
      unknownForgeContext(),
      forgeError(
        ERROR_CODES.UNPARSEABLE_PROVIDER_OUTPUT,
        safeCliErrorMessage(stderr, stdout),
      ),
    );
  }
  if (truncated) {
    isError = true;
    packet = forgeErrorPacket(
      unknownForgeContext(),
      forgeError(ERROR_CODES.OVERSIZED_RAW_OUTPUT, 'CLI output exceeded MCP byte cap'),
    );
  }
  return {
    isError,
    content: [{ type: 'text', text: JSON.stringify(packet, null, 2) }],
  };
}
