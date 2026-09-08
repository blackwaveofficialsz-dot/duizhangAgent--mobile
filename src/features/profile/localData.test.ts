import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { useInsightDetailStore } from '@/features/analytics/insightDetailStore';
import { clearLocalAppData } from './localData';

const mockDeleteCache = jest.fn();
let mockCacheExists = true;

jest.mock('expo-file-system', () => ({ Paths: { cache: { delete: () => mockDeleteCache(), get exists() { return mockCacheExists; } } } }));

describe('clearLocalAppData', () => {
  beforeEach(() => {
    mockCacheExists = true;
    mockDeleteCache.mockReset();
  });

  it('removes tenant-scoped analytics and selected insight data', () => {
    useAnalyticsStore.setState({
      data: { tenant: 'old-tenant' } as never,
      error: 'old error',
      isOffline: true,
      lastSyncedAt: 123,
      mealStatus: 'error',
      selectedMealDate: '2026-07-16',
      status: 'error',
      stores: [{ key: 'old-store', label: '旧门店' }],
    });
    useInsightDetailStore.setState({
      isReadOnly: true,
      labor: { employee_id: 'old-user' } as never,
      order: { order_id: 'old-order' } as never,
      product: { product_id: 'old-product' } as never,
      productTrend: { product_key: 'old-product' } as never,
    });

    clearLocalAppData();

    expect(useAnalyticsStore.getState()).toMatchObject({
      data: null,
      error: null,
      isOffline: false,
      lastSyncedAt: null,
      mealStatus: 'idle',
      selectedMealDate: null,
      status: 'idle',
      stores: [],
    });
    expect(useInsightDetailStore.getState()).toMatchObject({
      isReadOnly: false,
      labor: null,
      order: null,
      product: null,
      productTrend: null,
    });
    expect(mockDeleteCache).toHaveBeenCalledTimes(1);
  });

  it('still resets business state and reports a temporary file deletion failure', () => {
    mockDeleteCache.mockImplementationOnce(() => { throw new Error('临时文件删除失败'); });
    useAnalyticsStore.setState({ data: { tenant: 'old-tenant' } as never });

    expect(() => clearLocalAppData()).toThrow('临时文件删除失败');

    expect(useAnalyticsStore.getState().data).toBeNull();
  });

  it('treats an already removed cache directory as clean', () => {
    mockCacheExists = false;

    expect(() => clearLocalAppData()).not.toThrow();
    expect(mockDeleteCache).not.toHaveBeenCalled();
  });
});
