import { z } from 'zod';
import { runRemogramCli, packetToMcpContent } from './run-cli.mjs';

export function registerTools(server) {
  const tools = [
    {
      name: 'doctor',
      description: 'Read-only provider readiness diagnostics for config, remote trust, auth, capabilities, and checks.',
      inputSchema: z.object({}),
      args: ['doctor'],
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
      }),
      args: (input) => {
        const a = ['cr', 'inventory'];
        if (input.slice_ref) a.push('--slice-ref', input.slice_ref);
        if (input.limit != null) a.push('--limit', String(input.limit));
        if (input.sort) a.push('--sort', input.sort);
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
      }),
      args: (input) => {
        const a = ['cr', 'open', '--head', input.head, '--base', input.base, '--title', input.title];
        if (input.body) a.push('--body', input.body);
        return a;
      },
      readOnlyHint: false,
      destructiveHint: true,
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
      args: (input) => {
        const a = ['merge', 'plan', '--number', String(input.number)];
        for (const glob of input.allowed_paths ?? []) {
          a.push('--allowed-path', glob);
        }
        return a;
      },
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
