import {
  ANALYTICS_CACHE_MAX_ENTRIES,
  ANALYTICS_CACHE_MAX_ENTRY_CHARS,
  ANALYTICS_DAILY_BUCKET_MAX_DAYS,
  ANALYTICS_DAILY_BUCKET_TTL_MS,
  ANALYTICS_SNAPSHOT_TTL_MS,
  type CacheIdentity,
} from './cachePolicy';
import {
  ANALYTICS_DAILY_KEY_VERSION,
  ANALYTICS_SNAPSHOT_KEY_VERSION,
  analyticsDailyItemKey,
  analyticsDailyOrdersItemKey,
  analyticsSnapshotItemKey,
  createAnalyticsCache,
} from './analyticsCache';
import type { CacheEntry, CacheStorage } from './cacheRepositories';

const user: CacheIdentity = { tenantId: 'tenant-a', userId: 'user-a' };
const now = Date.parse('2026-08-14T00:00:00.000Z');

function createMemoryStorage(): CacheStorage {
  let entries: CacheEntry[] = [];
  return {
    clear: async () => { entries = []; },
    purgeExpired: async (timestamp) => {
      entries = entries.filter((entry) => entry.expiresAt > timestamp);
    },
    readCategory: async () => entries,
    replaceCategory: async (_identity, _category, nextEntries) => { entries = nextEntries; },
    upsert: async (entry) => {
      entries = [...entries.filter((candidate) => candidate.key !== entry.key), entry];
    },
  };
}

function createDelayedAnalyticsStorage(): CacheStorage & { readStarted: Promise<void>; releaseRead(): void } {
  let entries: CacheEntry[] = [];
  let release: (() => void) | null = null;
  let startRead: (() => void) | null = null;
  let shouldDelay = true;

  return {
    clear: async () => { entries = []; },
    purgeExpired: async (timestamp) => {
      entries = entries.filter((entry) => entry.expiresAt > timestamp);
    },
    readCategory: async () => {
      const snapshot = entries;
      if (shouldDelay) {
        shouldDelay = false;
        startRead?.();
        await new Promise<void>((resolve) => { release = resolve; });
      }
      return snapshot;
    },
    replaceCategory: async (_identity, _category, nextEntries) => { entries = nextEntries; },
    upsert: async (entry) => {
      entries = [...entries.filter((candidate) => candidate.key !== entry.key), entry];
    },
    readStarted: new Promise<void>((resolve) => { startRead = resolve; }),
    releaseRead: () => { release?.(); },
  };
}

