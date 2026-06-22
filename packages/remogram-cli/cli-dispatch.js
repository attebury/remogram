import {
  forgePacket,
  PACKET_TYPES,
  ERROR_CODES,
  forgeError,
  sanitizeField,
  assertGitRef,
  assertGitRemote,
  throwIfStaleHeadByNumber,
  FACT_INVENTORY_PACKET_TYPES,
  forgeFactInventoryPacket,
  assertWriteCommandConfigured,
  parseSinceObservedAt,
  decodeForgeChangesCursor,
  paginateForgeChangesBody,
  DEFAULT_FORGE_CHANGES_PAGE_SIZE,
  normalizeAllowedPaths,
  assertExpectedSha,
  buildMergeExecuteBeforeFacts,
  collectMergeExecuteBlockers,
  buildCrMergeBlockedBody,
  buildCrMergedBody,
  buildMergeExecuteAfterFacts,
  buildMergeExecuteMergeFacts,
  mergeExecuteViewFacts,
  isOpenPrState,
  bindIdempotencyScope,
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
      cursor: flags.cursor,
    });
    if (inventoryBody.list_truncated === true && !flags.cursor) {
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
    if (typeof provider.forgeChanges !== 'function') {
      throw Object.assign(new Error('forge changes not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'forge changes not implemented for provider',
        ),
      });
    }
    let sinceIso;
    let cursorOffset = 0;
    const pageLimit = parsePositiveInt(flags.limit, '--limit') ?? DEFAULT_FORGE_CHANGES_PAGE_SIZE;
    if (flags.cursor) {
      const decoded = decodeForgeChangesCursor(flags.cursor, { since: flags.since });
      sinceIso = decoded.since;
      cursorOffset = decoded.offset;
    } else {
      sinceIso = parseSinceObservedAt(flags.since);
    }
    const body = await provider.forgeChanges(ctx, { since: sinceIso });
    const paginated = paginateForgeChangesBody(body, { offset: cursorOffset, limit: pageLimit });
    return forgePacket(PACKET_TYPES.FORGE_CHANGES, ctx, paginated);
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
    const idempotencyFingerprint = flags.idempotency_key
      ? bindIdempotencyScope(ctx.repo_id, flags.idempotency_key, [flags.head, flags.base])
      : null;
    return forgePacket(
      PACKET_TYPES.CHANGE_REQUEST_OPENED,
      ctx,
      await provider.crOpen(ctx, {
        head: flags.head,
        base: flags.base,
        title: flags.title,
        body: flags.body,
        idempotencyFingerprint,
      }),
    );
  }
  if (group === 'issue' && sub === 'open') {
    if (typeof provider.issueOpen !== 'function') {
      throw Object.assign(new Error('issue open not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'issue open not implemented for provider',
        ),
      });
    }
    if (!flags.title) {
      throw Object.assign(new Error('--title required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--title required for issue open'),
      });
    }
    assertWriteCommandConfigured(ctx.config, 'issue_open');
    const idempotencyFingerprint = flags.idempotency_key
      ? bindIdempotencyScope(ctx.repo_id, flags.idempotency_key, [flags.title])
      : null;
    return forgePacket(
      PACKET_TYPES.ISSUE_OPENED,
      ctx,
      await provider.issueOpen(ctx, {
        title: flags.title,
        body: flags.body,
        idempotencyFingerprint,
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
    const idempotencyFingerprint = flags.idempotency_key
      ? bindIdempotencyScope(ctx.repo_id, flags.idempotency_key, [
          flags.sha,
          flags.context,
          flags.state,
        ])
      : null;
    return forgePacket(
      PACKET_TYPES.COMMIT_STATUS_SET,
      ctx,
      await provider.statusSet(ctx, {
        sha: flags.sha,
        context: flags.context,
        state: flags.state,
        target_url: flags.target_url,
        description: flags.description,
        idempotencyFingerprint,
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
      body.forge_source_branch_ref,
      body.forge_source_sha,
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
        { forge_source_sha: view.forge_source_sha },
        view.forge_source_branch_ref,
        view.forge_source_sha,
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
  if (group === 'merge' && sub === 'execute') {
    if (typeof provider.mergeExecute !== 'function') {
      throw Object.assign(new Error('merge execute not implemented for provider'), {
        forgeError: forgeError(
          ERROR_CODES.PROVIDER_UNSUPPORTED,
          'merge execute not implemented for provider',
        ),
      });
    }
    const number = parsePositiveInt(flags.number, '--number');
    if (number == null) {
      throw Object.assign(new Error('--number required'), {
        forgeError: forgeError(ERROR_CODES.INVALID_ARGS, '--number required for merge execute'),
      });
    }
    if (!flags.expected_base_sha || !flags.expected_head_sha) {
      throw Object.assign(new Error('expected SHAs required'), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          '--expected-base-sha and --expected-head-sha required for merge execute',
        ),
      });
    }
    const method = flags.method ? String(flags.method).toLowerCase() : 'merge';
    if (method !== 'merge') {
      throw Object.assign(new Error('Unsupported merge method'), {
        forgeError: forgeError(
          ERROR_CODES.INVALID_ARGS,
          'Only --method merge is supported in v1',
        ),
      });
    }
    const expectedBaseSha = assertExpectedSha(flags.expected_base_sha, '--expected-base-sha');
    const expectedHeadSha = assertExpectedSha(flags.expected_head_sha, '--expected-head-sha');
    assertWriteCommandConfigured(ctx.config, 'merge');

    const view = await provider.prView(ctx, { number });
    const checks = await provider.prChecks(ctx, { number });
    const mergePlanBody = await provider.mergePlan(ctx, { number });
    const expected = { baseSha: expectedBaseSha, headSha: expectedHeadSha };
    const viewFacts = mergeExecuteViewFacts(view);

    let forgeHeadRefSha = null;
    const headRef = viewFacts.sourceBranchRef ? String(viewFacts.sourceBranchRef).trim() : '';
    if (!headRef && isOpenPrState(view.state)) {
      const before = buildMergeExecuteBeforeFacts(
      view,
      checks,
      mergePlanBody,
      null,
      ctx.mergePolicy,
    );
      return forgePacket(
        PACKET_TYPES.CR_MERGE_BLOCKED,
        ctx,
        buildCrMergeBlockedBody({
          prNumber: number,
          expected,
          before,
          blockers: ['head_ref_missing'],
        }),
        forgeError(ERROR_CODES.MERGE_BLOCKED, 'Open change request missing head branch ref'),
      );
    }
    if (headRef) {
      if (typeof provider.branchHeadSha !== 'function') {
        const before = buildMergeExecuteBeforeFacts(
      view,
      checks,
      mergePlanBody,
      null,
      ctx.mergePolicy,
    );
        return forgePacket(
          PACKET_TYPES.CR_MERGE_BLOCKED,
          ctx,
          buildCrMergeBlockedBody({
            prNumber: number,
            expected,
            before,
            blockers: ['head_ref_unverified'],
          }),
          forgeError(
            ERROR_CODES.MERGE_BLOCKED,
            'Forge head branch verification not implemented for provider',
          ),
        );
      }
      try {
        assertGitRef(headRef, 'head_ref');
      } catch (err) {
        const before = buildMergeExecuteBeforeFacts(
      view,
      checks,
      mergePlanBody,
      null,
      ctx.mergePolicy,
    );
        return forgePacket(
          PACKET_TYPES.CR_MERGE_BLOCKED,
          ctx,
          buildCrMergeBlockedBody({
            prNumber: number,
            expected,
            before,
            blockers: ['head_ref_invalid'],
          }),
          forgeError(
            ERROR_CODES.INVALID_ARGS,
            sanitizeField(err.forgeError?.message || err.message || err.invalidArgs)
              || 'Head branch ref invalid',
          ),
        );
      }
      try {
        forgeHeadRefSha = await provider.branchHeadSha(ctx, headRef, {
          repoId: view.forge_source_repo_id ?? null,
        });
      } catch (err) {
        if (err.forgeError?.code === ERROR_CODES.INVALID_ARGS) {
          throw err;
        }
        const before = buildMergeExecuteBeforeFacts(
      view,
      checks,
      mergePlanBody,
      null,
      ctx.mergePolicy,
    );
        return forgePacket(
          PACKET_TYPES.CR_MERGE_BLOCKED,
          ctx,
          buildCrMergeBlockedBody({
            prNumber: number,
            expected,
            before,
            blockers: ['head_ref_unreadable'],
          }),
          forgeError(
            ERROR_CODES.MERGE_BLOCKED,
            sanitizeField(err.forgeError?.message || err.message) || 'Head branch ref unreadable',
            err.status ?? err.forgeError?.status ?? null,
          ),
        );
      }
    }

    const before = buildMergeExecuteBeforeFacts(
      view,
      checks,
      mergePlanBody,
      forgeHeadRefSha,
      ctx.mergePolicy,
    );
    const blockers = collectMergeExecuteBlockers(
      view,
      checks,
      mergePlanBody,
      expected,
      { forgeHeadRefSha, mergePolicy: ctx.mergePolicy },
    );

    if (blockers.length > 0) {
      return forgePacket(
        PACKET_TYPES.CR_MERGE_BLOCKED,
        ctx,
        buildCrMergeBlockedBody({ prNumber: number, expected, before, blockers }),
        forgeError(ERROR_CODES.MERGE_BLOCKED, 'Merge blocked by preflight'),
      );
    }

    try {
      const providerResult = await provider.mergeExecute(ctx, {
        number,
        method,
        expectedHeadSha: expected.headSha,
      });
      const merge = buildMergeExecuteMergeFacts(method, providerResult);
      const after = buildMergeExecuteAfterFacts(view, providerResult);
      return forgePacket(
        PACKET_TYPES.CR_MERGED,
        ctx,
        buildCrMergedBody({ prNumber: number, expected, before, merge, after }),
      );
    } catch (err) {
      const status = err.status ?? err.forgeError?.status ?? null;
      const blockers =
        Array.isArray(err.mergeBlockedBlockers) && err.mergeBlockedBlockers.length > 0
          ? err.mergeBlockedBlockers
          : ['merge_endpoint_failed'];
      const fe =
        err.forgeError
        ?? forgeError(
          ERROR_CODES.MERGE_ENDPOINT_FAILED,
          sanitizeField(err.message) || 'Forge merge request failed',
          status,
        );
      return forgePacket(
        PACKET_TYPES.CR_MERGE_BLOCKED,
        ctx,
        buildCrMergeBlockedBody({
          prNumber: number,
          expected,
          before,
          blockers,
        }),
        fe,
      );
    }
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
      'Unknown command. Try: provider capabilities, repo status, refs compare, refs inventory, cr inventory, cr files, cr comments, cr open, status set, forge changes, pr view, pr checks, merge plan, merge execute, sync plan, whoami, branch protection',
    ),
  });
}
