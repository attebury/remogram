import { describe, it, expect } from 'vitest';
import {
  buildCheckDiagnostics,
  buildPrChecksBody,
  enrichCheckStatus,
} from '@remogram/core';
import { mergeBlockersFromFacts } from '@remogram/core';

const HEAD = 'abc123def4567890abc123def4567890abc123de';

describe('check diagnostics', () => {
  it('marks required contexts and missing required checks', () => {
    const body = buildPrChecksBody({
      forge_source_sha: HEAD,
      check_conclusion: 'failure',
      checks_truncated: false,
      required_contexts: ['Dogfood Gate / Dogfood gate (push)', 'ci/test'],
      statuses: [
        {
          context: 'Dogfood Gate / Dogfood gate (push)',
          state: 'failure',
          sha: HEAD,
          source: 'commit_status',
        },
        {
          context: 'pull_request',
          state: 'success',
          sha: HEAD,
          source: 'commit_status',
        },
      ],
    });
    expect(body.required_contexts).toEqual(['ci/test', 'Dogfood Gate / Dogfood gate (push)']);
    expect(body.missing_required_contexts).toEqual(['ci/test']);
    expect(body.failed_contexts).toEqual(['Dogfood Gate / Dogfood gate (push)']);
    expect(body.statuses[0]).toMatchObject({ required: true, state: 'failure' });
  });

  it('detects stale contexts when status sha differs from head', () => {
    const diagnostics = buildCheckDiagnostics(
      [
        {
          context: 'Dogfood Gate / Dogfood gate (push)',
          state: 'success',
          sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        },
      ],
      { headSha: HEAD, requiredContexts: ['Dogfood Gate / Dogfood gate (push)'] },
    );
    expect(diagnostics.stale_contexts).toEqual(['Dogfood Gate / Dogfood gate (push)']);
    expect(enrichCheckStatus(diagnostics.statuses[0], { headSha: HEAD }).stale).toBe(true);
  });

  it('derives merge blockers from diagnostics', () => {
    const checks = buildPrChecksBody({
      forge_source_sha: HEAD,
      check_conclusion: 'pending',
      required_contexts: ['ci/test'],
      statuses: [{ context: 'ci/test', state: 'pending', sha: HEAD }],
    });
    const blockers = mergeBlockersFromFacts(
      { mergeability: 'clean', state: 'open' },
      checks,
      {},
      {},
    );
    expect(blockers).toContain('required_checks_pending');
    expect(blockers).toContain('checks_pending');
  });
});
