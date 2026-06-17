import { sanitizeField } from './caps.js';

export const MAX_CR_FILES_PATHS = 256;

function sanitizePathList(filesArray) {
  if (!Array.isArray(filesArray)) return [];
  const paths = [];
  for (const file of filesArray) {
    if (file == null || typeof file !== 'object') continue;
    const sanitized = sanitizeField(file.filename);
    if (sanitized) paths.push(sanitized);
  }
  return paths;
}

export function buildCrFilesBody({ pr_number, changed_paths, paths_truncated, path_count }) {
  const paths = Array.isArray(changed_paths) ? changed_paths : [];
  const count = Number.isFinite(Number(path_count)) ? Math.floor(Number(path_count)) : paths.length;
  return {
    pr_number: Math.floor(Number(pr_number)),
    changed_paths: paths,
    paths_truncated: Boolean(paths_truncated),
    path_count: count,
  };
}

export function buildCrFilesFromGiteaFiles(prNumber, filesArray) {
  const allPaths = sanitizePathList(filesArray);
  const path_count = allPaths.length;
  const capped = allPaths.length > MAX_CR_FILES_PATHS;
  const changed_paths = allPaths.slice(0, MAX_CR_FILES_PATHS);
  return buildCrFilesBody({
    pr_number: prNumber,
    changed_paths,
    paths_truncated: capped,
    path_count,
  });
}

export function buildCrFilesFromGitLabChanges(prNumber, changesArray) {
  const paths = [];
  const seen = new Set();
  if (Array.isArray(changesArray)) {
    for (const change of changesArray) {
      if (change == null || typeof change !== 'object') continue;
      const path = sanitizeField(change.new_path ?? change.old_path ?? '');
      if (path && !seen.has(path)) {
        seen.add(path);
        paths.push(path);
      }
    }
  }
  const path_count = paths.length;
  const capped = paths.length > MAX_CR_FILES_PATHS;
  const changed_paths = paths.slice(0, MAX_CR_FILES_PATHS);
  return buildCrFilesBody({
    pr_number: prNumber,
    changed_paths,
    paths_truncated: capped,
    path_count,
  });
}
