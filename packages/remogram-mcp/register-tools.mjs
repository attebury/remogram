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
      }),
      args: (input) => ['merge', 'plan', '--number', String(input.number)],
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
        annotations: { readOnlyHint: true, destructiveHint: false },
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
