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
  'sync_plan',
];

describe('doc consistency (beta.4 capabilities)', () => {
  it('WRITE_COMMAND_IDS matches documented write rails', () => {
    expect([...WRITE_COMMAND_IDS].sort()).toEqual(['cr_open', 'status_set']);
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

    it('does not flatly deny opening PRs', () => {
      expect(skill).not.toMatch(/does not execute merges or open PRs/);
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
