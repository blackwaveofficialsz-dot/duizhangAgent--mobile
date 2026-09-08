import type { SessionListItem } from '@/types/chat';
import type { TaskRecord } from '@/types/task';
import {
  createCacheRepositories,
  type CacheEntry,
  type CacheStorage,
} from './cacheRepositories';

const now = Date.parse('2026-07-16T00:00:00.000Z');
const userA = { tenantId: 'tenant-a', userId: 'user-a' };
const userB = { tenantId: 'tenant-a', userId: 'user-b' };

class MemoryCacheStorage implements CacheStorage {
  entries: CacheEntry[] = [];

  async clear(): Promise<void> {
    this.entries = [];
  }

  async readCategory(identity: CacheEntry['identity'], category: CacheEntry['category']): Promise<CacheEntry[]> {
    return this.entries.filter((entry) => (
      entry.identity.tenantId === identity.tenantId
      && entry.identity.userId === identity.userId
      && entry.category === category
    ));
  }

  async replaceCategory(
    identity: CacheEntry['identity'],
    category: CacheEntry['category'],
    entries: CacheEntry[],
  ): Promise<void> {
    this.entries = [
      ...this.entries.filter((entry) => (
        entry.identity.tenantId !== identity.tenantId
        || entry.identity.userId !== identity.userId
        || entry.category !== category
      )),
      ...entries,
    ];
  }

  async purgeExpired(nowValue: number): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.expiresAt >= nowValue);
  }

  async upsert(entry: CacheEntry): Promise<void> {
    this.entries = [
      ...this.entries.filter((candidate) => (
        candidate.identity.tenantId !== entry.identity.tenantId
        || candidate.identity.userId !== entry.identity.userId
        || candidate.category !== entry.category
        || candidate.key !== entry.key
      )),
      entry,
    ];
  }
}

class DelayedSessionReadStorage extends MemoryCacheStorage {
  private releaseRead: (() => void) | null = null;
  private startedRead: (() => void) | null = null;
  private shouldDelay = false;
  readonly readStarted = new Promise<void>((resolve) => { this.startedRead = resolve; });

  delayNextSessionRead(): void {
    this.shouldDelay = true;
  }

  release(): void {
    this.releaseRead?.();
  }

  async readCategory(identity: CacheEntry['identity'], category: CacheEntry['category']): Promise<CacheEntry[]> {
    const snapshot = await super.readCategory(identity, category);
    if (category === 'sessions' && this.shouldDelay) {
      this.shouldDelay = false;
      this.startedRead?.();
      await new Promise<void>((resolve) => { this.releaseRead = resolve; });
    }
    return snapshot;
  }
}

class DelayedAnalyticsReadStorage extends MemoryCacheStorage {
  private releaseRead: (() => void) | null = null;
  private readBlocked = false;
  private startedRead: (() => void) | null = null;
  private writeWhileReadBlocked = false;
  private shouldDelay = true;
  readonly readStarted = new Promise<void>((resolve) => { this.startedRead = resolve; });

  didWriteWhileReadBlocked(): boolean {
    return this.writeWhileReadBlocked;
  }

  release(): void {
    this.readBlocked = false;
    this.releaseRead?.();
  }

  async readCategory(identity: CacheEntry['identity'], category: CacheEntry['category']): Promise<CacheEntry[]> {
    const snapshot = await super.readCategory(identity, category);
    if (category === 'analytics' && this.shouldDelay) {
      this.shouldDelay = false;
      this.readBlocked = true;
      this.startedRead?.();
      await new Promise<void>((resolve) => { this.releaseRead = resolve; });
    }
    return snapshot;
  }

  async replaceCategory(
    identity: CacheEntry['identity'],
    category: CacheEntry['category'],
    entries: CacheEntry[],
  ): Promise<void> {
    if (category === 'analytics' && this.readBlocked) this.writeWhileReadBlocked = true;
    await super.replaceCategory(identity, category, entries);
  }
}

