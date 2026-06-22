import {
  loadConfig,
  assertForgeReady,
  forgeContext,
  ERROR_CODES,
  forgeError,
} from '@remogram/core';
import { provider as giteaApi } from '@remogram/provider-gitea-api';
import { provider as githubApi } from '@remogram/provider-github-api';
import { provider as gitlabApi } from '@remogram/provider-gitlab-api';
import { provider as giteaTea } from '@remogram/provider-gitea-tea';
import { provider as githubGh } from '@remogram/provider-github-gh';
import { output, handleError } from './cli-io.js';
import { parseCliArgv } from './cli-argv.js';
import { buildDoctorPacket } from './cli-doctor.js';
import { dispatchForgeCommand } from './cli-dispatch.js';

const PROVIDERS = {
  'gitea-api': giteaApi,
  'github-api': githubApi,
  'gitlab-api': gitlabApi,
  'gitea-tea': giteaTea,
  'github-gh': githubGh,
};

export async function runCli(argv, options = {}) {
  const cwd = options.cwd ?? process.env.REMOGRAM_CWD ?? process.cwd();
  const providers = options.providers ?? PROVIDERS;
  const { positional, asJson, flags } = parseCliArgv(argv);
  const [group, sub] = positional;

  if (group === 'doctor' && sub == null) {
    const packet = await buildDoctorPacket(cwd, providers, { live: flags.live === true });
    output(packet, asJson);
    if (!packet.ok) process.exitCode = 1;
    return;
  }

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
    const packet = await dispatchForgeCommand({ group, sub, flags, positional, ctx, provider });
    output(packet, asJson);
    if (!packet.ok) process.exitCode = 1;
  } catch (err) {
    handleError(err, ctx, asJson);
  }
}
