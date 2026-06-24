import { describe, it, expect } from 'vitest';
import {
  buildIssueOpenedBody,
  parseIssueOpenArgs,
  forgePacket,
  PACKET_TYPES,
  FORBIDDEN_PACKET_KEYS,
  ERROR_CODES,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('issue open core', () => {
  it('buildIssueOpenedBody maps Gitea issue response', () => {
    const body = buildIssueOpenedBody(
      { number: 12, html_url: 'http://localhost:3000/o/r/issues/12', state: 'open', title: 'Bug' },
      { title: 'Bug' },
    );
    expect(body).toEqual({
      issue_number: 12,
      url: 'http://localhost:3000/o/r/issues/12',
      state: 'open',
      title: 'Bug',
      created: true,
    });
  });

  it('buildIssueOpenedBody sets reused_existing when reusing', () => {
    const body = buildIssueOpenedBody(
      { number: 3, html_url: 'http://localhost:3000/o/r/issues/3', state: 'open', title: 'Forge title' },
      { title: 'Requested title' },
      { reusedExisting: true },
    );
    expect(body.reused_existing).toBe(true);
    expect(body.title).toBe('Forge title');
  });

  it('parseIssueOpenArgs rejects truncated body by default', () => {
    expect(() => parseIssueOpenArgs({ title: 'T', body: 'z'.repeat(600) })).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.WRITE_FIELD_TRUNCATED }),
      }),
    );
  });

  it('parseIssueOpenArgs preserves long body when uncapped', () => {
    const body = 'alpha\nbeta\n' + 'w'.repeat(600);
    const parsed = parseIssueOpenArgs(
      { title: 'T', body },
      { fieldMaxBytes: null, uncapped: true },
    );
    expect(parsed.body).toContain('\n');
    expect(Buffer.byteLength(parsed.body, 'utf8')).toBeGreaterThan(512);
  });

  it('parseIssueOpenArgs requires title', () => {
    expect(() => parseIssueOpenArgs({})).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });

  it('issue_opened packet excludes forbidden keys', () => {
    const packet = forgePacket(PACKET_TYPES.ISSUE_OPENED, ctx, {
      issue_number: 1,
      url: 'http://localhost:3000/o/r/issues/1',
      state: 'open',
      title: 'T',
      created: true,
    });
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
    expect(packet.type).toBe('issue_opened');
    expect(packet.ok).toBe(true);
  });
});
