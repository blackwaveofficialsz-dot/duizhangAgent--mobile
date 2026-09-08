import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { getProducts, getProductTrend, listPlatformDim, listStoreScopeTree } from '@/services/api/analytics';
import { getOperationsProducts } from '@/services/api/operationsAnalytics';
import { clearCachedAnalytics, readCachedAnalytics, saveCachedAnalytics } from '@/services/cache/offlineCache';
import { useNetworkStore } from '@/services/network/networkStore';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { createAnalyticsFilters, productAnalyticsCacheKey } from './analyticsFilters';
import { useAnalyticsStore } from './analyticsStore';
import { useInsightDetailStore } from './insightDetailStore';
import { ProductInsightScreen } from './ProductInsightScreen';
import type { StoreScopeNode } from './storeScope';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/services/api/analytics', () => ({ getProducts: jest.fn(), getProductTrend: jest.fn(), listPlatformDim: jest.fn(), listShopMappings: jest.fn().mockResolvedValue([]), listStoreScopeTree: jest.fn().mockResolvedValue({ nodes: [] }) }));
jest.mock('@/services/api/operationsAnalytics', () => ({ getOperationsProducts: jest.fn() }));
jest.mock('@/services/cache/offlineCache', () => ({ clearCachedAnalytics: jest.fn().mockResolvedValue(undefined), readCachedAnalytics: jest.fn().mockResolvedValue(null), saveCachedAnalytics: jest.fn().mockResolvedValue(undefined) }));

const mockPush = jest.fn();
const defaultSetComparisonMode = useAnalyticsStore.getState().setComparisonMode;
const productRows = [
  { order_count: 12, product_key: 'p-1', product_name: '招牌牛肉面', quantity: 15, sales_amount: 390, sales_share: 0.6 },
  { order_count: 8, product_key: 'p-2', product_name: '鲜肉馄饨', quantity: 10, sales_amount: 260, sales_share: 0.4 },
];

const scopeTree: StoreScopeNode[] = [{
  key: 'dept:north',
  label: '北区',
  type: 'department',
  children: [
    { key: 'shop:101', label: '茅坡店', store_key: '101', type: 'store' },
    { key: 'shop:102', label: '凤十二店', store_key: '102', type: 'store' },
  ],
}];

function trend(productKey: string) {
  return {
    date_from: '2026-06-15',
    date_to: '2026-07-19',
    dim_key: 'ALL',
    dim_type: 'all',
    metric: 'quantity' as const,
    points: [],
    product_key: productKey,
    product_name: productRows.find((row) => row.product_key === productKey)?.product_name ?? productKey,
  };
}

