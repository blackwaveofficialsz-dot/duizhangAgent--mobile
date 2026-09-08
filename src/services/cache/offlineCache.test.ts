import { createCacheRepositories } from './cacheRepositories';
import type { AnalyticsModule, CacheEntry, CacheIdentity, CacheStorage } from './cacheRepositories';
import { showToast } from '@/components/feedback/AppToast';
import { clearOfflineCacheForLogout, openOfflineCache } from './database';
import {
  clearOfflineCache,
  clearCachedAnalytics,
  clearCachedAnalyticsDailyBucket,
  captureOfflineCacheOperationToken,
  configureOfflineCacheIdentity,
  getOfflineCacheIdentity,
  getOfflineCacheDiagnostics,
  getOfflineCacheLastSyncedAt,
  getOfflineCacheRepositories,
  mergeCachedAnalyticsDelta,
  readCachedAnalytics,
  readCachedAnalyticsClientDays,
  saveCachedAnalytics,
} from './offlineCache';

jest.mock('./database', () => ({
  clearOfflineCacheForLogout: jest.fn(),
  openOfflineCache: jest.fn(),
}));
jest.mock('./cacheRepositories', () => ({ createCacheRepositories: jest.fn() }));
jest.mock('@/components/feedback/AppToast', () => ({ showToast: jest.fn() }));

function configureRealDailyCache(blockFirstDailyRead = false): { readStarted: Promise<void>; releaseRead(): void } {
  let entries: CacheEntry[] = [];
  const storage: CacheStorage = {
    clear: async () => { entries = []; },
    purgeExpired: async (now) => { entries = entries.filter((entry) => entry.expiresAt > now); },
    readCategory: async () => entries,
    replaceCategory: async (_identity, _category, nextEntries) => { entries = nextEntries; },
    upsert: async (entry) => { entries = [...entries.filter((candidate) => candidate.key !== entry.key), entry]; },
  };
  const { createCacheRepositories: createRealCacheRepositories } = jest.requireActual<typeof import('./cacheRepositories')>('./cacheRepositories');
  const repositories = createRealCacheRepositories(storage);
  let releaseRead: (() => void) | undefined;
  let signalReadStarted: (() => void) | undefined;
  let shouldBlock = blockFirstDailyRead;
  const readStarted = new Promise<void>((resolve) => { signalReadStarted = resolve; });
  const readDailyBucket = repositories.analytics.readDailyBucket.bind(repositories.analytics);
  (repositories.analytics as { readDailyBucket: (...args: unknown[]) => Promise<unknown> }).readDailyBucket = async (...args) => {
    const bucket = await readDailyBucket(...args as [never, string, number]);
    if (shouldBlock) {
      shouldBlock = false;
      signalReadStarted?.();
      await new Promise<void>((resolve) => { releaseRead = resolve; });
    }
    return bucket;
  };
  jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage });
  jest.mocked(createCacheRepositories).mockReturnValue(repositories);
  configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });
  return { readStarted, releaseRead: () => releaseRead?.() };
}

