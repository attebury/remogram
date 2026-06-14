/**
 * Glob allowlist matching for autonomous Observer auto-merge scope checks.
 * Supports `**`, `*`, and literal path segments (e.g. README.md).
 */

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
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
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
