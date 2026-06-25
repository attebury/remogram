import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TOPOGRAM_ALLOWLIST_PATTERNS,
  PUBLIC_SURFACE_ROOTS,
  findDisallowedTopogramMentions,
} from './export-public-surface.mjs';

const repoRoot = join(import.meta.dirname, '../..');
const exportScript = join(repoRoot, 'scripts/export-public-main.sh');

describe('public Topogram allowlist', () => {
  it('documents allowlist patterns and public surface roots', () => {
    expect(TOPOGRAM_ALLOWLIST_PATTERNS.length).toBeGreaterThan(0);
    expect(PUBLIC_SURFACE_ROOTS).toContain('README.md');
    expect(PUBLIC_SURFACE_ROOTS).toContain('tools/remogram-agent-support/skills/remogram-consumer');
  });

  it('export script strips maintainer blocks and dogfood paths', () => {
    const script = readFileSync(exportScript, 'utf8');
    expect(script).toContain('maintainer-only:start');
    expect(script).toContain('tools/gitea');
    expect(script).toContain('scripts/run-gitea-gate.sh');
    expect(script).toContain('tools/remogram-agent-support/README.md');
  });

  it('public surface has no disallowed Topogram mentions after maintainer stripping', () => {
    const violations = findDisallowedTopogramMentions(repoRoot);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('dogfood-only paths are excluded from public surface scan', () => {
    expect(PUBLIC_SURFACE_ROOTS).not.toContain('tools/remogram-agent-support/skills/remogram-dogfood');
  });
});

function formatViolations(violations) {
  if (violations.length === 0) return '';
  return violations.map((v) => `${v.file}:${v.line} ${v.text}`).join('\n');
}