describe('offline cache facade', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearOfflineCache();
  });

  it('uses the current authenticated tenant and user as the only cache identity', () => {
    configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });

    expect(getOfflineCacheIdentity()).toEqual({ tenantId: 'tenant-1', userId: 'user-1' });
  });

  it('opens one repository set and discards it when local cache is cleared', async () => {
    const repositories = { analytics: {}, sessions: {}, tasks: {} };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);

    await expect(getOfflineCacheRepositories()).resolves.toBe(repositories);
    await expect(getOfflineCacheRepositories()).resolves.toBe(repositories);
    expect(openOfflineCache).toHaveBeenCalledTimes(1);

    await clearOfflineCache();
    expect(clearOfflineCacheForLogout).toHaveBeenCalled();
    expect(getOfflineCacheIdentity()).toBeNull();
  });

  it('reopens the cache within the same operation after a reset-required initialization failure', async () => {
    const repositories = { analytics: {}, sessions: {}, tasks: {} };
    jest.mocked(openOfflineCache)
      .mockRejectedValueOnce(new Error('cache reset required'))
      .mockResolvedValueOnce({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);

    await expect(getOfflineCacheRepositories()).resolves.toBe(repositories);
    expect(openOfflineCache).toHaveBeenCalledTimes(2);
  });

  it('shows one actionable error when cache initialization still fails after retry', async () => {
    jest.mocked(openOfflineCache).mockRejectedValue(new Error('离线缓存已重置，请从服务端重新同步'));

    await expect(getOfflineCacheRepositories()).rejects.toThrow('离线缓存已重置');

    expect(showToast).toHaveBeenCalledWith('离线缓存已重置，请从服务端重新同步', 'error');
  });

  it('does not write the previous identity after logout starts during cache initialization', async () => {
    let resolveOpen: ((value: { securityMode: 'sqlcipher'; storage: never }) => void) | undefined;
    const open = new Promise<{ securityMode: 'sqlcipher'; storage: never }>((resolve) => { resolveOpen = resolve; });
    const saveSuccess = jest.fn().mockResolvedValue(undefined);
    jest.mocked(openOfflineCache).mockReturnValue(open);
    jest.mocked(createCacheRepositories).mockReturnValue({ analytics: { saveSuccess }, sessions: {}, tasks: {} } as never);
    configureOfflineCacheIdentity({ tenantId: 'tenant-old', userId: 'user-old' });

    const save = saveCachedAnalytics('orders', 'date_from=2026-07-01', { rows: [] }, 100);
    const clear = clearOfflineCache();
    resolveOpen?.({ securityMode: 'sqlcipher', storage: {} as never });
    await Promise.all([save, clear]);

    expect(saveSuccess).not.toHaveBeenCalled();
    expect(clearOfflineCacheForLogout).toHaveBeenCalled();
  });

  it('returns the newest sync time across the current identity cache', async () => {
    const now = Date.parse('2026-07-16T15:10:00+08:00');
    const analyticsLastSyncedAt = jest.fn().mockResolvedValue(now - 60_000);
    const repositories = {
      analytics: { latestSyncedAt: analyticsLastSyncedAt },
      sessions: { lastSyncedAt: jest.fn().mockResolvedValue(now - 180_000) },
      tasks: { lastSyncedAt: jest.fn().mockResolvedValue(now - 120_000) },
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });

    await expect(getOfflineCacheLastSyncedAt(now)).resolves.toBe(now - 60_000);
    expect(repositories.sessions.lastSyncedAt).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, now);
    expect(repositories.tasks.lastSyncedAt).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, now);
    expect(analyticsLastSyncedAt).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, now);
  });

  it('returns diagnostics for the current cache identity', async () => {
    const now = Date.parse('2026-07-16T15:10:00+08:00');
    const summary = {
      analytics: { dailyBuckets: 1, entries: 2, snapshots: 1 },
      categories: { analytics: 2, sessions: 1, tasks: 1 },
      latestSyncedAt: now - 60_000,
      totalEntries: 4,
    };
    const repositories = {
      analytics: {},
      diagnostics: { summarize: jest.fn().mockResolvedValue(summary) },
      sessions: {},
      tasks: {},
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });

    await expect(getOfflineCacheDiagnostics(now)).resolves.toEqual({
      ...summary,
      available: true,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
    });
    expect(repositories.diagnostics.summarize).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' }, now);
  });

  it('reads only the exact scope supplied by the caller', async () => {
    const now = Date.parse('2026-07-16T15:10:00+08:00');
    const identity = { tenantId: 'tenant-1', userId: 'user-1' };
    const snapshots = new Map<string, { data: unknown; lastSyncedAt: number }>();
    const repositories = {
      analytics: {
        lastSyncedAt: jest.fn(async (_identity: CacheIdentity, _module: AnalyticsModule, cacheScope: string) => snapshots.get(cacheScope)?.lastSyncedAt ?? null),
        read: jest.fn(async (_identity: CacheIdentity, _module: AnalyticsModule, cacheScope: string) => snapshots.get(cacheScope)?.data ?? null),
        saveSuccess: jest.fn(async (_identity: CacheIdentity, _module: AnalyticsModule, cacheScope: string, payload: unknown, savedAt: number) => {
          snapshots.set(cacheScope, { data: payload, lastSyncedAt: savedAt });
        }),
      },
      sessions: {},
      tasks: {},
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity(identity);

    await saveCachedAnalytics('orders', 'scope=A', { rows: ['A'] }, now);
    await saveCachedAnalytics('orders', 'scope=B', { rows: ['B'] }, now + 1);

    await expect(readCachedAnalytics('orders', 'scope=A', now + 1)).resolves.toEqual({
      data: { rows: ['A'] },
      lastSyncedAt: now,
    });

    expect(repositories.analytics.read).toHaveBeenCalledWith(identity, 'orders', 'scope=A', now + 1);
    expect(repositories.analytics.saveSuccess).toHaveBeenCalledWith(identity, 'orders', 'scope=A', { rows: ['A'] }, now);
  });

  it('clears only the requested scope on forced refresh preparation', async () => {
    const now = Date.parse('2026-07-16T15:10:00+08:00');
    const snapshots = new Map<string, unknown>([
      ['scope=A', { rows: ['A'] }],
      ['scope=B', { rows: ['B'] }],
    ]);
    const repositories = {
      analytics: {
        clear: jest.fn(async (_identity: CacheIdentity, _module: AnalyticsModule, cacheScope: string) => {
          snapshots.delete(cacheScope);
        }),
        lastSyncedAt: jest.fn(async (_identity: CacheIdentity, _module: AnalyticsModule, cacheScope: string) => snapshots.has(cacheScope) ? now : null),
        read: jest.fn(async (_identity: CacheIdentity, _module: AnalyticsModule, cacheScope: string) => snapshots.get(cacheScope) ?? null),
      },
      sessions: {},
      tasks: {},
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });

    await clearCachedAnalytics('orders', 'scope=A', now);
    await expect(readCachedAnalytics('orders', 'scope=A', now)).resolves.toBeNull();
    await expect(readCachedAnalytics('orders', 'scope=B', now)).resolves.not.toBeNull();
    expect(repositories.analytics.clear).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', userId: 'user-1' },
      'orders',
      'scope=A',
      now,
    );
  });

  it('removes a daily record when changed_days returns a null payload', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    const bucket = { days: {} as Record<string, { payload: unknown; version: string }> };
    const repositories = {
      analytics: {
        readDailyBucket: jest.fn(async () => bucket),
        saveDailyBucket: jest.fn(async (_identity, _scope, nextBucket) => { bucket.days = nextBucket.days; }),
      },
      sessions: {},
      tasks: {},
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });

    await mergeCachedAnalyticsDelta('orders:shop:all:53961', [{ date: '2026-08-10', payload: { rows: [] }, version: 'v1' }], undefined, now);
    await mergeCachedAnalyticsDelta('orders:shop:all:53961', [{ date: '2026-08-10', payload: null, version: 'deleted' }], undefined, now);

    await expect(readCachedAnalyticsClientDays('orders:shop:all:53961', '2026-08-10', '2026-08-10', now)).resolves.toEqual([]);
  });

  it('merges metadata and deletes null daily payloads through the generic facade', async () => {
    const now = Date.parse('2026-08-27T10:00:00+08:00');
    configureRealDailyCache();
    await mergeCachedAnalyticsDelta('analytics-v2:daily:productTrend:p1:ALL:all', [
      { date: '2026-08-26', payload: { period: '2026-08-26', quantity: 5 }, version: 'v1' },
    ], { product_name: '肉夹馍' }, now);
    const bucket = await mergeCachedAnalyticsDelta('analytics-v2:daily:productTrend:p1:ALL:all', [
      { date: '2026-08-26', payload: null, version: 'deleted' },
    ], undefined, now + 1);

    expect(bucket).toEqual({ days: {}, meta: { product_name: '肉夹馍' } });
  });

  it('filters and sorts cached order day versions from the real bucket state', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    configureRealDailyCache();

    await mergeCachedAnalyticsDelta('scope=A', [
      { date: '2026-08-12', payload: { rows: [] }, version: 'v12' },
      { date: '2026-08-10', payload: { rows: [] }, version: 'v10' },
      { date: '2026-08-11', payload: { rows: [] }, version: 'v11' },
    ], undefined, now);

    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-11', '2026-08-12', now)).resolves.toEqual([
      { date: '2026-08-11', version: 'v11' },
      { date: '2026-08-12', version: 'v12' },
    ]);
  });

  it('retains only the newest 365 cached order days', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    configureRealDailyCache();
    const changedDays = Array.from({ length: 366 }, (_, index) => {
      const date = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
      return { date, payload: { rows: [] }, version: `v${index}` };
    });

    await mergeCachedAnalyticsDelta('scope=A', changedDays, undefined, now);

    await expect(readCachedAnalyticsClientDays('scope=A', '2025-01-01', '2026-12-31', now)).resolves.toHaveLength(365);
    await expect(readCachedAnalyticsClientDays('scope=A', '2025-01-01', '2025-01-01', now)).resolves.toEqual([]);
  });

  it('clears only the matching order daily bucket', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    configureRealDailyCache();
    await mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-10', payload: { rows: [] }, version: 'vA' }], undefined, now);
    await mergeCachedAnalyticsDelta('scope=B', [{ date: '2026-08-10', payload: { rows: [] }, version: 'vB' }], undefined, now);

    await clearCachedAnalyticsDailyBucket('scope=A', now);

    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-10', '2026-08-10', now)).resolves.toEqual([]);
    await expect(readCachedAnalyticsClientDays('scope=B', '2026-08-10', '2026-08-10', now)).resolves.toEqual([{ date: '2026-08-10', version: 'vB' }]);
  });

  it('preserves changed days from concurrent merges for one bucket', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    configureRealDailyCache();

    await Promise.all([
      mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-10', payload: { rows: [] }, version: 'v10' }], undefined, now),
      mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-11', payload: { rows: [] }, version: 'v11' }], undefined, now),
    ]);

    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-10', '2026-08-11', now)).resolves.toEqual([
      { date: '2026-08-10', version: 'v10' },
      { date: '2026-08-11', version: 'v11' },
    ]);
  });

  it('does not run queued daily operations under a later cache identity', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    const gate = configureRealDailyCache(true);
    const firstOldMerge = mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-10', payload: { rows: [] }, version: 'old-1' }], undefined, now);
    await gate.readStarted;
    const queuedOldMerge = mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-11', payload: { rows: [] }, version: 'old-2' }], undefined, now);
    const queuedOldClear = clearCachedAnalyticsDailyBucket('scope=A', now);

    configureOfflineCacheIdentity({ tenantId: 'tenant-2', userId: 'user-2' });
    await mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-12', payload: { rows: [] }, version: 'new' }], undefined, now);
    gate.releaseRead();
    await Promise.all([firstOldMerge, queuedOldMerge, queuedOldClear]);

    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-10', '2026-08-11', now)).resolves.toEqual([]);
    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-12', '2026-08-12', now)).resolves.toEqual([
      { date: '2026-08-12', version: 'new' },
    ]);
  });

  it('does not merge a response captured for a previous cache identity', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    configureRealDailyCache();
    const token = captureOfflineCacheOperationToken();

    configureOfflineCacheIdentity({ tenantId: 'tenant-2', userId: 'user-2' });
    await expect(mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-10', payload: { rows: ['old'] }, version: 'old' }], undefined, now, { token })).resolves.toBeNull();

    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-10', '2026-08-10', now)).resolves.toEqual([]);
  });

  it('does not save a daily bucket when its merge is aborted while waiting for the bucket', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    const gate = configureRealDailyCache(true);
    const controller = new AbortController();
    const merge = mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-10', payload: { rows: [] }, version: 'v1' }], undefined, now, { signal: controller.signal });
    await gate.readStarted;
    controller.abort();
    gate.releaseRead();

    await expect(merge).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-10', '2026-08-10', now)).resolves.toEqual([]);
  });

  it('restores the prior bucket when an abort arrives during a pending daily save', async () => {
    const now = Date.parse('2026-08-14T00:00:00+08:00');
    let bucket = { days: { '2026-08-09': { payload: { rows: ['old'] }, version: 'old' } } };
    let releaseSave: (() => void) | undefined;
    let signalSaveStarted: (() => void) | undefined;
    const saveStarted = new Promise<void>((resolve) => { signalSaveStarted = resolve; });
    let shouldBlock = true;
    const repositories = {
      analytics: {
        readDailyBucket: jest.fn(async () => bucket),
        saveDailyBucket: jest.fn(async (_identity, _scope, nextBucket) => {
          bucket = structuredClone(nextBucket);
          if (!shouldBlock) return;
          shouldBlock = false;
          signalSaveStarted?.();
          await new Promise<void>((resolve) => { releaseSave = resolve; });
        }),
      },
      sessions: {},
      tasks: {},
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity({ tenantId: 'tenant-1', userId: 'user-1' });
    const controller = new AbortController();

    const merge = mergeCachedAnalyticsDelta('scope=A', [{ date: '2026-08-10', payload: { rows: ['new'] }, version: 'new' }], undefined, now, { signal: controller.signal });
    await saveStarted;
    controller.abort();
    releaseSave?.();

    await expect(merge).rejects.toMatchObject({ name: 'AbortError' });
    await expect(readCachedAnalyticsClientDays('scope=A', '2026-08-09', '2026-08-10', now)).resolves.toEqual([
      { date: '2026-08-09', version: 'old' },
    ]);
  });

  it('reads and writes revenue alerts with the current tenant and user identity', async () => {
    const now = Date.parse('2026-07-16T15:10:00+08:00');
    const identity = { tenantId: 'tenant-1', userId: 'user-1' };
    const alerts = [{ business_date: '2026-07-16', shop_key: 'store-1' }];
    const repositories = {
      analytics: {
        lastSyncedAt: jest.fn().mockResolvedValue(now),
        read: jest.fn().mockResolvedValue(alerts),
        saveSuccess: jest.fn().mockResolvedValue(undefined),
      },
      sessions: {},
      tasks: {},
    };
    jest.mocked(openOfflineCache).mockResolvedValue({ securityMode: 'sqlcipher', storage: {} as never });
    jest.mocked(createCacheRepositories).mockReturnValue(repositories as never);
    configureOfflineCacheIdentity(identity);

    await expect(readCachedAnalytics('revenueAlerts', '2026-07-16', now)).resolves.toEqual({
      data: alerts,
      lastSyncedAt: now,
    });
    await saveCachedAnalytics('revenueAlerts', '2026-07-16', alerts, now);

    expect(repositories.analytics.read).toHaveBeenCalledWith(identity, 'revenueAlerts', '2026-07-16', now);
    expect(repositories.analytics.saveSuccess).toHaveBeenCalledWith(
      identity,
      'revenueAlerts',
      '2026-07-16',
      alerts,
      now,
    );
  });
});
