import { describe, it, expect, afterEach } from 'vitest';
import {
  loadConfig,
  assertForgeReady,
  forgeContext,
  ERROR_CODES,
} from '@remogram/core';
import { setupTempForge } from '../helpers/temp-forge.mjs';

const baseConfig = {
  version: '1',
  provider: 'gitea-api',
  owner: 'owner',
  repo: 'repo',
  baseUrl: 'http://localhost:3000',
  remote: 'origin',
};

describe('assertForgeReady', () => {
  /** @type {ReturnType<typeof setupTempForge>[]} */
  const cleanups = [];

  afterEach(() => {
    while (cleanups.length) cleanups.pop().cleanup();
  });

  function forge(config, remoteUrl) {
    const env = setupTempForge({ config, remoteUrl });
    cleanups.push(env);
    return assertForgeReady(loadConfig(env.dir));
  }

  it('succeeds when config matches https remote', () => {
    const loaded = forge(
      baseConfig,
      'https://localhost:3000/owner/repo.git',
    );
    expect(loaded.parsed.owner).toBe('owner');
    expect(loaded.parsed.repo).toBe('repo');
    expect(loaded.parsed.host).toBe('localhost:3000');
  });

  it('succeeds when config matches ssh remote', () => {
    const loaded = forge(
      { ...baseConfig, baseUrl: undefined },
      'git@forge.example:owner/repo.git',
    );
    expect(loaded.parsed.owner).toBe('owner');
    expect(loaded.parsed.host).toBe('forge.example');
  });

  it('throws CONFIG_INVALID on owner/repo mismatch', () => {
    expect(() =>
      forge(
        { ...baseConfig, owner: 'wrong', repo: 'repo' },
        'https://localhost:3000/owner/repo.git',
      ),
    ).toThrow(/does not match git remote/);
    try {
      forge(
        { ...baseConfig, owner: 'wrong', repo: 'repo' },
        'https://localhost:3000/owner/repo.git',
      );
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.CONFIG_INVALID);
    }
  });

  it('throws UNTRUSTED_BASE_URL when baseUrl host differs from remote', () => {
    expect(() =>
      forge(
        { ...baseConfig, baseUrl: 'http://evil.example:3000' },
        'https://localhost:3000/owner/repo.git',
      ),
    ).toThrow(/baseUrl host not trusted/);
    try {
      forge(
        { ...baseConfig, baseUrl: 'http://evil.example:3000' },
        'https://localhost:3000/owner/repo.git',
      );
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.UNTRUSTED_BASE_URL);
    }
  });

  it('allows localhost and 127.0.0.1 alias for baseUrl', () => {
    const loaded = forge(
      { ...baseConfig, baseUrl: 'http://127.0.0.1:3000' },
      'https://localhost:3000/owner/repo.git',
    );
    expect(loaded.config.baseUrl).toBe('http://127.0.0.1:3000');
  });

  it('throws REMOTE_INFER_FAILED when remote URL is unparseable', () => {
    expect(() => forge(baseConfig, 'not-a-valid-remote')).toThrow(/Could not parse git remote/);
    try {
      forge(baseConfig, 'not-a-valid-remote');
    } catch (err) {
      expect(err.forgeError.code).toBe(ERROR_CODES.REMOTE_INFER_FAILED);
    }
  });

  it('forgeContext includes baseUrl after assertForgeReady', () => {
    const loaded = forge(
      baseConfig,
      'https://localhost:3000/owner/repo.git',
    );
    const ctx = forgeContext(loaded);
    expect(ctx.baseUrl).toBe('http://localhost:3000');
  });
});
