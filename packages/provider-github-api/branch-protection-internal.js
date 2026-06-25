/** @type {((ctx: object, opts: { branchRef: string }) => Promise<object>) | null} */
let branchProtectionImpl = null;

export function setBranchProtectionImpl(fn) {
  branchProtectionImpl = fn;
}

export async function resolveBranchProtection(ctx, opts) {
  if (typeof branchProtectionImpl !== 'function') {
    throw new Error('branch protection impl not registered');
  }
  return branchProtectionImpl(ctx, opts);
}
