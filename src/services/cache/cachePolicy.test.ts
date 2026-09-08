import type { SessionListItem } from '@/types/chat';
import {
  ANALYTICS_SNAPSHOT_TTL_MS,
  createScopedCacheKey,
  isAnalyticsSnapshotFresh,
  isOfflineReadOnlyAction,
  sanitizeCachePayload,
  sanitizeCacheText,
  selectRecentSessions,
  type CacheIdentity,
} from './cachePolicy';

const now = Date.parse('2026-07-16T00:00:00.000Z');

function session(index: number, updatedAt: number): SessionListItem {
  return {
    session_id: `session-${index}`,
    title: `会话 ${index}`,
    created_at: new Date(updatedAt).toISOString(),
    updated_at: new Date(updatedAt).toISOString(),
  };
}

describe('cachePolicy', () => {
  it('includes both tenant_id and user_id in every scoped cache key', () => {
    const first = createScopedCacheKey({ tenantId: 'tenant-a', userId: 'user-a' }, 'sessions', 'session-1');
    const second = createScopedCacheKey({ tenantId: 'tenant-a', userId: 'user-b' }, 'sessions', 'session-1');

    expect(first).toContain('tenant-a');
    expect(first).toContain('user-a');
    expect(first).not.toBe(second);
  });

  it('reports an invalid cache identity without leaking a trim runtime error', () => {
    const malformed = { tenantId: 'tenant-a', userId: undefined } as unknown as CacheIdentity;

    expect(() => createScopedCacheKey(malformed, 'sessions', 'session-1'))
      .toThrow('离线缓存需要服务端提供 tenant_id 和 user_id');
  });

  it('keeps at most ten recent sessions from the last thirty days', () => {
    const recent = Array.from({ length: 12 }, (_, index) => session(index, now - index * 86_400_000));
    const expired = session(99, now - 31 * 86_400_000);

    const selected = selectRecentSessions([...recent, expired], now);

    expect(selected).toHaveLength(10);
    expect(selected.map((item) => item.session_id)).toEqual([
      'session-0', 'session-1', 'session-2', 'session-3', 'session-4',
      'session-5', 'session-6', 'session-7', 'session-8', 'session-9',
    ]);
  });

  it('treats a snapshot as fresh for five minutes and retains it for thirty days', () => {
    const current = Date.parse('2026-08-27T10:00:00+08:00');

    expect(ANALYTICS_SNAPSHOT_TTL_MS).toBe(30 * 86_400_000);
    expect(isAnalyticsSnapshotFresh(current - 299_999, current)).toBe(true);
    expect(isAnalyticsSnapshotFresh(current - 300_001, current)).toBe(false);
    expect(isAnalyticsSnapshotFresh(null, current)).toBe(false);
  });

  it('removes attachment, report, token, and complete phone data before persistence', () => {
    const value = sanitizeCachePayload({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      attachment_url: 'https://example.test/statement.xlsx',
      nested: { report_url: 'https://example.test/report.xlsx', phone: '13800138000' },
      note: '请联系 13800138000，Bearer abc.def.ghi',
    });

    expect(value).toEqual({ nested: {}, note: '请联系 138****8000，Bearer [redacted]' });
  });

  it('redacts formatted Chinese mobile numbers before persistence', () => {
    expect(sanitizeCachePayload({ note: '空格 138 0013 8000，横线 139-1234-5678' })).toEqual({
      note: '空格 138****8000，横线 139****5678',
    });
  });

  it('redacts mobile numbers with repeated or punctuation separators', () => {
    expect(sanitizeCacheText('手机号 138  0013 8000')).toBe('手机号 138****8000');
    expect(sanitizeCacheText('手机号 138.0013.8000')).toBe('手机号 138****8000');
    expect(sanitizeCacheText('手机号 138 (0013) 8000')).toBe('手机号 138****8000');
    expect(sanitizeCacheText('手机号 138/0013/8000')).toBe('手机号 138****8000');
    expect(sanitizeCacheText('手机号 138　0013　8000')).toBe('手机号 138****8000');
    expect(sanitizeCacheText('手机号 138 0013 8000')).toBe('手机号 138****8000');
    expect(sanitizeCacheText('手机号 138·0013·8000')).toBe('手机号 138****8000');
  });

  it('marks every offline-forbidden command as read-only', () => {
    expect(isOfflineReadOnlyAction('send')).toBe(true);
    expect(isOfflineReadOnlyAction('upload')).toBe(true);
    expect(isOfflineReadOnlyAction('approve')).toBe(true);
    expect(isOfflineReadOnlyAction('retry')).toBe(true);
    expect(isOfflineReadOnlyAction('forceRefresh')).toBe(true);
  });
});
