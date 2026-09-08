import { partialSalesAgentResponse, sessionDetailWithAgentResponse, validAgentResponse } from '@/test/agentResponseFixture';
import { normalizeMessageAgentResponse } from '@/types/agentResponse';
import { SESSION_CACHE_TTL_MS } from './cachePolicy';
import type { CacheEntry, CacheStorage } from './cacheRepositories';
import { createChatCache } from './chatCache';

const identity = { tenantId: 'tenant-1', userId: 'user-1' };
const now = Date.parse('2026-08-21T10:00:00+08:00');

class MemoryCacheStorage implements CacheStorage {
  entries: CacheEntry[] = [];

  async clear(): Promise<void> { this.entries = []; }
  async purgeExpired(nowValue: number): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.expiresAt >= nowValue);
  }
  async readCategory(target: CacheEntry['identity'], category: CacheEntry['category']): Promise<CacheEntry[]> {
    return this.entries.filter((entry) => (
      entry.identity.tenantId === target.tenantId
      && entry.identity.userId === target.userId
      && entry.category === category
    ));
  }
  async replaceCategory(target: CacheEntry['identity'], category: CacheEntry['category'], entries: CacheEntry[]): Promise<void> {
    this.entries = [
      ...this.entries.filter((entry) => entry.identity.tenantId !== target.tenantId || entry.identity.userId !== target.userId || entry.category !== category),
      ...entries,
    ];
  }
  async upsert(entry: CacheEntry): Promise<void> {
    this.entries = [...this.entries.filter((candidate) => candidate.key !== entry.key), entry];
  }
}

