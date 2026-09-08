import { parseAgentResponsePayload } from '@/types/agentResponse';
import { parseAgentActivity } from '@/types/agentActivity';
import type { MessageItem, SessionDetailResponse, SessionListItem } from '@/types/chat';
import { parseBeijingTimestamp } from '@/utils/time';
import {
  assertCacheIdentity,
  createScopedCacheKey,
  SESSION_CACHE_TTL_MS,
  sanitizeCacheText,
  selectRecentSessions,
  type CacheIdentity,
} from './cachePolicy';
import type { CacheEntry, CacheStorage } from './cacheRepositories';

type CachedSessionRecord = SessionListItem & { messages?: MessageItem[] };

export function createChatCache(storage: CacheStorage) {
  let writeBarrier: Promise<void> = Promise.resolve();
  const serializeWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = writeBarrier.then(operation, operation);
    writeBarrier = pending.then(() => undefined, () => undefined);
    return pending;
  };

  return {
    async lastSyncedAt(identity: CacheIdentity, now: number): Promise<number | null> {
      assertCacheIdentity(identity);
      await storage.purgeExpired(now);
      return latestCachedAt(await storage.readCategory(identity, 'sessions'));
    },
    async read(identity: CacheIdentity, now: number): Promise<SessionListItem[]> {
      assertCacheIdentity(identity);
      await storage.purgeExpired(now);
      const entries = await storage.readCategory(identity, 'sessions');
      return entries
        .filter((entry) => entry.expiresAt >= now)
        .sort((left, right) => right.cachedAt - left.cachedAt)
        .flatMap((entry) => parseRecord(entry.payload))
        .map(toSessionListItem);
    },
    async readDetail(identity: CacheIdentity, sessionId: string, now: number): Promise<SessionDetailResponse | null> {
      assertCacheIdentity(identity);
      await storage.purgeExpired(now);
      const key = createScopedCacheKey(identity, 'sessions', sessionId);
      const record = (await storage.readCategory(identity, 'sessions'))
        .filter((entry) => entry.key === key && entry.expiresAt >= now)
        .flatMap((entry) => parseRecord(entry.payload))[0];
      if (!record?.messages) return null;
      return { session_id: record.session_id, title: record.title, messages: record.messages.map(toCachedMessage) };
    },
    async save(identity: CacheIdentity, sessions: SessionListItem[], now: number): Promise<void> {
      return serializeWrite(async () => {
        assertCacheIdentity(identity);
        await storage.purgeExpired(now);
        const existing = new Map(
          (await storage.readCategory(identity, 'sessions'))
            .flatMap((entry) => parseRecord(entry.payload))
            .map((record) => [record.session_id, record]),
        );
        const entries = selectRecentSessions(sessions, now).map((session): CacheEntry => ({
          cachedAt: now,
          category: 'sessions',
          expiresAt: (parseBeijingTimestamp(session.updated_at) ?? now) + SESSION_CACHE_TTL_MS,
          identity,
          key: createScopedCacheKey(identity, 'sessions', session.session_id),
          payload: JSON.stringify({
            ...session,
            messages: existing.get(session.session_id)?.messages?.map(toCachedMessage),
          }),
        }));
        await storage.replaceCategory(identity, 'sessions', entries);
      });
    },
    async saveDetail(identity: CacheIdentity, detail: SessionDetailResponse, now: number): Promise<void> {
      return serializeWrite(async () => {
        assertCacheIdentity(identity);
        await storage.purgeExpired(now);
        const key = createScopedCacheKey(identity, 'sessions', detail.session_id);
        const entry = (await storage.readCategory(identity, 'sessions')).find((candidate) => candidate.key === key);
        const record = entry && parseRecord(entry.payload)[0];
        const timestamp = new Date(now).toISOString();
        await storage.upsert({
          cachedAt: now,
          category: 'sessions',
          expiresAt: entry?.expiresAt ?? now + SESSION_CACHE_TTL_MS,
          identity,
          key,
          payload: JSON.stringify({
            session_id: detail.session_id,
            title: sanitizeCacheText(detail.title),
            created_at: record?.created_at ?? timestamp,
            updated_at: record?.updated_at ?? timestamp,
            messages: detail.messages.map(toCachedMessage),
          }),
        });
      });
    },
  };
}

function latestCachedAt(entries: CacheEntry[]): number | null {
  return entries.reduce<number | null>((latest, entry) => latest === null || entry.cachedAt > latest ? entry.cachedAt : latest, null);
}

function parseRecord(payload: string): CachedSessionRecord[] {
  try {
    const value = JSON.parse(payload) as CachedSessionRecord;
    return typeof value.session_id === 'string' && typeof value.title === 'string'
      && typeof value.created_at === 'string' && typeof value.updated_at === 'string'
      ? [value]
      : [];
  } catch {
    return [];
  }
}

function toSessionListItem(record: CachedSessionRecord): SessionListItem {
  return {
    session_id: record.session_id,
    title: record.title,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function toCachedMessage(message: MessageItem): MessageItem {
  const agentResponse = parseAgentResponsePayload(message.agentResponse);
  const activity = message.role === 'assistant' ? parseAgentActivity(message.activity) : null;
  return {
    id: message.id,
    role: message.role,
    content: sanitizeCacheText(message.content),
    created_at: message.created_at,
    ...(agentResponse ? { agentResponse } : {}),
    ...(activity ? { activity } : {}),
    ...(message.interrupted === undefined ? {} : { interrupted: message.interrupted }),
    ...(message.task_id === undefined ? {} : { task_id: message.task_id }),
    ...(message.toolCall ? {
      toolCall: {
        name: sanitizeCacheText(message.toolCall.name),
        description: sanitizeCacheText(message.toolCall.description),
        status: message.toolCall.status,
      },
    } : {}),
  };
}
