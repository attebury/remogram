import { describe, it, expect } from 'vitest';
import { issueInventory, buildIssueInventoryEntry } from '@remogram/core';

const ctx = { cwd: process.cwd(), config: { remote: 'origin' }, remoteName: 'origin' };

describe('issue inventory', () => {
  it('buildIssueInventoryEntry preserves linked CR details', () => {
    const entry = buildIssueInventoryEntry({
      issue_number: 12,
      url: 'http://localhost:3000/o/r/issues/12',
      title: 'Track follow-up',
      state: 'open',
      linked_change_request: {
        pr_number: 99,
        url: 'http://localhost:3000/o/r/pulls/99',
      },
    });
    expect(entry.issue_number).toBe(12);
    expect(entry.linked_change_request?.pr_number).toBe(99);
  });

  it('issueInventory aggregates issue views and paginates with cursor', async () => {
    const provider = {
      listIssuesWithMeta: async () => ({ numbers: [1, 2], list_truncated: false, entry_count: 2 }),
      issueView: async (_ctx, { number }) => ({
        issue_number: number,
        url: `http://localhost:3000/o/r/issues/${number}`,
        title: `Issue ${number}`,
        state: 'open',
      }),
    };
    const body = await issueInventory(ctx, provider, { slice_ref: 'origin/remo', limit: 1 });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].issue_number).toBe(1);
    expect(body.slice_ref).toBe('origin/remo');
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe('string');
  });
});
