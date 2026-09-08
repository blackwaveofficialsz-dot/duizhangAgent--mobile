import { eachBusinessDate, loadAnalyticsDailyDelta, loadAnalyticsDailyFactsV2 } from './analyticsDelta';
import {
  captureOfflineCacheOperationToken,
  clearCachedAnalyticsDailyBucket,
  mergeCachedAnalyticsDelta,
  readCachedAnalyticsDailyBucket,
  readCachedAnalyticsClientDays,
} from '@/services/cache/offlineCache';

jest.mock('@/services/cache/offlineCache', () => ({
  captureOfflineCacheOperationToken: jest.fn(),
  clearCachedAnalyticsDailyBucket: jest.fn(),
  mergeCachedAnalyticsDelta: jest.fn(),
  readCachedAnalyticsDailyBucket: jest.fn(),
  readCachedAnalyticsClientDays: jest.fn(),
}));

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(captureOfflineCacheOperationToken).mockReturnValue({ generation: 1, identity: { tenantId: 'tenant-a', userId: 'user-a' } });
  jest.mocked(readCachedAnalyticsDailyBucket).mockResolvedValue({ days: {} });
  jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([]);
});

it('loads V2 facts from monthly buckets with the cached access scope', async () => {
  jest.mocked(readCachedAnalyticsDailyBucket).mockResolvedValue({
    days: {
      '2026-08-25': { payload: { date: '2026-08-25', value: 1 }, version: 'v1' },
    },
    meta: { access_scope_hash: 'scope-current', schema_version: 'orders-daily-fact-v4' },
  });
  const request = jest.fn().mockResolvedValue({
    access_scope_hash: 'scope-current',
    changed_days: [],
    deleted_days: [],
    namespace: 'analytics.orders.daily',
    params_hash: 'params-current',
    reset_required: false,
    schema_version: 'orders-daily-fact-v4',
    unchanged_days: ['2026-08-25'],
  });

  await expect(loadAnalyticsDailyFactsV2({
    cacheScope: 'analytics-v3:daily:orders',
    dateFrom: '2026-08-25',
    dateTo: '2026-08-25',
    request,
    schemaVersion: 'orders-daily-fact-v4',
  })).resolves.toMatchObject({ payloads: [{ value: 1 }] });

  expect(request).toHaveBeenCalledWith(
    [{ date: '2026-08-25', version: 'v1' }],
    'scope-current',
    { dateFrom: '2026-08-25', dateTo: '2026-08-25', forceRefresh: false },
  );
  expect(readCachedAnalyticsDailyBucket).toHaveBeenCalledWith(
    'analytics-v3:daily:orders:2026-08',
    undefined,
    expect.objectContaining({ token: expect.anything() }),
  );
});

it('drops populated V2 buckets without complete access identity metadata', async () => {
  jest.mocked(readCachedAnalyticsDailyBucket).mockResolvedValue({
    days: {
      '2026-08-25': { payload: { date: '2026-08-25', value: 1 }, version: 'old' },
    },
    meta: { schema_version: 'orders-daily-fact-v4' },
  });
  jest.mocked(mergeCachedAnalyticsDelta).mockResolvedValue({
    days: {
      '2026-08-25': { payload: { date: '2026-08-25', value: 2 }, version: 'new' },
    },
    meta: { access_scope_hash: 'scope-current', schema_version: 'orders-daily-fact-v4' },
  });
  const request = jest.fn().mockResolvedValue({
    access_scope_hash: 'scope-current',
    changed_days: [{ date: '2026-08-25', payload: { date: '2026-08-25', value: 2 }, version: 'new' }],
    deleted_days: [],
    namespace: 'analytics.orders.daily',
    params_hash: 'params-current',
    reset_required: false,
    schema_version: 'orders-daily-fact-v4',
    unchanged_days: [],
  });

  await loadAnalyticsDailyFactsV2({
    cacheScope: 'analytics-v3:daily:orders',
    dateFrom: '2026-08-25',
    dateTo: '2026-08-25',
    request,
    schemaVersion: 'orders-daily-fact-v4',
  });

  expect(clearCachedAnalyticsDailyBucket).toHaveBeenCalledWith(
    'analytics-v3:daily:orders:2026-08',
    undefined,
    expect.objectContaining({ token: expect.anything() }),
  );
  expect(request).toHaveBeenCalledWith(
    [],
    null,
    { dateFrom: '2026-08-25', dateTo: '2026-08-25', forceRefresh: false },
  );
});

