import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHECK_STATUS_PAGE_SIZE,
  DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
  idempotencyScanCapabilityFacts,
  statusSetIdempotencyScanCapabilityFacts,
} from '@remogram/core';

const PROVIDER_MODULES = [
  {
    id: 'gitea-api',
    load: () => import('@remogram/provider-gitea-api'),
    expectedPageSize: DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
    usesStatusSetScanFacts: false,
  },
  {
    id: 'github-api',
    load: () => import('@remogram/provider-github-api'),
    expectedPageSize: DEFAULT_CHECK_STATUS_PAGE_SIZE,
    usesStatusSetScanFacts: true,
  },
  {
    id: 'gitlab-api',
    load: () => import('@remogram/provider-gitlab-api'),
    expectedPageSize: DEFAULT_CHECK_STATUS_PAGE_SIZE,
    usesStatusSetScanFacts: true,
  },
];

describe('capability honesty (idempotency_scan.page_size)', () => {
  it('statusSetIdempotencyScanCapabilityFacts matches commit-status scan page size', () => {
    expect(statusSetIdempotencyScanCapabilityFacts().idempotency_scan.page_size).toBe(
      DEFAULT_CHECK_STATUS_PAGE_SIZE,
    );
  });

  it('idempotencyScanCapabilityFacts matches Gitea open-pull scan page size', () => {
    expect(idempotencyScanCapabilityFacts().idempotency_scan.page_size).toBe(
      DEFAULT_OPEN_PULL_LIST_PAGE_SIZE,
    );
  });

  for (const entry of PROVIDER_MODULES) {
    it(`${entry.id} providerCapabilities idempotency_scan.page_size matches scan implementation`, async () => {
      const mod = await entry.load();
      const body = mod.provider.providerCapabilities();
      expect(body.idempotency_scan.page_size).toBe(entry.expectedPageSize);
      expect(body.idempotency_scan.page_size).toBe(
        entry.usesStatusSetScanFacts
          ? statusSetIdempotencyScanCapabilityFacts().idempotency_scan.page_size
          : idempotencyScanCapabilityFacts().idempotency_scan.page_size,
      );
    });
  }

  it('github-api and gitlab-api do not advertise cr-open page_size (100) for status-set scan', async () => {
    for (const id of ['github-api', 'gitlab-api']) {
      const mod = await import(`@remogram/provider-${id}`);
      const body = mod.provider.providerCapabilities();
      expect(body.idempotency_scan.page_size).toBe(DEFAULT_CHECK_STATUS_PAGE_SIZE);
      expect(body.idempotency_scan.page_size).not.toBe(DEFAULT_OPEN_PULL_LIST_PAGE_SIZE);
    }
  });
});
