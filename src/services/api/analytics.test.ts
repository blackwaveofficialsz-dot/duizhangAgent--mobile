import { apiRequest } from './client';
import { loadAnalyticsDailyDelta, loadAnalyticsDailyFactsV2 } from './analyticsDelta';
import {
  getDashboardAnalytics,
  getLabor,
  getLaborDetail,
  getLaborTrend,
  getMealPeriodTrend,
  getMealPeriodTurnover,
  getOrderDailyRecords,
  getOrderPeriodSnapshotRecords,
  readCachedOrderDailyRecords,
  getOrders,
  getProducts,
  getProductTrend,
  getRevenueAlerts,
  getRevenueTrend,
  listPlatformDim,
  listStoreScopeTree,
} from './analytics';
import {
  captureOfflineCacheOperationToken,
  clearCachedAnalytics,
  clearCachedAnalyticsDailyBucket,
  mergeCachedAnalyticsDelta,
  readCachedAnalytics,
  readCachedAnalyticsClientDays,
  readCachedAnalyticsDailyBucket,
  saveCachedAnalytics,
} from '@/services/cache/offlineCache';
import type { DailyBucket } from '@/services/cache/analyticsCache';
import { laborTrendFixture, productTrendFixture, scopeFixture } from '@/features/analytics/__fixtures__/webParity';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));
jest.mock('./analyticsDelta', () => ({
  ...jest.requireActual<typeof import('./analyticsDelta')>('./analyticsDelta'),
  loadAnalyticsDailyDelta: jest.fn(),
  loadAnalyticsDailyFactsV2: jest.fn(),
}));
jest.mock('@/services/cache/offlineCache', () => ({
  captureOfflineCacheOperationToken: jest.fn(),
  clearCachedAnalytics: jest.fn(),
  clearCachedAnalyticsDailyBucket: jest.fn(),
  mergeCachedAnalyticsDelta: jest.fn(),
  readCachedAnalytics: jest.fn(),
  readCachedAnalyticsClientDays: jest.fn(),
  readCachedAnalyticsDailyBucket: jest.fn(),
  saveCachedAnalytics: jest.fn(),
}));
jest.mock('@/utils/time', () => ({
  ...jest.requireActual<typeof import('@/utils/time')>('@/utils/time'),
  beijingToday: () => '2026-08-06',
}));

const filters = {
  dateFrom: '2026-06-17',
  dateTo: '2026-07-16',
  sourceType: 'shop' as const,
  storeKey: '53961',
  storeKeys: ['53961'],
};

