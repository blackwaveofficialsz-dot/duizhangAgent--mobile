import { comparisonDisplayItems, comparisonPeriodText } from './periodComparison';

describe('comparisonDisplayItems', () => {
  it('formats backend comparison values in the requested all-display order', () => {
    expect(comparisonDisplayItems({
      current: 120,
      previous: 100,
      difference: 20,
      change_rate: 0.2,
      status: 'comparable',
    }, 'all', 'money')).toEqual([
      { key: 'percentage', label: '较上期', tone: 'positive', value: '+20.00%' },
      { key: 'difference', label: '差值', tone: 'positive', value: '+¥20.00' },
      { key: 'previous', label: '上期', tone: 'neutral', value: '¥100.00' },
    ]);
  });

  it('shows unavailable when the backend does not provide a change rate', () => {
    expect(comparisonDisplayItems({
      current: 20,
      previous: 0,
      difference: 20,
      change_rate: null,
      status: 'zero_baseline',
    }, 'percentage', 'integer')[0]).toEqual({
      key: 'percentage',
      label: '较上期',
      tone: 'unavailable',
      value: '不可比',
    });
  });

  it('uses the backend change rate sign for percentage tone when it differs from the difference', () => {
    expect(comparisonDisplayItems({
      current: 80,
      previous: -100,
      difference: 180,
      change_rate: -0.2,
      status: 'comparable',
    }, 'percentage', 'money')).toEqual([
      { key: 'percentage', label: '较上期', tone: 'negative', value: '-20.00%' },
    ]);
  });

  it('formats rate differences as percentage points without deriving a rate', () => {
    expect(comparisonDisplayItems({
      current: 0.0185,
      previous: 0.02,
      difference: -0.0015,
      change_rate: -0.075,
      status: 'comparable',
    }, 'difference', 'percentagePoint')).toEqual([
      { key: 'difference', label: '差值', tone: 'negative', value: '-0.15 个百分点' },
    ]);
  });
});

describe('comparisonPeriodText', () => {
  it('describes the actual backend comparison period', () => {
    expect(comparisonPeriodText({ date_from: '2026-07-01', date_to: '2026-07-31' }))
      .toBe('对比上期：2026-07-01 至 2026-07-31');
  });

  it('returns null when the backend provides no previous period', () => {
    expect(comparisonPeriodText(null)).toBeNull();
  });
});
