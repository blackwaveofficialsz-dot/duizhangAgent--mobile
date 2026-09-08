import { beijingIsoNow, formatBeijingDateTime, parseBeijingTimestamp } from './time';

describe('formatBeijingDateTime', () => {
  it('treats a timezone-free backend value as Beijing time', () => {
    expect(formatBeijingDateTime('2026-07-15T23:30:00')).toBe('2026-07-15 23:30');
    expect(formatBeijingDateTime('2026-07-15 09:05:00')).toBe('2026-07-15 09:05');
  });

  it('converts Z and offset values to Beijing time across day boundaries', () => {
    expect(formatBeijingDateTime('2026-07-15T16:30:00Z')).toBe('2026-07-16 00:30');
    expect(formatBeijingDateTime('2026-07-15T23:30:00-04:00')).toBe('2026-07-16 11:30');
  });

  it('returns a stable placeholder for empty or invalid values', () => {
    expect(formatBeijingDateTime('')).toBe('—');
    expect(formatBeijingDateTime('not-a-date')).toBe('—');
    expect(formatBeijingDateTime(null)).toBe('—');
  });

  it('returns the current business time with an explicit Beijing offset', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T16:30:45.000Z'));

    expect(beijingIsoNow()).toBe('2026-07-16T00:30:45+08:00');

    jest.useRealTimers();
  });

  it('parses timezone-free backend timestamps as Beijing time', () => {
    expect(parseBeijingTimestamp('2026-07-16T08:00:00')).toBe(Date.parse('2026-07-16T08:00:00+08:00'));
    expect(parseBeijingTimestamp('2026-07-16T00:00:00Z')).toBe(Date.parse('2026-07-16T00:00:00Z'));
    expect(parseBeijingTimestamp('invalid')).toBeNull();
  });
});
