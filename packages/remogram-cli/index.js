import {
  loadConfig,
  assertForgeReady,
  forgeContext,
  forgePacket,
  forgeErrorPacket,
  PACKET_TYPES,
  ERROR_CODES,
  forgeError,
} from '@remogram/core';
import { provider as giteaApi } from '@remogram/provider-gitea-api';

const PROVIDERS = {
  'gitea-api': giteaApi,
};

function output(packet, asJson) {
  const text = JSON.stringify(packet, null, asJson ? 2 : 0);
  if (asJson) console.log(text);
  else console.log(text);
}

function handleError(err, ctx, type, asJson) {
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
  output(forgeErrorPacket(baseCtx, fe, type), asJson);
  process.exitCode = 1;
}

function getProvider(config) {
  const p = PROVIDERS[config.provider];
  if (!p) return null;
  return p;
}

export async function runCli(argv) {
  const cwd = process.env.REMOGRAM_CWD || process.cwd();
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

  const [group, sub, ...rest] = positional;
  void rest;

  let loaded;
  let ctx;
  try {
    loaded = assertForgeReady(loadConfig(cwd));
    ctx = forgeContext(loaded);
  } catch (err) {
    handleError(err, null, PACKET_TYPES.FORGE_ERROR, asJson);
    return;
  }

  const provider = getProvider(ctx.config);
  if (!provider) {
    handleError(
      {
        message: `Unsupported provider: ${ctx.config.provider}`,
        forgeError: {
          code: ERROR_CODES.PROVIDER_UNSUPPORTED,
          message: `Unsupported provider: ${ctx.config.provider}`,
        },
      },
      ctx,
      PACKET_TYPES.FORGE_ERROR,
      asJson,
    );
    return;
  }

  try {
    let packet;
    if (group === 'repo' && sub === 'status') {
      const body = await provider.repoStatus(ctx);
      packet = forgePacket(PACKET_TYPES.REPO_STATUS, ctx, body);
    } else if (group === 'refs' && sub === 'compare') {
      if (!flags.base || !flags.head) {
        throw Object.assign(new Error('--base and --head required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--base and --head required'),
        });
      }
      const body = await provider.refsCompare(ctx, flags.base, flags.head);
      packet = forgePacket(PACKET_TYPES.REF_COMPARE, ctx, body);
    } else if (group === 'pr' && sub === 'view') {
      const body = await provider.prView(ctx, {
        index: flags.index ? Number(flags.index) : undefined,
        number: flags.number ? Number(flags.number) : undefined,
      });
      packet = forgePacket(PACKET_TYPES.PR_STATUS, ctx, body);
    } else if (group === 'pr' && sub === 'checks') {
      const body = await provider.prChecks(ctx, {
        index: flags.index ? Number(flags.index) : undefined,
        ref: flags.ref,
      });
      packet = forgePacket(PACKET_TYPES.PR_CHECKS, ctx, body);
    } else if (group === 'merge' && sub === 'plan') {
      if (!flags.index) {
        throw Object.assign(new Error('--index required'), {
          forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--index required'),
        });
      }
      const body = await provider.mergePlan(ctx, { index: Number(flags.index) });
      packet = forgePacket(PACKET_TYPES.MERGE_PLAN, ctx, body);
    } else if (group === 'sync' && sub === 'plan') {
      const body = await provider.syncPlan(ctx, flags.remote || ctx.config.remote);
      packet = forgePacket(PACKET_TYPES.SYNC_PLAN, ctx, body);
    } else {
      throw Object.assign(new Error(`Unknown command: ${positional.join(' ')}`), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          `Unknown command. Try: repo status, refs compare, pr view, pr checks, merge plan, sync plan`,
        ),
      });
    }
    output(packet, asJson);
  } catch (err) {
    const typeMap = {
      'repo status': PACKET_TYPES.REPO_STATUS,
      'refs compare': PACKET_TYPES.REF_COMPARE,
      'pr view': PACKET_TYPES.PR_STATUS,
      'pr checks': PACKET_TYPES.PR_CHECKS,
      'merge plan': PACKET_TYPES.MERGE_PLAN,
      'sync plan': PACKET_TYPES.SYNC_PLAN,
    };
    const key = `${group} ${sub}`;
    handleError(err, ctx, typeMap[key] || PACKET_TYPES.FORGE_ERROR, asJson);
  }
}
