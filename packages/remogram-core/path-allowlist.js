/**
 * Glob allowlist matching for autonomous Observer auto-merge scope checks.
 * Supports `**`, `*`, and literal path segments (e.g. README.md).
 */

/**
 * Collapse `.` / `..` segments; reject absolute paths and repo-root escape.
 * @param {string} filePath
 * @returns {string|null}
 */
export function normalizeRepoRelativePath(filePath) {
  if (typeof filePath !== 'string') return null;
  let path = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (path === '') return null;
  if (path.startsWith('/')) return null;
  if (path === '..' || path.startsWith('../')) return null;
  const parts = path.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

function changedPathHasDotDotSegment(filePath) {
  if (typeof filePath !== 'string') return false;
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return true;
  }
  return normalized.split('/').some((segment) => segment === '..');
}

/**
 * Normalize a forge changed-path list for allowlist scope; null if any path is unnormalizable.
 * @param {unknown} changedPaths
 * @returns {string[]|null}
 */
export function normalizeChangedPathList(changedPaths) {
  if (!Array.isArray(changedPaths)) return null;
  const normalized = [];
  for (const filePath of changedPaths) {
    if (changedPathHasDotDotSegment(filePath)) return null;
    const repoPath = normalizeRepoRelativePath(filePath);
    if (repoPath == null) return null;
    normalized.push(repoPath);
  }
  return normalized;
}

function globToRegExp(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i += 1;
      if (glob[i + 1] === '/') i += 1;
    } else if (ch === '*') {
      pattern += '[^/]*';
    } else if (/[+?^${}()|[\]\\]/.test(ch)) {
      pattern += `\\${ch}`;
    } else {
      pattern += ch;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * @param {string} glob
 * @param {string} filePath
 * @returns {boolean}
 */
export function matchPathAllowlist(glob, filePath) {
  if (typeof glob !== 'string' || typeof filePath !== 'string') return false;
  const normalized = normalizeRepoRelativePath(filePath);
  if (normalized == null) return false;
  return globToRegExp(glob).test(normalized);
}

/**
 * @param {string[]} allowedPaths
 * @param {string} filePath
 * @returns {boolean}
 */
export function isPathAllowed(allowedPaths, filePath) {
  if (!Array.isArray(allowedPaths) || allowedPaths.length === 0) return false;
  return allowedPaths.some((glob) => matchPathAllowlist(glob, filePath));
}

/**
 * @param {string[]} allowedPaths
 * @param {string[]} changedPaths
 * @returns {string[]}
 */
export function pathsOutsideAllowlist(allowedPaths, changedPaths) {
  if (!Array.isArray(changedPaths)) return [];
  return changedPaths.filter((filePath) => !isPathAllowed(allowedPaths, filePath));
}

/**
 * @param {string[]} allowedPaths
 * @param {string[]} changedPaths
 * @returns {boolean}
 */
export function allPathsAllowed(allowedPaths, changedPaths) {
  return pathsOutsideAllowlist(allowedPaths, changedPaths).length === 0;
}
