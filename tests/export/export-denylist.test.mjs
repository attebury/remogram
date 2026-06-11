import { describe, it, expect } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '../..');
const exportScript = join(repoRoot, 'scripts/export-public-main.sh');
const dogfoodList = join(repoRoot, 'scripts/dogfood-skills.list');

const STATIC_DENYLIST = [
  'topo',
  '.gitea',
  '.tmp',
  'dx',
  'topogram.project.json',
  'topogram.sdlc-policy.json',
  'scripts/install-topogram-local.sh',
  'scripts/park-topogram-skills.sh',
  'scripts/dogfood-skills.list',
  'scripts/remogram-smoke-compare.mjs',
  '.cursor/rules/remogram-maintainer.mdc',
];

function readDogfoodSkills() {
  return readFileSync(dogfoodList, 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
}

function applyExportDenylist(root) {
  for (const rel of STATIC_DENYLIST) {
    rmSync(join(root, rel), { recursive: true, force: true });
  }
  for (const skill of readDogfoodSkills()) {
    rmSync(join(root, 'tools/remogram-agent-support/skills', skill), { recursive: true, force: true });
    rmSync(join(root, '.cursor/skills', skill), { recursive: true, force: true });
  }
}

describe('export-public-main denylist', () => {
  it('export script documents static denylist paths', () => {
    const script = readFileSync(exportScript, 'utf8');
    for (const rel of STATIC_DENYLIST) {
      expect(script).toContain(rel);
    }
    expect(script).toContain('dogfood-skills.list');
  });

  it('removes private paths from exported tree fixture', () => {
    const fixtureRoot = join(repoRoot, 'tests/fixtures/export-denylist/tree');
    mkdirSync(join(fixtureRoot, 'topo/sdlc'), { recursive: true });
    mkdirSync(join(fixtureRoot, '.gitea'), { recursive: true });
    mkdirSync(join(fixtureRoot, 'tools/remogram-agent-support/skills/remogram-dogfood'), { recursive: true });
    writeFileSync(join(fixtureRoot, 'topo/sdlc/secret.tg'), 'private\n');
    writeFileSync(join(fixtureRoot, 'README.md'), 'public\n');

    applyExportDenylist(fixtureRoot);

    expect(existsSync(join(fixtureRoot, 'topo'))).toBe(false);
    expect(existsSync(join(fixtureRoot, '.gitea'))).toBe(false);
    expect(existsSync(join(fixtureRoot, 'tools/remogram-agent-support/skills/remogram-dogfood'))).toBe(false);
    expect(existsSync(join(fixtureRoot, 'README.md'))).toBe(true);
  });
});
