import type { SessionDetailResponse, SessionListItem } from '@/types/chat';
import type { TaskRecord } from '@/types/task';
import { ANALYTICS_DAILY_KEY_VERSION, ANALYTICS_SNAPSHOT_KEY_VERSION, createAnalyticsCache, type AnalyticsCache, type AnalyticsModule } from './analyticsCache';
import { createChatCache } from './chatCache';
import { assertCacheIdentity, createScopedCacheKey, type CacheCategory, type CacheIdentity, type CacheJson } from './cachePolicy';
import { createTaskCache, type CachedTaskSummary } from './taskCache';

export type CacheEntry = {
  cachedAt: number;
  category: CacheCategory;
  expiresAt: number;
  identity: CacheIdentity;
  key: string;
  payload: string;
};

export type CacheStorage = {
  clear(): Promise<void>;
  purgeExpired(now: number): Promise<void>;
  readCategory(identity: CacheIdentity, category: CacheCategory): Promise<CacheEntry[]>;
  replaceCategory(identity: CacheIdentity, category: CacheCategory, entries: CacheEntry[]): Promise<void>;
  upsert(entry: CacheEntry): Promise<void>;
};

type AnalyticsRepository = AnalyticsCache & {
  clear(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, now: number): Promise<void>;
  latestSyncedAt(identity: CacheIdentity, now: number): Promise<number | null>;
};

export type CacheDiagnosticsSummary = {
  analytics: {
    dailyBuckets: number;
    entries: number;
    snapshots: number;
  };
  categories: Record<CacheCategory, number>;
  latestSyncedAt: number | null;
  totalEntries: number;
};

const CACHE_CATEGORIES: CacheCategory[] = ['sessions', 'tasks', 'analytics'];

export function createCacheRepositories(storage: CacheStorage) {
  const analytics = createAnalyticsCache(storage);
  return {
    analytics: {
      ...analytics,
      async clear(identity: CacheIdentity, module: AnalyticsModule, cacheScope: string, now: number): Promise<void> {
        await analytics.clearSnapshot(identity, module, cacheScope, now);
      },
      async latestSyncedAt(identity: CacheIdentity, now: number): Promise<number | null> {
        assertCacheIdentity(identity);
        await storage.purgeExpired(now);
        const snapshotKeyPrefix = createScopedCacheKey(identity, 'analytics', `${ANALYTICS_SNAPSHOT_KEY_VERSION}:snapshot:`);
        return (await storage.readCategory(identity, 'analytics'))
          .filter((entry) => entry.key.startsWith(snapshotKeyPrefix))
          .reduce<number | null>((latest, entry) => latest === null || entry.cachedAt > latest ? entry.cachedAt : latest, null);
      },
    },
    diagnostics: {
      async summarize(identity: CacheIdentity, now: number): Promise<CacheDiagnosticsSummary> {
        assertCacheIdentity(identity);
        await storage.purgeExpired(now);
        const entriesByCategory = await Promise.all(
          CACHE_CATEGORIES.map(async (category) => [category, await storage.readCategory(identity, category)] as const),
        );
        const categories = Object.fromEntries(
          entriesByCategory.map(([category, entries]) => [category, entries.length]),
        ) as Record<CacheCategory, number>;
        const analyticsEntries = entriesByCategory.find(([category]) => category === 'analytics')?.[1] ?? [];
        const snapshotPrefix = createScopedCacheKey(identity, 'analytics', `${ANALYTICS_SNAPSHOT_KEY_VERSION}:snapshot:`);
        const dailyPrefix = createScopedCacheKey(identity, 'analytics', `${ANALYTICS_DAILY_KEY_VERSION}:daily:`);
        const dailyV3Prefix = createScopedCacheKey(identity, 'analytics', 'analytics-v3:daily:');
        return {
          analytics: {
            dailyBuckets: analyticsEntries.filter((entry) => entry.key.startsWith(dailyPrefix) || entry.key.startsWith(dailyV3Prefix)).length,
            entries: analyticsEntries.length,
            snapshots: analyticsEntries.filter((entry) => entry.key.startsWith(snapshotPrefix)).length,
          },
          categories,
          latestSyncedAt: entriesByCategory
            .flatMap(([, entries]) => entries)
            .reduce<number | null>((latest, entry) => latest === null || entry.cachedAt > latest ? entry.cachedAt : latest, null),
          totalEntries: entriesByCategory.reduce((total, [, entries]) => total + entries.length, 0),
        };
      },
    },
    sessions: createChatCache(storage),
    tasks: createTaskCache(storage),
  } as {
    analytics: AnalyticsRepository;
    diagnostics: {
      summarize(identity: CacheIdentity, now: number): Promise<CacheDiagnosticsSummary>;
    };
    sessions: {
      lastSyncedAt(identity: CacheIdentity, now: number): Promise<number | null>;
      read(identity: CacheIdentity, now: number): Promise<SessionListItem[]>;
      readDetail(identity: CacheIdentity, sessionId: string, now: number): Promise<SessionDetailResponse | null>;
      save(identity: CacheIdentity, sessions: SessionListItem[], now: number): Promise<void>;
      saveDetail(identity: CacheIdentity, detail: SessionDetailResponse, now: number): Promise<void>;
    };
    tasks: {
      lastSyncedAt(identity: CacheIdentity, now: number): Promise<number | null>;
      read(identity: CacheIdentity, now: number): Promise<CachedTaskSummary[]>;
      save(identity: CacheIdentity, tasks: TaskRecord[], now: number): Promise<void>;
    };
  };
}

export type { AnalyticsModule, CacheIdentity, CacheJson, CachedTaskSummary };
