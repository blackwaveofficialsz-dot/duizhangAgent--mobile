import type { OperationsOverview } from '@/services/api/operationsAnalytics';
import { buildOrderExportRows, comparisonForOrderRow, createOrderAnalyticsFilters, effectiveOrderChannels, effectiveOrderSourceType, excludeTodayForOrderFallback, normalizeOrderDimensions, orderDimensionKey, orderPeriodKey } from './orderAnalytics';

const overview: OperationsOverview = {
  period: { date_from: '2026-07-01', date_to: '2026-07-31' },
  previous_period: { date_from: '2026-06-01', date_to: '2026-06-30' },
  metrics: {},
  channels: [{ dim_key: 'shop', dim_label: '堂食', metrics: {} }],
  platforms: [],
  stores: [{ dim_key: '101', dim_label: '唐城医院店', metrics: {
    net_income: { current: 1200, previous: 1000, difference: 200, change_rate: 0.2, status: 'ok' },
  } }],
  store_channels: [{ dim_key: '101:shop', dim_label: '唐城医院店 · 堂食', metrics: {
    net_income: { current: 1200, previous: 1000, difference: 200, change_rate: 0.2, status: 'ok' },
  } }],
};

describe('orderAnalytics', () => {
  it('normalizes compatible dimensions in a stable order', () => {
    expect(orderDimensionKey([])).toBe('all');
    expect(orderDimensionKey(['channel', 'shop'])).toBe('shop_channel');
    expect(orderDimensionKey(['platform', 'shop'])).toBe('shop_platform');
    expect(normalizeOrderDimensions(['platform', 'channel'])).toEqual(['platform']);
  });

  it('uses an all-source request for channel dimensions and matching overview channels', () => {
    const filters = { ...createOrderAnalyticsFilters('2026-08-06'), sourceType: 'takeout' as const };
    expect(effectiveOrderSourceType(filters, ['shop', 'channel'])).toBe('all');
    expect(effectiveOrderChannels(filters, ['shop', 'channel'])).toEqual([]);
    expect(effectiveOrderSourceType(filters, ['shop'])).toBe('takeout');
    expect(effectiveOrderChannels(filters, ['shop'])).toEqual(['takeout']);
  });

  it('creates period keys and defaults to yesterday', () => {
    expect(orderPeriodKey({
      dateFrom: '2026-07-27',
      dateTo: '2026-08-02',
      granularity: 'week',
    })).toBe('2026-W31');
    expect(createOrderAnalyticsFilters('2026-08-06')).toEqual(expect.objectContaining({
      dateFrom: '2026-08-05',
      dateTo: '2026-08-05',
      granularity: 'day',
      includeCurrent: false,
    }));
  });

  it('excludes today only for normalized current weeks and months', () => {
    const today = '2026-08-06';
    expect(excludeTodayForOrderFallback({
      ...createOrderAnalyticsFilters(today),
      dateFrom: '2026-08-03',
      dateTo: '2026-08-05',
      granularity: 'week',
      includeCurrent: true,
    }, today)).toBe(true);
    expect(excludeTodayForOrderFallback({
      ...createOrderAnalyticsFilters(today),
      dateFrom: '2026-08-01',
      dateTo: '2026-08-05',
      granularity: 'month',
      includeCurrent: true,
    }, today)).toBe(true);
    expect(excludeTodayForOrderFallback({
      ...createOrderAnalyticsFilters(today),
      dateFrom: '2026-07-20',
      dateTo: '2026-07-26',
      granularity: 'week',
      includeCurrent: true,
    }, today)).toBe(false);
    expect(excludeTodayForOrderFallback({
      ...createOrderAnalyticsFilters(today),
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      granularity: 'month',
      includeCurrent: true,
    }, today)).toBe(false);
  });

  it('maps a current order row to the matching backend comparison metric', () => {
    expect(comparisonForOrderRow(
      { dim_key: '101', dim_label: '唐城医院店' },
      'shop',
      overview,
      'net_income',
    )).toEqual(overview.stores[0].metrics.net_income);
  });

  it('maps every order dimension using backend keys and store labels', () => {
    const comparison = { current: 2, previous: 1, difference: 1, change_rate: 1, status: 'ok' };
    const dimensions: Array<[Parameters<typeof comparisonForOrderRow>[1], { dim_key: string; dim_label: string }]> = [
      ['all', { dim_key: 'ALL', dim_label: '全部' }],
      ['shop', { dim_key: 'missing', dim_label: '真实门店' }],
      ['platform', { dim_key: '10', dim_label: '美团' }],
      ['channel', { dim_key: 'shop', dim_label: '堂食' }],
      ['shop_channel', { dim_key: '101|shop', dim_label: '真实门店 · 堂食' }],
      ['shop_platform', { dim_key: '101|10', dim_label: '真实门店 · 美团' }],
    ];
    const allDimensions: OperationsOverview = {
      ...overview,
      metrics: { net_income: comparison },
      stores: [{ store_key: '101', store_label: '真实门店', metrics: { net_income: comparison } }],
      platforms: [{ dim_key: '10', dim_label: '美团', metrics: { net_income: comparison } }],
      channels: [{ dim_key: 'shop', dim_label: '堂食', metrics: { net_income: comparison } }],
      store_channels: [{ dim_key: '101|shop', dim_label: '真实门店 · 堂食', metrics: { net_income: comparison } }],
      store_platforms: [{ dim_key: '101|10', dim_label: '真实门店 · 美团', metrics: { net_income: comparison } }],
    };

    for (const [dimension, row] of dimensions) {
      expect(comparisonForOrderRow(row, dimension, allDimensions, 'net_income')).toEqual(comparison);
    }
  });

  it('builds export rows with backend comparison values and combined labels', () => {
    expect(buildOrderExportRows([
      { avg_order_value: 30, dim_key: '101:shop', dim_label: '唐城医院店 · 堂食', net_income: 1200, order_count: 40, paid_amount: 1300, refund_amount: 100, refund_rate: 0.0769 },
    ], {
      comparisonOverview: overview,
      dimensions: ['shop', 'channel'],
    })).toEqual([
      expect.objectContaining({
        维度: '唐城医院店 · 堂食',
        净实收: 1200,
        '净实收上期': 1000,
        '净实收差值': 200,
        '净实收变化率': '20.00%',
      }),
    ]);
  });
});
