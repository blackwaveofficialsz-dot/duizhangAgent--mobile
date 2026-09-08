import type { AnalyticsModule, DailyBucket } from './analyticsCache';
import { ANALYTICS_DAILY_BUCKET_MAX_DAYS, type CacheJson } from './cachePolicy';
import { createCacheRepositories, type CacheDiagnosticsSummary, type CacheIdentity } from './cacheRepositories';
import { clearOfflineCacheForLogout, openOfflineCache } from './database';
import { showToast } from '@/components/feedback/AppToast';

type CacheRepositories = ReturnType<typeof createCacheRepositories>;
export type CacheOperationToken = Readonly<{ generation: number; identity: CacheIdentity }>;
export type CacheOperationOptions = { signal?: AbortSignal; token?: CacheOperationToken | null };
export type OfflineCacheDiagnostics = CacheDiagnosticsSummary & {
  available: boolean;
  identity: CacheIdentity | null;
};

let identity: CacheIdentity | null = null;
let generation = 0;
let repositoriesPromise: Promise<CacheRepositories> | null = null;
let clearBarrier: Promise<void> = Promise.resolve();
const activeOperations = new Set<Promise<unknown>>();
const pendingAnalyticsDailyBucketOperations = new Map<string, Promise<void>>();
let lastReportedError: { message: string; timestamp: number } | null = null;

export function configureOfflineCacheIdentity(nextIdentity: CacheIdentity): void {
  generation += 1;
  identity = nextIdentity;
}

export function getOfflineCacheIdentity(): CacheIdentity | null {
  return identity;
}

export function captureOfflineCacheOperationToken(): CacheOperationToken | null {
  return identity ? { generation, identity } : null;
}

export function getOfflineCacheRepositories(): Promise<CacheRepositories> {
  repositoriesPromise ??= openRepositoriesAfter(clearBarrier);
  const current = repositoriesPromise;
  return current.catch((error) => {
    if (repositoriesPromise === current) repositoriesPromise = null;
    reportCacheError(error);
    throw error;
  });
}

export async function readCachedAnalytics<T>(module: AnalyticsModule, cacheScope: string, now = Date.now()): Promise<{ data: T; lastSyncedAt: number | null } | null> {
  return runCurrentCacheOperation(async (repositories, currentIdentity) => {
    const data = await repositories.analytics.read(currentIdentity, module, cacheScope, now);
    if (data === null) return null;
    return {
      data: data as T,
      lastSyncedAt: await repositories.analytics.lastSyncedAt(currentIdentity, module, cacheScope, now),
    };
  });
}

export async function saveCachedAnalytics(module: AnalyticsModule, cacheScope: string, payload: unknown, now = Date.now()): Promise<void> {
  await runCurrentCacheOperation(async (repositories, currentIdentity) => {
    await repositories.analytics.saveSuccess(currentIdentity, module, cacheScope, payload, now);
  });
}

export async function clearCachedAnalytics(module: AnalyticsModule, cacheScope: string, now = Date.now()): Promise<void> {
  await runCurrentCacheOperation(async (repositories, currentIdentity) => {
    await repositories.analytics.clear(currentIdentity, module, cacheScope, now);
  });
}

export type AnalyticsChangedDay<T> = { date: string; payload: T | null; version: string };

export async function readCachedAnalyticsDailyBucket<T>(scope: string, now = Date.now(), options?: CacheOperationOptions): Promise<DailyBucket<T> | null> {
  throwIfAborted(options?.signal);
  const token = options?.token === undefined ? captureOfflineCacheOperationToken() : options.token;
  const bucket = await runCacheOperation(token, (repositories, currentIdentity) => (
    repositories.analytics.readDailyBucket<T>(currentIdentity, scope, now)
  ));
  throwIfAborted(options?.signal);
  return bucket ? cloneDailyBucket(bucket) : null;
}

export async function readCachedAnalyticsClientDays(scope: string, dateFrom: string, dateTo: string, now = Date.now(), options?: CacheOperationOptions): Promise<Array<{ date: string; version: string }>> {
  throwIfAborted(options?.signal);
  const token = options?.token === undefined ? captureOfflineCacheOperationToken() : options.token;
  const bucket = await runCacheOperation(token, (repositories, currentIdentity) => (
    repositories.analytics.readDailyBucket<unknown>(currentIdentity, scope, now)
  ));
  throwIfAborted(options?.signal);
  return Object.entries(bucket?.days ?? {})
    .filter(([date]) => date >= dateFrom && date <= dateTo)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => ({ date, version: day.version }));
}