describe('analytics API', () => {
  beforeEach(() => {
    jest.mocked(apiRequest).mockReset().mockResolvedValue({});
    jest.mocked(captureOfflineCacheOperationToken).mockReset().mockReturnValue({ generation: 1, identity: { tenantId: 'tenant-1', userId: 'user-1' } });
    jest.mocked(clearCachedAnalytics).mockReset().mockResolvedValue(undefined);
    jest.mocked(clearCachedAnalyticsDailyBucket).mockReset().mockResolvedValue(undefined);
    jest.mocked(mergeCachedAnalyticsDelta).mockReset().mockResolvedValue(null);
    jest.mocked(readCachedAnalytics).mockReset().mockResolvedValue(null);
    jest.mocked(readCachedAnalyticsClientDays).mockReset().mockResolvedValue([]);
    jest.mocked(readCachedAnalyticsDailyBucket).mockReset().mockResolvedValue({ days: {} });
    jest.mocked(saveCachedAnalytics).mockReset().mockResolvedValue(undefined);
    jest.mocked(loadAnalyticsDailyDelta).mockReset();
    jest.mocked(loadAnalyticsDailyFactsV2).mockReset();
  });

  it('loads the dashboard through one orders V2 request and one meal V2 request', async () => {
    jest.mocked(loadAnalyticsDailyFactsV2).mockImplementation(async (options) => {
      await options.request([], null, { dateFrom: '2025-12-20', dateTo: '2026-06-17', forceRefresh: false });
      return options.schemaVersion === 'orders-daily-fact-v4'
        ? {
            days: ['2026-06-17'],
            payloads: [{
              data_status: 'ready',
              date: '2026-06-17',
              net_income_cent: 10_000,
              order_count: 2,
              source_totals: { shop: { net_income_cent: 10_000, order_count: 2 }, takeout: { net_income_cent: 0, order_count: 0 } },
              stores: { '53961': { store_key: '53961', net_income_cent: 10_000, order_count: 2, source_totals: { shop: { net_income_cent: 10_000, order_count: 2 } } } },
            }],
          } as never
        : {
            days: ['2026-06-17'],
            payloads: [{
              data_status: 'ready',
              date: '2026-06-17',
              stores: { '53961': { data_status: 'ready', periods: {}, store_key: '53961', table_count: 10 } },
            }],
          } as never;
    });

    const result = await getDashboardAnalytics({ ...filters, dateFrom: '2026-06-17', dateTo: '2026-06-17' });

    expect(apiRequest).toHaveBeenCalledTimes(2);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/orders/delta', expect.objectContaining({
      body: expect.stringContaining('"schema_version":"orders-daily-fact-v4"'),
      method: 'POST',
    }));
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/meal-periods/delta', expect.objectContaining({
      body: expect.stringContaining('"schema_version":"meal-period-daily-fact-v4"'),
      method: 'POST',
    }));
    expect(result.revenue.points[0]).toMatchObject({ net_income: 100, order_count: 2 });
  });

  it('loads a single-scope daily revenue trend through delta versions', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockResolvedValue({
      days: ['2026-06-17'],
      payloads: [{ period: '2026-06-17', net_income: 100, order_count: 4, missing: false }],
      meta: { moving_averages: [] },
    });
    await expect(getRevenueTrend({ ...filters, dateFrom: '2026-06-17', dateTo: '2026-06-17' }))
      .resolves.toMatchObject({ points: [{ period: '2026-06-17', net_income: 100 }] });
    expect(loadAnalyticsDailyDelta).toHaveBeenCalledWith(expect.objectContaining({
      cacheScope: 'analytics-v2:daily:revenueTrend:53961:shop',
    }));
  });

  it('uses the cached revenue GET endpoint when the caller prefers server cache', async () => {
    jest.mocked(apiRequest).mockResolvedValueOnce({ points: [] });

    await getRevenueTrend(filters, { preferServerCache: true });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&granularity=day&include_current=false',
      { signal: undefined },
    );
  });

  it('rebuilds labor trend points without aggregating financial totals', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockResolvedValue({
      days: ['2026-06-17'],
      payloads: [{ ...laborTrendFixture.points[0], period: '2026-06-17' }],
    });

    const result = await getLaborTrend({ ...filters, dateFrom: '2026-06-17', dateTo: '2026-06-17' });

    expect(result.points).toEqual([expect.objectContaining({ period: '2026-06-17' })]);
    expect(loadAnalyticsDailyDelta).toHaveBeenCalledWith(expect.objectContaining({
      cacheScope: 'analytics-v2:daily:laborTrend:53961:30',
    }));
  });

  it('uses labor delta for the page single-store scope', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockResolvedValue({
      days: ['2026-06-17'],
      payloads: [{ ...laborTrendFixture.points[0], period: '2026-06-17' }],
    });

    await getLaborTrend(filters, { storeKeys: ['53961'] });

    expect(loadAnalyticsDailyDelta).toHaveBeenCalledWith(expect.objectContaining({
      cacheScope: 'analytics-v2:daily:laborTrend:53961:30',
    }));
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('keeps the product name in product-trend daily metadata', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockResolvedValue({
      days: ['2026-06-17'],
      payloads: [{ ...productTrendFixture.points[0], period: '2026-06-17' }],
      meta: { product_name: '经典肉夹馍' },
    });

    const result = await getProductTrend('p-1', { ...filters, dateFrom: '2026-06-17', dateTo: '2026-06-17' });

    expect(result.product_name).toBe('经典肉夹馍');
    expect(result.points).toHaveLength(1);
  });

  it('uses product delta for the page single-store scope', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockResolvedValue({
      days: ['2026-06-17'],
      payloads: [{ ...productTrendFixture.points[0], period: '2026-06-17' }],
      meta: { product_name: '经典肉夹馍' },
    });

    await getProductTrend('p-1', filters, { dimKey: '53961', dimType: 'shop', storeKeys: ['53961'] });

    expect(loadAnalyticsDailyDelta).toHaveBeenCalledWith(expect.objectContaining({
      cacheScope: 'analytics-v2:daily:productTrend:p-1:53961:shop',
    }));
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('does not use product ranking delta because the page requires a server range result', async () => {
    await getProducts(filters);

    expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining('/api/v1/analytics/products?'), { signal: undefined });
    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
  });

  it('posts meal-period client versions to the existing delta endpoint', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockImplementation(async ({ request }) => {
      await request([{ date: '2026-06-17', version: 'v1' }]);
      return { days: ['2026-06-17'], payloads: [{ date: '2026-06-17' }] as never[] };
    });
    await getMealPeriodTrend({ ...filters, dateFrom: '2026-06-17', dateTo: '2026-06-17' });
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/stores/53961/meal-periods/trend/delta',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('\"client_days\":[{\"date\":\"2026-06-17\",\"version\":\"v1\"}]') }),
    );
  });

  it('falls back to the unchanged revenue GET endpoint after a delta error', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(new Error('delta unavailable'));
    jest.mocked(apiRequest).mockResolvedValueOnce({ points: [] });
    await getRevenueTrend(filters);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&granularity=day&include_current=false',
      { signal: undefined },
    );
  });

  it('keeps single-scope daily revenue trends with the current period on GET', async () => {
    await getRevenueTrend({ ...filters, includeCurrent: true });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&granularity=day&include_current=true',
      { signal: undefined },
    );
  });

  it('does not fall back after an aborted revenue delta request', async () => {
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(error);

    await expect(getRevenueTrend(filters)).rejects.toThrow('cancelled');

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('does not fall back after an aborted meal-period trend delta request', async () => {
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(error);

    await expect(getMealPeriodTrend(filters)).rejects.toThrow('cancelled');

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('falls back to the labor trend GET endpoint after a delta error', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(new Error('delta unavailable'));
    jest.mocked(apiRequest).mockResolvedValueOnce({ points: [] });

    await getLaborTrend(filters);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/labor-efficiency/trend?date_from=2026-06-17&date_to=2026-07-16&store_key=53961&periods=30',
      { signal: undefined },
    );
  });

  it('does not fall back after an aborted labor trend delta request', async () => {
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(error);

    await expect(getLaborTrend(filters)).rejects.toThrow('cancelled');

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('falls back to the product trend GET endpoint after a delta error', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(new Error('delta unavailable'));
    jest.mocked(apiRequest).mockResolvedValueOnce({ points: [] });

    await getProductTrend('p-1', filters);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/products/trend?product_key=p-1&date_from=2026-06-17&date_to=2026-07-16&dim_key=53961&dim_type=shop',
      { signal: undefined },
    );
  });

  it('does not fall back after an aborted product trend delta request', async () => {
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    jest.mocked(loadAnalyticsDailyDelta).mockRejectedValueOnce(error);

    await expect(getProductTrend('p-1', filters)).rejects.toThrow('cancelled');

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps explicit labor includeCurrent=%s on GET', async (includeCurrent) => {
    await getLaborTrend(filters, { includeCurrent });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      `/api/v1/analytics/labor-efficiency/trend?date_from=2026-06-17&date_to=2026-07-16&store_key=53961&periods=30&include_current=${includeCurrent}`,
      { signal: undefined },
    );
  });

  it.each([false, true])('keeps explicit product includeCurrent=%s on GET', async (includeCurrent) => {
    await getProductTrend('p-1', filters, { includeCurrent });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      `/api/v1/analytics/products/trend?product_key=p-1&date_from=2026-06-17&date_to=2026-07-16&dim_key=53961&dim_type=shop&include_current=${includeCurrent}`,
      { signal: undefined },
    );
  });

  it('passes weekly granularity and the current-period flag only to revenue trends', async () => {
    const weekly = { ...filters, granularity: 'week' as const, includeCurrent: true };

    await getRevenueTrend(weekly);
    await getLaborTrend(weekly);

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&granularity=week&include_current=true',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/labor-efficiency/trend?date_from=2026-06-17&date_to=2026-07-16&store_key=53961&periods=30',
      { signal: undefined },
    );
  });

  it('uses the selected date range for the turnover endpoint', async () => {
    await getMealPeriodTurnover(filters);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/stores/53961/meal-periods/turnover?date_from=2026-06-17&date_to=2026-07-16',
      { signal: undefined },
    );
  });

  it('repeats store_keys for every store in multi-store trend requests', async () => {
    const multiStoreFilters = { ...filters, storeKey: 'ALL', storeKeys: ['53961', '53962'] };

    await getRevenueTrend(multiStoreFilters);
    await getMealPeriodTrend(multiStoreFilters);
    await getMealPeriodTurnover(multiStoreFilters);

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=ALL&store_keys=53961&store_keys=53962&granularity=day&include_current=false',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/stores/ALL/meal-periods/trend?date_from=2026-06-17&date_to=2026-07-16&store_keys=53961&store_keys=53962',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      3,
      '/api/v1/analytics/stores/ALL/meal-periods/turnover?date_from=2026-06-17&date_to=2026-07-16&store_keys=53961&store_keys=53962',
      { signal: undefined },
    );
    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
  });

  it('keeps weekly revenue and monthly meal-period trends on their existing GET endpoints', async () => {
    await getRevenueTrend({ ...filters, granularity: 'week' });
    await getMealPeriodTrend({ ...filters, granularity: 'month' });

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&granularity=week&include_current=false',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/stores/53961/meal-periods/trend?date_from=2026-06-17&date_to=2026-07-16',
      { signal: undefined },
    );
    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
  });

  it('requests store trends for overlapping explicit scopes even when they resolve to one store', async () => {
    await getRevenueTrend({ ...filters, scopeKeys: ['dept:north', 'shop:53961'] });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&store_keys=53961&granularity=day&include_current=false',
      { signal: undefined },
    );
  });

  it('requests store trends for a single explicit department that resolves to one store', async () => {
    await getRevenueTrend({ ...filters, scopeKeys: ['dept:north'] });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/trends/revenue?date_from=2026-06-17&date_to=2026-07-16&source_type=shop&store_key=53961&store_keys=53961&granularity=day&include_current=false',
      { signal: undefined },
    );
  });

  it('uses the server-produced range result from the delta endpoint', async () => {
    jest.mocked(apiRequest).mockResolvedValue({
      changed_days: [
        {
          date: '2026-06-17',
          payload: { rows: [{ avg_order_value: 50, dim_key: '53961', dim_label: '门店一', net_income: 80, order_count: 2, paid_amount: 100, refund_amount: 10, refund_rate: 0.1 }] },
          version: 'v1',
        },
        {
          date: '2026-06-18',
          payload: { rows: [{ avg_order_value: 33.33, dim_key: '53961', dim_label: '门店一', net_income: 90, order_count: 3, paid_amount: 100, refund_amount: 10, refund_rate: 0.1 }] },
          version: 'v2',
        },
      ],
      unchanged_days: [],
      range_payload: { rows: [{ avg_order_value: 40, dim_key: '53961', dim_label: '门店一', net_income: 170, order_count: 5, paid_amount: 200, refund_amount: 20, refund_rate: 0.1 }] },
    });

    const result = await getOrders(filters, { forceRefresh: true });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/orders/delta',
      expect.objectContaining({
        body: JSON.stringify({
          auto_refresh: true,
          client_days: [],
          date_from: '2026-06-17',
          date_to: '2026-07-16',
          force_refresh: true,
          params: { dim: 'all', source_type: 'shop', store_keys: ['53961'] },
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        signal: undefined,
      }),
    );
    expect(result.rows).toEqual([expect.objectContaining({
      avg_order_value: 40,
      dim_key: '53961',
      net_income: 170,
      order_count: 5,
      refund_rate: 0.1,
    })]);
  });

  it('loads order detail records through the shared daily order cache', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockImplementation(async ({ cacheScope, request }) => {
      expect(cacheScope).toBe('analytics-v2:daily:orders:shop:shop:53961');
      await request([{ date: '2026-06-17', version: 'v10' }]);
      return {
        days: ['2026-06-17'],
        entries: [{ date: '2026-06-17', payload: { rows: [] }, version: 'v10' }],
        payloads: [{ rows: [] }],
      } as never;
    });

    await expect(getOrderDailyRecords(filters, { dimensions: ['shop'] })).resolves.toEqual([
      { data: { rows: [] }, date: '2026-06-17', version: 'v10' },
    ]);
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/orders/delta',
      expect.objectContaining({
        body: JSON.stringify({
          auto_refresh: false,
          client_days: [{ date: '2026-06-17', version: 'v10' }],
          date_from: '2026-06-17',
          date_to: '2026-07-16',
          force_refresh: false,
          params: { dim: 'shop', source_type: 'shop', store_keys: ['53961'] },
        }),
      }),
    );
  });

  it('reads aggregate shop daily cache when the scoped store bucket is empty', async () => {
    jest.mocked(readCachedAnalyticsDailyBucket).mockImplementation(async (scope) => (
      scope === 'analytics-v2:daily:orders:shop:shop:'
        ? {
            days: {
              '2026-06-17': {
                payload: { rows: [{ avg_order_value: 40, dim_key: '53961', dim_label: '门店一', net_income: 80, order_count: 2, refund_rate: 0 }] },
                version: 'all-v1',
              },
            },
          }
        : ({ days: {} } as DailyBucket<unknown>)
    ));

    await expect(readCachedOrderDailyRecords(filters, { dimensions: ['shop'] })).resolves.toEqual([
      {
        data: { rows: [{ avg_order_value: 40, dim_key: '53961', dim_label: '门店一', net_income: 80, order_count: 2, refund_rate: 0 }] },
        date: '2026-06-17',
        version: 'all-v1',
      },
    ]);
    expect(readCachedAnalyticsDailyBucket).toHaveBeenNthCalledWith(1, 'analytics-v2:daily:orders:shop:shop:53961', undefined, expect.anything());
    expect(readCachedAnalyticsDailyBucket).toHaveBeenNthCalledWith(2, 'analytics-v2:daily:orders:shop:shop:', undefined, expect.anything());
  });

  it('returns the server range result before the background delta merge settles', async () => {
    let signalMergeStarted: (() => void) | undefined;
    const mergeStarted = new Promise<void>((resolve) => { signalMergeStarted = resolve; });
    jest.mocked(mergeCachedAnalyticsDelta).mockImplementation(() => {
      signalMergeStarted?.();
      return new Promise(() => {});
    });
    jest.mocked(apiRequest).mockResolvedValue({
      changed_days: [{ date: '2026-06-17', payload: { rows: [] }, version: 'v1' }],
      range_payload: { rows: [{ avg_order_value: 40, dim_key: '53961', dim_label: '门店一', net_income: 170, order_count: 5, refund_rate: 0.1 }] },
      unchanged_days: [],
    });

    const response = getOrders(filters);
    await mergeStarted;
    let settled = false;
    void response.then(() => { settled = true; });
    await new Promise<void>((resolve) => { setImmediate(resolve); });

    expect(settled).toBe(true);
    await expect(response).resolves.toEqual(expect.objectContaining({ rows: [expect.objectContaining({ net_income: 170 })] }));
  });

  it('sends cached order day versions for the requested range', async () => {
    jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([
      { date: '2026-06-17', version: 'v10' },
      { date: '2026-06-18', version: 'v11' },
    ]);

    await getOrders(filters);

    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/orders/delta', expect.objectContaining({
      body: expect.stringContaining('"client_days":[{"date":"2026-06-17","version":"v10"},{"date":"2026-06-18","version":"v11"}]'),
    }));
  });

  it('uses one captured cache operation token for legacy order reads and merges', async () => {
    const token = { generation: 3, identity: { tenantId: 'tenant-1', userId: 'user-1' } };
    jest.mocked(captureOfflineCacheOperationToken).mockReturnValue(token);
    jest.mocked(apiRequest).mockResolvedValue({ changed_days: [] });

    await getOrders(filters);

    const scope = 'analytics-v2:daily:orders:shop:all:53961';
    expect(readCachedAnalyticsClientDays).toHaveBeenCalledWith(scope, filters.dateFrom, filters.dateTo, undefined, { signal: undefined, token });
    expect(mergeCachedAnalyticsDelta).toHaveBeenCalledWith(scope, [], undefined, undefined, { signal: undefined, token });
  });

  it('clears the scoped daily bucket and sends empty versions for force refresh', async () => {
    const token = { generation: 2, identity: { tenantId: 'tenant-1', userId: 'user-1' } };
    jest.mocked(captureOfflineCacheOperationToken).mockReturnValue(token);
    jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([{ date: '2026-06-17', version: 'v10' }]);

    await getOrders(filters, { forceRefresh: true });

    expect(clearCachedAnalyticsDailyBucket).toHaveBeenCalledWith('analytics-v2:daily:orders:shop:all:53961', undefined, { signal: undefined, token });
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/orders/delta', expect.objectContaining({
      body: expect.stringContaining('"client_days":[]'),
    }));
  });

  it('sends cached order day versions for detail records', async () => {
    jest.mocked(loadAnalyticsDailyDelta).mockImplementation(async ({ request }) => {
      await request([{ date: '2026-06-17', version: 'v10' }]);
      return {
        days: ['2026-06-17'],
        entries: [{ date: '2026-06-17', payload: { rows: [] }, version: 'v10' }],
        payloads: [{ rows: [] }],
      } as never;
    });

    await expect(getOrderDailyRecords(filters)).resolves.toEqual([
      { data: { rows: [] }, date: '2026-06-17', version: 'v10' },
    ]);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/orders/delta', expect.objectContaining({
      body: expect.stringContaining('"client_days":[{"date":"2026-06-17","version":"v10"}]'),
    }));
  });

  it('sends normalized dimensions and keeps channel requests source-neutral', async () => {
    jest.mocked(apiRequest).mockResolvedValue({ changed_days: [], unchanged_days: [] });

    await getOrders(filters, { dimensions: ['channel', 'shop'] });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/orders/delta',
      expect.objectContaining({
        body: expect.stringContaining('"params":{"dim":"shop_channel","source_type":"all","store_keys":["53961"]}'),
      }),
    );
  });

  it('does not fall back after an aborted delta request', async () => {
    const controller = new AbortController();
    const error = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    controller.abort();
    jest.mocked(apiRequest).mockRejectedValue(error);

    await expect(getOrders(filters, { signal: controller.signal })).rejects.toThrow('cancelled');

    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
  });

  it('falls back to the orders endpoint after a non-abort delta error', async () => {
    jest.mocked(apiRequest)
      .mockRejectedValueOnce(new Error('delta unavailable'))
      .mockResolvedValueOnce({ rows: [] });

    await expect(getOrders(filters)).resolves.toEqual({ rows: [] });

    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/orders?granularity=day&period=2026-06-17&dim=all&source_type=shop&store_keys=53961&auto_refresh=true&exclude_today=false',
      { signal: undefined },
    );
    expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
  });

  it('excludes today only for normalized current periods in fallback queries', async () => {
    jest.mocked(apiRequest)
      .mockRejectedValueOnce(new Error('week delta unavailable'))
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('month delta unavailable'))
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('completed week delta unavailable'))
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('completed month delta unavailable'))
      .mockResolvedValueOnce({ rows: [] });

    await getOrders({ ...filters, dateFrom: '2026-08-03', dateTo: '2026-08-05', granularity: 'week', includeCurrent: true });
    await getOrders({ ...filters, dateFrom: '2026-08-01', dateTo: '2026-08-05', granularity: 'month', includeCurrent: true });
    await getOrders({ ...filters, dateFrom: '2026-07-20', dateTo: '2026-07-26', granularity: 'week', includeCurrent: true });
    await getOrders({ ...filters, dateFrom: '2026-07-01', dateTo: '2026-07-31', granularity: 'month', includeCurrent: true });

    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/orders?granularity=week&period=2026-W32&dim=all&source_type=shop&store_keys=53961&auto_refresh=true&exclude_today=true',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      4,
      '/api/v1/analytics/orders?granularity=month&period=2026-08&dim=all&source_type=shop&store_keys=53961&auto_refresh=true&exclude_today=true',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      6,
      '/api/v1/analytics/orders?granularity=week&period=2026-W30&dim=all&source_type=shop&store_keys=53961&auto_refresh=true&exclude_today=false',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      8,
      '/api/v1/analytics/orders?granularity=month&period=2026-07&dim=all&source_type=shop&store_keys=53961&auto_refresh=true&exclude_today=false',
      { signal: undefined },
    );
  });

  it('loads weekly order detail records through one batch period snapshot request', async () => {
    jest.mocked(apiRequest).mockResolvedValue({
      records: [
        {
          data: { rows: [{ avg_order_value: 18, dim_key: '53961', dim_label: '门店一', net_income: 126, order_count: 7, refund_rate: 0 }], snapshot_status: 'ready' },
          date_from: '2026-07-27',
          date_to: '2026-08-02',
          period: '2026-W31',
        },
        {
          data: { rows: [{ avg_order_value: 18, dim_key: '53961', dim_label: '门店一', net_income: 140, order_count: 8, refund_rate: 0 }], snapshot_status: 'ready' },
          date_from: '2026-08-24',
          date_to: '2026-08-30',
          period: '2026-W35',
        },
      ],
    });

    const result = await getOrderPeriodSnapshotRecords({
      ...filters,
      dateFrom: '2026-07-27',
      dateTo: '2026-08-30',
      granularity: 'week',
      includeCurrent: false,
    }, { dimensions: ['shop'] });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/orders/periods',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json' }, method: 'POST', signal: undefined }),
    );
    const body = JSON.parse(String(jest.mocked(apiRequest).mock.calls[0][1]?.body));
    expect(body).toMatchObject({ auto_refresh: false, dim: 'shop', exclude_today: false, granularity: 'week', source_type: 'shop', store_keys: ['53961'] });
    expect(body.periods.map((period: { period: string }) => period.period)).toEqual(['2026-W31', '2026-W32', '2026-W33', '2026-W34', '2026-W35']);
    expect(result[0]).toEqual(expect.objectContaining({ dateFrom: '2026-07-27', dateTo: '2026-08-02', period: '2026-W31' }));
    expect(result.at(-1)).toEqual(expect.objectContaining({ dateFrom: '2026-08-24', dateTo: '2026-08-30', period: '2026-W35' }));
    expect(saveCachedAnalytics).toHaveBeenCalledWith(
      'orders',
      expect.stringContaining('order-period-snapshot-v1:shop:53961:'),
      expect.objectContaining({ records: expect.arrayContaining([expect.objectContaining({ period: '2026-W35' })]) }),
      expect.any(Number),
    );
  });

  it('reuses fresh cached order period snapshots without a network request', async () => {
    jest.mocked(readCachedAnalytics).mockImplementation(async (_module, scope) => ({
      data: {
        cacheContext: String(scope),
        records: [{
          data: { rows: [{ avg_order_value: 18, dim_key: '53961', dim_label: '门店一', net_income: 126, order_count: 7, refund_rate: 0 }] },
          dateFrom: '2026-08-01',
          dateTo: '2026-08-31',
          period: '2026-08',
          version: 'cached-v1',
        }],
      },
      lastSyncedAt: Date.now(),
    }));

    await expect(getOrderPeriodSnapshotRecords({
      ...filters,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      granularity: 'month',
      includeCurrent: false,
    }, { dimensions: ['shop'] })).resolves.toEqual([
      expect.objectContaining({ period: '2026-08', version: 'cached-v1' }),
    ]);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('passes the selected store to labor and product rankings', async () => {
    await getLabor(filters);
    await getProducts(filters);

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v1/analytics/labor-efficiency?date_from=2026-06-17&date_to=2026-07-16&store_keys=53961',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/products?date_from=2026-06-17&date_to=2026-07-16&limit=20&shop=53961',
      { signal: undefined },
    );
  });

  it('keeps multi-store labor trends on the GET endpoint', async () => {
    const multiStoreFilters = { ...filters, storeKey: 'ALL', storeKeys: ['53961', '53962'] };
    await getLabor(multiStoreFilters);
    await getLaborTrend(multiStoreFilters);

    expect(apiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/v1/analytics/labor-efficiency?date_from=2026-06-17&date_to=2026-07-16&store_keys=53961&store_keys=53962',
      { signal: undefined },
    );
    expect(apiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/v1/analytics/labor-efficiency/trend?date_from=2026-06-17&date_to=2026-07-16&store_key=ALL&periods=30&store_keys=53961&store_keys=53962',
      { signal: undefined },
    );
  });

  it('keeps a non-equivalent labor store key on the GET endpoint', async () => {
    await getLaborTrend(filters, { storeKeys: ['53962'] });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/labor-efficiency/trend?date_from=2026-06-17&date_to=2026-07-16&store_key=53961&periods=30&store_keys=53962',
      { signal: undefined },
    );
  });

  it('keeps explicit product trend store keys on the GET endpoint', async () => {
    await getProductTrend('name:招牌 牛肉面', {
      ...filters,
      storeKey: 'ALL',
      storeKeys: ['53961', '53962'],
    }, { storeKeys: ['53961', '53962'] });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/products/trend?product_key=name%3A%E6%8B%9B%E7%89%8C+%E7%89%9B%E8%82%89%E9%9D%A2&date_from=2026-06-17&date_to=2026-07-16&dim_key=ALL&dim_type=all&store_keys=53961&store_keys=53962',
      { signal: undefined },
    );
  });

  it('keeps a non-equivalent product store key on the GET endpoint', async () => {
    await getProductTrend('p-1', filters, { dimKey: '53961', dimType: 'shop', storeKeys: ['53962'] });

    expect(loadAnalyticsDailyDelta).not.toHaveBeenCalled();
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/products/trend?product_key=p-1&date_from=2026-06-17&date_to=2026-07-16&dim_key=53961&dim_type=shop&store_keys=53962',
      { signal: undefined },
    );
  });

  it('serializes explicit product trend store keys in stable Web order without include_store_trends', async () => {
    await getProductTrend('name:招牌 牛肉面', filters, {
      dimKey: 'ALL',
      dimType: 'all',
      granularity: 'week',
      includeCurrent: true,
      includeStoreTrends: true,
      storeKeys: ['53962', 'ALL', '53961', '53962'],
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/products/trend?product_key=name%3A%E6%8B%9B%E7%89%8C+%E7%89%9B%E8%82%89%E9%9D%A2&date_from=2026-06-17&date_to=2026-07-16&dim_key=ALL&dim_type=all&store_keys=53961&store_keys=53962&granularity=week&include_current=true',
      { signal: undefined },
    );
  });

  it('serializes labor department scope as stable store_keys without include_store_trends', async () => {
    await getLaborTrend({ ...filters, storeKey: 'ALL' }, {
      granularity: 'month',
      includeCurrent: true,
      storeKeys: ['dept:north', 'dept:central', 'dept:north'],
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/labor-efficiency/trend?date_from=2026-06-17&date_to=2026-07-16&store_key=ALL&periods=30&store_keys=dept%3Acentral&store_keys=dept%3Anorth&granularity=month&include_current=true',
      { signal: undefined },
    );
  });

  it('keeps web-parity response fixtures for missing, zero-denominator, and duplicate-department cases', () => {
    expect(productTrendFixture.points[1]).toMatchObject({ missing: true, period_start: '2026-06-15', period_end: '2026-06-21' });
    expect(laborTrendFixture.points[0]).toMatchObject({ actual_revenue_per_hour: 0, planned_revenue_per_hour: 0 });
    expect(laborTrendFixture.moving_averages).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'actual_hours_ma4' }),
      expect.objectContaining({ field: 'actual_revenue_per_hour_ma4' }),
      expect.objectContaining({ field: 'planned_hours_ma4' }),
      expect.objectContaining({ field: 'planned_revenue_per_hour_ma4' }),
    ]));
    expect(scopeFixture.departmentMappings).toContainEqual({ departmentKey: 'dept:north', storeKey: '53961' });
    expect(scopeFixture.departmentMappings.filter((item) => item.storeKey === '53961')).toHaveLength(2);
  });

  it('loads labor detail for the selected store and period', async () => {
    await getLaborDetail('53961', filters);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/labor-efficiency/53961/detail?granularity=week&date_from=2026-06-17&date_to=2026-07-16',
      { signal: undefined },
    );
  });

  it('keeps force-refresh product trends on GET outside daily granularity', async () => {
    await getProductTrend('name:招牌 牛肉面', filters, {
      dimKey: '2',
      dimType: 'platform',
      forceRefresh: true,
      granularity: 'week',
    });
    const params = new URLSearchParams({
      product_key: 'name:招牌 牛肉面',
      date_from: '2026-06-17',
      date_to: '2026-07-16',
      dim_key: '2',
      dim_type: 'platform',
      granularity: 'week',
    });
    params.set('refresh', 'true');

    expect(apiRequest).toHaveBeenCalledWith(
      `/api/v1/analytics/products/trend?${params.toString()}`,
      { signal: undefined },
    );
  });

  it('loads every product row for the selected product dimension', async () => {
    await getProducts(filters, { dimKey: 'takeout', dimType: 'channel', limit: 0 });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/products?date_from=2026-06-17&date_to=2026-07-16&limit=0&shop=takeout&dim_type=channel',
      { signal: undefined },
    );
  });

  it('serializes explicit product stores in stable order without ALL', async () => {
    await getProducts({ ...filters, storeKey: 'ALL', storeKeys: ['ALL'] }, {
      limit: 0,
      storeKeys: ['102', 'ALL', '101', '102'],
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/products?date_from=2026-06-17&date_to=2026-07-16&limit=0&shop=ALL&store_keys=101&store_keys=102',
      { signal: undefined },
    );
  });

  it('loads platform labels for the product dimension filter', async () => {
    jest.mocked(apiRequest).mockResolvedValue({ platforms: [{ confirmed: true, platform_code: 2, platform_name: '美团' }] });

    await expect(listPlatformDim()).resolves.toEqual([{ confirmed: true, platform_code: 2, platform_name: '美团' }]);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/platform-dim', { signal: undefined });
  });

  it('loads the department and store scope tree', async () => {
    const scopeTree = { nodes: [{ key: 'dept:north', type: 'department', label: '北区' }], source: 'projection', store_count: 2 };
    jest.mocked(apiRequest).mockResolvedValue(scopeTree);

    await expect(listStoreScopeTree()).resolves.toEqual(scopeTree);
    expect(apiRequest).toHaveBeenCalledWith('/api/v1/analytics/store-scope-tree', { signal: undefined });
  });

  it('loads the read-only revenue alerts for the selected business date', async () => {
    const alerts = [{
      actual_amount: 820,
      baseline_amount: 1000,
      business_date: '2026-07-16',
      deviation_pct: -0.18,
      direction: 'under',
      shop_key: '53961',
      shop_label: '长安旗舰店',
      status: 'open',
    }];
    jest.mocked(apiRequest).mockResolvedValue({ alerts });

    await expect(getRevenueAlerts('2026-07-16')).resolves.toEqual(alerts);
    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/revenue-alerts?business_date=2026-07-16',
      { signal: undefined },
    );
  });
});
