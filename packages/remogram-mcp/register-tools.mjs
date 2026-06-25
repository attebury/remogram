import { z } from 'zod';
import { normalizeAllowedPaths } from '@remogram/core';
import { runRemogramCli, packetToMcpContent } from './run-cli.mjs';

/** @internal Build CLI argv for merge_plan MCP tool (exported for transport tests). */
export function mergePlanMcpCliArgs(input) {
  const a = ['merge', 'plan', '--number', String(input.number)];
  for (const glob of normalizeAllowedPaths(input.allowed_paths ?? []) ?? []) {
    a.push('--allowed-path', glob);
  }
  return a;
}

export function registerTools(server) {
  const tools = [
    {
      name: 'doctor',
      description: 'Read-only provider readiness diagnostics for config, remote trust, auth, capabilities, and checks.',
      inputSchema: z.object({
        live: z
          .boolean()
          .optional()
          .describe('When true, perform a bounded live forge API reachability probe'),
      }),
      args: (input) => (input.live ? ['doctor', '--live'] : ['doctor']),
    },
    {
      name: 'provider_capabilities',
      description: 'Structured provider capability facts for commands, auth, checks, host binding, pagination, and write support.',
      inputSchema: z.object({}),
      args: ['provider', 'capabilities'],
    },
    {
      name: 'repo_status',
      description: 'Forge repo status facts (auth, capabilities, default branch).',
      inputSchema: z.object({}),
      args: ['repo', 'status'],
    },
    {
      name: 'ref_compare',
      description: 'Compare two refs with exact SHAs and ahead/behind counts.',
      inputSchema: z.object({
        base: z.string().describe('Base ref'),
        head: z.string().describe('Head ref'),
      }),
      args: (input) => ['refs', 'compare', '--base', input.base, '--head', input.head],
    },
    {
      name: 'ref_inventory',
      description: 'List repository refs with SHAs, default branch hint, and optional ancestry hints.',
      inputSchema: z.object({}),
      args: ['refs', 'inventory'],
    },
    {
      name: 'cr_inventory',
      description: 'Aggregate open change requests with checks and merge-plan facts into a semantic-diff slice.',
      inputSchema: z.object({
        slice_ref: z.string().optional().describe('Optional slice ref label for consumers'),
        limit: z.number().int().positive().optional().describe('Max open CR entries (default 3)'),
        sort: z
          .enum(['number_asc', 'number_desc', 'recent_update', 'recent_created'])
          .optional()
          .describe('Open-list slice sort preset (default number_asc)'),
        cursor: z.string().optional().describe('Opaque cursor from prior cr_inventory next_cursor'),
      }),
      args: (input) => {
        const a = ['cr', 'inventory'];
        if (input.slice_ref) a.push('--slice-ref', input.slice_ref);
        if (input.limit != null) a.push('--limit', String(input.limit));
        if (input.sort) a.push('--sort', input.sort);
        if (input.cursor) a.push('--cursor', input.cursor);
        return a;
      },
    },
    {
      name: 'issue_inventory',
      description: 'Aggregate open issues into a semantic-diff inventory slice with pagination cursors.',
      inputSchema: z.object({
        slice_ref: z.string().optional().describe('Optional slice ref label for consumers'),
        limit: z.number().int().positive().optional().describe('Max open issue entries (default 3)'),
        sort: z
          .enum(['number_asc', 'number_desc', 'recent_update', 'recent_created'])
          .optional()
          .describe('Open-list slice sort preset (default number_asc)'),
        cursor: z.string().optional().describe('Opaque cursor from prior issue_inventory next_cursor'),
      }),
      args: (input) => {
        const a = ['issue', 'inventory'];
        if (input.slice_ref) a.push('--slice-ref', input.slice_ref);
        if (input.limit != null) a.push('--limit', String(input.limit));
        if (input.sort) a.push('--sort', input.sort);
        if (input.cursor) a.push('--cursor', input.cursor);
        return a;
      },
    },
    {
      name: 'cr_open',
      description: 'Open a change request (pull request) on the configured forge.',
      inputSchema: z.object({
        head: z.string().describe('Head branch ref'),
        base: z.string().describe('Base branch ref'),
        title: z.string().describe('Change request title'),
        body: z.string().optional().describe('Optional change request body'),
        idempotency_key: z
          .string()
          .optional()
          .describe('Optional agent idempotency key for retry-safe writes'),
      }),
      args: (input) => {
        const a = ['cr', 'open', '--head', input.head, '--base', input.base, '--title', input.title];
        if (input.body) a.push('--body', input.body);
        if (input.idempotency_key) a.push('--idempotency-key', input.idempotency_key);
        return a;
      },
      readOnlyHint: false,
      destructiveHint: true,
    },
    {
      name: 'status_set',
      description: 'Set a commit status (check context) on the configured forge.',
      inputSchema: z.object({
        sha: z.string().describe('40-character commit SHA'),
        context: z.string().describe('Status context name'),
        state: z.enum(['pending', 'success', 'failure', 'error']).describe('Status state'),
        target_url: z.string().optional().describe('Optional target URL for the status'),
        description: z.string().optional().describe('Optional status description'),
        idempotency_key: z
          .string()
          .optional()
          .describe('Optional agent idempotency key for retry-safe writes'),
      }),
      args: (input) => {
        const a = [
          'status',
          'set',
          '--sha',
          input.sha,
          '--context',
          input.context,
          '--state',
          input.state,
        ];
        if (input.target_url) a.push('--target-url', input.target_url);
        if (input.description) a.push('--description', input.description);
        if (input.idempotency_key) a.push('--idempotency-key', input.idempotency_key);
        return a;
      },
      readOnlyHint: false,
      destructiveHint: true,
    },
    {
      name: 'issue_open',
      description: 'Open a forge issue on the configured repository (Gitea v1).',
      inputSchema: z.object({
        title: z.string().describe('Issue title'),
        body: z.string().optional().describe('Optional issue body'),
        idempotency_key: z
          .string()
          .optional()
          .describe('Optional agent idempotency key for retry-safe writes'),
      }),
      args: (input) => {
        const a = ['issue', 'open', '--title', input.title];
        if (input.body) a.push('--body', input.body);
        if (input.idempotency_key) a.push('--idempotency-key', input.idempotency_key);
        return a;
      },
      readOnlyHint: false,
      destructiveHint: true,
    },
    {
      name: 'issue_view',
      description: 'Issue metadata facts with optional linked change request snapshot.',
      inputSchema: z.object({
        number: z.number().int().positive(),
      }),
      args: (input) => ['issue', 'view', '--number', String(input.number)],
    },
    {
      name: 'issue_comments',
      description: 'Issue comments (sanitized bodies, truncation-aware).',
      inputSchema: z.object({
        number: z.number().int().positive(),
      }),
      args: (input) => ['issue', 'comments', '--number', String(input.number)],
    },
    {
      name: 'pr_status',
      description: 'PR metadata and mergeability facts.',
      inputSchema: z.object({
        number: z.number().int().positive(),
      }),
      args: (input) => ['pr', 'view', '--number', String(input.number)],
    },
    {
      name: 'pr_checks',
      description: 'CI/check conclusions for a PR number or git ref.',
      inputSchema: z
        .object({
          number: z.number().int().positive().optional(),
          ref: z.string().optional(),
        })
        .refine(
          (input) => input.number != null || (input.ref != null && input.ref.trim() !== ''),
          { message: '--number or --ref required for pr checks' },
        ),
      args: (input) => {
        const a = ['pr', 'checks'];
        if (input.number != null) a.push('--number', String(input.number));
        if (input.ref) a.push('--ref', input.ref);
        return a;
      },
    },
    {
      name: 'merge_plan',
      description: 'Merge readiness facts: mergeability, checks, blockers.',
      inputSchema: z.object({
        number: z.number().int().positive(),
        allowed_paths: z.array(z.string()).optional(),
      }),
      args: mergePlanMcpCliArgs,
    },
    {
      name: 'whoami',
      description: 'Authenticated forge identity facts (login, can_write, token scope/expiry signals).',
      inputSchema: z.object({}),
      args: ['whoami'],
    },
    {
      name: 'branch_protection',
      description:
        'Branch protection policy facts: required status contexts, protected rules, approvals signal.',
      inputSchema: z.object({
        branch_ref: z.string(),
      }),
      args: (input) => ['branch', 'protection', '--branch-ref', input.branch_ref],
    },
    {
      name: 'cr_files',
      description: 'Changed file paths for a change request (bounded, truncation-aware).',
      inputSchema: z.object({
        number: z.number().int().positive(),
      }),
      args: (input) => ['cr', 'files', '--number', String(input.number)],
    },
    {
      name: 'cr_comments',
      description: 'Review comments for a change request (sanitized bodies, truncation-aware).',
      inputSchema: z.object({
        number: z.number().int().positive(),
      }),
      args: (input) => ['cr', 'comments', '--number', String(input.number)],
    },
    {
      name: 'forge_changes',
      description:
        'Forge activity events since an observed_at boundary (PR lifecycle, head SHA moves, check conclusions).',
      inputSchema: z.object({
        since: z.string().optional().describe('ISO-8601 observed_at boundary (required on first page)'),
        cursor: z.string().optional().describe('Opaque cursor from prior forge_changes next_cursor'),
        limit: z.number().int().positive().optional().describe('Events per page (default 64)'),
        include_issues: z.boolean().optional().describe('Include issue open/close lifecycle events'),
      }),
      args: (input) => {
        const a = ['forge', 'changes'];
        if (input.since) a.push('--since', input.since);
        if (input.cursor) a.push('--cursor', input.cursor);
        if (input.limit != null) a.push('--limit', String(input.limit));
        if (input.include_issues === true) a.push('--include-issues');
        return a;
      },
    },
    {
      name: 'verify_bind',
      description: 'Create a verify_bind packet bound to a target SHA and optional proof metadata.',
      inputSchema: z.object({
        target_sha: z.string().describe('40-character verified target SHA'),
        verifier: z.string().optional().describe('Verifier identity or lane label'),
        proof_url: z.string().optional().describe('Verification proof URL'),
        note: z.string().optional().describe('Optional verification notes'),
      }),
      args: (input) => {
        const a = ['verify', 'bind', '--target-sha', input.target_sha];
        if (input.verifier) a.push('--verifier', input.verifier);
        if (input.proof_url) a.push('--proof-url', input.proof_url);
        if (input.note) a.push('--note', input.note);
        return a;
      },
    },
    {
      name: 'review_bundle',
      description: 'Create a review_bundle packet for reviewed head/base, decision, and summary facts.',
      inputSchema: z.object({
        number: z.number().int().positive(),
        reviewed_head_sha: z.string().optional(),
        reviewed_base_sha: z.string().optional(),
        decision: z.enum(['approved', 'changes_requested', 'commented']).optional(),
        summary: z.string().optional(),
      }),
      args: (input) => {
        const a = ['review', 'bundle', '--number', String(input.number)];
        if (input.reviewed_head_sha) a.push('--reviewed-head-sha', input.reviewed_head_sha);
        if (input.reviewed_base_sha) a.push('--reviewed-base-sha', input.reviewed_base_sha);
        if (input.decision) a.push('--decision', input.decision);
        if (input.summary) a.push('--summary', input.summary);
        return a;
      },
    },
    {
      name: 'issue_bundle',
      description: 'Create an issue_bundle packet for issue lifecycle and linked review context.',
      inputSchema: z.object({
        issue_number: z.number().int().positive(),
        state: z.enum(['open', 'closed']).optional(),
        title: z.string().optional(),
        url: z.string().optional(),
        linked_pr: z.number().int().positive().optional(),
      }),
      args: (input) => {
        const a = ['issue', 'bundle', '--issue-number', String(input.issue_number)];
        if (input.state) a.push('--state', input.state);
        if (input.title) a.push('--title', input.title);
        if (input.url) a.push('--url', input.url);
        if (input.linked_pr != null) a.push('--linked-pr', String(input.linked_pr));
        return a;
      },
    },
    {
      name: 'merge_execute',
      description: 'Execute a forge merge for an open change request after SHA-bound preflight.',
      inputSchema: z.object({
        number: z.number().int().positive(),
        expected_base_sha: z.string().describe('Expected base SHA (40 hex chars)'),
        expected_head_sha: z.string().describe('Expected head SHA (40 hex chars)'),
        method: z.enum(['merge']).optional().describe('Merge method (v1: merge only)'),
      }),
      args: (input) => {
        const a = [
          'merge',
          'execute',
          '--number',
          String(input.number),
          '--expected-base-sha',
          input.expected_base_sha,
          '--expected-head-sha',
          input.expected_head_sha,
        ];
        if (input.method) a.push('--method', input.method);
        return a;
      },
      readOnlyHint: false,
      destructiveHint: true,
    },
    {
      name: 'sync_plan',
      description: 'Local vs remote sync facts and divergent-remote blockers.',
      inputSchema: z.object({
        remote: z.string().optional(),
      }),
      args: (input) => {
        const a = ['sync', 'plan'];
        if (input.remote) a.push('--remote', input.remote);
        return a;
      },
    },
    {
      name: 'command_contract_export',
      description: 'Read command contract metadata for all commands or one command key.',
      inputSchema: z.object({
        command: z.string().optional().describe('Optional command key, for example "issue inventory"'),
      }),
      args: (input) => {
        const a = ['contract'];
        if (input.command) a.push('--command', input.command);
        return a;
      },
    },
  ];

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnlyHint !== false,
          destructiveHint: tool.destructiveHint === true,
        },
      },
      async (input) => {
        const args = typeof tool.args === 'function' ? tool.args(input) : tool.args;
        const result = await runRemogramCli(args);
        const truncated = result.stdoutTruncated || result.stderrTruncated;
        return packetToMcpContent(result.stdout, result.stderr, result.code, truncated);
      },
    );
  }
}
