import { migrateCacheDatabase } from './migrations';

describe('cache migrations', () => {
  it('drops incompatible analytics snapshots while preserving daily buckets and other categories', async () => {
    const database = {
      closeAsync: jest.fn(),
      execAsync: jest.fn(),
      getAllAsync: jest.fn(),
      getFirstAsync: jest.fn(),
      runAsync: jest.fn(),
      withExclusiveTransactionAsync: jest.fn(),
    };

    await migrateCacheDatabase(database);

    expect(database.execAsync).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE IF NOT EXISTS read_only_cache'));
    expect(database.runAsync).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM read_only_cache'),
      'analytics',
      '%analytics-v2:snapshot:%',
      '%analytics-v2%3Asnapshot%3A%',
    );
    expect(database.runAsync.mock.calls[0][0]).not.toContain('analytics-v2:daily');
  });
});
