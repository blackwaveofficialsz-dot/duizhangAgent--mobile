import { groupSessions } from './groupSessions';

describe('groupSessions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-16T04:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('groups sessions by Beijing calendar day without changing backend order', () => {
    const groups = groupSessions([
      { session_id: 'today', title: '今天', created_at: '2026-07-16T10:00:00+08:00', updated_at: '2026-07-16T10:00:00+08:00' },
      { session_id: 'week', title: '本周', created_at: '2026-07-09T10:00:00+08:00', updated_at: '2026-07-09T10:00:00+08:00' },
      { session_id: 'older', title: '更早', created_at: '2026-07-08T10:00:00+08:00', updated_at: '2026-07-08T10:00:00+08:00' },
    ]);

    expect(groups.map((group) => [group.label, group.sessions.map((session) => session.session_id)])).toEqual([
      ['今天', ['today']],
      ['过去 7 天', ['week']],
      ['更早', ['older']],
    ]);
  });
});
