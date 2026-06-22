import { describe, it, expect } from 'vitest';
import {
  decodeCrInventoryCursor,
  encodeCrInventoryCursor,
  CR_INVENTORY_CURSOR_VERSION,
} from '@remogram/core';

describe('cr inventory cursor codec', () => {
  it('round-trips sort and offset', () => {
    const cursor = encodeCrInventoryCursor({ sort: 'number_asc', offset: 4 });
    expect(decodeCrInventoryCursor(cursor)).toEqual({ sort: 'number_asc', offset: 4 });
  });

  it('rejects malformed cursor', () => {
    try {
      decodeCrInventoryCursor('not-valid');
      throw new Error('expected throw');
    } catch (err) {
      expect(err.forgeError?.code).toBe('invalid_args');
      expect(err.forgeError?.message).toMatch(/malformed/);
    }
  });

  it('rejects unsupported cursor version', () => {
    const raw = Buffer.from(JSON.stringify({ v: 99, sort: 'number_asc', offset: 0 }), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeCrInventoryCursor(raw)).toThrow(/version/);
  });

  it('rejects sort mismatch against --sort', () => {
    const cursor = encodeCrInventoryCursor({ sort: 'number_asc', offset: 2 });
    try {
      decodeCrInventoryCursor(cursor, { sort: 'recent_update' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err.forgeError?.code).toBe('invalid_args');
      expect(err.forgeError?.message).toMatch(/sort must match/);
    }
  });

  it('uses cursor version constant', () => {
    const cursor = encodeCrInventoryCursor({ sort: 'number_desc', offset: 0 });
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    expect(payload.v).toBe(CR_INVENTORY_CURSOR_VERSION);
  });
});

describe('crInventory cursor paging', () => {
  it('returns next_cursor when more entries remain', async () => {
    const { crInventory } = await import('../../packages/remogram-core/cr-inventory.js');
    const numbers = [1, 2, 3, 4, 5];
    const provider = {
      listOpenPullsWithMeta: async () => ({
        numbers,
        entry_count: numbers.length,
        list_truncated: false,
      }),
      prView: async (_ctx, { number }) => ({
        pr_number: number,
        state: 'open',
        mergeability: 'clean',
      }),
      prChecks: async () => ({ check_conclusion: 'success', checks_truncated: false }),
    };
    const ctx = { cwd: process.cwd(), mergePolicy: {} };
    const page1 = await crInventory(ctx, provider, { limit: 2 });
    expect(page1.has_more).toBe(true);
    expect(page1.complete).toBe(false);
    expect(page1.entries).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const page2 = await crInventory(ctx, provider, { limit: 2, cursor: page1.next_cursor });
    expect(page2.has_more).toBe(true);
    expect(page2.entries.map((e) => e.pr_number)).toEqual([3, 4]);

    const page3 = await crInventory(ctx, provider, { limit: 2, cursor: page2.next_cursor });
    expect(page3.has_more).toBe(false);
    expect(page3.complete).toBe(true);
    expect(page3.entries.map((e) => e.pr_number)).toEqual([5]);
    expect(page3.next_cursor).toBeUndefined();
  });
});
