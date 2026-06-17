import {
  forgePacket,
  PACKET_TYPES,
  ERROR_CODES,
  forgeError,
  assertGitRef,
  assertGitRemote,
  throwIfStaleHeadByNumber,
  FACT_INVENTORY_PACKET_TYPES,
  forgeFactInventoryPacket,
  assertWriteCommandConfigured,
  parseSinceObservedAt,
  normalizeAllowedPaths,
} from '@remogram/core';
import { parseAllowedPathFlags, parsePositiveInt } from './cli-argv.js';

export async function dispatchForgeCommand({ group, sub, flags, positional, ctx, provider }) {
  if (group === 'provider' && sub === 'capabilities') {
    return forgePacket(
      PACKET_TYPES.PROVIDER_CAPABILITIES,
      ctx,
      await provider.providerCapabilities(ctx),
    );
  }
  if (group === 'repo' && sub === 'status') {
    return forgePacket(PACKET_TYPES.REPO_STATUS, ctx, await provider.repoStatus(ctx));
  }
  if (group === 'refs' && sub === 'compare') {
    if (!flags.base || !flags.head) {
      throw Object.assign(new Error('--base and --head required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--base and --head required'),
      });
    }
    assertGitRef(flags.base, '--base');
    assertGitRef(flags.head, '--head');
    return forgePacket(
      PACKET_TYPES.REF_COMPARE,
      ctx,
      await provider.refsCompare(ctx, flags.base, flags.head),
    );
  }
  if (group === 'refs' && sub === 'inventory') {
    if (typeof provider.refsInventory !== 'function') {
      throw Object.assign(new Error('refs inventory not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'refs inventory not implemented for provider',
        ),
      });
    }
    return forgeFactInventoryPacket(
      FACT_INVENTORY_PACKET_TYPES.REF_INVENTORY,
      ctx,
      await provider.refsInventory(ctx),
    );
  }
  if (group === 'cr' && sub === 'inventory') {
    if (typeof provider.crInventory !== 'function') {
      throw Object.assign(new Error('cr inventory not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'cr inventory not implemented for provider',
        ),
      });
    }
    const inventoryBody = await provider.crInventory(ctx, {
      slice_ref: flags.slice_ref,
      limit: parsePositiveInt(flags.limit, '--limit'),
      sort: flags.sort,
    });
    if (inventoryBody.list_truncated === true) {
      throw Object.assign(new Error('Open CR list incomplete'), {
        forgeError: forgeError(
          ERROR_CODES.INVENTORY_LIST_INCOMPLETE,
          'Open change request list could not be proved complete within pagination bounds',
          null,
          {
            inventory_list: {
              entry_count: inventoryBody.entry_count,
            },
          },
        ),
      });
    }
    return forgeFactInventoryPacket(
      FACT_INVENTORY_PACKET_TYPES.CR_INVENTORY_SLICE,
      ctx,
      inventoryBody,
    );
  }
  if (group === 'cr' && sub === 'files') {
    const number = parsePositiveInt(flags.number, '--number');
    if (number == null) {
      throw Object.assign(new Error('--number required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for cr files'),
      });
    }
    if (typeof provider.crFiles !== 'function') {
      throw Object.assign(new Error('cr files not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'cr files not implemented for provider',
        ),
      });
    }
    return forgePacket(
      PACKET_TYPES.CR_FILES,
      ctx,
      await provider.crFiles(ctx, { number }),
    );
  }
  if (group === 'cr' && sub === 'comments') {
    const number = parsePositiveInt(flags.number, '--number');
    if (number == null) {
      throw Object.assign(new Error('--number required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for cr comments'),
      });
    }
    if (typeof provider.crComments !== 'function') {
      throw Object.assign(new Error('cr comments not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'cr comments not implemented for provider',
        ),
      });
    }
    return forgePacket(
      PACKET_TYPES.CR_COMMENTS,
      ctx,
      await provider.crComments(ctx, { number }),
    );
  }
  if (group === 'forge' && sub === 'changes') {
    const sinceIso = parseSinceObservedAt(flags.since);
    if (typeof provider.forgeChanges !== 'function') {
      throw Object.assign(new Error('forge changes not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'forge changes not implemented for provider',
        ),
      });
    }
    return forgePacket(
      PACKET_TYPES.FORGE_CHANGES,
      ctx,
      await provider.forgeChanges(ctx, { since: sinceIso }),
    );
  }
  if (group === 'cr' && sub === 'open') {
    if (typeof provider.crOpen !== 'function') {
      throw Object.assign(new Error('cr open not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'cr open not implemented for provider',
        ),
      });
    }
    if (!flags.head || !flags.base || !flags.title) {
      throw Object.assign(new Error('--head, --base, and --title required'), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          '--head, --base, and --title required for cr open',
        ),
      });
    }
    assertGitRef(flags.head, '--head');
    assertGitRef(flags.base, '--base');
    assertWriteCommandConfigured(ctx.config, 'cr_open');
    return forgePacket(
      PACKET_TYPES.CHANGE_REQUEST_OPENED,
      ctx,
      await provider.crOpen(ctx, {
        head: flags.head,
        base: flags.base,
        title: flags.title,
        body: flags.body,
      }),
    );
  }
  if (group === 'status' && sub === 'set') {
    if (typeof provider.statusSet !== 'function') {
      throw Object.assign(new Error('status set not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'status set not implemented for provider',
        ),
      });
    }
    assertWriteCommandConfigured(ctx.config, 'status_set');
    return forgePacket(
      PACKET_TYPES.COMMIT_STATUS_SET,
      ctx,
      await provider.statusSet(ctx, {
        sha: flags.sha,
        context: flags.context,
        state: flags.state,
        target_url: flags.target_url,
        description: flags.description,
      }),
    );
  }
  if (group === 'pr' && sub === 'view') {
    const number = parsePositiveInt(flags.number, '--number');
    if (number == null) {
      throw Object.assign(new Error('--number required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for pr view'),
      });
    }
    const body = await provider.prView(ctx, { number });
    throwIfStaleHeadByNumber(
      ctx,
      PACKET_TYPES.PR_STATUS,
      body,
      body.head_ref,
      body.head_sha,
    );
    return forgePacket(PACKET_TYPES.PR_STATUS, ctx, body);
  }
  if (group === 'pr' && sub === 'checks') {
    const number = parsePositiveInt(flags.number, '--number');
    if (number == null && !flags.ref) {
      throw Object.assign(new Error('--number or --ref required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number or --ref required for pr checks'),
      });
    }
    if (flags.ref) assertGitRef(flags.ref, '--ref');
    if (number != null && !flags.ref) {
      const view = await provider.prView(ctx, { number });
      throwIfStaleHeadByNumber(
        ctx,
        PACKET_TYPES.PR_CHECKS,
        { head_sha: view.head_sha },
        view.head_ref,
        view.head_sha,
      );
    }
    return forgePacket(
      PACKET_TYPES.PR_CHECKS,
      ctx,
      await provider.prChecks(ctx, { number, ref: flags.ref }),
    );
  }
  if (group === 'merge' && sub === 'plan') {
    const number = parsePositiveInt(flags.number, '--number');
    if (number == null) {
      throw Object.assign(new Error('--number required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for merge plan'),
      });
    }
    const allowedPaths = normalizeAllowedPaths(parseAllowedPathFlags(flags) ?? []);
    return forgePacket(
      PACKET_TYPES.MERGE_PLAN,
      ctx,
      await provider.mergePlan(ctx, {
        number,
        ...(allowedPaths ? { allowed_paths: allowedPaths } : {}),
      }),
    );
  }
  if (group === 'branch' && sub === 'protection') {
    const branchRef = flags.branch_ref;
    if (!branchRef) {
      throw Object.assign(new Error('--branch-ref required'), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          '--branch-ref required for branch protection',
        ),
      });
    }
    assertGitRef(branchRef, '--branch-ref');
    if (typeof provider.branchProtection !== 'function') {
      throw Object.assign(new Error('branch protection not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'branch protection not implemented for provider',
        ),
      });
    }
    return forgePacket(
      PACKET_TYPES.BRANCH_PROTECTION,
      ctx,
      await provider.branchProtection(ctx, { branchRef }),
    );
  }
  if (group === 'whoami' && sub == null) {
    if (typeof provider.whoami !== 'function') {
      throw Object.assign(new Error('whoami not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'whoami not implemented for provider',
        ),
      });
    }
    return forgePacket(PACKET_TYPES.PROVIDER_IDENTITY, ctx, await provider.whoami(ctx));
  }
  if (group === 'sync' && sub === 'plan') {
    const remote = flags.remote || ctx.config.remote;
    assertGitRemote(remote, '--remote');
    return forgePacket(
      PACKET_TYPES.SYNC_PLAN,
      ctx,
      await provider.syncPlan(ctx, remote),
    );
  }

  throw Object.assign(new Error(`Unknown command: ${positional.join(' ')}`), {
    forgeError: forgeError(
      ERROR_CODES.INVALID_ARGS,
      'Unknown command. Try: provider capabilities, repo status, refs compare, refs inventory, cr inventory, cr files, cr comments, cr open, status set, forge changes, pr view, pr checks, merge plan, sync plan, whoami, branch protection',
    ),
  });
}
