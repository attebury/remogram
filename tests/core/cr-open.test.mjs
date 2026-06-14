import { describe, it, expect } from 'vitest';
import {
  buildChangeRequestOpenedBody,
  forgePacket,
  PACKET_TYPES,
  FORBIDDEN_PACKET_KEYS,
} from '@remogram/core';

const ctx = {
  providerId: 'gitea-api',
  remoteName: 'origin',
  repoId: 'owner/repo',
};

describe('cr open packet', () => {
  it('buildChangeRequestOpenedBody maps Gitea pull response', () => {
    const body = buildChangeRequestOpenedBody(
      { number: 42, html_url: 'http://localhost:3000/o/r/pulls/42', title: 'From API' },
      { head: 'impl/x', base: 'remo', title: 'Open CR' },
    );
    expect(body).toEqual({
      pr_number: 42,
      url: 'http://localhost:3000/o/r/pulls/42',
      head: 'impl/x',
      base: 'remo',
      title: 'Open CR',
    });
  });

  it('change_request_opened packet excludes forbidden keys', () => {
    const packet = forgePacket(PACKET_TYPES.CHANGE_REQUEST_OPENED, ctx, {
      pr_number: 1,
      url: 'http://localhost:3000/o/r/pulls/1',
      head: 'feat',
      base: 'remo',
      title: 'T',
    });
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
    expect(packet.type).toBe('change_request_opened');
    expect(packet.ok).toBe(true);
  });
});
