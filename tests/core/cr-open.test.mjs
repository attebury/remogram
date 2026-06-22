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
      created: true,
    });
  });

  it('buildChangeRequestOpenedBody rejects invalid pull number with forgeError', () => {
    expect(() =>
      buildChangeRequestOpenedBody({ number: 0 }, { head: 'h', base: 'b', title: 'T' }),
    ).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: 'unparseable_provider_output' }),
      }),
    );
  });

  it('buildChangeRequestOpenedBody sets reused_existing and forge title when reusing', () => {
    const body = buildChangeRequestOpenedBody(
      { number: 7, html_url: 'http://localhost:3000/o/r/pulls/7', title: 'Forge title' },
      { head: 'feat/x', base: 'remo', title: 'Requested title' },
      { reusedExisting: true },
    );
    expect(body.reused_existing).toBe(true);
    expect(body.title).toBe('Forge title');
  });

  it('change_request_opened packet excludes forbidden keys', () => {
    const packet = forgePacket(PACKET_TYPES.CHANGE_REQUEST_OPENED, ctx, {
      pr_number: 1,
      url: 'http://localhost:3000/o/r/pulls/1',
      head: 'feat',
      base: 'remo',
      title: 'T',
      reused_existing: true,
    });
    for (const key of FORBIDDEN_PACKET_KEYS) {
      expect(packet).not.toHaveProperty(key);
    }
    expect(packet.type).toBe('change_request_opened');
    expect(packet.ok).toBe(true);
    expect(packet.reused_existing).toBe(true);
  });
});
