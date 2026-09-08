import type { SessionListItem } from '@/types/chat';
import { parseBeijingTimestamp } from '@/utils/time';

export const SESSION_CACHE_LIMIT = 10;
export const SESSION_CACHE_TTL_MS = 30 * 86_400_000;
export const TASK_CACHE_TTL_MS = 7 * 86_400_000;
export const ANALYTICS_CACHE_TTL_MS = 7 * 86_400_000;
export const ANALYTICS_SNAPSHOT_TTL_MS = 30 * 86_400_000;
export const ANALYTICS_REVALIDATE_AFTER_MS = 5 * 60_000;
export const ANALYTICS_DAILY_BUCKET_TTL_MS = 365 * 86_400_000;
export const ANALYTICS_DAILY_BUCKET_MAX_DAYS = 365;
export const ANALYTICS_CACHE_MAX_ENTRIES = 300;
export const ANALYTICS_CACHE_MAX_ENTRY_CHARS = 1_000_000;

export type CacheIdentity = {
  tenantId: string;
  userId: string;
};

export type CacheCategory = 'sessions' | 'tasks' | 'analytics';
export type CacheJson = null | boolean | number | string | CacheJson[] | { [key: string]: CacheJson };
export type OfflineRestrictedAction = 'send' | 'upload' | 'approve' | 'retry' | 'forceRefresh';

const SENSITIVE_KEY = /(attachment|report|token|phone|mobile|tel)/i;
const CHINA_MOBILE = /(^|[^\d])(1[3-9](?:[^\dA-Za-z\u3400-\u9fff\r\n]{0,3}\d){9})(?=$|[^\d])/g;
const BEARER_TOKEN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const OFFLINE_RESTRICTED_ACTIONS = new Set<OfflineRestrictedAction>(['send', 'upload', 'approve', 'retry', 'forceRefresh']);

export function createScopedCacheKey(identity: CacheIdentity, category: CacheCategory, itemKey: string): string {
  assertCacheIdentity(identity);
  return [
    `tenant_id=${encodeURIComponent(identity.tenantId)}`,
    `user_id=${encodeURIComponent(identity.userId)}`,
    category,
    encodeURIComponent(itemKey),
  ].join('|');
}

export function assertCacheIdentity(identity: CacheIdentity): void {
  if (
    typeof identity?.tenantId !== 'string'
    || !identity.tenantId.trim()
    || typeof identity?.userId !== 'string'
    || !identity.userId.trim()
  ) {
    throw new Error('离线缓存需要服务端提供 tenant_id 和 user_id');
  }
}

export function selectRecentSessions(sessions: SessionListItem[], now: number): SessionListItem[] {
  return sessions
    .filter((session) => isFresh(timestamp(session.updated_at), SESSION_CACHE_TTL_MS, now))
    .sort((left, right) => timestamp(right.updated_at) - timestamp(left.updated_at))
    .slice(0, SESSION_CACHE_LIMIT)
    .map((session) => ({
      session_id: session.session_id,
      title: sanitizeCacheText(session.title),
      created_at: session.created_at,
      updated_at: session.updated_at,
    }));
}

export function isFresh(cachedAt: number, ttlMs: number, now: number): boolean {
  return Number.isFinite(cachedAt) && cachedAt <= now && now - cachedAt <= ttlMs;
}

export function isAnalyticsSnapshotFresh(cachedAt: number | null, now = Date.now()): boolean {
  return cachedAt !== null && isFresh(cachedAt, ANALYTICS_REVALIDATE_AFTER_MS, now);
}

export function isOfflineReadOnlyAction(action: OfflineRestrictedAction): boolean {
  return OFFLINE_RESTRICTED_ACTIONS.has(action);
}

export function sanitizeCacheText(value: string): string {
  return value
    .replace(BEARER_TOKEN, 'Bearer [redacted]')
    .replace(JWT_TOKEN, '[redacted]')
    .replace(CHINA_MOBILE, (_match, prefix: string, mobile: string) => {
      const digits = mobile.replace(/\D/g, '');
      return `${prefix}${digits.slice(0, 3)}****${digits.slice(-4)}`;
    });
}

export function sanitizeCachePayload(value: unknown): CacheJson {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return sanitizeCacheText(value);
  if (Array.isArray(value)) return value.map(sanitizeCachePayload);
  if (!value || typeof value !== 'object') return String(value);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY.test(key))
      .map(([key, item]) => [key, sanitizeCachePayload(item)]),
  ) as { [key: string]: CacheJson };
}

function timestamp(value: string): number {
  return parseBeijingTimestamp(value) ?? Number.NEGATIVE_INFINITY;
}