describe('chat cache', () => {
  it.each([
    ['without a session-list entry', now],
    ['after its session-list entry expires', now + SESSION_CACHE_TTL_MS + 1],
  ])('persists normalized API history %s for offline restore', async (_scenario, cacheNow) => {
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    const apiDetail = sessionDetailWithAgentResponse();
    const normalizedDetail = { ...apiDetail, messages: apiDetail.messages.map(normalizeMessageAgentResponse) };
    if (cacheNow !== now) {
      await cache.save(identity, [{
        session_id: 'session-1', title: '经营分析',
        created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
      }], now);
    }

    await cache.saveDetail(identity, normalizedDetail, cacheNow);

    const raw = JSON.parse(storage.entries[0].payload);
    expect(raw.messages[0].agentResponse.result_id).toBe('labor-turn-1');
    expect(raw.messages[0].metadata).toBeUndefined();
    await expect(cache.readDetail(identity, 'session-1', cacheNow)).resolves.toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ agentResponse: expect.objectContaining({ result_id: 'labor-turn-1' }) })],
    }));
  });

  it('caches only the validated response and drops arbitrary metadata', async () => {
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    const detail = sessionDetailWithAgentResponse();
    detail.messages[0].agentResponse = validAgentResponse;

    await cache.save(identity, [{
      session_id: 'session-1',
      title: '经营分析',
      created_at: '2026-08-21T10:00:00+08:00',
      updated_at: '2026-08-21T10:00:00+08:00',
    }], now);
    await cache.saveDetail(identity, detail, now);
    const restored = await cache.readDetail(identity, 'session-1', now);

    expect(restored?.messages[0].agentResponse?.result_id).toBe('labor-turn-1');
    expect(restored?.messages[0].metadata).toBeUndefined();
  });

  it('persists normalized assistant activity without raw activity metadata', async () => {
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    const detail = {
      session_id: 'session-activity', title: '活动缓存',
      messages: [
        {
          id: 'assistant-1', role: 'assistant', content: '结果', created_at: '2026-08-24T10:00:00+08:00',
          activity: {
            version: 'v1' as const, status: 'completed' as const, label: '分析完成', elapsed_ms: 50,
            steps: [{ step_id: 'query', label: '查询数据', status: 'completed' as const, elapsed_ms: 50, sequence: 1 }],
            scope: ['销售'], sources: ['销售日报'],
          },
          metadata: { agent_activity: { private_reasoning: 'drop-me' } },
        },
      ],
    };

    await cache.saveDetail(identity, detail, now);

    const raw = JSON.parse(storage.entries[0].payload);
    expect(raw.messages[0]).toEqual(expect.objectContaining({ activity: detail.messages[0].activity }));
    expect(raw.messages[0].metadata).toBeUndefined();
    await expect(cache.readDetail(identity, 'session-activity', now)).resolves.toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ activity: detail.messages[0].activity })],
    }));
  });

  it('drops a corrupt cached response while preserving fallback content', async () => {
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    await cache.save(identity, [{
      session_id: 'session-1',
      title: '经营分析',
      created_at: '2026-08-21T10:00:00+08:00',
      updated_at: '2026-08-21T10:00:00+08:00',
    }], now);
    storage.entries[0].payload = JSON.stringify({
      session_id: 'session-1',
      title: '经营分析',
      created_at: '2026-08-21T10:00:00+08:00',
      updated_at: '2026-08-21T10:00:00+08:00',
      messages: [{
        id: 'assistant-1', role: 'assistant', content: '本期人效结果', created_at: '2026-08-21T10:00:00+08:00',
        agentResponse: { version: 1, parts: [] },
        metadata: { token: 'drop-me', agent_response: validAgentResponse },
      }],
    });

    await expect(cache.readDetail(identity, 'session-1', now)).resolves.toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ content: '本期人效结果' })],
    }));
    const restored = await cache.readDetail(identity, 'session-1', now);
    expect(restored?.messages[0].agentResponse).toBeUndefined();
    expect(restored?.messages[0].metadata).toBeUndefined();
  });

  it('drops legacy metadata instead of rebuilding an offline response from it', async () => {
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    await cache.save(identity, [{
      session_id: 'session-1', title: '经营分析',
      created_at: '2026-08-21T10:00:00+08:00', updated_at: '2026-08-21T10:00:00+08:00',
    }], now);
    storage.entries[0].payload = JSON.stringify({
      session_id: 'session-1', title: '经营分析',
      created_at: '2026-08-21T10:00:00+08:00', updated_at: '2026-08-21T10:00:00+08:00',
      messages: [{
        id: 'assistant-1', role: 'assistant', content: '本期销售结果', created_at: '2026-08-21T10:00:00+08:00',
        metadata: { agent_response: partialSalesAgentResponse, ignored_private_data: 'drop-me' },
      }],
    });

    const restored = await cache.readDetail(identity, 'session-1', now);
    expect(restored?.messages[0]).toEqual(expect.objectContaining({ content: '本期销售结果' }));
    expect(restored?.messages[0].agentResponse).toBeUndefined();
    expect(restored?.messages[0].metadata).toBeUndefined();
  });

  it('sanitizes retained messages when refreshing the session list', async () => {
    const storage = new MemoryCacheStorage();
    const cache = createChatCache(storage);
    await cache.save(identity, [{
      session_id: 'session-1', title: '经营分析',
      created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
    }], now);
    storage.entries[0].payload = JSON.stringify({
      session_id: 'session-1', title: '经营分析',
      created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
      messages: [{
        id: 'assistant-1', role: 'assistant', content: '本期销售结果', created_at: '2026-08-21T10:00:00+08:00',
        agentResponse: { version: 1, parts: [] },
        metadata: { agent_response: validAgentResponse, private_token: 'drop-me' },
      }],
    });

    await cache.save(identity, [{
      session_id: 'session-1', title: '经营分析',
      created_at: new Date(now).toISOString(), updated_at: new Date(now).toISOString(),
    }], now + 1);

    const raw = JSON.parse(storage.entries[0].payload);
    expect(raw.messages[0].metadata).toBeUndefined();
    expect(raw.messages[0].agentResponse).toBeUndefined();
    expect(storage.entries[0].payload).not.toContain('private_token');
  });
});
