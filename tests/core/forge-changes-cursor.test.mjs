import { describe, it, expect } from 'vitest';
import {
  encodeForgeChangesCursor,
  decodeForgeChangesCursor,
  paginateForgeChangesBody,
  DEFAULT_FORGE_CHANGES_PAGE_SIZE,
  buildForgeChangesBody,
  ERROR_CODES,
} from '@remogram/core';

const SINCE = '2024-06-01T12:00:00.000Z';

function makeEvents(count) {
  return Array.from({ length: count }, (_, i) => ({
    kind: 'pr_opened',
    pr_number: i + 1,
  }));
}

describe('forge changes cursor', () => {
  it('round-trips opaque cursor with since and offset', () => {
    const cursor = encodeForgeChangesCursor({ since: SINCE, offset: 64 });
    expect(decodeForgeChangesCursor(cursor)).toEqual({ since: SINCE, offset: 64 });
  });

  it('rejects malformed cursor', () => {
    expect(() => decodeForgeChangesCursor('not-valid')).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('rejects since mismatch when --since provided with cursor', () => {
    const cursor = encodeForgeChangesCursor({ since: SINCE, offset: 0 });
    expect(() =>
      decodeForgeChangesCursor(cursor, { since: '2024-07-01T00:00:00Z' }),
    ).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('paginates events with has_more and next_cursor', () => {
    const body = buildForgeChangesBody({
      since: SINCE,
      events: makeEvents(5),
      events_truncated: false,
      event_count: 5,
    });
    const page1 = paginateForgeChangesBody(body, { offset: 0, limit: 2 });
    expect(page1.events).toHaveLength(2);
    expect(page1.has_more).toBe(true);
    expect(page1.complete).toBe(false);
    expect(typeof page1.next_cursor).toBe('string');

    const page2 = paginateForgeChangesBody(body, {
      offset: decodeForgeChangesCursor(page1.next_cursor).offset,
      limit: 2,
    });
    expect(page2.events).toHaveLength(2);
    expect(page2.has_more).toBe(true);

    const page3 = paginateForgeChangesBody(body, {
      offset: decodeForgeChangesCursor(page2.next_cursor).offset,
      limit: 2,
    });
    expect(page3.events).toHaveLength(1);
    expect(page3.has_more).toBe(false);
    expect(page3.complete).toBe(true);
    expect(page3.next_cursor).toBeUndefined();
  });

  it('keeps has_more when events_truncated even at end of returned slice', () => {
    const body = buildForgeChangesBody({
      since: SINCE,
      events: makeEvents(DEFAULT_FORGE_CHANGES_PAGE_SIZE),
      events_truncated: true,
      event_count: DEFAULT_FORGE_CHANGES_PAGE_SIZE + 10,
    });
    const page = paginateForgeChangesBody(body, {
      offset: DEFAULT_FORGE_CHANGES_PAGE_SIZE - 2,
      limit: 2,
    });
    expect(page.has_more).toBe(true);
    expect(page.complete).toBe(false);
  });
});