export async function mergeCachedAnalyticsDelta<T>(
  scope: string,
  changedDays: AnalyticsChangedDay<T>[],
  meta?: Record<string, CacheJson>,
  now = Date.now(),
  options?: CacheOperationOptions,
): Promise<DailyBucket<T> | null> {
  const token = options?.token === undefined ? captureOfflineCacheOperationToken() : options.token;
  let result: DailyBucket<T> | null = null;
  await serializeAnalyticsDailyBucket(scope, async () => {
    result = await runCacheOperation(token, async (repositories, currentIdentity) => {
      throwIfAborted(options?.signal);
      const previousBucket = cloneDailyBucket(await repositories.analytics.readDailyBucket<T>(currentIdentity, scope, now));
      throwIfAborted(options?.signal);
      const bucket = cloneDailyBucket(previousBucket);
      for (const day of changedDays) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date)) continue;
        if (day.payload === null) delete bucket.days[day.date];
        else bucket.days[day.date] = { payload: day.payload, version: day.version };
      }
      bucket.days = Object.fromEntries(Object.entries(bucket.days).sort(([left], [right]) => right.localeCompare(left)).slice(0, ANALYTICS_DAILY_BUCKET_MAX_DAYS));
      if (meta) bucket.meta = { ...(bucket.meta ?? {}), ...meta };
      throwIfAborted(options?.signal);
      await repositories.analytics.saveDailyBucket(currentIdentity, scope, bucket, now);
      if (options?.signal?.aborted) {
        await repositories.analytics.saveDailyBucket(currentIdentity, scope, previousBucket, now);
        throwIfAborted(options.signal);
      }
      return bucket;
    });
  }, token);
  return result;
}

export async function clearCachedAnalyticsDailyBucket(scope: string, now = Date.now(), options?: CacheOperationOptions): Promise<void> {
  throwIfAborted(options?.signal);
  const token = options?.token === undefined ? captureOfflineCacheOperationToken() : options.token;
  await serializeAnalyticsDailyBucket(scope, async () => {
    await runCacheOperation(token, async (repositories, currentIdentity) => {
      throwIfAborted(options?.signal);
      await repositories.analytics.clearDailyBucket(currentIdentity, scope, now);
    });
  }, token);
}

function serializeAnalyticsDailyBucket(scope: string, operation: () => Promise<void>, token: CacheOperationToken | null): Promise<void> {
  const scheduledGeneration = token?.generation;
  const scheduledIdentity = token?.identity;
  if (!scheduledIdentity) return Promise.resolve();
  const cacheKey = `${scheduledGeneration}:${scheduledIdentity.tenantId}:${scheduledIdentity.userId}:${scope}`;
  const previous = pendingAnalyticsDailyBucketOperations.get(cacheKey) ?? Promise.resolve();
  const guardedOperation = async (): Promise<void> => {
    if (generation !== scheduledGeneration || identity !== scheduledIdentity) return;
    await operation();
  };
  const pending = previous.then(guardedOperation, guardedOperation);
  const tracked = pending.finally(() => {
    if (pendingAnalyticsDailyBucketOperations.get(cacheKey) === tracked) pendingAnalyticsDailyBucketOperations.delete(cacheKey);
  });
  pendingAnalyticsDailyBucketOperations.set(cacheKey, tracked);
  return tracked;
}

function runCacheOperation<T>(token: CacheOperationToken | null, operation: (repositories: CacheRepositories, identity: CacheIdentity) => Promise<T>): Promise<T | null> {
  if (!token) return Promise.resolve(null);
  const pending = (async () => {
    const repositories = await getOfflineCacheRepositories();
    if (!isCurrentCacheOperationToken(token)) return null;
    const result = await operation(repositories, token.identity);
    return isCurrentCacheOperationToken(token) ? result : null;
  })().catch((error) => {
    if (!isAbortError(error)) reportCacheError(error);
    throw error;
  });
  activeOperations.add(pending);
  void pending.then(
    () => activeOperations.delete(pending),
    () => activeOperations.delete(pending),
  );
  return pending;
}

