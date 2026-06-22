import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WRITE_COMMAND_IDS } from '@remogram/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/** MCP tool snake_case names exposed by remogram-mcp (same JSON as CLI). */
const MCP_TOOLS = [
  'doctor',
  'provider_capabilities',
  'repo_status',
  'ref_compare',
  'ref_inventory',
  'cr_inventory',
  'whoami',
  'branch_protection',
  'cr_files',
  'cr_comments',
  'forge_changes',
  'cr_open',
  'status_set',
  'pr_status',
  'pr_checks',
  'merge_plan',
  'merge_execute',
  'sync_plan',
];

describe('doc consistency (beta.4 capabilities)', () => {
  it('WRITE_COMMAND_IDS matches documented write rails', () => {
    expect([...WRITE_COMMAND_IDS].sort()).toEqual(['cr_open', 'issue_open', 'merge', 'status_set']);
  });

  describe('llms.txt', () => {
    const llms = readRepoFile('llms.txt');

    it('mentions write_commands and beta.4', () => {
      expect(llms).toMatch(/write_commands/);
      expect(llms).toMatch(/beta\.4|0\.1\.0-beta\.4/);
    });

    it('mentions both write command ids', () => {
      for (const id of WRITE_COMMAND_IDS) {
        expect(llms).toContain(id);
      }
    });

    it('does not flatly deny PR create without write nuance', () => {
      expect(llms).not.toMatch(/Read\/plan only\. No PR create/);
    });

    it('(#432): cr_open and merge are independent opt-ins', () => {
      expect(llms).toMatch(/cr_open and merge are independent/i);
      expect(llms).toMatch(/merge plan is read-only/i);
    });
  });

  describe('README.md', () => {
    const readme = readRepoFile('README.md');

    it('beta limitations mention write_commands', () => {
      const betaSection = readme.slice(
        readme.indexOf('### Beta limitations'),
        readme.indexOf('## Providers'),
      );
      expect(betaSection).toMatch(/write_commands/);
    });

    it('P1 (#432): documents write command boundaries table', () => {
      expect(readme).toMatch(/Write command boundaries/);
      expect(readme).toMatch(/cr_open.*separate from merge|separate from merge/s);
      expect(readme).toMatch(/merge plan.*does not execute/i);
      expect(readme).toMatch(/cr_open.*does not enable merge/i);
    });

    it('does not claim six read/plan commands', () => {
      expect(readme).not.toMatch(/six read\/plan commands/i);
    });
  });

  describe('examples/mcp/claude-code.md', () => {
    const claude = readRepoFile('examples/mcp/claude-code.md');

    it('lists all MCP tools including write tools', () => {
      for (const tool of MCP_TOOLS) {
        expect(claude).toContain(tool);
      }
    });

    it('documents write_commands gate for MCP writes', () => {
      expect(claude).toMatch(/write_commands/);
      expect(claude).toMatch(/write_not_configured/);
    });
  });

  describe('examples/mcp/README.md', () => {
    const mcpReadme = readRepoFile('examples/mcp/README.md');

    it('P4 (#432): lists merge_execute MCP tool', () => {
      expect(mcpReadme).toContain('merge_execute');
    });

    it('P4 (#432): documents merge as separate write opt-in', () => {
      expect(mcpReadme).toMatch(/cr_open.*does not enable.*merge|merge.*separate opt-in/i);
    });

    it('N1 (#432): states merge_plan is read-only', () => {
      expect(mcpReadme).toMatch(/merge_plan.*read-only|does not execute merges/i);
    });
  });

  describe('remogram-consumer skill', () => {
    const skill = readRepoFile(
      'tools/remogram-agent-support/skills/remogram-consumer/SKILL.md',
    );

    it('includes cr open and status set CLI examples', () => {
      expect(skill).toMatch(/remogram cr open/);
      expect(skill).toMatch(/remogram status set/);
    });

    it('mentions both write command ids', () => {
      for (const id of WRITE_COMMAND_IDS) {
        expect(skill).toContain(id);
      }
    });

    it('P2 (#432): cr_open does not imply merge opt-in', () => {
      const section = skill.slice(
        skill.indexOf('## Write command boundaries'),
        skill.indexOf('## Opt-out bridges'),
      );
      expect(section).toMatch(/cr_open.*does not enable merge/i);
      expect(section).toMatch(/not implied by.*cr_open|not implied by `cr_open`/i);
    });

    it('P3 (#432): merge plan does not execute merges', () => {
      const section = skill.slice(
        skill.indexOf('## Write command boundaries'),
        skill.indexOf('## Opt-out bridges'),
      );
      expect(section).toMatch(/merge plan.*does not execute/i);
    });

    it('N1 (#432): does not claim merge plan performs merge', () => {
      expect(skill).not.toMatch(/merge plan (executes|performs|authorizes) (the )?merge/i);
    });

    it('N2 (#432): does not claim cr_open enables all writes', () => {
      expect(skill).not.toMatch(/cr_open.*enables all writes/i);
      expect(skill).not.toMatch(/write_commands.*cr_open.*all writes/i);
    });

    it('does not flatly deny opening PRs', () => {
      expect(skill).not.toMatch(/does not execute merges or open PRs/);
    });
  });

  describe('remogram-consumer skill friction section', () => {
    const skill = readRepoFile(
      'tools/remogram-agent-support/skills/remogram-consumer/SKILL.md',
    );

    it('P1: documents Runlane friction reporting for remogram (cli_friction or friction report)', () => {
      expect(skill).toMatch(/cli_friction|friction report/);
      expect(skill).toMatch(/tool:\s*remogram|"tool":\s*"remogram"/);
    });

    it('P2: includes all four friction classifications with Remogram commands', () => {
      for (const classification of [
        'contract_gap',
        'tool_bug',
        'infra_blocker',
        'operator_confusion',
      ]) {
        expect(skill).toContain(classification);
      }
      expect(skill).toMatch(/remogram (cr open|pr checks|doctor|provider capabilities)/);
    });

    it('P3: friction evidence cites normalized Remogram packet fields', () => {
      for (const field of [
        'provider_id',
        'check_conclusion',
        'checks_truncated',
        'baseUrl',
      ]) {
        expect(skill).toContain(field);
      }
    });

    it('P4: routes repeated Remogram friction to Remogram repo issues', () => {
      expect(skill).toMatch(/Remogram repo issue/i);
    });

    it('N1: does not claim friction satisfies proof, merge readiness, approval, or SDLC gates', () => {
      const frictionSection = skill.slice(
        skill.indexOf('## CLI friction (Runlane lanes)'),
        skill.indexOf('## Live smoke fixtures'),
      );
      expect(frictionSection).not.toMatch(
        /friction (satisfies|proves|authorizes|approves|clears)/i,
      );
      expect(frictionSection).not.toMatch(
        /friction (is|means|shows|indicates) (merge-ready|ready to merge|proof|approved)/i,
      );
    });

    it('N2: does not instruct pasting raw secrets, tokens, provider bodies, or full stdout', () => {
      expect(skill).not.toMatch(/paste (raw )?(stdout|stderr|token|secret)/i);
      expect(skill).toMatch(/not.*(tokens|raw provider HTTP|stdout\/stderr)/i);
    });

    it('N3: does not add Topogram lane or SDLC fields to Remogram packet examples in friction section', () => {
      const frictionSection = skill.slice(
        skill.indexOf('## CLI friction (Runlane lanes)'),
        skill.indexOf('## Live smoke fixtures'),
      );
      expect(frictionSection).not.toMatch(/sdlc_task|goal_branch|next_actor|canonical_integration_ref/);
    });

    it('N4: does not infer merge readiness from friction entries', () => {
      expect(skill).not.toMatch(/friction.*merge-ready|merge-ready.*friction/i);
      expect(skill).not.toMatch(/friction.*empty blockers/i);
    });

    it('N5: friction tools frozen to runlane, topogram, remogram only', () => {
      const frictionSection = skill.slice(
        skill.indexOf('## CLI friction (Runlane lanes)'),
        skill.indexOf('## Live smoke fixtures'),
      );
      expect(frictionSection).toMatch(/runlane.*topogram.*remogram/);
      expect(frictionSection).not.toMatch(/`gitea`|tool:\s*gitea|"tool":\s*"gitea"/);
    });
  });

  describe('remogram-core skill', () => {
    const skill = readRepoFile(
      'tools/remogram-agent-support/skills/remogram-core/SKILL.md',
    );

    it('includes cr open in first-commands block', () => {
      expect(skill).toMatch(/remogram cr open/);
    });

    it('does not claim six v1 read/plan commands', () => {
      expect(skill).not.toMatch(/six v1 read\/plan commands/i);
    });

    it('describes semantic diff layer as shipped', () => {
      expect(skill).toMatch(/Semantic diff fact layer \(shipped\)/);
    });
  });
});
