import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildMergeAllowedPaths,
  STATIC_MERGE_GLOBS,
} from "../../scripts/dogfood-merge-allowed-paths.mjs";
import { cursorMirrorSkillNames } from "../lib/dogfood-skills.mjs";

describe("dogfood-merge-allowed-paths", () => {
  it("P4 buildMergeAllowedPaths includes all mirror skills and static globs", () => {
    const payload = buildMergeAllowedPaths();
    expect(payload.static_globs).toEqual(STATIC_MERGE_GLOBS);
    expect(payload.mirror_skills).toEqual(
      cursorMirrorSkillNames(join(import.meta.dirname, "../../scripts/dogfood-skills.list"))
    );
    for (const skill of payload.mirror_skills) {
      expect(payload.skill_globs).toContain(`.cursor/skills/${skill}/**`);
    }
    expect(payload.skill_globs).not.toContain(".cursor/skills/**");
  });

  it("N3 buildMergeAllowedPaths uses fallback dogfood list when file missing", () => {
    const root = mkdtempSync(join(tmpdir(), "dogfood-merge-paths-"));
    const missingList = join(root, "missing-dogfood-skills.list");
    const payload = buildMergeAllowedPaths({ dogfoodListPath: missingList });
    expect(payload.dogfood_skills).toContain("remogram-dogfood");
    expect(payload.mirror_skills).toContain("remogram-core");
    rmSync(root, { recursive: true, force: true });
  });

  it("X2 skill_globs names match cursorMirrorSkillNames", () => {
    const listPath = join(import.meta.dirname, "../../scripts/dogfood-skills.list");
    const payload = buildMergeAllowedPaths({ dogfoodListPath: listPath });
    const expected = cursorMirrorSkillNames(listPath).map((skill) => `.cursor/skills/${skill}/**`);
    expect(payload.skill_globs).toEqual(expected);
  });
});
