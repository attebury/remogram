import { sanitizeField } from './caps.js';

export const MAX_BRANCH_PROTECTION_STATUS_CONTEXTS = 64;
export const MAX_BRANCH_PROTECTION_RULES = 32;

/** Gitea exposes required_approvals on branch protection; omit when unavailable. */
export function unimplementedApprovalsRequiredSignal() {
  return { implemented: false, count: null };
}

function sanitizeStringList(values, maxItems) {
  if (!Array.isArray(values)) return [];
  const out = [];
  for (const value of values) {
    if (out.length >= maxItems) break;
    const sanitized = sanitizeField(value);
    if (sanitized) out.push(sanitized);
  }
  return out;
}

function normalizeApprovalsRequired(signal) {
  if (signal == null || typeof signal !== 'object') {
    return unimplementedApprovalsRequiredSignal();
  }
  if (signal.implemented === false) {
    return { implemented: false, count: null };
  }
  if (signal.implemented === true) {
    if (signal.count == null) {
      return { implemented: true, count: null };
    }
    const count = Number(signal.count);
    if (!Number.isFinite(count) || count < 0) {
      return { implemented: true, count: null };
    }
    return { implemented: true, count: Math.floor(count) };
  }
  return unimplementedApprovalsRequiredSignal();
}

export function buildBranchProtectionBody({
  branch_ref,
  required_status_contexts,
  protected_branch_rules,
  approvals_required,
}) {
  const rules = (Array.isArray(protected_branch_rules) ? protected_branch_rules : [])
    .slice(0, MAX_BRANCH_PROTECTION_RULES)
    .map((rule) => {
      const name =
        rule != null && typeof rule === 'object'
          ? sanitizeField(rule.name)
          : sanitizeField(rule);
      return name ? { name } : null;
    })
    .filter(Boolean);

  return {
    branch_ref: sanitizeField(branch_ref),
    required_status_contexts: sanitizeStringList(
      required_status_contexts,
      MAX_BRANCH_PROTECTION_STATUS_CONTEXTS,
    ),
    protected_branch_rules: rules,
    approvals_required: normalizeApprovalsRequired(approvals_required),
  };
}

export function buildBranchProtectionFromGitLabProtection(
  branchRef,
  { protectedBranch = null, approvalRules = [] } = {},
) {
  if (protectedBranch == null) {
    return buildBranchProtectionBody({
      branch_ref: branchRef,
      required_status_contexts: [],
      protected_branch_rules: [],
      approvals_required: unimplementedApprovalsRequiredSignal(),
    });
  }
  const ruleName = sanitizeField(protectedBranch.name ?? branchRef);
  let approvals_required = unimplementedApprovalsRequiredSignal();
  if (Array.isArray(approvalRules) && approvalRules.length > 0) {
    const counts = approvalRules
      .map((rule) => Number(rule.approvals_required))
      .filter((count) => Number.isFinite(count) && count >= 0);
    if (counts.length > 0) {
      approvals_required = { implemented: true, count: Math.max(...counts) };
    }
  }
  return buildBranchProtectionBody({
    branch_ref: branchRef,
    required_status_contexts: [],
    protected_branch_rules: ruleName ? [{ name: ruleName }] : [],
    approvals_required,
  });
}

export function buildBranchProtectionFromGitHubProtection(branchRef, protectionPayload) {
  if (protectionPayload == null) {
    return buildBranchProtectionBody({
      branch_ref: branchRef,
      required_status_contexts: [],
      protected_branch_rules: [],
      approvals_required: unimplementedApprovalsRequiredSignal(),
    });
  }
  const payload =
    protectionPayload != null && typeof protectionPayload === 'object' ? protectionPayload : {};
  const required_status_contexts = sanitizeStringList(
    payload.required_status_checks?.contexts,
    MAX_BRANCH_PROTECTION_STATUS_CONTEXTS,
  );
  let approvals_required = unimplementedApprovalsRequiredSignal();
  const reviews = payload.required_pull_request_reviews;
  if (reviews != null && typeof reviews === 'object' && 'required_approving_review_count' in reviews) {
    const count = Number(reviews.required_approving_review_count);
    if (Number.isFinite(count) && count >= 0) {
      approvals_required = { implemented: true, count: Math.floor(count) };
    }
  }
  const ruleName = sanitizeField(branchRef);
  return buildBranchProtectionBody({
    branch_ref: branchRef,
    required_status_contexts,
    protected_branch_rules: ruleName ? [{ name: ruleName }] : [],
    approvals_required,
  });
}

export function buildBranchProtectionFromGiteaProtection(branchRef, protectionPayload) {
  const payload =
    protectionPayload != null && typeof protectionPayload === 'object' ? protectionPayload : {};
  const ruleName = sanitizeField(payload.branch_name ?? payload.rule_name ?? branchRef);
  const required_status_contexts =
    payload.enable_status_check === false
      ? []
      : sanitizeStringList(payload.status_check_contexts, MAX_BRANCH_PROTECTION_STATUS_CONTEXTS);

  let approvals_required = unimplementedApprovalsRequiredSignal();
  if ('required_approvals' in payload) {
    const count = Number(payload.required_approvals);
    if (Number.isFinite(count) && count >= 0) {
      approvals_required = { implemented: true, count: Math.floor(count) };
    }
  }

  return buildBranchProtectionBody({
    branch_ref: branchRef,
    required_status_contexts,
    protected_branch_rules: ruleName ? [{ name: ruleName }] : [],
    approvals_required,
  });
}
