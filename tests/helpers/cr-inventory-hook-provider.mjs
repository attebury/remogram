import { crInventory } from '@remogram/core';
import { createMockProvider } from './mock-provider.mjs';

/**
 * Provider wired like provider-gitea-api crInventorySlice: real core aggregation
 * over hookable listOpenPulls / prView / prChecks — no canned crInventory stub.
 */
export function createCrInventoryHookProvider(hooks = {}) {
  const base = createMockProvider();
  const listOpenPulls = hooks.listOpenPulls ?? base.listOpenPulls;
  const prView = hooks.prView ?? base.prView;
  const prChecks = hooks.prChecks ?? base.prChecks;
  const listOpenPullsWithMeta = hooks.listOpenPullsWithMeta;

  const sliceHooks = { listOpenPulls, prView, prChecks };
  if (listOpenPullsWithMeta) {
    sliceHooks.listOpenPullsWithMeta = listOpenPullsWithMeta;
  }

  const { crInventory: _stub, ...rest } = base;
  return {
    ...rest,
    listOpenPulls,
    prView,
    prChecks,
    ...(listOpenPullsWithMeta ? { listOpenPullsWithMeta } : {}),
    crInventory: (ctx, opts = {}) => crInventory(ctx, sliceHooks, opts),
  };
}