describe('ProductInsightScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({ hydrated: true, mode: 'light', resolvedMode: 'light', setMode: async () => {}, theme: semanticThemes.light });
    jest.mocked(useRouter).mockReturnValue({ push: mockPush } as never);
    jest.mocked(getProducts).mockResolvedValue({ bottom: [], top: productRows, total: 2 });
    jest.mocked(getProductTrend).mockImplementation(async (productKey) => trend(productKey));
    jest.mocked(getOperationsProducts).mockResolvedValue({ data_status: 'ok', items: [], limit: 0, offset: 0, previous_period: null, total: 0 });
    jest.mocked(listPlatformDim).mockResolvedValue([]);
    jest.mocked(listStoreScopeTree).mockResolvedValue({ nodes: scopeTree, source: 'test', store_count: 2 });
    jest.mocked(clearCachedAnalytics).mockReset().mockResolvedValue(undefined);
    jest.mocked(readCachedAnalytics).mockReset().mockResolvedValue(null);
    jest.mocked(saveCachedAnalytics).mockReset().mockResolvedValue(undefined);
    useNetworkStore.setState({ status: 'online' });
    useAnalyticsStore.setState({
      productFilters: {
        ...createAnalyticsFilters('2026-07-22'),
        dateFrom: '2026-06-15',
        dateTo: '2026-07-19',
        granularity: 'week',
        includeCurrent: false,
        scopeKeys: ['dept:north'],
        storeKey: 'ALL',
        storeKeys: ['101', '102'],
      },
      scopeTree,
      stores: [{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }],
      hiddenSeriesByChart: {},
      comparisonModeByModule: { dashboard: 'previous', labor: 'previous', orders: 'previous', products: 'previous' },
      selectedProductKeys: [],
      selectedPeriodByChart: {},
      selectedSeriesByChart: {},
      setComparisonMode: defaultSetComparisonMode,
    });
    useInsightDetailStore.getState().reset();
  });

  afterEach(() => jest.restoreAllMocks());

  it('requests the default full weeks and explicit selected stores for product trends', async () => {
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false, storeKeys: ['101', '102'] }),
      expect.objectContaining({ dimKey: 'ALL', dimType: 'all', granularity: 'week', includeCurrent: false, storeKeys: ['101', '102'], signal: expect.anything() }),
    ));
    await screen.unmount();
  });

  it('resolves product department scopes into request store keys when filters still carry ALL', async () => {
    useAnalyticsStore.setState({
      productFilters: {
        ...createAnalyticsFilters('2026-07-22'),
        dateFrom: '2026-06-15',
        dateTo: '2026-07-19',
        granularity: 'week',
        includeCurrent: false,
        scopeKeys: ['dept:north'],
        storeKey: 'ALL',
        storeKeys: ['ALL'],
      },
    });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getProducts).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-07-13', dateTo: '2026-07-19', scopeKeys: ['dept:north'], storeKeys: ['ALL'] }),
      expect.objectContaining({ periodSnapshot: true, storeKeys: ['101', '102'] }),
    ));
    await waitFor(() => expect(getOperationsProducts).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-07-13',
      dateTo: '2026-07-19',
      granularity: 'week',
      storeKeys: ['101', '102'],
    })));
    expect(getProductTrend).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({ dateFrom: '2026-06-15', dateTo: '2026-07-19', scopeKeys: ['dept:north'], storeKeys: ['ALL'] }),
      expect.objectContaining({ storeKeys: ['101', '102'] }),
    );
    await screen.unmount();
  });

  it('uses the latest detail period for product ranking and comparison while keeping trend on the full range', async () => {
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        dateFrom: '2026-07-13',
        dateTo: '2026-07-19',
        granularity: 'week',
        includeCurrent: false,
      }),
      expect.objectContaining({ storeKeys: ['101', '102'] }),
    ));
    await waitFor(() => expect(getOperationsProducts).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-07-13',
      dateTo: '2026-07-19',
      granularity: 'week',
      storeKeys: ['101', '102'],
    })));
    expect(getProductTrend).toHaveBeenCalledWith(
      'p-1',
      expect.objectContaining({
        dateFrom: '2026-06-15',
        dateTo: '2026-07-19',
        granularity: 'week',
      }),
      expect.anything(),
    );
    expect(screen.getByText('当前周期：2026-07-13 至 2026-07-19')).toBeTruthy();
    await screen.unmount();
  });

  it('defaults to the first two ranked products and keeps ranking visible if a trend request fails', async () => {
    jest.mocked(getProductTrend)
      .mockResolvedValueOnce({ ...trend('p-1'), points: [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 12, period: '2026-W28', quantity: 15, sales_amount: 390 }] })
      .mockRejectedValueOnce(new Error('第二条趋势失败'));
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-2', expect.anything(), expect.anything()));
    expect(useAnalyticsStore.getState().selectedProductKeys).toEqual(['p-1', 'p-2']);
    expect(screen.getByText('产品销售排名')).toBeTruthy();
    expect(screen.getByTestId('product-echart')).toBeTruthy();
    await screen.unmount();
  });

  it('keeps the successful product as a multi-product trend after the first selected trend fails', async () => {
    jest.mocked(getProductTrend)
      .mockRejectedValueOnce(new Error('第一条趋势失败'))
      .mockResolvedValueOnce({ ...trend('p-2'), points: [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 8, period: '2026-W28', quantity: 10, sales_amount: 260 }] });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText('多产品销量趋势')).toBeTruthy());
    expect(screen.getByRole('button', { name: '选择趋势产品 鲜肉馄饨' })).toBeTruthy();
    expect(screen.queryByText('每日销量 · MA7 / MA30 / MA180')).toBeNull();
    await screen.unmount();
  });

  it('keeps the remaining selected products when the picker removes one and never adds a sixth', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      order_count: index + 1,
      product_key: `p-${index + 1}`,
      product_name: `产品 ${index + 1}`,
      quantity: index + 2,
      sales_amount: (index + 1) * 10,
      sales_share: 0.1,
    }));
    jest.mocked(getProducts).mockResolvedValueOnce({ bottom: [], top: rows, total: 6 });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByRole('button', { name: '选择趋势产品 产品 1' })).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '选择趋势产品 产品 1' }));
    for (const productName of ['产品 3', '产品 4', '产品 5']) {
      await fireEvent.press(screen.getByRole('button', { name: `选择趋势产品 ${productName}` }));
    }
    await fireEvent.press(screen.getByRole('button', { name: '选择趋势产品 产品 6' }));
    expect(useAnalyticsStore.getState().selectedProductKeys).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);

    await fireEvent.press(screen.getByRole('button', { name: '移除趋势产品 产品 1' }));
    expect(useAnalyticsStore.getState().selectedProductKeys).toEqual(['p-2', 'p-3', 'p-4', 'p-5']);
    await screen.unmount();
  });

  it('clears old trends and loading when every selected product is removed during a pending request', async () => {
    let delayNextP2 = false;
    jest.mocked(getProductTrend).mockImplementation(async (productKey) => {
      if (delayNextP2 && productKey === 'p-2') return new Promise(() => {});
      return { ...trend(productKey), points: [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 2, period: '2026-W28', quantity: 3, sales_amount: 90 }] };
    });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByTestId('product-echart')).toBeTruthy());
    delayNextP2 = true;
    await fireEvent.press(screen.getByRole('button', { name: '选择趋势产品 招牌牛肉面' }));
    await fireEvent.press(screen.getByRole('button', { name: '移除趋势产品 招牌牛肉面' }));
    await waitFor(() => expect(getProductTrend).toHaveBeenLastCalledWith('p-2', expect.anything(), expect.anything()));
    await fireEvent.press(screen.getByRole('button', { name: '移除趋势产品 鲜肉馄饨' }));

    await waitFor(() => {
      expect(useAnalyticsStore.getState().selectedProductKeys).toEqual([]);
      expect(screen.queryByTestId('product-echart')).toBeNull();
      expect(screen.queryByText('正在加载')).toBeNull();
    });
    await screen.unmount();
  });

  it('renders server-provided sales comparison below the product summary', async () => {
    jest.mocked(getOperationsProducts).mockResolvedValueOnce({
      data_status: 'ok',
      items: [{ amount_share: 0.6, comparison: { sales_amount: { change_rate: 0.2, current: 390, difference: 65, previous: 325, status: 'comparable' } }, order_count: 12, product_key: 'p-1', product_name: '招牌牛肉面', quantity: 15, quantity_share: 0.6, sales_amount: 390 }],
      limit: 0,
      offset: 0,
      previous_period: { date_from: '2026-05-12', date_to: '2026-06-14' },
      total: 1,
    });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText(/较上期.*20\.00%/)).toBeTruthy());
    expect(screen.getByText('对比上期：2026-05-12 至 2026-06-14')).toBeTruthy();
    await waitFor(() => expect(jest.mocked(saveCachedAnalytics).mock.calls.some(([, cacheScope, payload]) => (
      String(cacheScope).includes('comparison_mode=previous')
      && (payload as { comparison?: { items?: Array<{ product_key: string }> } }).comparison?.items?.[0]?.product_key === 'p-1'
    ))).toBe(true));
    await screen.unmount();
  });

  it('uses the first currently selected product for the comparison summary', async () => {
    useAnalyticsStore.setState({ selectedProductKeys: ['p-2'] });
    jest.mocked(getOperationsProducts).mockResolvedValueOnce({
      data_status: 'ok',
      items: [{ amount_share: 0.4, comparison: { sales_amount: { change_rate: 0.1, current: 260, difference: 24, previous: 236, status: 'comparable' } }, order_count: 8, product_key: 'p-2', product_name: '鲜肉馄饨', quantity: 10, quantity_share: 0.4, sales_amount: 260 }],
      limit: 0, offset: 0, previous_period: null, total: 1,
    });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText(/较上期.*10\.00%/)).toBeTruthy());
    await screen.unmount();
  });

  it('clears the visible comparison when comparison mode is disabled', async () => {
    jest.mocked(getOperationsProducts).mockResolvedValueOnce({
      data_status: 'ok',
      items: [{ amount_share: 0.6, comparison: { sales_amount: { change_rate: 0.2, current: 390, difference: 65, previous: 325, status: 'comparable' } }, order_count: 12, product_key: 'p-1', product_name: '招牌牛肉面', quantity: 15, quantity_share: 0.6, sales_amount: 390 }],
      limit: 0, offset: 0, previous_period: null, total: 1,
    });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText(/较上期.*20\.00%/)).toBeTruthy());
    await fireEvent.press(screen.getByRole('button', { name: '不对比' }));
    await waitFor(() => expect(screen.queryByText(/较上期.*20\.00%/)).toBeNull());
    await screen.unmount();
  });

  it('passes the product comparison period as stable fullscreen identifiers', async () => {
    jest.mocked(getOperationsProducts).mockResolvedValueOnce({
      data_status: 'ok',
      items: [],
      limit: 0,
      offset: 0,
      previous_period: { date_from: '2026-06-08', date_to: '2026-06-14' },
      total: 0,
    });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getOperationsProducts).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: '全屏查看单品销量趋势' }));

    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
      pathname: '/chart',
      params: expect.objectContaining({
        comparisonDateFrom: '2026-06-08',
        comparisonDateTo: '2026-06-14',
        comparisonMode: 'previous',
      }),
    }));
    await screen.unmount();
  });

  it('does not restore an in-flight comparison after comparison mode switches to none', async () => {
    let resolveComparison: (value: Awaited<ReturnType<typeof getOperationsProducts>>) => void = () => {};
    useAnalyticsStore.setState({ setComparisonMode: jest.fn() });
    jest.mocked(getOperationsProducts).mockImplementationOnce(() => new Promise((resolve) => { resolveComparison = resolve; }));
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getOperationsProducts).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: '不对比' }));
    await act(async () => {
      resolveComparison({
        data_status: 'ok',
        items: [{ amount_share: 0.6, comparison: { sales_amount: { change_rate: 0.2, current: 390, difference: 65, previous: 325, status: 'comparable' } }, order_count: 12, product_key: 'p-1', product_name: '招牌牛肉面', quantity: 15, quantity_share: 0.6, sales_amount: 390 }],
        limit: 0, offset: 0, previous_period: null, total: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText(/较上期.*20\.00%/)).toBeNull();
    await screen.unmount();
  });

  it('keeps the selected product set when the refreshed ranking still contains it', async () => {
    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: '选择趋势产品 招牌牛肉面' })).toBeTruthy());

    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: '按月' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-2', expect.anything(), expect.anything()));
    expect(useAnalyticsStore.getState().selectedProductKeys).toEqual(['p-1', 'p-2']);
    await screen.unmount();
  });

  it('uses the expanded shop range for both ranking and trend requests', async () => {
    useAnalyticsStore.setState({
      productFilters: {
        ...createAnalyticsFilters('2026-07-22'),
        dateFrom: '2026-06-15',
        dateTo: '2026-07-19',
        granularity: 'week',
        includeCurrent: false,
        scopeKeys: ['ALL'],
      },
    });
    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(getProducts).toHaveBeenCalled());
    expect(screen.getByText(/整合 · 全部门店$/)).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: '选择分析维度 分店铺' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择范围 北区' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => {
      expect(getProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ scopeKeys: ['dept:north'], storeKeys: ['101', '102'] }),
        expect.objectContaining({ storeKeys: ['101', '102'] }),
      );
      expect(getProductTrend).toHaveBeenCalledWith(
        'p-2',
        expect.objectContaining({ scopeKeys: ['dept:north'], storeKeys: ['101', '102'] }),
        expect.objectContaining({ storeKeys: ['101', '102'] }),
      );
    });
    expect(screen.getByText(/· 北区$/)).toBeTruthy();
    await screen.unmount();
  });

  it('selects the new first product when the refreshed ranking removes the selected product', async () => {
    useAnalyticsStore.setState({ selectedProductKeys: ['p-2'] });
    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(getProductTrend).toHaveBeenCalledWith('p-2', expect.anything(), expect.anything()));
    jest.mocked(getProducts).mockResolvedValueOnce({
      bottom: [],
      top: [{ order_count: 3, product_key: 'p-3', product_name: '红油抄手', quantity: 4, sales_amount: 88, sales_share: 1 }],
      total: 1,
    });

    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    await fireEvent.press(screen.getByRole('button', { name: '按月' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    await waitFor(() => expect(getProductTrend).toHaveBeenLastCalledWith('p-3', expect.anything(), expect.anything()));
    await screen.unmount();
  });

  it('renders explicit product scopes without moving averages and persists their legend visibility', async () => {
    const comparisonScopeTree: StoreScopeNode[] = [
      ...scopeTree,
      { key: 'shop:201', label: '南坪店', store_key: '201', type: 'store' },
    ];
    useAnalyticsStore.setState({
      productFilters: {
        ...createAnalyticsFilters('2026-07-22'),
        dateFrom: '2026-06-15',
        dateTo: '2026-07-19',
        granularity: 'week',
        includeCurrent: false,
        scopeKeys: ['dept:north', 'shop:201'],
        storeKey: 'MULTI',
        storeKeys: ['101', '102', '201'],
      },
      scopeTree: comparisonScopeTree,
      selectedProductKeys: ['p-1'],
      stores: [{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }, { key: '201', label: '南坪店' }],
    });
    jest.mocked(listStoreScopeTree).mockResolvedValue({ nodes: comparisonScopeTree, source: 'test', store_count: 3 });
    jest.mocked(getProductTrend).mockResolvedValue({
      ...trend('p-1'),
      granularity: 'week',
      moving_averages: [{ available: true, available_periods: 4, field: 'ma4', label: 'MA4', window: 4 }],
      store_trends: {
        '101': [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 3, period: '2026-W28', quantity: 4, sales_amount: 88 }],
        '102': [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 2, period: '2026-W28', quantity: 3, sales_amount: 66 }],
        '201': [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 4, period: '2026-W28', quantity: 5, sales_amount: 110 }],
      },
    });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByRole('button', { name: '隐藏 北区' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '隐藏 南坪店' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '隐藏 MA4' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '隐藏 北区' }));
    expect(useAnalyticsStore.getState().hiddenSeriesByChart).toEqual({ 'product:trend': ['scope:dept:north'] });
    await fireEvent.press(screen.getByRole('button', { name: '隐藏 南坪店' }));
    expect(useAnalyticsStore.getState().hiddenSeriesByChart).toEqual({ 'product:trend': ['scope:dept:north'] });
    await screen.unmount();
  });

  it('stores the selected product period and series before opening fullscreen', async () => {
    jest.mocked(getProductTrend).mockResolvedValue({
      ...trend('p-1'),
      granularity: 'week',
      moving_averages: [{ available: true, available_periods: 2, field: 'ma4', label: 'MA4', window: 4 }],
      points: [
        { ma180: null, ma30: null, ma7: null, ma4: 4, missing: false, order_count: 3, period: '2026-W27', quantity: 5, sales_amount: 100 },
        { ma180: null, ma30: null, ma7: null, ma4: 7, missing: false, order_count: 6, period: '2026-W28', quantity: 9, sales_amount: 180 },
      ],
    });
    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(screen.getByTestId('product-echart')).toBeTruthy());

    await act(() => screen.getByTestId('product-echart').props.onDataIndexSelect(0, {
      dataIndex: 0,
      seriesId: 'product:ma4',
      seriesName: 'MA4',
    }));
    await fireEvent.press(screen.getByRole('button', { name: '全屏查看单品销量趋势' }));

    expect(useAnalyticsStore.getState().selectedPeriodByChart).toEqual({ 'product:trend': '2026-W27' });
    expect(useAnalyticsStore.getState().selectedSeriesByChart).toEqual({ 'product:trend': 'product:ma4' });
    expect(mockPush).toHaveBeenLastCalledWith({
      pathname: '/chart',
      params: expect.objectContaining({
        cacheKey: expect.stringContaining('product_keys=p-1%2Cp-2'),
        comparisonMode: 'previous',
        dateFrom: '2026-06-15',
        dateTo: '2026-07-19',
        dimKey: 'ALL',
        dimType: 'all',
        granularity: 'week',
        includeCurrent: 'false',
        productKey: 'p-1',
        selectedProductKeys: 'p-1,p-2',
        productScopes: expect.stringContaining('"key":"dept:north"'),
        scopeKeys: 'dept:north',
        sourceType: 'all',
        storeKeys: '101,102',
        type: 'product',
      }),
    });
    await screen.unmount();
  });

  it('shows an empty offline state when the exact product scope was never cached', async () => {
    useNetworkStore.setState({ status: 'offline' });
    useAnalyticsStore.setState({ selectedProductKeys: ['p-2'] });
    jest.mocked(readCachedAnalytics)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        data: { comparison: null, comparisonMode: 'previous', ranking: { bottom: [], top: productRows, total: 2 }, selectedProductKeys: ['p-1', 'p-2'], trends: {} },
        lastSyncedAt: Date.now(),
      });

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(readCachedAnalytics).toHaveBeenCalledWith(
      'products',
      expect.stringContaining('product_keys=p-2'),
      expect.any(Number),
    ));
    expect(screen.queryByText('招牌牛肉面')).toBeNull();
    expect(screen.queryByText('鲜肉馄饨')).toBeNull();
    await screen.unmount();
  });

  it('shows a stale product snapshot before the online ranking request resolves', async () => {
    const cachedProductDashboard = {
      comparison: null,
      comparisonMode: 'previous' as const,
      filters: useAnalyticsStore.getState().productFilters,
      ranking: { bottom: [], top: productRows, total: productRows.length },
      scope: { dimKey: 'ALL', dimType: 'all' as const },
      selectedProductKeys: ['p-1'],
      trends: { 'p-1': trend('p-1') },
    };
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: cachedProductDashboard, lastSyncedAt: Date.now() - 301_000 });
    jest.mocked(getProducts).mockReturnValue(new Promise(() => {}));

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getAllByText('招牌牛肉面').length).toBeGreaterThan(0));
    expect(getProducts).toHaveBeenCalled();
    await screen.unmount();
  });

  it('clears the exact stale product snapshot after a business error', async () => {
    const cachedProductDashboard = {
      comparison: null,
      comparisonMode: 'previous' as const,
      filters: useAnalyticsStore.getState().productFilters,
      ranking: { bottom: [], top: productRows, total: productRows.length },
      scope: { dimKey: 'ALL', dimType: 'all' as const },
      selectedProductKeys: ['p-1'],
      trends: { 'p-1': trend('p-1') },
    };
    jest.mocked(readCachedAnalytics).mockResolvedValue({ data: cachedProductDashboard, lastSyncedAt: Date.now() - 301_000 });
    jest.mocked(getProducts).mockRejectedValue(new Error('403 Forbidden'));

    const screen = await render(<ProductInsightScreen />);

    await waitFor(() => expect(screen.getByText('加载失败')).toBeTruthy());
    expect(clearCachedAnalytics).toHaveBeenCalledWith(
      'products',
      productAnalyticsCacheKey(
        { ...useAnalyticsStore.getState().productFilters, dateFrom: '2026-07-13', dateTo: '2026-07-19' },
        { dimKey: 'ALL', dimType: 'all' },
        ['p-1'],
        'previous',
      ),
      expect.any(Number),
    );
    expect(screen.queryAllByText('招牌牛肉面')).toHaveLength(0);
    await screen.unmount();
  });

  it('does not fall back to cache after a forced refresh fails', async () => {
    const screen = await render(<ProductInsightScreen />);
    await waitFor(() => expect(screen.getAllByText('招牌牛肉面').length).toBeGreaterThan(0));
    jest.mocked(readCachedAnalytics).mockClear();
    jest.mocked(getProducts).mockRejectedValueOnce(new Error('网络请求失败，请检查网络后重试'));

    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));

    await waitFor(() => expect(screen.getByText('网络请求失败，请检查网络后重试')).toBeTruthy());
    expect(clearCachedAnalytics).toHaveBeenCalledWith(
      'products',
      productAnalyticsCacheKey(
        { ...useAnalyticsStore.getState().productFilters, dateFrom: '2026-07-13', dateTo: '2026-07-19' },
        { dimKey: 'ALL', dimType: 'all' },
        ['p-1', 'p-2'],
        'previous',
      ),
      expect.any(Number),
    );
    expect(readCachedAnalytics).not.toHaveBeenCalled();
    await screen.unmount();
  });
});
