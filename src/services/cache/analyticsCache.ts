import {
  ANALYTICS_CACHE_MAX_ENTRIES,
  ANALYTICS_CACHE_MAX_ENTRY_CHARS,
  ANALYTICS_DAILY_BUCKET_TTL_MS,
  ANALYTICS_CACHE_TTL_MS,
  ANALYTICS_SNAPSHOT_TTL_MS,
  assertCacheIdentity,
  createScopedCacheKey,
  sanitizeCachePayload,
  type CacheIdentity,
  type CacheJson,
} from './cachePolicy';
import type { CacheEntry, CacheStorage } from './cacheRepositories';

export type AnalyticsModule = 'revenue' | 'revenueSources' | 'mealPeriods' | 'mealPeriodTrend' | 'mealPeriodTurnover' | 'orders' | 'orderDaily' | 'labor' | 'laborTrend' | 'products' | 'revenueAlerts' | 'shopMappings' | 'storeScopeTree';
export type AnalyticsDailyModule = 'orders' | 'revenueTrend' | 'laborTrend' | 'mealPeriodTrend' | 'productTrend';

export const ANALYTICS_SNAPSHOT_KEY_VERSION = 'analytics-v3';
export const ANALYTICS_DAILY_KEY_VERSION = 'analytics-v2';

export function analyticsSnapshotItemKey(module: AnalyticsModule, cacheScope: string): string {
  return `${ANALYTICS_SNAPSHOT_KEY_VERSION}:snapshot:${module}:${cacheScope}`;
}

export function analyticsDailyItemKey(module: AnalyticsDailyModule, stableScope: string): string {
  return `${ANALYTICS_DAILY_KEY_VERSION}:daily:${module}:${stableScope}`;
}

export function analyticsDailyOrdersItemKey(sourceType: string, dimension: string, storeKeys: string[]): string {
  const stores = [...new Set(storeKeys.filter(Boolean))].sort().join(',');
  return analyticsDailyItemKey('orders', `${sourceType}:${dimension}:${stores}`);
}

export type AnalyticsCache = {
  clearSnapshot(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, now: number): Promise<void>;
  clearDailyBucket(identity: CacheIdentity, cacheScope: string, now: number): Promise<void>;
  lastSyncedAt(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, now: number): Promise<number | null>;
  lastSyncedAt(identity: CacheIdentity, module: AnalyticsModule, now: number): Promise<number | null>;
  read(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, now: number): Promise<CacheJson | null>;
  read(identity: CacheIdentity, module: AnalyticsModule, now: number): Promise<CacheJson | null>;
  saveSuccess(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, payload: unknown, now: number): Promise<void>;
  saveSuccess(identity: CacheIdentity, module: AnalyticsModule, payload: unknown, now: number): Promise<void>;
  readDailyBucket<T>(identity: CacheIdentity, cacheScope: string, now: number): Promise<DailyBucket<T>>;
  saveDailyBucket<T>(identity: CacheIdentity, cacheScope: string, bucket: DailyBucket<T>, now: number): Promise<void>;
};

export type DailyBucket<T> = {
  days: Record<string, { payload: T; version: string }>;
  meta?: Record<string, CacheJson>;
};

export function createAnalyticsCache(storage: CacheStorage): AnalyticsCache {
  let pendingSave = Promise.resolve();

  function serializeSave(operation: () => Promise<void>): Promise<void> {
    const save = pendingSave.then(operation, operation);
    pendingSave = save.catch(() => undefined);
    return save;
  }

  async function lastSyncedAt(
    identity: CacheIdentity,
    module: AnalyticsModule,
    cacheScopeOrNow: string | number,
    maybeNow?: number,
  ): Promise<number | null> {
    assertCacheIdentity(identity);
    const legacy = maybeNow === undefined;
    const now = legacy ? cacheScopeOrNow as number : maybeNow;
    const itemKey = legacy ? module : analyticsSnapshotItemKey(module, cacheScopeOrNow as string);
    await storage.purgeExpired(now);
    return findEntry(await storage.readCategory(identity, 'analytics'), identity, itemKey)?.cachedAt ?? null;
  }

  async function read(
    identity: CacheIdentity,
    module: AnalyticsModule,
    cacheScopeOrNow: string | number,
    maybeNow?: number,
  ): Promise<CacheJson | null> {
    assertCacheIdentity(identity);
    const legacy = maybeNow === undefined;
    const now = legacy ? cacheScopeOrNow as number : maybeNow;
    const itemKey = legacy ? module : analyticsSnapshotItemKey(module, cacheScopeOrNow as string);
    await storage.purgeExpired(now);
    const entry = findEntry(await storage.readCategory(identity, 'analytics'), identity, itemKey);
    if (!entry) return null;
    try {
      return sanitizeCachePayload(JSON.parse(entry.payload));
    } catch {
      return null;
    }
  }

  async function saveSuccess(
    identity: CacheIdentity,
    module: AnalyticsModule,
    cacheScopeOrPayload: string | unknown,
    payloadOrNow: unknown,
    maybeNow?: number,
  ): Promise<void> {
    const legacy = maybeNow === undefined;
    if (legacy) {
      await serializeSave(() => saveLegacySnapshot(storage, identity, module, cacheScopeOrPayload, payloadOrNow as number));
      return;
    }
    await serializeSave(() => saveSnapshot(storage, identity, module, cacheScopeOrPayload as string, payloadOrNow, maybeNow));
  }

  async function readDailyBucket<T>(identity: CacheIdentity, cacheScope: string, now: number): Promise<DailyBucket<T>> {
    assertCacheIdentity(identity);
    await storage.purgeExpired(now);
    const entry = findEntry(await storage.readCategory(identity, 'analytics'), identity, cacheScope);
    if (!entry) return { days: {} };
    try {
      const parsed = JSON.parse(entry.payload) as DailyBucket<T>;
      return parsed && typeof parsed === 'object' && parsed.days && typeof parsed.days === 'object' ? parsed : { days: {} };
    } catch {
      return { days: {} };
    }
  }

  async function saveDailyBucket<T>(identity: CacheIdentity, cacheScope: string, bucket: DailyBucket<T>, now: number): Promise<void> {
    await serializeSave(() => persistDailyBucket(storage, identity, cacheScope, bucket, now));
  }

  async function clearSnapshot(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, now: number): Promise<void> {
    assertCacheIdentity(identity);
    await serializeSave(async () => {
      await storage.purgeExpired(now);
      const key = createScopedCacheKey(identity, 'analytics', analyticsSnapshotItemKey(module, cacheScope));
      const entries = await storage.readCategory(identity, 'analytics');
      await storage.replaceCategory(identity, 'analytics', entries.filter((entry) => entry.key !== key));
    });
  }

  async function clearDailyBucket(identity: CacheIdentity, cacheScope: string, now: number): Promise<void> {
    assertCacheIdentity(identity);
    await serializeSave(async () => {
      await storage.purgeExpired(now);
      const key = createScopedCacheKey(identity, 'analytics', cacheScope);
      const entries = await storage.readCategory(identity, 'analytics');
      await storage.replaceCategory(identity, 'analytics', entries.filter((entry) => entry.key !== key));
    });
  }

  return { clearDailyBucket, clearSnapshot, lastSyncedAt, read, readDailyBucket, saveDailyBucket, saveSuccess };
}