function session(id: string, updatedAt = now): SessionListItem {
  return {
    session_id: id,
    title: `会话 ${id}`,
    created_at: new Date(updatedAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
  };
}

function task(id: string, updatedAt = now): TaskRecord {
  return {
    celery_task_id: 'celery-secret',
    completed_at: null,
    created_at: new Date(updatedAt).toISOString(),
    id,
    meta: { attachment_url: 'https://example.test/upload.xlsx', token: 'secret' },
    session_id: 'session-secret',
    status: 'completed',
    task_id: `task-${id}`,
    task_type: 'file_parsing',
    tenant_id: userA.tenantId,
    updated_at: new Date(updatedAt).toISOString(),
    user_id: userA.userId,
  };
}

describe('cache repositories', () => {
  it('requires both server-issued tenant and user IDs even when a cache category is empty', async () => {
    const repositories = createCacheRepositories(new MemoryCacheStorage());

    await expect(repositories.sessions.save({ tenantId: 'tenant-a', userId: '' }, [], now))
      .rejects.toThrow('tenant_id 和 user_id');
  });

  it('keeps session caches isolated by tenant and user', async () => {
    const repositories = createCacheRepositories(new MemoryCacheStorage());
    await repositories.sessions.save(userA, [session('a')], now);
    await repositories.sessions.save(userB, [session('b')], now);

    await expect(repositories.sessions.read(userA, now)).resolves.toEqual([session('a')]);
    await expect(repositories.sessions.read(userB, now)).resolves.toEqual([session('b')]);
  });

  it('stores only non-sensitive task summaries from the last seven days', async () => {
    const storage = new MemoryCacheStorage();
    const repositories = createCacheRepositories(storage);
    await repositories.tasks.save(userA, [task('recent'), task('old', now - 8 * 86_400_000)], now);

    await expect(repositories.tasks.read(userA, now)).resolves.toEqual([
      expect.objectContaining({ id: 'recent', task_id: 'task-recent', task_type: 'file_parsing' }),
    ]);
    const stored = await storage.readCategory(userA, 'tasks');
    expect(stored[0].payload).not.toContain('celery-secret');
    expect(stored[0].payload).not.toContain('session-secret');
    expect(stored[0].payload).not.toContain('attachment_url');
    expect(stored[0].payload).not.toContain('token');
  });

  it('retains only the public research run status from task metadata', async () => {
    const storage = new MemoryCacheStorage();
    const repositories = createCacheRepositories(storage);
    const researchTask = {
      ...task('research'),
      status: 'running',
      task_type: 'research',
      meta: { authorization_snapshot: 'secret', run_status: 'needs_review' },
    };

    await repositories.tasks.save(userA, [researchTask], now);

    await expect(repositories.tasks.read(userA, now)).resolves.toEqual([
      expect.objectContaining({ id: 'research', meta: { run_status: 'needs_review' } }),
    ]);
    const stored = await storage.readCategory(userA, 'tasks');
    expect(stored[0].payload).not.toContain('authorization_snapshot');
    expect(stored[0].payload).not.toContain('secret');
  });

  it('does not overwrite another filter when saving a second analytics snapshot', async () => {
    const storage = new MemoryCacheStorage();
    const repositories = createCacheRepositories(storage);
    await repositories.analytics.saveSuccess(userA, 'revenue', 'store=A&range=7d', { points: [1] }, now);
    await repositories.analytics.saveSuccess(userA, 'revenue', 'store=B&range=7d', { points: [2] }, now + 1);

    await expect(repositories.analytics.read(userA, 'revenue', 'store=A&range=7d', now + 1))
      .resolves.toEqual({ points: [1] });
    await expect(repositories.analytics.read(userA, 'revenue', 'store=B&range=7d', now + 1))
      .resolves.toEqual({ points: [2] });
  });

  it('does not return a snapshot written by another user in the same tenant', async () => {
    const repositories = createCacheRepositories(new MemoryCacheStorage());
    await repositories.analytics.saveSuccess(userA, 'orders', 'scope=A', { rows: [1] }, now);

    await expect(repositories.analytics.read(userB, 'orders', 'scope=A', now)).resolves.toBeNull();
  });

  it('clears one scoped snapshot without affecting another scope and reports the latest current snapshot', async () => {
    const repositories = createCacheRepositories(new MemoryCacheStorage());
    await repositories.analytics.saveSuccess(userA, 'orders', 'scope=A', { rows: ['A'] }, now);
    await repositories.analytics.saveSuccess(userA, 'orders', 'scope=B', { rows: ['B'] }, now + 1);
    await repositories.analytics.saveSuccess(userA, 'orders', { rows: ['legacy'] }, now + 2);

    await repositories.analytics.clear(userA, 'orders', 'scope=A', now + 2);

    await expect(repositories.analytics.read(userA, 'orders', 'scope=A', now + 2)).resolves.toBeNull();
    await expect(repositories.analytics.read(userA, 'orders', 'scope=B', now + 2)).resolves.toEqual({ rows: ['B'] });
    await expect(repositories.analytics.latestSyncedAt(userA, now + 2)).resolves.toBe(now + 1);
  });

  it('summarizes cache diagnostics without returning payload contents', async () => {
    const storage = new MemoryCacheStorage();
    const repositories = createCacheRepositories(storage);
    await repositories.sessions.save(userA, [session('a')], now);
    await repositories.tasks.save(userA, [task('recent')], now + 1);
    await repositories.analytics.saveSuccess(userA, 'orders', 'scope=A', { secret: 'hidden' }, now + 2);
    await repositories.analytics.saveDailyBucket(userA, 'analytics-v2:daily:orders:platform:all', {
      days: { '2026-07-16': { payload: { secret: 'daily-hidden' }, version: 'v1' } },
    }, now + 3);

    await expect(repositories.diagnostics.summarize(userA, now + 3)).resolves.toEqual({
      analytics: {
        dailyBuckets: 1,
        entries: 2,
        snapshots: 1,
      },
      categories: {
        analytics: 2,
        sessions: 1,
        tasks: 1,
      },
      latestSyncedAt: now + 3,
      totalEntries: 4,
    });
  });

  it('keeps a forced scoped clear after an overlapping snapshot save', async () => {
    const storage = new DelayedAnalyticsReadStorage();
    const repositories = createCacheRepositories(storage);
    const save = repositories.analytics.saveSuccess(userA, 'orders', 'scope=A', { rows: ['stale'] }, now);
    await storage.readStarted;
    const clear = repositories.analytics.clear(userA, 'orders', 'scope=A', now + 1);
    await new Promise<void>((resolve) => { setImmediate(resolve); });
    expect(storage.didWriteWhileReadBlocked()).toBe(false);
    storage.release();
    await Promise.all([save, clear]);

    await expect(repositories.analytics.read(userA, 'orders', 'scope=A', now + 1)).resolves.toBeNull();
  });

  it('expires sessions and tasks from their source update time instead of extending them when cached', async () => {
    const repositories = createCacheRepositories(new MemoryCacheStorage());
    await repositories.sessions.save(userA, [session('old-session', now - 29 * 86_400_000)], now);
    await repositories.tasks.save(userA, [task('old-task', now - 6 * 86_400_000)], now);

    await expect(repositories.sessions.read(userA, now + 2 * 86_400_000)).resolves.toEqual([]);
    await expect(repositories.tasks.read(userA, now + 2 * 86_400_000)).resolves.toEqual([]);
  });

  it('keeps sanitized message bodies for recent sessions and preserves them on list refresh', async () => {
    const storage = new MemoryCacheStorage();
    const repositories = createCacheRepositories(storage);
    await repositories.sessions.save(userA, [session('a')], now);
    await repositories.sessions.saveDetail(userA, {
      session_id: 'a',
      title: '会话 a',
      messages: [{
        id: 'message-1',
        role: 'assistant',
        content: '联系 13812345678，Bearer abc.def.ghi',
        created_at: new Date(now).toISOString(),
        metadata: { attachment_url: 'https://example.test/report.xlsx', token: 'secret' },
      }],
    }, now);
    await repositories.sessions.save(userA, [session('a', now + 1_000)], now + 1_000);

    await expect(repositories.sessions.readDetail(userA, 'a', now + 1_000)).resolves.toEqual({
      session_id: 'a',
      title: '会话 a',
      messages: [expect.objectContaining({ content: '联系 138****5678，Bearer [redacted]', id: 'message-1' })],
    });
    const stored = await storage.readCategory(userA, 'sessions');
    expect(stored[0].payload).not.toContain('13812345678');
    expect(stored[0].payload).not.toContain('attachment_url');
    expect(stored[0].payload).not.toContain('secret');
  });

  it('serializes list and detail writes so a stale list snapshot cannot erase messages', async () => {
    const storage = new DelayedSessionReadStorage();
    const repositories = createCacheRepositories(storage);
    await repositories.sessions.save(userA, [session('a')], now);
    storage.delayNextSessionRead();

    const listSave = repositories.sessions.save(userA, [session('a', now + 1_000)], now + 1_000);
    await storage.readStarted;
    const detailSave = repositories.sessions.saveDetail(userA, {
      session_id: 'a',
      title: '会话 a',
      messages: [{ id: 'message-1', role: 'assistant', content: '最终结果', created_at: new Date(now).toISOString() }],
    }, now + 1_000);
    await Promise.resolve();
    storage.release();
    await Promise.all([listSave, detailSave]);

    await expect(repositories.sessions.readDetail(userA, 'a', now + 1_000)).resolves.toEqual(
      expect.objectContaining({ messages: [expect.objectContaining({ content: '最终结果' })] }),
    );
  });
});
