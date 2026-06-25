import { describe, it, expect } from 'vitest';
import {
  buildForgeChangesFromGiteaIssues,
  FORGE_CHANGE_EVENT_KINDS,
} from '@remogram/core';

const SINCE = '2024-06-01T12:00:00.000Z';

describe('forge changes issue events', () => {
  it('emits issue_opened and issue_closed events in window', () => {
    const events = buildForgeChangesFromGiteaIssues(SINCE, [
      {
        number: 10,
        title: 'New bug',
        html_url: 'http://localhost:3000/o/r/issues/10',
        state: 'open',
        created_at: '2024-06-02T10:00:00Z',
        updated_at: '2024-06-02T10:00:00Z',
      },
      {
        number: 11,
        title: 'Closed bug',
        html_url: 'http://localhost:3000/o/r/issues/11',
        state: 'closed',
        created_at: '2024-05-01T10:00:00Z',
        updated_at: '2024-06-03T10:00:00Z',
        closed_at: '2024-06-03T10:00:00Z',
      },
    ]);
    expect(events.map((event) => event.kind)).toEqual([
      FORGE_CHANGE_EVENT_KINDS.ISSUE_OPENED,
      FORGE_CHANGE_EVENT_KINDS.ISSUE_CLOSED,
    ]);
    expect(events[0]).toMatchObject({ issue_number: 10, state: 'open' });
    expect(events[1]).toMatchObject({ issue_number: 11, state: 'closed' });
  });
});
