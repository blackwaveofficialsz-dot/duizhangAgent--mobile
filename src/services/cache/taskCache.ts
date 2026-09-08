import { isAgentRunStatus, type TaskRecord } from '@/types/task';
import { parseBeijingTimestamp } from '@/utils/time';
import {
  assertCacheIdentity,
  createScopedCacheKey,
  isFresh,
  TASK_CACHE_TTL_MS,
  type CacheIdentity,
} from './cachePolicy';
import type { CacheEntry, CacheStorage } from './cacheRepositories';

export type CachedTaskSummary = Pick<
  TaskRecord,
  'id' | 'task_type' | 'status' | 'task_id' | 'created_at' | 'updated_at' | 'completed_at'
> & { meta: { run_status: string } | null };

export function createTaskCache(storage: CacheStorage) {
  return {
    async lastSyncedAt(identity: CacheIdentity, now: number): Promise<number | null> {
      assertCacheIdentity(identity);
      await storage.purgeExpired(now);
      return latestCachedAt(await storage.readCategory(identity, 'tasks'));
    },
    async read(identity: CacheIdentity, now: number): Promise<CachedTaskSummary[]> {
      assertCacheIdentity(identity);
      await storage.purgeExpired(now);
      const entries = await storage.readCategory(identity, 'tasks');
      return entries
        .filter((entry) => entry.expiresAt >= now)
        .flatMap((entry) => parseTask(entry.payload))
        .sort((left, right) => (parseBeijingTimestamp(right.updated_at) ?? 0) - (parseBeijingTimestamp(left.updated_at) ?? 0));
    },
    async save(identity: CacheIdentity, tasks: TaskRecord[], now: number): Promise<void> {
      assertCacheIdentity(identity);
      await storage.purgeExpired(now);
      const entries = tasks
        .filter((task) => isFresh(parseBeijingTimestamp(task.updated_at) ?? Number.NEGATIVE_INFINITY, TASK_CACHE_TTL_MS, now))
        .map((task): CacheEntry => ({
          cachedAt: now,
          category: 'tasks',
          expiresAt: (parseBeijingTimestamp(task.updated_at) ?? now) + TASK_CACHE_TTL_MS,
          identity,
          key: createScopedCacheKey(identity, 'tasks', task.id),
          payload: JSON.stringify(toTaskSummary(task)),
        }));
      await storage.replaceCategory(identity, 'tasks', entries);
    },
  };
}

function latestCachedAt(entries: CacheEntry[]): number | null {
  return entries.reduce<number | null>((latest, entry) => latest === null || entry.cachedAt > latest ? entry.cachedAt : latest, null);
}

function toTaskSummary(task: TaskRecord): CachedTaskSummary {
  const runStatus = task.meta?.run_status;
  return {
    completed_at: task.completed_at,
    created_at: task.created_at,
    id: task.id,
    meta: isAgentRunStatus(runStatus) ? { run_status: runStatus } : null,
    status: task.status,
    task_id: task.task_id,
    task_type: task.task_type,
    updated_at: task.updated_at,
  };
}

function parseTask(payload: string): CachedTaskSummary[] {
  try {
    const value = JSON.parse(payload) as CachedTaskSummary;
    if (typeof value.id === 'string' && typeof value.task_type === 'string'
      && typeof value.status === 'string' && typeof value.created_at === 'string'
      && typeof value.updated_at === 'string') {
      const runStatus = value.meta?.run_status;
      return [{ ...value, meta: isAgentRunStatus(runStatus) ? { run_status: runStatus } : null }];
    }
    return [];
  } catch {
    return [];
  }
}
