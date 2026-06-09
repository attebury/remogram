import {
  loadConfig,
  assertForgeReady,
  forgeContext,
  forgePacket,
  forgeErrorPacket,
  PACKET_TYPES,
  ERROR_CODES,
  forgeError,
  assertGitRef,
  assertGitRemote,
} from '@remogram/core';
import { provider as giteaApi } from '@remogram/provider-gitea-api';
import { provider as githubApi } from '@remogram/provider-github-api';
import { provider as giteaTea } from '@remogram/provider-gitea-tea';
import { provider as githubGh } from '@remogram/provider-github-gh';

const PROVIDERS = {
  'gitea-api': giteaApi,
  'github-api': githubApi,
  'gitea-tea': giteaTea,
  'github-gh': githubGh,
};

function parsePositiveInt(value, name) {
  if (value == null) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw Object.assign(new Error(`Invalid ${name}`), {
      forgeError: forgeError(ERROR_CODES.INVALID_ARGS, `${name} must be a positive integer`),
    });
  }
  return n;
}

function output(packet, asJson) {
  console.log(JSON.stringify(packet, null, asJson ? 2 : 0));
}

function handleError(err, ctx, asJson) {
  const fe = err.forgeError || {
    code: ERROR_CODES.API_ERROR,
    message: err.message,
    status: err.status,
  };
  const baseCtx = ctx || {
    providerId: 'unknown',
    remoteName: 'origin',
    repoId: 'unknown/unknown',
  };
  output(forgeErrorPacket(baseCtx, fe), asJson);
  process.exitCode = 1;
}

export async function runCli(argv, options = {}) {
  const cwd = options.cwd ?? process.env.REMOGRAM_CWD ?? process.cwd();
  const providers = options.providers ?? PROVIDERS;
  const positional = [];
  let asJson = false;
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') asJson = true;
    else if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  const [group, sub] = positional;

  let ctx;
  try {
    const loaded = assertForgeReady(loadConfig(cwd));
    ctx = forgeContext(loaded);
  } catch (err) {
    handleError(err, null, asJson);
    return;
  }

  const provider = providers[ctx.config.provider];
  if (!provider) {
    handleError(
      {
        message: `Unsupported provider: ${ctx.config.provider}`,
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          `Unsupported provider: ${ctx.config.provider}`,
        ),
      },
      ctx,
      asJson,
    );
    return;
  }

  try {
    let packet;
    if (group === 'repo' && sub === 'status') {
      packet = forgePacket(PACKET_TYPES.REPO_STATUS, ctx, await provider.repoStatus(ctx));
    } else if (group === 'refs' && sub === 'compare') {
      if (!flags.base || !flags.head) {
        throw Object.assign(new Error('--base and --head required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--base and --head required'),
        });
      }
      assertGitRef(flags.base, '--base');
      assertGitRef(flags.head, '--head');
      packet = forgePacket(
        PACKET_TYPES.REF_COMPARE,
        ctx,
        await provider.refsCompare(ctx, flags.base, flags.head),
      );
    } else if (group === 'pr' && sub === 'view') {
      const number = parsePositiveInt(flags.number, '--number');
      if (number == null) {
        throw Object.assign(new Error('--number required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for pr view'),
        });
      }
      packet = forgePacket(PACKET_TYPES.PR_STATUS, ctx, await provider.prView(ctx, { number }));
    } else if (group === 'pr' && sub === 'checks') {
      const number = parsePositiveInt(flags.number, '--number');
      if (number == null && !flags.ref) {
        throw Object.assign(new Error('--number or --ref required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number or --ref required for pr checks'),
        });
      }
      if (flags.ref) assertGitRef(flags.ref, '--ref');
      packet = forgePacket(
        PACKET_TYPES.PR_CHECKS,
        ctx,
        await provider.prChecks(ctx, { number, ref: flags.ref }),
      );
    } else if (group === 'merge' && sub === 'plan') {
      const number = parsePositiveInt(flags.number, '--number');
      if (number == null) {
        throw Object.assign(new Error('--number required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for merge plan'),
        });
      }
      packet = forgePacket(PACKET_TYPES.MERGE_PLAN, ctx, await provider.mergePlan(ctx, { number }));
    } else if (group === 'sync' && sub === 'plan') {
      const remote = flags.remote || ctx.config.remote;
      assertGitRemote(remote, '--remote');
      packet = forgePacket(
        PACKET_TYPES.SYNC_PLAN,
        ctx,
        await provider.syncPlan(ctx, remote),
      );
    } else {
      throw Object.assign(new Error(`Unknown command: ${positional.join(' ')}`), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          'Unknown command. Try: repo status, refs compare, pr view, pr checks, merge plan, sync plan',
        ),
      });
    }
    output(packet, asJson);
  } catch (err) {
    handleError(err, ctx, asJson);
  }
}
