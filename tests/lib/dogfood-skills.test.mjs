import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertSkillDirParity,
  cursorMirrorSkillNames,
  loadDogfoodSkillNames,
} from "./dogfood-skills.mjs";

describe("dogfood-skills helper", () => {
  it("N1 assertSkillDirParity fails when SKILL.md content diverges", () => {
    const root = mkdtempSync(join(tmpdir(), "dogfood-skills-"));
    const canonicalRoot = join(root, "canonical");
    const cursorRoot = join(root, "cursor");
    mkdirSync(join(canonicalRoot, "remogram-core"), { recursive: true });
    mkdirSync(join(cursorRoot, "remogram-core"), { recursive: true });
    writeFileSync(join(canonicalRoot, "remogram-core", "SKILL.md"), "canonical\n");
    writeFileSync(join(cursorRoot, "remogram-core", "SKILL.md"), "cursor\n");

    expect(() => assertSkillDirParity(canonicalRoot, cursorRoot, "remogram-core")).toThrow(
      /remogram-core\/SKILL\.md/
    );

    rmSync(root, { recursive: true, force: true });
  });

  it("N2 assertSkillDirParity fails when references file missing in cursor copy", () => {
    const root = mkdtempSync(join(tmpdir(), "dogfood-skills-"));
    const canonicalRoot = join(root, "canonical");
    const cursorRoot = join(root, "cursor");
    mkdirSync(join(canonicalRoot, "remogram-dogfood", "references"), { recursive: true });
    mkdirSync(join(cursorRoot, "remogram-dogfood"), { recursive: true });
    writeFileSync(join(canonicalRoot, "remogram-dogfood", "SKILL.md"), "skill\n");
    writeFileSync(join(cursorRoot, "remogram-dogfood", "SKILL.md"), "skill\n");
    writeFileSync(join(canonicalRoot, "remogram-dogfood", "references", "lane-prompts.md"), "refs\n");

    expect(() => assertSkillDirParity(canonicalRoot, cursorRoot, "remogram-dogfood")).toThrow(
      /remogram-dogfood/
    );

    rmSync(root, { recursive: true, force: true });
  });

  it("N3 loadDogfoodSkillNames uses fallback when list file missing", () => {
    const names = loadDogfoodSkillNames(join(tmpdir(), "missing-dogfood-skills.list"));
    expect(names).toContain("remogram-dogfood");
    expect(names).toContain("remogram-observer");
  });

  it("X2 cursorMirrorSkillNames includes remogram-core after dogfood list skills", () => {
    const names = cursorMirrorSkillNames(join(import.meta.dirname, "../../scripts/dogfood-skills.list"));
    expect(names.at(-1)).toBe("remogram-core");
    expect(names).toContain("remogram-sdlc-core");
  });
});
