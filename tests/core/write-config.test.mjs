import { describe, it, expect } from 'vitest';
import {
  assertWriteCommandConfigured,
  isWriteCommandConfigured,
  parseConfigFile,
  forgeError,
  ERROR_CODES,
  writeNotConfiguredMessage,
} from '@remogram/core';

describe('write config gate', () => {
  it('isWriteCommandConfigured is false when write_commands omitted', () => {
    const config = { version: '1', provider: 'gitea-api', owner: 'o', repo: 'r' };
    expect(isWriteCommandConfigured(config, 'cr_open')).toBe(false);
    expect(isWriteCommandConfigured(config, 'status_set')).toBe(false);
  });

  it('assertWriteCommandConfigured throws write_not_configured', () => {
    const config = { version: '1', provider: 'gitea-api', owner: 'o', repo: 'r' };
    expect(() => assertWriteCommandConfigured(config, 'cr_open')).toThrow(
      expect.objectContaining({
        forgeError: forgeError(
          ERROR_CODES.WRITE_NOT_CONFIGURED,
          writeNotConfiguredMessage('cr_open'),
        ),
      }),
    );
  });

  it('parseConfigFile accepts write_commands cr_open and status_set', () => {
    const config = parseConfigFile(
      JSON.stringify({
        version: '1',
        provider: 'gitea-api',
        owner: 'o',
        repo: 'r',
        write_commands: ['cr_open', 'status_set'],
      }),
    );
    expect(config.write_commands).toEqual(['cr_open', 'status_set']);
  });

  it('parseConfigFile rejects unknown write command names', () => {
    expect(() =>
      parseConfigFile(
        JSON.stringify({
          version: '1',
          provider: 'gitea-api',
          owner: 'o',
          repo: 'r',
          write_commands: ['merge_execute'],
        }),
      ),
    ).toThrow();
  });

  it('assertWriteCommandConfigured rejects unknown command names before config check', () => {
    const config = {
      version: '1',
      provider: 'gitea-api',
      owner: 'o',
      repo: 'r',
      write_commands: ['cr_open'],
    };
    expect(() => assertWriteCommandConfigured(config, 'merge_execute')).toThrow(
      expect.objectContaining({
        forgeError: expect.objectContaining({ code: ERROR_CODES.INVALID_ARGS }),
      }),
    );
  });
});
