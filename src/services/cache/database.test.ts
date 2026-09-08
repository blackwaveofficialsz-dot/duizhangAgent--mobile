import {
  CacheResetRequiredError,
  createCacheDatabaseManager,
  createSqliteCacheStorage,
} from './database';

const secureStore = {
  deleteItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
};

function createDatabase(cipherVersion: string | null, keyError?: Error) {
  const database = {
    closeAsync: jest.fn(),
    execAsync: jest.fn(async (sql: string) => {
      if (keyError && sql.startsWith('PRAGMA key')) throw keyError;
    }),
    getFirstAsync: jest.fn(async () => (cipherVersion ? { cipher_version: cipherVersion } : null)),
    getAllAsync: jest.fn(),
    runAsync: jest.fn(),
    withExclusiveTransactionAsync: jest.fn(),
  };
  database.withExclusiveTransactionAsync.mockImplementation(async (
    task: (transaction: Pick<typeof database, 'runAsync'>) => Promise<void>,
  ) => task(database));
  return database;
}

describe('cache database manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    secureStore.getItemAsync.mockResolvedValue('11'.repeat(32));
  });

  it('resets the cache instead of writing plaintext when SQLCipher is unavailable in development', async () => {
    const database = createDatabase(null);
    const deleteDatabase = jest.fn();
    const manager = createCacheDatabaseManager({
      appEnv: 'development',
      deleteDatabase,
      openDatabase: jest.fn().mockResolvedValue(database),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await expect(manager.open()).rejects.toBeInstanceOf(CacheResetRequiredError);
    expect(deleteDatabase).toHaveBeenCalledWith('blackwave-offline-cache.db');
  });

  it('resets instead of claiming encryption when SQLCipher is unavailable outside development', async () => {
    const database = createDatabase(null);
    const deleteDatabase = jest.fn();
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      deleteDatabase,
      openDatabase: jest.fn().mockResolvedValue(database),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await expect(manager.open()).rejects.toBeInstanceOf(CacheResetRequiredError);
    expect(deleteDatabase).toHaveBeenCalledWith('blackwave-offline-cache.db');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('blackwave-offline-cache-key-v1');
  });

  it('deletes the unreadable database and key when encryption setup fails', async () => {
    const database = createDatabase('4.6.0', new Error('file is not a database'));
    const deleteDatabase = jest.fn();
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      deleteDatabase,
      openDatabase: jest.fn().mockResolvedValue(database),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await expect(manager.open()).rejects.toBeInstanceOf(CacheResetRequiredError);
    expect(database.closeAsync).toHaveBeenCalled();
    expect(deleteDatabase).toHaveBeenCalledWith('blackwave-offline-cache.db');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('blackwave-offline-cache-key-v1');
  });

  it('validates that the configured key can read the existing database before returning it', async () => {
    const database = createDatabase('4.6.0');
    database.getFirstAsync
      .mockResolvedValueOnce({ cipher_version: '4.6.0' })
      .mockRejectedValueOnce(new Error('file is not a database'));
    const deleteDatabase = jest.fn();
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      deleteDatabase,
      openDatabase: jest.fn().mockResolvedValue(database),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await expect(manager.open()).rejects.toBeInstanceOf(CacheResetRequiredError);
    expect(database.getFirstAsync).toHaveBeenNthCalledWith(2, 'SELECT count(*) AS count FROM sqlite_master');
    expect(deleteDatabase).toHaveBeenCalledWith('blackwave-offline-cache.db');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('blackwave-offline-cache-key-v1');
  });

  it('deletes the database and its key during logout cleanup', async () => {
    const deleteDatabase = jest.fn();
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      deleteDatabase,
      openDatabase: jest.fn(),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await manager.clearForLogout();

    expect(deleteDatabase).toHaveBeenCalledWith('blackwave-offline-cache.db');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('blackwave-offline-cache-key-v1');
  });

  it('still clears the key when logout happens before the database is created', async () => {
    const deleteDatabase = jest.fn();
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      databaseExists: jest.fn(() => false),
      deleteDatabase,
      openDatabase: jest.fn(),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await manager.clearForLogout();

    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('blackwave-offline-cache-key-v1');
  });

  it('reports logout cleanup failure after attempting both database and key deletion', async () => {
    const deleteDatabase = jest.fn().mockRejectedValue(new Error('delete failed'));
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      deleteDatabase,
      openDatabase: jest.fn(),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });

    await expect(manager.clearForLogout()).rejects.toThrow('delete failed');
    expect(secureStore.deleteItemAsync).toHaveBeenCalledWith('blackwave-offline-cache-key-v1');
  });

  it('closes an opened database before deleting its file and key', async () => {
    let resolveClose!: () => void;
    const database = createDatabase('4.6.0');
    database.closeAsync.mockReturnValue(new Promise<void>((resolve) => { resolveClose = resolve; }));
    const deleteDatabase = jest.fn().mockResolvedValue(undefined);
    const manager = createCacheDatabaseManager({
      appEnv: 'production',
      deleteDatabase,
      openDatabase: jest.fn().mockResolvedValue(database),
      randomBytes: jest.fn().mockResolvedValue(new Uint8Array(32)),
      secureStore,
    });
    await manager.open();

    const clear = manager.clearForLogout();
    expect(deleteDatabase).not.toHaveBeenCalled();
    resolveClose();
    await clear;

    expect(deleteDatabase).toHaveBeenCalledWith('blackwave-offline-cache.db');
  });

  it('replaces a scoped category on the already-keyed connection inside one transaction', async () => {
    const database = createDatabase('4.6.0');
    const key = '22'.repeat(32);
    const storage = createSqliteCacheStorage(database, key);

    await storage.replaceCategory({ tenantId: 'tenant-1', userId: 'user-1' }, 'sessions', [{
      cachedAt: 10,
      category: 'sessions',
      expiresAt: 20,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      key: 'session-1',
      payload: '{}',
    }]);

    expect(database.withExclusiveTransactionAsync).not.toHaveBeenCalled();
    expect(database.execAsync).toHaveBeenNthCalledWith(1, 'BEGIN IMMEDIATE TRANSACTION');
    expect(database.runAsync).toHaveBeenNthCalledWith(
      1,
      'DELETE FROM read_only_cache WHERE tenant_id = ? AND user_id = ? AND category = ?',
      'tenant-1',
      'user-1',
      'sessions',
    );
    expect(database.runAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT OR REPLACE INTO read_only_cache'),
      'tenant-1',
      'user-1',
      'sessions',
      'session-1',
      '{}',
      10,
      20,
    );
    expect(database.execAsync).toHaveBeenNthCalledWith(2, 'COMMIT');
  });

  it('rolls back a failed category replacement and keeps later writes usable', async () => {
    const database = createDatabase('4.6.0');
    database.runAsync.mockRejectedValueOnce(new Error('write failed')).mockResolvedValue(undefined);
    const storage = createSqliteCacheStorage(database, '22'.repeat(32));

    await expect(storage.replaceCategory(
      { tenantId: 'tenant-1', userId: 'user-1' },
      'tasks',
      [],
    )).rejects.toThrow('write failed');
    await storage.upsert({
      cachedAt: 10,
      category: 'tasks',
      expiresAt: 20,
      identity: { tenantId: 'tenant-1', userId: 'user-1' },
      key: 'task-1',
      payload: '{}',
    });

    expect(database.execAsync).toHaveBeenNthCalledWith(1, 'BEGIN IMMEDIATE TRANSACTION');
    expect(database.execAsync).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(database.runAsync).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO read_only_cache'),
      'tenant-1',
      'user-1',
      'tasks',
      'task-1',
      '{}',
      10,
      20,
    );
  });

  it('waits for an active category replacement before reading from the keyed connection', async () => {
    let finishDelete!: () => void;
    const database = createDatabase('4.6.0');
    database.runAsync.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDelete = resolve; }));
    database.getAllAsync.mockResolvedValue([]);
    const storage = createSqliteCacheStorage(database, '22'.repeat(32));

    const replacement = storage.replaceCategory(
      { tenantId: 'tenant-1', userId: 'user-1' },
      'sessions',
      [],
    );
    await Promise.resolve();
    await Promise.resolve();
    const read = storage.readCategory({ tenantId: 'tenant-1', userId: 'user-1' }, 'sessions');

    expect(database.getAllAsync).not.toHaveBeenCalled();
    finishDelete();
    await replacement;
    await read;
    expect(database.getAllAsync).toHaveBeenCalledTimes(1);
  });
});