it('clears a V2 monthly bucket when the server resets access scope and applies explicit deletes', async () => {
  jest.mocked(readCachedAnalyticsDailyBucket).mockResolvedValue({
    days: {
      '2026-08-25': { payload: { date: '2026-08-25', value: 1 }, version: 'old-1' },
      '2026-08-26': { payload: { date: '2026-08-26', value: 2 }, version: 'old-2' },
    },
    meta: { access_scope_hash: 'scope-old', schema_version: 'orders-daily-fact-v4' },
  });
  jest.mocked(mergeCachedAnalyticsDelta).mockResolvedValue({
    days: {
      '2026-08-25': { payload: { date: '2026-08-25', value: 3 }, version: 'new-1' },
    },
    meta: { access_scope_hash: 'scope-new' },
  });

  const result = await loadAnalyticsDailyFactsV2({
    cacheScope: 'analytics-v3:daily:orders',
    dateFrom: '2026-08-25',
    dateTo: '2026-08-26',
    request: async () => ({
      access_scope_hash: 'scope-new',
      changed_days: [{ date: '2026-08-25', payload: { date: '2026-08-25', value: 3 }, version: 'new-1' }],
      deleted_days: ['2026-08-26'],
      namespace: 'analytics.orders.daily',
      params_hash: 'params-current',
      reset_required: true,
      schema_version: 'orders-daily-fact-v4',
      unchanged_days: [],
    }),
    schemaVersion: 'orders-daily-fact-v4',
  });

  expect(clearCachedAnalyticsDailyBucket).toHaveBeenCalledWith(
    'analytics-v3:daily:orders:2026-08',
    undefined,
    expect.objectContaining({ token: expect.anything() }),
  );
  expect(mergeCachedAnalyticsDelta).toHaveBeenCalledWith(
    'analytics-v3:daily:orders:2026-08',
    [
      { date: '2026-08-25', payload: { date: '2026-08-25', value: 3 }, version: 'new-1' },
      { date: '2026-08-26', payload: null, version: 'deleted' },
    ],
    expect.objectContaining({ access_scope_hash: 'scope-new', params_hash: 'params-current' }),
    undefined,
    expect.objectContaining({ token: expect.anything() }),
  );
  expect(result.payloads).toEqual([{ date: '2026-08-25', value: 3 }]);
});

it('splits V2 force refreshes at the server 31-day limit', async () => {
  const stored = new Map<string, Record<string, { payload: { date: string }; version: string }>>();
  jest.mocked(mergeCachedAnalyticsDelta).mockImplementation(async (scope, updates) => {
    const days = stored.get(scope) ?? {};
    for (const update of updates) {
      if (update.payload === null) delete days[update.date];
      else days[update.date] = { payload: update.payload as { date: string }, version: update.version };
    }
    stored.set(scope, days);
    return { days };
  });
  const request = jest.fn(async (
    _clientDays: Array<{ date: string; version: string }>,
    _accessScopeHash: string | null,
    range: { dateFrom: string; dateTo: string; forceRefresh: boolean },
  ) => {
    const changedDays = eachBusinessDate(range.dateFrom, range.dateTo).map((date) => ({
      date,
      payload: { date },
      version: `v-${date}`,
    }));
    return {
      access_scope_hash: 'scope-current',
      changed_days: changedDays,
      deleted_days: [],
      namespace: 'analytics.orders.daily',
      params_hash: 'params-current',
      reset_required: false,
      schema_version: 'orders-daily-fact-v4',
      unchanged_days: [],
    };
  });

  const result = await loadAnalyticsDailyFactsV2({
    cacheScope: 'analytics-v3:daily:orders',
    dateFrom: '2026-07-01',
    dateTo: '2026-08-01',
    forceRefresh: true,
    request: request as never,
    schemaVersion: 'orders-daily-fact-v4',
  });

  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.map((call) => call[2])).toEqual([
    { dateFrom: '2026-07-01', dateTo: '2026-07-31', forceRefresh: true },
    { dateFrom: '2026-08-01', dateTo: '2026-08-01', forceRefresh: true },
  ]);
  expect(result.payloads).toHaveLength(32);
});

it('reuses cached versions and returns payloads in requested date order', async () => {
  jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([
    { date: '2026-08-25', version: 'v1' },
  ]);
  jest.mocked(mergeCachedAnalyticsDelta).mockResolvedValue({
    days: {
      '2026-08-25': { payload: { period: '2026-08-25', value: 1 }, version: 'v1' },
      '2026-08-26': { payload: { period: '2026-08-26', value: 2 }, version: 'v2' },
    },
  });
  const request = jest.fn().mockResolvedValue({
    changed_days: [{ date: '2026-08-26', payload: { period: '2026-08-26', value: 2 }, version: 'v2' }],
    unchanged_days: ['2026-08-25'],
  });

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-26', request,
  })).resolves.toMatchObject({
    entries: [
      { date: '2026-08-25', payload: { value: 1 }, version: 'v1' },
      { date: '2026-08-26', payload: { value: 2 }, version: 'v2' },
    ],
    payloads: [{ value: 1 }, { value: 2 }],
  });
  expect(request).toHaveBeenCalledWith([{ date: '2026-08-25', version: 'v1' }]);
});

