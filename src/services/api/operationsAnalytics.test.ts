import { apiRequest } from './client';
import {
  getOperationsLabor,
  getOperationsOverview,
  getOperationsProducts,
} from './operationsAnalytics';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

describe('operations analytics API', () => {
  beforeEach(() => jest.mocked(apiRequest).mockReset().mockResolvedValue({}));

  it('serializes overview filters and repeated store keys', async () => {
    await getOperationsOverview({
      compare: 'previous',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      granularity: 'week',
      orderChannels: ['takeout'],
      platformCodes: [199254],
      storeKeys: ['101', '102'],
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/operations/overview?compare=previous&date_from=2026-07-01&date_to=2026-07-31&granularity=week&store_keys=101&store_keys=102&order_channels=takeout&platform_codes=199254',
      { signal: undefined },
    );
  });

  it('serializes product channel platform and paging filters', async () => {
    await getOperationsProducts({
      compare: 'previous',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      granularity: 'month',
      limit: 200,
      offset: 0,
      orderChannels: ['takeout'],
      platformIds: [1],
      productKeys: ['p-1', 'p-2'],
      storeKeys: ['101'],
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/operations/products?compare=previous&date_from=2026-07-01&date_to=2026-07-31&granularity=month&store_keys=101&order_channels=takeout&platform_ids=1&product_keys=p-1&product_keys=p-2&limit=200&offset=0',
      { signal: undefined },
    );
  });

  it('serializes labor filters and forwards the abort signal', async () => {
    const signal = new AbortController().signal;

    await getOperationsLabor({
      compare: 'previous',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-31',
      granularity: 'week',
      signal,
      storeKeys: ['102', '101'],
    });

    expect(apiRequest).toHaveBeenCalledWith(
      '/api/v1/analytics/operations/labor?compare=previous&date_from=2026-07-01&date_to=2026-07-31&granularity=week&store_keys=102&store_keys=101',
      { signal },
    );
  });
});
