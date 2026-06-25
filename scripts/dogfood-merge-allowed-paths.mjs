#!/usr/bin/env node
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cursorMirrorSkillNames,
  loadDogfoodSkillNames,
} from "../tests/lib/dogfood-skills.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dogfoodListPath = join(repoRoot, "scripts/dogfood-skills.list");

export const STATIC_MERGE_GLOBS = [
  "packages/**",
  "tests/**",
  "topo/sdlc/**",
  "topo/providers/**",
  "README.md",
  "CHANGELOG.md",
  "llms.txt",
  "docs/**",
  "examples/mcp/**",
  "scripts/**",
  "tools/remogram-agent-support/**",
];

export function buildMergeAllowedPaths(options = {}) {
  const listPath = options.dogfoodListPath ?? dogfoodListPath;
  const mirrorSkills = cursorMirrorSkillNames(listPath);
  const skill_globs = mirrorSkills.map((skill) => `.cursor/skills/${skill}/**`);
  return {
    skill_globs,
    static_globs: [...STATIC_MERGE_GLOBS],
    mirror_skills: mirrorSkills,
    dogfood_skills: loadDogfoodSkillNames(listPath),
  };
}

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    help: argv.includes("--help") || argv.includes("-h"),
  };
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/dogfood-merge-allowed-paths.mjs [--json]

Emit recommended observer_dispatch.auto_merge.allowed_paths skill globs for
Remogram dogfood. Edit tools/remogram-agent-support/skills, run install script,
then refresh lane-registry allowed_paths from this output.

Options:
  --json   Print { skill_globs, static_globs, mirror_skills, dogfood_skills }
`);
    process.exit(0);
  }

  const payload = buildMergeAllowedPaths();
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("# Merge into observer_dispatch.auto_merge.allowed_paths");
    console.log("# static product globs:");
    for (const glob of payload.static_globs) {
      console.log(glob);
    }
    console.log("# per-skill cursor mirror globs (prefer over .cursor/skills/**):");
    for (const glob of payload.skill_globs) {
      console.log(glob);
    }
  }
}
