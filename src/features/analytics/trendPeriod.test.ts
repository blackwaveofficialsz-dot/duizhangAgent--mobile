import { defaultTrendRange, normalizeTrendRange, toggleCurrentPeriod, trendPointStatusText } from './trendPeriod';

describe('trendPeriod', () => {
  it('uses the latest five completed days, ISO weeks, and months by default', () => {
    expect(defaultTrendRange('day', '2026-07-21')).toEqual({
      dateFrom: '2026-07-16',
      dateTo: '2026-07-20',
      includeCurrent: false,
    });
    expect(defaultTrendRange('week', '2026-07-21')).toEqual({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-19',
      includeCurrent: false,
    });
    expect(defaultTrendRange('month', '2026-07-21')).toEqual({
      dateFrom: '2026-02-01',
      dateTo: '2026-06-30',
      includeCurrent: false,
    });
  });

  it('excludes an unfinished ISO week or month at their boundaries', () => {
    expect(defaultTrendRange('week', '2026-07-20')).toEqual({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-19',
      includeCurrent: false,
    });
    expect(defaultTrendRange('month', '2026-08-01')).toEqual({
      dateFrom: '2026-03-01',
      dateTo: '2026-07-31',
      includeCurrent: false,
    });
  });

  it('normalizes period boundaries and caps current periods at yesterday', () => {
    expect(normalizeTrendRange('week', '2026-07-15', '2026-07-21', true, '2026-07-21')).toEqual([
      '2026-07-13',
      '2026-07-20',
    ]);
    expect(normalizeTrendRange('month', '2026-07-15', '2026-07-21', false, '2026-07-21')).toEqual([
      '2026-06-01',
      '2026-06-30',
    ]);
  });

  it('moves between completed and current week without including today', () => {
    expect(toggleCurrentPeriod('week', { dateFrom: '2026-06-16', dateTo: '2026-07-19' }, true, '2026-07-21')).toEqual({
      dateFrom: '2026-06-16',
      dateTo: '2026-07-20',
      includeCurrent: true,
    });
    expect(toggleCurrentPeriod('week', { dateFrom: '2026-06-16', dateTo: '2026-07-20' }, false, '2026-07-21').dateTo).toBe('2026-07-19');
  });

  it('describes current and incomplete points', () => {
    expect(trendPointStatusText({ in_progress: true, missing: true })).toBe('进行中，截至昨日 · 数据不完整');
    expect(trendPointStatusText({})).toBeNull();
  });
});
