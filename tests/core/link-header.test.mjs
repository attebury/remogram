import { describe, it, expect } from 'vitest';
import { parseLinkHeader } from '@remogram/core';

describe('parseLinkHeader', () => {
  it('parses standard GitHub rel="next"', () => {
    const links = parseLinkHeader(
      '<https://api.github.com/repos/o/r/pulls?page=2>; rel="next", <https://api.github.com/repos/o/r/pulls?page=1>; rel="prev"',
    );
    expect(links.next).toBe('https://api.github.com/repos/o/r/pulls?page=2');
    expect(links.prev).toBe('https://api.github.com/repos/o/r/pulls?page=1');
  });

  it('parses rel=\'next\' with single quotes', () => {
    const links = parseLinkHeader("<https://api.github.com/page2>; rel='next'");
    expect(links.next).toBe('https://api.github.com/page2');
  });

  it('returns empty object when rel=next is missing', () => {
    expect(parseLinkHeader('<https://api.github.com/page2>; rel="prev"')).toEqual({
      prev: 'https://api.github.com/page2',
    });
    expect(parseLinkHeader('')).toEqual({});
    expect(parseLinkHeader(null)).toEqual({});
  });

  it('last rel wins when duplicate keys appear', () => {
    const links = parseLinkHeader(
      '<https://api.github.com/a>; rel="next", <https://api.github.com/b>; rel="next"',
    );
    expect(links.next).toBe('https://api.github.com/b');
  });

  it('ignores malformed segments without throwing', () => {
    expect(() =>
      parseLinkHeader('not-a-link; rel="next", <https://api.github.com/ok>; rel="next"'),
    ).not.toThrow();
    const links = parseLinkHeader('not-a-link; rel="next", <https://api.github.com/ok>; rel="next"');
    expect(links.next).toBe('https://api.github.com/ok');
  });

  it('ignores injection prose in non-matching segments', () => {
    const links = parseLinkHeader(
      'ignore me; rel="next", <https://api.github.com/safe>; rel="next"',
    );
    expect(links.next).toBe('https://api.github.com/safe');
  });
});
