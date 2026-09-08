import type { NativeCacheDatabase } from './database';

export async function migrateCacheDatabase(database: NativeCacheDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS read_only_cache (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      entry_key TEXT NOT NULL,
      payload TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, user_id, category, entry_key)
    );
    CREATE INDEX IF NOT EXISTS read_only_cache_expiry ON read_only_cache (expires_at);
  `);
  await database.runAsync(
    `DELETE FROM read_only_cache
     WHERE category = ?
       AND (entry_key LIKE ? OR entry_key LIKE ?)`,
    'analytics',
    '%analytics-v2:snapshot:%',
    '%analytics-v2%3Asnapshot%3A%',
  );
}
