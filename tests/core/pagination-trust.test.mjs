import { describe, it, expect } from 'vitest';
import { isTrustedPaginationUrl } from '@remogram/core';

const TRUSTED = 'https://api.github.com';

describe('isTrustedPaginationUrl', () => {
  it('accepts absolute same-origin URLs', () => {
    expect(
      isTrustedPaginationUrl(TRUSTED, 'https://api.github.com/repos/o/r/pulls?page=2'),
    ).toBe(true);
  });

  it('rejects absolute off-origin URLs', () => {
    expect(
      isTrustedPaginationUrl(TRUSTED, 'https://evil.example/repos/o/r/pulls?page=2'),
    ).toBe(false);
  });

  it('accepts relative same-origin paths with resolveBase', () => {
    const base = 'https://api.github.com/repos/o/r/pulls?state=open&per_page=100';
    expect(isTrustedPaginationUrl(TRUSTED, '/repos/o/r/pulls?page=2', base)).toBe(true);
  });

  it('rejects relative paths resolved against an off-origin base', () => {
    const evilBase = 'https://evil.example/api/start';
    expect(isTrustedPaginationUrl(TRUSTED, '/repos/o/r/pulls?page=2', evilBase)).toBe(false);
  });

  it('rejects http vs https mismatch on the same host', () => {
    expect(
      isTrustedPaginationUrl(TRUSTED, 'http://api.github.com/repos/o/r/pulls?page=2'),
    ).toBe(false);
  });

  it('rejects invalid URLs without resolveBase', () => {
    expect(isTrustedPaginationUrl(TRUSTED, '/repos/o/r/pulls?page=2')).toBe(false);
  });
});
