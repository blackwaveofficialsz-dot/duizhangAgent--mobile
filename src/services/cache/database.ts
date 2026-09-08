import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { readRuntimeConfig, type AppEnvironment } from '@/config/env';
import type { CacheCategory, CacheIdentity } from './cachePolicy';
import type { CacheEntry, CacheStorage } from './cacheRepositories';
import { migrateCacheDatabase } from './migrations';

export const CACHE_DATABASE_NAME = 'blackwave-offline-cache.db';
export const CACHE_DATABASE_KEY_NAME = 'blackwave-offline-cache-key-v1';

export type CacheSecurityMode = 'sqlcipher';
type CacheRow = {
  cached_at: number;
  category: CacheCategory;
  entry_key: string;
  expires_at: number;
  payload: string;
  tenant_id: string;
  user_id: string;
};

export type NativeCacheDatabase = {
  closeAsync(): Promise<void>;
  execAsync(sql: string): Promise<void>;
  getAllAsync(sql: string, ...params: Array<string | number>): Promise<unknown[]>;
  getFirstAsync(sql: string): Promise<Record<string, unknown> | null>;
  runAsync(sql: string, ...params: Array<string | number>): Promise<unknown>;
  withExclusiveTransactionAsync(
    task: (transaction: Pick<NativeCacheDatabase, 'execAsync' | 'runAsync'>) => Promise<void>,
  ): Promise<void>;
};

type SecureStoreAdapter = Pick<typeof SecureStore, 'deleteItemAsync' | 'getItemAsync' | 'setItemAsync'>;

export type CacheDatabaseDependencies = {
  appEnv: AppEnvironment;
  databaseName?: string;
  databaseExists?(databaseName: string): boolean;
  deleteDatabase(databaseName: string): Promise<void>;
  openDatabase(databaseName: string): Promise<NativeCacheDatabase>;
  randomBytes(length: number): Promise<Uint8Array>;
  secureStore: SecureStoreAdapter;
};

export class CacheResetRequiredError extends Error {
  constructor() {
    super('离线缓存已重置，请从服务端重新同步');
    this.name = 'CacheResetRequiredError';
  }
}

export function createCacheDatabaseManager(dependencies: CacheDatabaseDependencies) {
  const databaseName = dependencies.databaseName ?? CACHE_DATABASE_NAME;
  let openedDatabase: NativeCacheDatabase | null = null;

  const reset = async (bestEffort: boolean) => {
    const results: PromiseSettledResult<unknown>[] = [];
    if (openedDatabase) {
      results.push(...await Promise.allSettled([Promise.resolve(openedDatabase.closeAsync())]));
      openedDatabase = null;
    }
    const cleanup = [Promise.resolve(dependencies.secureStore.deleteItemAsync(CACHE_DATABASE_KEY_NAME))];
    if (dependencies.databaseExists?.(databaseName) ?? true) {
      cleanup.unshift(Promise.resolve(dependencies.deleteDatabase(databaseName)));
    }
    results.push(...await Promise.allSettled(cleanup));
    if (!bestEffort) {
      const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failure) throw failure.reason;
    }
  };

  return {
    async clearForLogout(): Promise<void> {
      await reset(false);
    },
    async open(): Promise<{ securityMode: CacheSecurityMode; storage: CacheStorage }> {
      let database: NativeCacheDatabase | null = null;
      try {
        database = await dependencies.openDatabase(databaseName);
        const key = await getOrCreateCacheKey(dependencies);
        await database.execAsync(`PRAGMA key = "x'${key}'"`);
        const cipher = await database.getFirstAsync('PRAGMA cipher_version');
        if (typeof cipher?.cipher_version !== 'string' || !cipher.cipher_version) {
          throw new Error('当前构建未启用 SQLCipher');
        }
        await database.getFirstAsync('SELECT count(*) AS count FROM sqlite_master');
        const securityMode = 'sqlcipher' as const;
        await migrateCacheDatabase(database);
        openedDatabase = database;
        return { securityMode, storage: createSqliteCacheStorage(database, key) };
      } catch {
        if (database) await Promise.resolve(database.closeAsync()).catch(() => undefined);
        await reset(true);
        throw new CacheResetRequiredError();
      }
    },
  };
}