describe('analytics cache policy', () => {
  it('keeps two order filter scopes as different encrypted analytics entries', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());

    await cache.saveSuccess(user, 'orders', 'date=2026-08-01&stores=A', { rows: [{ dim_key: 'A' }] }, now);
    await cache.saveSuccess(user, 'orders', 'date=2026-08-01&stores=B', { rows: [{ dim_key: 'B' }] }, now);

    await expect(cache.read(user, 'orders', 'date=2026-08-01&stores=A', now))
      .resolves.toEqual({ rows: [{ dim_key: 'A' }] });
  });

  it('returns the cachedAt for the exact scoped snapshot', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());
    const scopeA = 'date=2026-08-01&stores=A';
    const scopeB = 'date=2026-08-01&stores=B';

    await cache.saveSuccess(user, 'orders', scopeB, { rows: [] }, now - 200);
    await expect(cache.lastSyncedAt(user, 'orders', scopeA, now)).resolves.toBeNull();

    await cache.saveSuccess(user, 'orders', scopeA, { rows: [] }, now - 100);
    await expect(cache.lastSyncedAt(user, 'orders', scopeA, now)).resolves.toBe(now - 100);
  });

  it('evicts the oldest snapshot when saving more than the maximum entries', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());

    for (let index = 0; index <= ANALYTICS_CACHE_MAX_ENTRIES; index += 1) {
      await cache.saveSuccess(user, 'orders', `scope=${index}`, { index }, now + index);
    }

    await expect(cache.read(user, 'orders', 'scope=0', now + ANALYTICS_CACHE_MAX_ENTRIES)).resolves.toBeNull();
    await expect(cache.read(user, 'orders', `scope=${ANALYTICS_CACHE_MAX_ENTRIES}`, now + ANALYTICS_CACHE_MAX_ENTRIES))
      .resolves.toEqual({ index: ANALYTICS_CACHE_MAX_ENTRIES });
  });

  it('does not write a snapshot whose serialized payload exceeds the entry limit', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());

    await cache.saveSuccess(user, 'orders', 'scope=large', { body: 'x'.repeat(ANALYTICS_CACHE_MAX_ENTRY_CHARS) }, now);

    await expect(cache.read(user, 'orders', 'scope=large', now)).resolves.toBeNull();
  });

  it('preserves existing analytics snapshots when an oversized replacement is rejected', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());

    await cache.saveSuccess(user, 'orders', 'scope=A', { rows: [1] }, now);
    await cache.saveSuccess(user, 'orders', 'scope=B', { rows: [2] }, now);
    await cache.saveSuccess(user, 'orders', 'scope=A', { body: 'x'.repeat(ANALYTICS_CACHE_MAX_ENTRY_CHARS) }, now + 1);

    await expect(cache.read(user, 'orders', 'scope=A', now + 1)).resolves.toEqual({ rows: [1] });
    await expect(cache.read(user, 'orders', 'scope=B', now + 1)).resolves.toEqual({ rows: [2] });
  });

  it('preserves both scopes when saves overlap', async () => {
    const storage = createDelayedAnalyticsStorage();
    const cache = createAnalyticsCache(storage);
    const firstSave = cache.saveSuccess(user, 'orders', 'scope=A', { rows: [1] }, now);

    await storage.readStarted;
    const secondSave = cache.saveSuccess(user, 'orders', 'scope=B', { rows: [2] }, now);
    storage.releaseRead();
    await Promise.all([firstSave, secondSave]);

    await expect(cache.read(user, 'orders', 'scope=A', now)).resolves.toEqual({ rows: [1] });
    await expect(cache.read(user, 'orders', 'scope=B', now)).resolves.toEqual({ rows: [2] });
  });

  it('replaces a same-scope snapshot with the newest payload at the same millisecond', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());

    await cache.saveSuccess(user, 'orders', 'scope=A', { rows: [1] }, now);
    await cache.saveSuccess(user, 'orders', 'scope=A', { rows: [2] }, now);

    await expect(cache.read(user, 'orders', 'scope=A', now)).resolves.toEqual({ rows: [2] });
  });

  it('uses one daily bucket for equivalent sorted store selections', () => {
    expect(analyticsDailyOrdersItemKey('shop', 'platform', ['B', 'A', 'A']))
      .toBe(analyticsDailyOrdersItemKey('shop', 'platform', ['A', 'B']));
  });

  it('versions scoped snapshots without changing immutable daily bucket keys', () => {
    expect(ANALYTICS_SNAPSHOT_KEY_VERSION).toBe('analytics-v3');
    expect(ANALYTICS_DAILY_KEY_VERSION).toBe('analytics-v2');
    expect(analyticsSnapshotItemKey('orders', 'scope=A')).toBe('analytics-v3:snapshot:orders:scope=A');
    expect(analyticsDailyItemKey('revenueTrend', '53961:shop')).toBe('analytics-v2:daily:revenueTrend:53961:shop');
  });

  it('keeps the existing order daily key while separating other modules', () => {
    expect(analyticsDailyItemKey('orders', 'shop:all:53961'))
      .toBe(analyticsDailyOrdersItemKey('shop', 'all', ['53961']));
    expect(analyticsDailyItemKey('revenueTrend', '53961:shop'))
      .toBe('analytics-v2:daily:revenueTrend:53961:shop');
  });

  it('stores and reads order daily buckets by their exact scope', async () => {
    const cache = createAnalyticsCache(createMemoryStorage());
    const scope = analyticsDailyOrdersItemKey('shop', 'all', ['53961']);

    await cache.saveDailyBucket(user, scope, {
      days: { '2026-08-10': { payload: { rows: [] }, version: 'v10' } },
    }, now);

    await expect(cache.readDailyBucket<{ rows: unknown[] }>(user, scope, now)).resolves.toEqual({
      days: { '2026-08-10': { payload: { rows: [] }, version: 'v10' } },
    });
  });

  it('freezes analytics cache resource limits', () => {
    expect(ANALYTICS_SNAPSHOT_TTL_MS).toBe(30 * 86_400_000);
    expect(ANALYTICS_DAILY_BUCKET_TTL_MS).toBe(365 * 86_400_000);
    expect(ANALYTICS_DAILY_BUCKET_MAX_DAYS).toBe(365);
    expect(ANALYTICS_CACHE_MAX_ENTRIES).toBe(300);
    expect(ANALYTICS_CACHE_MAX_ENTRY_CHARS).toBe(1_000_000);
  });
});
