import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const DOGFOOD_SKILLS_FALLBACK = [
  "remogram-dogfood",
  "remogram-sdlc-core",
  "remogram-plan-lane",
  "remogram-implement-lane",
  "remogram-reviewer",
  "remogram-verify-lane",
  "remogram-merge-lane",
  "remogram-integration-lane",
  "remogram-observer",
];

export const CURSOR_MIRROR_EXTRA_SKILLS = ["remogram-core"];

export function parseDogfoodSkillList(text) {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

export function loadDogfoodSkillNames(dogfoodListPath) {
  if (!existsSync(dogfoodListPath)) {
    return [...DOGFOOD_SKILLS_FALLBACK];
  }
  return parseDogfoodSkillList(readFileSync(dogfoodListPath, "utf8"));
}

export function cursorMirrorSkillNames(dogfoodListPath) {
  return [...loadDogfoodSkillNames(dogfoodListPath), ...CURSOR_MIRROR_EXTRA_SKILLS];
}

export function listSkillRelativeFiles(skillDir) {
  if (!existsSync(skillDir)) {
    return [];
  }

  const files = [];
  function walk(currentDir) {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const absolute = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (entry.isFile()) {
        files.push(relative(skillDir, absolute));
      }
    }
  }
  walk(skillDir);
  return files.sort();
}

export function assertSkillDirParity(canonicalRoot, cursorRoot, skillName) {
  const canonicalDir = join(canonicalRoot, skillName);
  const cursorDir = join(cursorRoot, skillName);

  if (!existsSync(canonicalDir)) {
    throw new Error(`canonical skill directory missing for ${skillName}: ${canonicalDir}`);
  }
  if (!existsSync(cursorDir)) {
    throw new Error(`cursor skill directory missing for ${skillName}: ${cursorDir}`);
  }

  const canonicalFiles = listSkillRelativeFiles(canonicalDir);
  const cursorFiles = listSkillRelativeFiles(cursorDir);

  if (canonicalFiles.join("\0") !== cursorFiles.join("\0")) {
    throw new Error(
      `skill file tree mismatch for ${skillName}: canonical=[${canonicalFiles.join(", ")}] cursor=[${cursorFiles.join(", ")}]`
    );
  }

  for (const rel of canonicalFiles) {
    const canonicalPath = join(canonicalDir, rel);
    const cursorPath = join(cursorDir, rel);
    const canonicalStat = statSync(canonicalPath);
    const cursorStat = statSync(cursorPath);
    if (!canonicalStat.isFile() || !cursorStat.isFile()) {
      throw new Error(`expected regular files for ${skillName}/${rel}`);
    }
    const canonicalText = readFileSync(canonicalPath, "utf8");
    const cursorText = readFileSync(cursorPath, "utf8");
    if (canonicalText !== cursorText) {
      throw new Error(`skill content mismatch for ${skillName}/${rel}`);
    }
  }
}
