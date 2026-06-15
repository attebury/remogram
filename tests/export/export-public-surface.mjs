import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Public Topogram allowlist — single source of truth for export regression gate.
 *
 * Topogram may appear on the public export surface only as provenance:
 * - README/llms.txt: "developed by and for Topogram" + https://topogram.dev
 * - CHANGELOG.md: historical release notes (no rewrite of shipped notes)
 *
 * Not allowed on public surface:
 * - Operational skill-mixing / lane / park-topogram guidance
 * - topogram CLI examples or topo/ path pointers in agent-facing docs
 * - "Topogram owns/interprets" authority-split language (use neutral planning-tool wording)
 */

export const TOPOGRAM_ALLOWLIST_PATTERNS = [
  /developed by and for/i,
  /Developed by and for Topogram/i,
  /https:\/\/topogram\.dev/i,
  /\[Topogram\]\(https:\/\/topogram\.dev\)/i,
];

/** Paths scanned after export denylist + maintainer-block stripping. */
export const PUBLIC_SURFACE_ROOTS = [
  'README.md',
  'AGENTS.md',
  'llms.txt',
  'CHANGELOG.md',
  'tools/remogram-agent-support/README.md',
  'tools/remogram-agent-support/skills/remogram-consumer',
  'tools/remogram-agent-support/skills/remogram-core',
  'tools/remogram-agent-support/adapters',
  'packages',
];

const MAINTAINER_STRIPPED_FILES = new Set([
  'AGENTS.md',
  'README.md',
  'tools/remogram-agent-support/README.md',
]);

export function stripMaintainerBlocks(text) {
  return text.replace(/\n<!-- maintainer-only:start -->[\s\S]*?<!-- maintainer-only:end -->\n?/gm, '\n');
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      walkFiles(path, out);
    } else if (name === 'remogram-maintainer.mdc') {
      continue;
    } else {
      out.push(path);
    }
  }
  return out;
}

export function collectPublicSurfaceFiles(root) {
  const files = [];
  for (const rel of PUBLIC_SURFACE_ROOTS) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const st = statSync(path);
    if (st.isDirectory()) {
      files.push(...walkFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}

function readPublicSurfaceText(root, relPath) {
  const text = readFileSync(join(root, relPath), 'utf8');
  return MAINTAINER_STRIPPED_FILES.has(relPath) ? stripMaintainerBlocks(text) : text;
}

export function findDisallowedTopogramMentions(root) {
  const violations = [];
  for (const file of collectPublicSurfaceFiles(root)) {
    const rel = relative(root, file);
    const sourceRel = MAINTAINER_STRIPPED_FILES.has(rel)
      ? rel
      : rel;
    const text = MAINTAINER_STRIPPED_FILES.has(rel)
      ? readPublicSurfaceText(root, rel)
      : readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!/topogram/i.test(lines[i])) continue;
      const allowed =
        rel === 'CHANGELOG.md' ||
        TOPOGRAM_ALLOWLIST_PATTERNS.some((pattern) => pattern.test(lines[i]));
      if (!allowed) {
        violations.push({ file: sourceRel, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return violations;
}
