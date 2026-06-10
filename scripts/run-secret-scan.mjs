#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_HEAD_REF = 'HEAD';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function usage() {
  return [
    'Usage: npm run security:secrets -- [--base <ref>] [--head <ref>] [--full-history]',
    '',
    'By default the scan uses REMOGRAM_SECRET_SCAN_BASE_REF, TOPOGRAM_SECRET_SCAN_BASE_REF,',
    'GITHUB_BASE_REF, or origin/remo when available.',
    'Use --full-history when no reliable base ref exists or for release/manual verification.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    base: null,
    fullHistory: false,
    head: DEFAULT_HEAD_REF,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    }

    if (arg === '--full-history') {
      options.fullHistory = true;
      continue;
    }

    if (arg === '--base') {
      index += 1;
      if (!argv[index]) {
        fail(`Missing value for --base.\n\n${usage()}`);
      }
      options.base = argv[index];
      continue;
    }

    if (arg.startsWith('--base=')) {
      options.base = arg.slice('--base='.length);
      if (!options.base) {
        fail(`Missing value for --base.\n\n${usage()}`);
      }
      continue;
    }

    if (arg === '--head') {
      index += 1;
      if (!argv[index]) {
        fail(`Missing value for --head.\n\n${usage()}`);
      }
      options.head = argv[index];
      continue;
    }

    if (arg.startsWith('--head=')) {
      options.head = arg.slice('--head='.length);
      if (!options.head) {
        fail(`Missing value for --head.\n\n${usage()}`);
      }
      continue;
    }

    fail(`Unknown argument ${arg}.\n\n${usage()}`);
  }

  if (options.fullHistory && options.base) {
    fail('--full-history and --base cannot be used together.');
  }

  return options;
}

function runGit(args) {
  return spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function resolveCommit(ref, { required }) {
  const result = runGit(['rev-parse', '--verify', `${ref}^{commit}`]);
  if (result.status === 0) {
    return result.stdout.trim();
  }

  if (!required) {
    return null;
  }

  const diagnostic = (result.stderr || result.stdout || '').trim();
  fail([
    `Unable to resolve git ref ${ref} for the Gitleaks scan.`,
    diagnostic,
    'Fetch the base ref first or run `npm run security:secrets -- --full-history`.',
  ].filter(Boolean).join('\n'));
}

function resolveAutomaticBaseRef() {
  for (const candidate of [
    process.env.REMOGRAM_SECRET_SCAN_BASE_REF,
    process.env.TOPOGRAM_SECRET_SCAN_BASE_REF,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    'origin/main',
    'origin/remo',
  ]) {
    if (candidate && resolveCommit(candidate, { required: false })) {
      return candidate;
    }
  }

  return null;
}

function resolveScanPlan(options) {
  if (options.fullHistory) {
    return { mode: 'full-history' };
  }

  const explicitBase = Boolean(options.base);
  const baseRef = options.base || resolveAutomaticBaseRef();
  if (!baseRef) {
    return { mode: 'full-history', reason: 'no base ref available' };
  }

  const baseCommit = resolveCommit(baseRef, { required: false });
  if (!baseCommit) {
    const reason = explicitBase
      ? `base ref ${baseRef} was unavailable (force push, first push, or shallow clone)`
      : `automatic base ref ${baseRef} was unavailable`;
    return { mode: 'full-history', reason };
  }

  const headCommit = resolveCommit(options.head, { required: true });
  const mergeBase = runGit(['merge-base', baseCommit, headCommit]);
  if (mergeBase.status !== 0) {
    const diagnostic = (mergeBase.stderr || mergeBase.stdout || '').trim();
    if (!explicitBase) {
      return { mode: 'full-history', reason: `automatic base ref ${baseRef} had no merge base` };
    }

    fail([
      `Unable to find a merge base for ${baseRef} and ${options.head}.`,
      diagnostic,
      'Fetch the base ref first or run `npm run security:secrets -- --full-history`.',
    ].filter(Boolean).join('\n'));
  }

  const mergeBaseCommit = mergeBase.stdout.trim();
  return {
    baseCommit,
    baseRef,
    headCommit,
    logOpts: `${mergeBaseCommit}..${headCommit}`,
    mode: 'range',
  };
}

const options = parseArgs(process.argv.slice(2));
const version = spawnSync('gitleaks', ['version'], {
  cwd: repoRoot,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (version.error && version.error.code === 'ENOENT') {
  fail([
    'Gitleaks is required for `npm run security:secrets`.',
    'Install it with `brew install gitleaks` or follow https://github.com/gitleaks/gitleaks.',
    'CI runs the same scanner through `.github/workflows/secret-scan.yml`.',
  ].join('\n'));
}

if (version.status !== 0) {
  fail(`Unable to run Gitleaks: ${(version.stderr || version.stdout || '').trim()}`);
}

const scanPlan = resolveScanPlan(options);
const gitleaksArgs = [
  'git',
  '--config',
  '.gitleaks.toml',
  '--redact=100',
  '--no-banner',
  '--no-color',
  '--verbose',
];

if (scanPlan.mode === 'range') {
  gitleaksArgs.push('--log-opts', scanPlan.logOpts);
  console.error(
    `Running Gitleaks secret scan for ${scanPlan.baseRef}..${options.head} (${scanPlan.logOpts}).`,
  );
} else if (scanPlan.reason) {
  console.error(`Running full-history Gitleaks secret scan because ${scanPlan.reason}.`);
} else {
  console.error('Running full-history Gitleaks secret scan.');
}

gitleaksArgs.push('.');

const result = spawnSync('gitleaks', gitleaksArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (result.error) {
  fail(`Gitleaks failed to start: ${result.error.message}`);
}

if (result.status === 0) {
  console.error('Gitleaks secret scan passed: no leaks found.');
}

process.exit(result.status ?? 1);
