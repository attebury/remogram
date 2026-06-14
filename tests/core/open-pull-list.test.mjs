import { describe, it, expect } from 'vitest';
import {
  CR_INVENTORY_SLICE_SORTS,
  DEFAULT_CR_INVENTORY_SLICE_SORT,
  normalizeCrInventorySort,
  parseTotalCountHeader,
  isCrInventoryFastPathEligible,
  forgeOrderAuthoritative,
  validateFastPathPageLength,
  isNumberSortFastPathEligible,
  resolvePaginatedEntryCount,
  isRecentCreatedFastPathEligible,
  giteaRecentCreatedTailPage,
  isNumberSortFullCollectRequired,
  prepareGiteaOpenPullPageItems,
  orderOpenPullNumbers,
  buildOpenPullListMeta,
  giteaOpenPullSortQuery,
} from '@remogram/core';
import { ERROR_CODES } from '@remogram/core';

describe('open-pull-list', () => {
  it('normalizes default sort to number_asc', () => {
    expect(normalizeCrInventorySort(undefined)).toBe(DEFAULT_CR_INVENTORY_SLICE_SORT);
    expect(normalizeCrInventorySort('')).toBe('number_asc');
  });

  it('accepts all supported sort presets', () => {
    for (const sort of CR_INVENTORY_SLICE_SORTS) {
      expect(normalizeCrInventorySort(sort)).toBe(sort);
    }
  });

  it('rejects unknown sort with invalid_args', () => {
    expect(() => normalizeCrInventorySort('newest')).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('parseTotalCountHeader accepts positive integers within maxTrusted', () => {
    const headers = new Map([['X-Total-Count', '42']]);
    expect(parseTotalCountHeader(headers, 'X-Total-Count', { maxTrusted: 100 })).toBe(42);
  });

  it('parseTotalCountHeader rejects invalid values', () => {
    expect(parseTotalCountHeader(null, 'X-Total-Count', { maxTrusted: 100 })).toBeNull();
    expect(parseTotalCountHeader(new Map([['X-Total-Count', 'abc']]), 'X-Total-Count', { maxTrusted: 100 })).toBeNull();
    expect(parseTotalCountHeader(new Map([['X-Total-Count', '0']]), 'X-Total-Count', { maxTrusted: 100 })).toBeNull();
    expect(parseTotalCountHeader(new Map([['X-Total-Count', '-1']]), 'X-Total-Count', { maxTrusted: 100 })).toBeNull();
    expect(parseTotalCountHeader(new Map([['X-Total-Count', '1000']]), 'X-Total-Count', { maxTrusted: 100 })).toBeNull();
  });

  it('isCrInventoryFastPathEligible requires retain_max', () => {
    expect(isCrInventoryFastPathEligible({ retain_max: 3 })).toBe(true);
    expect(isCrInventoryFastPathEligible({ limit: 3 })).toBe(false);
    expect(isCrInventoryFastPathEligible({})).toBe(false);
  });

  it('forgeOrderAuthoritative is true for activity sorts', () => {
    expect(forgeOrderAuthoritative('recent_update')).toBe(true);
    expect(forgeOrderAuthoritative('number_asc')).toBe(false);
  });

  it('orderOpenPullNumbers sorts by number for number_asc and number_desc', () => {
    const items = [{ number: 9 }, { number: 2 }, { number: 5 }];
    expect(orderOpenPullNumbers(items, (pr) => pr.number, 'number_asc')).toEqual([2, 5, 9]);
    expect(orderOpenPullNumbers(items, (pr) => pr.number, 'number_desc')).toEqual([9, 5, 2]);
  });

  it('orderOpenPullNumbers preserves forge order for recent_update', () => {
    const items = [{ number: 9 }, { number: 2 }, { number: 5 }];
    expect(orderOpenPullNumbers(items, (pr) => pr.number, 'recent_update')).toEqual([9, 2, 5]);
  });

  it('buildOpenPullListMeta shapes provider list meta', () => {
    expect(
      buildOpenPullListMeta({
        totalCount: 10,
        numbers: [1, 2, 3],
        listTruncated: false,
        sliceSort: 'recent_update',
      }),
    ).toEqual({
      numbers: [1, 2, 3],
      list_truncated: false,
      entry_count: 10,
      slice_sort: 'recent_update',
    });
  });

  it('giteaOpenPullSortQuery maps recent_update and recent_created', () => {
    expect(giteaOpenPullSortQuery('recent_update')).toEqual({ sort: 'recentupdate' });
    expect(giteaOpenPullSortQuery('recent_created')).toEqual({ sort: 'oldest' });
    expect(giteaOpenPullSortQuery('number_asc')).toEqual({});
  });

  it('validateFastPathPageLength requires min(total, limit) items', () => {
    expect(validateFastPathPageLength(3, 3, 3)).toBe(true);
    expect(validateFastPathPageLength(10, 3, 3)).toBe(true);
    expect(validateFastPathPageLength(10, 3, 2)).toBe(false);
  });

  it('isNumberSortFastPathEligible rejects number sorts when total exceeds retain_max', () => {
    expect(isNumberSortFastPathEligible(3, 3, 'number_asc')).toBe(true);
    expect(isNumberSortFastPathEligible(10, 3, 'number_asc')).toBe(false);
    expect(isNumberSortFastPathEligible(10, 3, 'number_desc')).toBe(false);
    expect(isNumberSortFastPathEligible(10, 3, 'recent_update')).toBe(true);
  });

  it('prepareGiteaOpenPullPageItems reverses oldest-first page for recent_created', () => {
    const items = [{ number: 1 }, { number: 2 }, { number: 3 }];
    expect(prepareGiteaOpenPullPageItems(items, 'recent_created').map((pr) => pr.number)).toEqual([
      3, 2, 1,
    ]);
    expect(prepareGiteaOpenPullPageItems(items, 'recent_update')).toBe(items);
  });

  it('resolvePaginatedEntryCount prefers trusted total', () => {
    expect(resolvePaginatedEntryCount(5, 1)).toBe(5);
    expect(resolvePaginatedEntryCount(null, 3)).toBe(3);
  });

  it('isRecentCreatedFastPathEligible rejects Gitea recent_created when total exceeds retain_max', () => {
    expect(isRecentCreatedFastPathEligible(3, 3, 'recent_created', 'gitea-api')).toBe(true);
    expect(isRecentCreatedFastPathEligible(10, 3, 'recent_created', 'gitea-api')).toBe(false);
    expect(isRecentCreatedFastPathEligible(10, 3, 'recent_created', 'github-api')).toBe(true);
  });

  it('giteaRecentCreatedTailPage computes last page index', () => {
    expect(giteaRecentCreatedTailPage(250, 100)).toBe(3);
    expect(giteaRecentCreatedTailPage(10, 100)).toBe(1);
  });

  it('isNumberSortFullCollectRequired when number sort and total exceeds retain_max', () => {
    expect(isNumberSortFullCollectRequired(10, 3, 'number_asc')).toBe(true);
    expect(isNumberSortFullCollectRequired(3, 3, 'number_asc')).toBe(false);
    expect(isNumberSortFullCollectRequired(10, 3, 'recent_update')).toBe(false);
  });
});
