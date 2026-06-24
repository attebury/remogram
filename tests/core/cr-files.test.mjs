import { describe, it, expect } from 'vitest';
import {
  buildCrFilesBody,
  buildCrFilesFromGiteaFiles,
  buildCrFilesFromGitLabChanges,
  MAX_CR_FILES_PATHS,
  forgePacket,
  PACKET_TYPES,
  FORBIDDEN_PACKET_KEYS,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('cr files normalization', () => {
  it('builds cr_files body from Gitea pull files payload', () => {
    const body = buildCrFilesFromGiteaFiles(42, [
      { filename: 'packages/remogram-core/foo.js' },
      { filename: 'tests/core/foo.test.mjs' },
    ]);
    expect(body.pr_number).toBe(42);
    expect(body.changed_paths).toEqual([
      'packages/remogram-core/foo.js',
      'tests/core/foo.test.mjs',
    ]);
    expect(body.paths_truncated).toBe(false);
    expect(body.path_count).toBe(2);
  });

  it('caps and sanitizes changed paths', () => {
    const files = Array.from({ length: MAX_CR_FILES_PATHS + 3 }, (_, i) => ({
      filename: `path/file-${i}.js`,
    }));
    const body = buildCrFilesFromGiteaFiles(1, files);
    expect(body.changed_paths).toHaveLength(MAX_CR_FILES_PATHS);
    expect(body.paths_truncated).toBe(true);
    expect(body.path_count).toBe(MAX_CR_FILES_PATHS + 3);
  });

  it('strips control characters from paths', () => {
    const body = buildCrFilesFromGiteaFiles(1, [{ filename: 'pkg/foo\ninjected.js' }]);
    expect(body.changed_paths[0]).not.toContain('\n');
  });

  it('buildCrFilesBody honors explicit path_count', () => {
    const body = buildCrFilesBody({
      pr_number: 5,
      changed_paths: ['a.js'],
      paths_truncated: true,
      path_count: 500,
    });
    expect(body.path_count).toBe(500);
    expect(body.paths_truncated).toBe(true);
  });

  it('sanitizes packet and strips forbidden workflow keys', () => {
    const body = buildCrFilesFromGiteaFiles(1, [{ filename: 'README.md' }]);
    const packet = forgePacket(PACKET_TYPES.CR_FILES, ctx, body);
    expect(packet.type).toBe('cr_files');
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet[key]).toBeUndefined();
    }
  });

  it('builds cr_files body from GitLab MR changes', () => {
    const body = buildCrFilesFromGitLabChanges(42, [
      { old_path: 'README.md', new_path: 'README.md' },
      { old_path: null, new_path: 'packages/remogram-core/bar.js' },
    ]);
    expect(body.pr_number).toBe(42);
    expect(body.changed_paths).toEqual(['README.md', 'packages/remogram-core/bar.js']);
    expect(body.paths_truncated).toBe(false);
  });
});