async function persistDailyBucket<T>(
  storage: CacheStorage,
  identity: CacheIdentity,
  cacheScope: string,
  bucket: DailyBucket<T>,
  now: number,
): Promise<void> {
  assertCacheIdentity(identity);
  const serialized = JSON.stringify(sanitizeCachePayload(bucket));
  if (serialized.length > ANALYTICS_CACHE_MAX_ENTRY_CHARS) return;
  const next: CacheEntry = {
    cachedAt: now,
    category: 'analytics',
    expiresAt: now + ANALYTICS_DAILY_BUCKET_TTL_MS,
    identity,
    key: createScopedCacheKey(identity, 'analytics', cacheScope),
    payload: serialized,
  };
  const entries = await storage.readCategory(identity, 'analytics');
  await storage.replaceCategory(identity, 'analytics', retainAnalyticsEntries([...entries, next], now));
}

async function saveSnapshot(
  storage: CacheStorage,
  identity: CacheIdentity,
  module: AnalyticsModule,
  cacheScope: string,
  payload: unknown,
  now: number,
): Promise<void> {
  assertCacheIdentity(identity);
  const serialized = JSON.stringify(sanitizeCachePayload(payload));
  if (serialized.length > ANALYTICS_CACHE_MAX_ENTRY_CHARS) return;

  const next: CacheEntry = {
    cachedAt: now,
    category: 'analytics',
    expiresAt: now + ANALYTICS_SNAPSHOT_TTL_MS,
    identity,
    key: createScopedCacheKey(identity, 'analytics', analyticsSnapshotItemKey(module, cacheScope)),
    payload: serialized,
  };
  const entries = await storage.readCategory(identity, 'analytics');
  await storage.replaceCategory(identity, 'analytics', retainAnalyticsEntries([...entries, next], now));
}

async function saveLegacySnapshot(
  storage: CacheStorage,
  identity: CacheIdentity,
  module: AnalyticsModule,
  payload: unknown,
  now: number,
): Promise<void> {
  assertCacheIdentity(identity);
  const serialized = JSON.stringify(sanitizeCachePayload(payload));
  if (serialized.length > ANALYTICS_CACHE_MAX_ENTRY_CHARS) return;

  const next: CacheEntry = {
    cachedAt: now,
    category: 'analytics',
    expiresAt: now + ANALYTICS_CACHE_TTL_MS,
    identity,
    key: createScopedCacheKey(identity, 'analytics', module),
    payload: serialized,
  };
  const entries = await storage.readCategory(identity, 'analytics');
  await storage.replaceCategory(identity, 'analytics', retainAnalyticsEntries([...entries, next], now));
}

function retainAnalyticsEntries(entries: CacheEntry[], now: number): CacheEntry[] {
  const latestEntries = new Map<string, CacheEntry>();
  for (const entry of entries) {
    if (entry.expiresAt <= now) continue;
    const current = latestEntries.get(entry.key);
    if (!current || entry.cachedAt >= current.cachedAt) latestEntries.set(entry.key, entry);
  }

  return [...latestEntries.values()]
    .sort((left, right) => right.cachedAt - left.cachedAt)
    .slice(0, ANALYTICS_CACHE_MAX_ENTRIES);
}

function findEntry(entries: CacheEntry[], identity: CacheIdentity, itemKey: string): CacheEntry | undefined {
  return entries
    .filter((candidate) => candidate.key === createScopedCacheKey(identity, 'analytics', itemKey))
    .sort((left, right) => right.cachedAt - left.cachedAt)[0];
}