it('throws when one requested business date is still missing', async () => {
  jest.mocked(mergeCachedAnalyticsDelta).mockResolvedValue({ days: {} });
  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25', request: async () => ({ changed_days: [{ date: '2026-08-25', payload: { value: 1 }, version: 'v1' }] }),
  })).rejects.toThrow('经营分析日缓存不完整');
});

it('binds a delta request and merge to one cache operation token', async () => {
  const token = { generation: 1, identity: { tenantId: 'tenant-a', userId: 'user-a' } };
  jest.mocked(captureOfflineCacheOperationToken).mockReturnValue(token);
  const changedDays = [{ date: '2026-08-25', payload: { period: '2026-08-25' }, version: 'v1' }];
  jest.mocked(mergeCachedAnalyticsDelta).mockResolvedValue({ days: { '2026-08-25': { payload: { period: '2026-08-25' }, version: 'v1' } } });

  await loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ changed_days: changedDays }),
  });

  expect(readCachedAnalyticsClientDays).toHaveBeenCalledWith('scope', '2026-08-25', '2026-08-25', undefined, { signal: undefined, token });
  expect(mergeCachedAnalyticsDelta).toHaveBeenCalledWith('scope', changedDays, undefined, undefined, { signal: undefined, token });
});

it('rejects a response that omits a cached requested day before merging', async () => {
  jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([{ date: '2026-08-25', version: 'v1' }]);

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-26',
    request: async () => ({ changed_days: [{ date: '2026-08-26', payload: { period: '2026-08-26' }, version: 'v2' }] }),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('clears the exact bucket and sends no client versions on force refresh', async () => {
  jest.mocked(mergeCachedAnalyticsDelta).mockResolvedValue({
    days: { '2026-08-25': { payload: { period: '2026-08-25' }, version: 'v2' } },
  });
  const request = jest.fn().mockResolvedValue({
    changed_days: [{ date: '2026-08-25', payload: { period: '2026-08-25' }, version: 'v2' }],
  });
  await loadAnalyticsDailyDelta({ cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25', forceRefresh: true, request });
  expect(clearCachedAnalyticsDailyBucket).toHaveBeenCalledWith('scope', undefined, expect.objectContaining({ token: expect.anything() }));
  expect(request).toHaveBeenCalledWith([]);
});

it('rejects an already-aborted force refresh before cache side effects', async () => {
  const controller = new AbortController();
  controller.abort();
  const request = jest.fn();

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25', forceRefresh: true, request, signal: controller.signal,
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(clearCachedAnalyticsDailyBucket).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('rejects invalid and reversed business date ranges', () => {
  expect(() => eachBusinessDate('2026-08-32', '2026-08-25')).toThrow('经营分析日期格式无效');
  expect(() => eachBusinessDate('2026-08-26', '2026-08-25')).toThrow('经营分析日期范围无效');
});

it('accepts 365 business days and rejects 366 before cache side effects', async () => {
  expect(eachBusinessDate('2025-08-27', '2026-08-26')).toHaveLength(365);

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2025-08-27', dateTo: '2026-08-27', forceRefresh: true, request: jest.fn(),
  })).rejects.toThrow('经营分析日期范围不能超过365天');
  expect(clearCachedAnalyticsDailyBucket).not.toHaveBeenCalled();
});

it('rejects an out-of-range changed day before merging', async () => {
  jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([]);

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ changed_days: [{ date: '2026-08-26', payload: { value: 2 }, version: 'v2' }] }),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('rejects duplicate changed days before merging', async () => {
  jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([]);

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ changed_days: [
      { date: '2026-08-25', payload: { value: 1 }, version: 'v1' },
      { date: '2026-08-25', payload: { value: 2 }, version: 'v2' },
    ] }),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('rejects an unchanged day without a requested client version before merging', async () => {
  jest.mocked(readCachedAnalyticsClientDays).mockResolvedValue([]);

  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ unchanged_days: ['2026-08-25'] }),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('rejects null changed days before merging', async () => {
  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ changed_days: null } as never),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('rejects null unchanged days before merging', async () => {
  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ unchanged_days: null } as never),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});

it('rejects a changed day without its own payload before merging', async () => {
  await expect(loadAnalyticsDailyDelta({
    cacheScope: 'scope', dateFrom: '2026-08-25', dateTo: '2026-08-25',
    request: async () => ({ changed_days: [{ date: '2026-08-25', version: 'v1' }] } as never),
  })).rejects.toThrow('经营分析增量协议无效');
  expect(mergeCachedAnalyticsDelta).not.toHaveBeenCalled();
});
