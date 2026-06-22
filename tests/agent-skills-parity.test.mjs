import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  assertSkillDirParity,
  cursorMirrorSkillNames,
} from "./lib/dogfood-skills.mjs";

const repoRoot = join(import.meta.dirname, "..");
const canonicalSkillsRoot = join(repoRoot, "tools/remogram-agent-support/skills");
const cursorSkillsRoot = join(repoRoot, ".cursor/skills");
const dogfoodListPath = join(repoRoot, "scripts/dogfood-skills.list");

// Public export strips scripts/dogfood-skills.list and internal skills; parity is dogfood-only.
const describeParity = existsSync(dogfoodListPath) ? describe : describe.skip;

describeParity("dogfood skill mirror parity", () => {
  for (const skill of cursorMirrorSkillNames(dogfoodListPath)) {
    it(`P1 .cursor/skills/${skill} directory matches canonical tools copy`, () => {
      expect(() => assertSkillDirParity(canonicalSkillsRoot, cursorSkillsRoot, skill)).not.toThrow();
    });
  }
});