function isCurrentCacheOperationToken(token: CacheOperationToken): boolean {
  return generation === token.generation && identity === token.identity;
}

function cloneDailyBucket<T>(bucket: DailyBucket<T>): DailyBucket<T> {
  return {
    days: Object.fromEntries(Object.entries(bucket.days).map(([date, day]) => [date, { payload: day.payload, version: day.version }])),
    ...(bucket.meta ? { meta: { ...bucket.meta } } : {}),
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { name: 'AbortError' });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function getOfflineCacheLastSyncedAt(now = Date.now()): Promise<number | null> {
  return runCurrentCacheOperation(async (repositories, currentIdentity) => {
    const timestamps = await Promise.all([
      repositories.sessions.lastSyncedAt(currentIdentity, now),
      repositories.tasks.lastSyncedAt(currentIdentity, now),
      repositories.analytics.latestSyncedAt(currentIdentity, now),
    ]);
    return timestamps.reduce<number | null>(
      (latest, timestamp) => timestamp !== null && (latest === null || timestamp > latest) ? timestamp : latest,
      null,
    );
  });
}

export async function getOfflineCacheDiagnostics(now = Date.now()): Promise<OfflineCacheDiagnostics> {
  const currentIdentity = identity;
  if (!currentIdentity) return emptyDiagnostics(null);
  const summary = await runCurrentCacheOperation(
    (repositories, cacheIdentity) => repositories.diagnostics.summarize(cacheIdentity, now),
  );
  return summary
    ? { ...summary, available: true, identity: currentIdentity }
    : emptyDiagnostics(currentIdentity);
}

export async function clearOfflineCache(): Promise<void> {
  identity = null;
  generation += 1;
  const previousBarrier = clearBarrier;
  const previousRepositories = repositoriesPromise;
  const previousOperations = [...activeOperations];
  repositoriesPromise = null;
  const clear = (async () => {
    await previousBarrier;
    await Promise.allSettled([
      ...previousOperations,
      ...(previousRepositories ? [previousRepositories] : []),
    ]);
    await clearOfflineCacheForLogout();
  })();
  clearBarrier = clear.then(() => undefined, () => undefined);
  await clear;
}

export function runCurrentCacheOperation<T>(
  operation: (repositories: CacheRepositories, identity: CacheIdentity) => Promise<T>,
): Promise<T | null> {
  const currentIdentity = identity;
  const currentGeneration = generation;
  if (!currentIdentity) return Promise.resolve(null);

  const pending = (async () => {
    const repositories = await getOfflineCacheRepositories();
    if (generation !== currentGeneration || identity !== currentIdentity) return null;
    const result = await operation(repositories, currentIdentity);
    return generation === currentGeneration && identity === currentIdentity ? result : null;
  })().catch((error) => {
    reportCacheError(error);
    throw error;
  });
  activeOperations.add(pending);
  void pending.then(
    () => activeOperations.delete(pending),
    () => activeOperations.delete(pending),
  );
  return pending;
}

async function openRepositoriesWithRetry(): Promise<CacheRepositories> {
  try {
    const { storage } = await openOfflineCache();
    return createCacheRepositories(storage);
  } catch {
    const { storage } = await openOfflineCache();
    return createCacheRepositories(storage);
  }
}

async function openRepositoriesAfter(barrier: Promise<void>): Promise<CacheRepositories> {
  await barrier;
  return openRepositoriesWithRetry();
}

function emptyDiagnostics(currentIdentity: CacheIdentity | null): OfflineCacheDiagnostics {
  return {
    analytics: { dailyBuckets: 0, entries: 0, snapshots: 0 },
    available: false,
    categories: { analytics: 0, sessions: 0, tasks: 0 },
    identity: currentIdentity,
    latestSyncedAt: null,
    totalEntries: 0,
  };
}

function reportCacheError(error: unknown): void {
  const message = error instanceof Error ? error.message : '离线缓存不可用，请重新同步';
  const timestamp = Date.now();
  if (lastReportedError?.message === message && timestamp - lastReportedError.timestamp < 5_000) return;
  lastReportedError = { message, timestamp };
  showToast(message, 'error');
}