export function createSqliteCacheStorage(database: NativeCacheDatabase, key: string): CacheStorage {
  void key;
  let writeQueue = Promise.resolve();
  const enqueueWrite = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = writeQueue.then(operation, operation);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    async clear(): Promise<void> {
      await enqueueWrite(() => database.runAsync('DELETE FROM read_only_cache').then(() => undefined));
    },
    async purgeExpired(now: number): Promise<void> {
      await enqueueWrite(() => database.runAsync('DELETE FROM read_only_cache WHERE expires_at < ?', now).then(() => undefined));
    },
    async readCategory(identity: CacheIdentity, category: CacheCategory): Promise<CacheEntry[]> {
      await writeQueue;
      const rows = await database.getAllAsync(
        `SELECT tenant_id, user_id, category, entry_key, payload, cached_at, expires_at
         FROM read_only_cache WHERE tenant_id = ? AND user_id = ? AND category = ?`,
        identity.tenantId,
        identity.userId,
        category,
      ) as CacheRow[];
      return rows.map(toCacheEntry);
    },
    async replaceCategory(identity: CacheIdentity, category: CacheCategory, entries: CacheEntry[]): Promise<void> {
      await enqueueWrite(async () => {
        await database.execAsync('BEGIN IMMEDIATE TRANSACTION');
        try {
          await database.runAsync(
            'DELETE FROM read_only_cache WHERE tenant_id = ? AND user_id = ? AND category = ?',
            identity.tenantId,
            identity.userId,
            category,
          );
          for (const entry of entries) await upsertCacheEntry(database, entry);
          await database.execAsync('COMMIT');
        } catch (error) {
          await database.execAsync('ROLLBACK').catch(() => undefined);
          throw error;
        }
      });
    },
    async upsert(entry: CacheEntry): Promise<void> {
      await enqueueWrite(() => upsertCacheEntry(database, entry));
    },
  };
}

let defaultManager: ReturnType<typeof createCacheDatabaseManager> | null = null;

export function openOfflineCache() {
  return getDefaultManager().open();
}

export function clearOfflineCacheForLogout(): Promise<void> {
  return getDefaultManager().clearForLogout();
}

function getDefaultManager() {
  defaultManager ??= createCacheDatabaseManager({
    appEnv: readRuntimeConfig().appEnv,
    databaseExists: (name) => new File(SQLite.defaultDatabaseDirectory, name).exists,
    deleteDatabase: SQLite.deleteDatabaseAsync,
    openDatabase: async (name) => SQLite.openDatabaseAsync(name) as unknown as NativeCacheDatabase,
    randomBytes: Crypto.getRandomBytesAsync,
    secureStore: SecureStore,
  });
  return defaultManager;
}

async function getOrCreateCacheKey(dependencies: CacheDatabaseDependencies): Promise<string> {
  const current = await dependencies.secureStore.getItemAsync(CACHE_DATABASE_KEY_NAME);
  if (current && /^[0-9a-f]{64}$/i.test(current)) return current;

  const key = Array.from(await dependencies.randomBytes(32), (byte) => byte.toString(16).padStart(2, '0')).join('');
  await dependencies.secureStore.setItemAsync(CACHE_DATABASE_KEY_NAME, key);
  return key;
}

async function upsertCacheEntry(database: Pick<NativeCacheDatabase, 'runAsync'>, entry: CacheEntry): Promise<void> {
  await database.runAsync(
    `INSERT OR REPLACE INTO read_only_cache
      (tenant_id, user_id, category, entry_key, payload, cached_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.identity.tenantId,
    entry.identity.userId,
    entry.category,
    entry.key,
    entry.payload,
    entry.cachedAt,
    entry.expiresAt,
  );
}

function toCacheEntry(row: CacheRow): CacheEntry {
  return {
    cachedAt: row.cached_at,
    category: row.category,
    expiresAt: row.expires_at,
    identity: { tenantId: row.tenant_id, userId: row.user_id },
    key: row.entry_key,
    payload: row.payload,
  };
}
