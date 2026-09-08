import { apiRequest } from './client';
import { getConnectorSyncRunRecords, type ConnectorRecordTable } from './connectors';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

describe('connectors API', () => {
  it('requests one encoded connector record page', async () => {
    const tablePage: ConnectorRecordTable = {
      columns: [{ field: 'store_name', label: '门店' }],
      rows: [{ store_name: '茅坡店' }],
      page: 2,
      page_size: 50,
      total: 1,
      total_pages: 1,
    };
    jest.mocked(apiRequest).mockResolvedValue(tablePage);

    await expect(getConnectorSyncRunRecords('run/1', 2, 50)).resolves.toEqual(tablePage);

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/connectors/sync-runs/run%2F1/records?page=2&page_size=50',
    );
  });
});
