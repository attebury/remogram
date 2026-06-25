import { describe, it, expect } from 'vitest';
import { buildIssueViewBody, forgePacket, PACKET_TYPES, FORBIDDEN_PACKET_KEYS } from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('issue view normalization', () => {
  it('builds issue_status body with linked change request fields', () => {
    const body = buildIssueViewBody(
      {
        number: 17,
        html_url: 'http://localhost:3000/o/r/issues/17',
        title: 'Need better docs',
        state: 'open',
      },
      {
        linkedChangeRequest: {
          pr_number: 22,
          url: 'http://localhost:3000/o/r/pulls/22',
          state: 'open',
          title: 'docs: expand getting-started',
        },
      },
    );
    expect(body).toEqual({
      issue_number: 17,
      url: 'http://localhost:3000/o/r/issues/17',
      title: 'Need better docs',
      state: 'open',
      linked_change_request: {
        pr_number: 22,
        url: 'http://localhost:3000/o/r/pulls/22',
        state: 'open',
        title: 'docs: expand getting-started',
      },
    });
  });

  it('emits issue_status packet without forbidden keys', () => {
    const packet = forgePacket(PACKET_TYPES.ISSUE_STATUS, ctx, {
      issue_number: 8,
      url: 'http://localhost:3000/o/r/issues/8',
      title: 'Question',
      state: 'closed',
    });
    expect(packet.type).toBe(PACKET_TYPES.ISSUE_STATUS);
    expect(packet.ok).toBe(true);
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
  });
});
