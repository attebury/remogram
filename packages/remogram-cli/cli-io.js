import {
  forgePacket,
  forgeErrorPacket,
  forgeError,
  ERROR_CODES,
  normalizedForgeOrigin,
  trustedBaseUrl,
  resolveMergePolicy,
} from '@remogram/core';

export function output(packet, asJson) {
  console.log(JSON.stringify(packet, null, asJson ? 2 : 0));
}

export function handleError(err, ctx, asJson) {
  const fe =
    err.forgeError
    || (err.invalidArgs
      ? forgeError(ERROR_CODES.INVALID_ARGS, err.invalidArgs)
      : {
          code: ERROR_CODES.API_ERROR,
          message: err.message,
          status: err.status,
        });
  const baseCtx = ctx || {
    providerId: 'unknown',
    remoteName: 'origin',
    repoId: 'unknown/unknown',
  };
  if (err.staleHeadPacket) {
    output(forgePacket(err.staleHeadPacket.type, baseCtx, err.staleHeadPacket.body, fe), asJson);
    process.exitCode = 1;
    return;
  }
  output(forgeErrorPacket(baseCtx, fe), asJson);
  process.exitCode = 1;
}

export function contextFromConfig(config, cwd, parsed = null) {
  const ctx = {
    providerId: config.provider,
    remoteName: config.remote,
    repoId: parsed ? `${parsed.owner}/${parsed.repo}` : `${config.owner}/${config.repo}`,
    config,
    cwd,
    parsed,
  };
  if (config.baseUrl && (!parsed || trustedBaseUrl(config, parsed.host))) {
    ctx.baseUrl = normalizedForgeOrigin(config);
  }
  ctx.mergePolicy = resolveMergePolicy(config);
  return ctx;
}
