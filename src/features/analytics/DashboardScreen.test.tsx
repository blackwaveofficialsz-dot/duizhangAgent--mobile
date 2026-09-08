import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { useNetworkStore } from '@/services/network/networkStore';
import { shareChartWorkbook } from '@/services/files/shareChart';
import { useAnalyticsStore } from './analyticsStore';
import { DashboardScreen } from './DashboardScreen';

jest.mock('./analyticsStore', () => ({ useAnalyticsStore: jest.fn() }));
jest.mock('@/services/files/shareChart', () => ({
  ...jest.requireActual('@/services/files/shareChart'),
  shareChartWorkbook: jest.fn().mockResolvedValue(undefined),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useRouter: () => ({ push: mockPush }) }));

const mockStore = useAnalyticsStore as unknown as jest.Mock;
let state: Record<string, unknown>;

describe('DashboardScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    jest.mocked(shareChartWorkbook).mockClear();
    useNetworkStore.setState({ status: 'online' });
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
    state = {
      data: {
        comparison: null,
        revenue: {
          date_from: '2026-06-17', date_to: '2026-07-16', store_key: 'ALL',
          points: [
            { period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: null, missing: false },
            { period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: null, missing: false },
          ],
        },
        revenueSources: {
          shop: {
            date_from: '2026-06-17', date_to: '2026-07-16', store_key: 'ALL',
            points: [{ period: '2026-07-16', net_income: 1100, order_count: 75, ma7: 900, ma30: 850, ma180: null, missing: false }],
          },
          takeout: {
            date_from: '2026-06-17', date_to: '2026-07-16', store_key: 'ALL',
            points: [{ period: '2026-07-16', net_income: 700, order_count: 45, ma7: 600, ma30: 550, ma180: null, missing: false }],
          },
        },
        mealPeriods: { business_date: '2026-07-16', store_key: 'ALL', periods: [] },
        mealTrend: {
          date_from: '2026-06-17', date_to: '2026-07-16', store_key: 'ALL',
          points: [mealTrendPoint('2026-07-15', 1200, 80), mealTrendPoint('2026-07-16', 1800, 120)],
        },
        turnover: {
          data_status: 'ok', eligible_store_count: 2, table_count: 18,
          points: [
            { date: '2026-07-15', lunch: { ma7: 2.1, ma30: 2, ma180: 1.8, shop_order_count: 80, turnover: 2.2 } },
            { date: '2026-07-16', lunch: { ma7: 2.2, ma30: 2.05, ma180: 1.82, shop_order_count: 120, turnover: 2.3 } },
          ],
          summary: [{ avg_daily_turnover: 2.25, period_key: 'lunch', period_label: '午餐', shop_order_count: 200 }],
        },
      },
      error: null,
      comparisonDisplayModeByModule: { dashboard: 'percentage' },
      comparisonModeByModule: { dashboard: 'previous' },
      dashboardFilters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      filters: { dateFrom: '2026-06-17', dateTo: '2026-07-16', sourceType: 'all', storeKey: 'ALL', storeKeys: ['ALL'] },
      hiddenSeriesByChart: {},
      loadScopes: jest.fn(),
      loadStores: jest.fn(),
      mealStatus: 'idle',
      selectedMealDate: '2026-07-16',
      selectMealDate: jest.fn(),
      scopeTree: [],
      selectedPeriodByChart: {},
      stores: [
        { key: '101', label: '茅坡店' },
        { key: '102', label: '凤城十二路店' },
      ],
      status: 'idle',
      refresh: jest.fn(),
      refreshComparison: jest.fn(),
      setComparisonDisplayMode: jest.fn(),
      setComparisonMode: jest.fn(),
      setDashboardFilters: jest.fn(),
      setFilters: jest.fn(),
      setSelectedChartPeriod: jest.fn(),
      syncSeriesVisibility: jest.fn(),
      toggleSeriesVisibility: jest.fn(),
    };
    mockStore.mockImplementation((selector?: (value: typeof state) => unknown) => selector ? selector(state) : state);
  });

  it('shows mobile KPI priorities and opens the filter sheet', async () => {
    const screen = await render(<DashboardScreen />);

    expect(screen.getByText('经营看板')).toBeTruthy();
    expect(screen.getByText('周期净实收')).toBeTruthy();
    expect(screen.getAllByText('1,800.00').length).toBeGreaterThan(0);
    expect(screen.getByText('周期订单')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();

    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);
    expect(screen.getByText('筛选条件')).toBeTruthy();
  });

  it('uses the latest dashboard detail period for cards while keeping the trend range visible', async () => {
    state = {
      ...state,
      dashboardFilters: { ...state.dashboardFilters as object, dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false },
      data: {
        ...state.data as object,
        revenue: {
          ...(state.data as { revenue: object }).revenue,
          date_from: '2026-06-15',
          date_to: '2026-07-19',
          granularity: 'week',
          points: [
            { period: '2026-W28', period_start: '2026-07-06', period_end: '2026-07-12', net_income: 2400, order_count: 160, missing: false },
            { period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false },
          ],
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    expect(screen.getByText('当前周期：2026-07-13 至 2026-07-19')).toBeTruthy();
    expect(screen.getByText('周期净实收')).toBeTruthy();
    expect(screen.getAllByText('3,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText('周期订单')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
    expect(screen.getByText(/06-15 至 07-19 · 按周/)).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: '切换经营看板周期 2026-07-06 至 2026-07-12' }));

    expect(state.setSelectedChartPeriod).toHaveBeenCalledWith('dashboard:revenue', '2026-07-06');
    expect(state.refreshComparison).toHaveBeenCalledTimes(1);
  });

  it('renders the actual previous period and percentage comparison', async () => {
    state = {
      ...state,
      data: {
        ...(state.data as object),
        comparison: {
          period: { date_from: '2026-07-20', date_to: '2026-07-20' },
          previous_period: { date_from: '2026-07-19', date_to: '2026-07-19' },
          metrics: {
            net_income: { current: 1200, previous: 1000, difference: 200, change_rate: 0.2, status: 'comparable' },
          },
          latest_metrics: {
            order_count: { current: 80, previous: 70, difference: 10, change_rate: 0.142857, status: 'comparable' },
          },
          channels: [],
          platforms: [],
          stores: [],
          store_channels: [],
        },
      },
    };

    const screen = await render(<DashboardScreen />);

    expect(screen.getByText('较上期 +20.00%')).toBeTruthy();
    expect(screen.getByText('对比上期：2026-07-19 至 2026-07-19')).toBeTruthy();
  });

  it('does not repeat module navigation links below the dashboard content', async () => {
    const screen = await render(<DashboardScreen />);

    expect(screen.queryByText('经营分析')).toBeNull();
    expect(screen.queryByRole('button', { name: '订单统计' })).toBeNull();
    expect(screen.queryByRole('button', { name: '产品' })).toBeNull();
    expect(screen.queryByRole('button', { name: '人效' })).toBeNull();
  });

  it('opens the trend in the root-level landscape route', async () => {
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '全屏查看营收趋势' }));

    expect(screen.getByTestId('revenue-echart')).toHaveStyle({ height: 164 });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/chart', params: { comparisonMode: 'previous', revenueMode: 'net', type: 'revenue' } });
  });

  it('passes dashboard comparison period as stable identifiers to fullscreen', async () => {
    state = {
      ...state,
      data: {
        ...(state.data as object),
        comparison: {
          period: { date_from: '2026-07-16', date_to: '2026-07-16' },
          previous_period: { date_from: '2026-07-15', date_to: '2026-07-15' },
          metrics: { net_income: { current: 1800, previous: 1200, difference: 600, change_rate: 0.5, status: 'comparable' } },
          channels: [],
          platforms: [],
          stores: [],
          store_channels: [],
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '全屏查看营收趋势' }));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/chart',
      params: expect.objectContaining({
        comparisonDateFrom: '2026-07-15',
        comparisonDateTo: '2026-07-15',
        comparisonMode: 'previous',
        revenueMode: 'net',
        type: 'revenue',
      }),
    });
  });

  it('passes dashboard previous period to the portrait chart workbook', async () => {
    state = {
      ...state,
      data: {
        ...(state.data as object),
        comparison: {
          period: { date_from: '2026-07-16', date_to: '2026-07-16' },
          previous_period: { date_from: '2026-07-15', date_to: '2026-07-15' },
          metrics: { net_income: { current: 1800, previous: 1200, difference: 600, change_rate: 0.5, status: 'comparable' } },
          channels: [],
          platforms: [],
          stores: [],
          store_channels: [],
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: /导出营收趋势/ }));
    await fireEvent.press(screen.getByRole('button', { name: '导出 XLSX' }));

    await waitFor(() => expect(shareChartWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      previousPeriod: { date_from: '2026-07-15', date_to: '2026-07-15' },
    })));
  });

  it('keeps the revenue and meal chart switches visible below their titles', async () => {
    const screen = await render(<DashboardScreen />);

    expect(screen.getByRole('button', { name: '净实收' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: '堂食 · 外卖' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '经营' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: '翻台率' })).toBeTruthy();
    for (const label of ['早餐', '午餐', '下午茶', '晚餐', '夜宵']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    await fireEvent.press(screen.getByRole('button', { name: '堂食 · 外卖' }));
    expect(screen.getAllByText('堂食').length).toBeGreaterThan(0);
    expect(screen.getAllByText('外卖').length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByRole('button', { name: '翻台率' }));
    expect(screen.getByText('2.30 次/桌')).toBeTruthy();
    expect(screen.getByText('有效 2 家门店 · 共 18 桌 · 排除 0 家 · 仅统计堂食订单')).toBeTruthy();
  });

  it('uses the preview KPI split layout', async () => {
    const screen = await render(<DashboardScreen />);

    expect(screen.getByTestId('dashboard-kpi-layout')).toHaveStyle({ flexDirection: 'row' });
  });

  it('updates the meal-period section when a revenue date is selected', async () => {
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));

    expect(state.selectMealDate).toHaveBeenCalledWith('2026-07-15');
  });

  it('reloads comparison for the revenue period selected from the chart', async () => {
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));

    expect(state.setSelectedChartPeriod).toHaveBeenCalledWith('dashboard:revenue', '2026-07-15');
    expect(state.refreshComparison).toHaveBeenCalledTimes(1);
  });

  it('offers the confirmed stores in the filter sheet', async () => {
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);

    expect(screen.getByRole('button', { name: '选择门店 茅坡店' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择门店 凤城十二路店' })).toBeTruthy();
  });

  it('allows retrying cached analytics when the device remains online', async () => {
    state = { ...state, isOffline: true, lastSyncedAt: Date.parse('2026-07-16T15:05:00+08:00') };
    const screen = await render(<DashboardScreen />);

    expect(screen.getByText(/离线查看/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));
    expect(state.refresh).toHaveBeenCalledWith(true);
    expect(state.loadStores).toHaveBeenCalledTimes(2);
    expect(state.loadScopes).toHaveBeenCalledTimes(2);
  });

  it('identifies stale local cache after a non-network refresh failure', async () => {
    state = { ...state, dataSource: 'local-cache', error: '请求失败（403）', isOffline: false, status: 'error' };
    const screen = await render(<DashboardScreen />);

    expect(screen.getByText('刷新失败，当前为缓存数据')).toBeTruthy();
  });

  it('disables real-time actions immediately when the device is offline', async () => {
    state = { ...state, isOffline: false, lastSyncedAt: Date.parse('2026-07-16T15:05:00+08:00') };
    useNetworkStore.setState({ status: 'offline' });
    const screen = await render(<DashboardScreen />);

    expect(screen.getByText(/离线查看/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '强制刷新' }));
    expect(state.refresh).not.toHaveBeenCalledWith(true);
  });

  it('blocks force refresh until connectivity is confirmed', async () => {
    useNetworkStore.setState({ status: 'unknown' });
    const screen = await render(<DashboardScreen />);
    const refresh = screen.getByRole('button', { name: '强制刷新' });

    expect(refresh.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(refresh);
    expect(state.refresh).not.toHaveBeenCalledWith(true);
  });

  it('shows the offline state without a retry command when no cache exists', async () => {
    state = { ...state, data: null, dataSource: null, isOffline: true, status: 'idle' };
    useNetworkStore.setState({ status: 'offline' });

    const screen = await render(<DashboardScreen />);

    expect(screen.getByText('当前处于离线状态')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '重新加载' })).toBeNull();
  });

  it('uses weekly KPI labels and does not load a meal day from a weekly point', async () => {
    state = {
      ...state,
      dashboardFilters: { ...state.dashboardFilters as object, dateFrom: '2026-06-15', dateTo: '2026-07-19', granularity: 'week', includeCurrent: false },
      data: {
        ...state.data as object,
        revenue: {
          ...(state.data as { revenue: object }).revenue,
          date_from: '2026-06-15',
          date_to: '2026-07-19',
          granularity: 'week',
          points: [{ period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 3000, order_count: 200, missing: false }],
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    expect(screen.getByText('当前周期：2026-07-13 至 2026-07-19')).toBeTruthy();
    expect(screen.getByText('周期净实收')).toBeTruthy();
    expect(screen.getByText('周期订单')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-W29'));
    expect(state.selectMealDate).not.toHaveBeenCalled();
  });

  it('offers the department scope tree in dashboard filters', async () => {
    state = {
      ...state,
      scopeTree: [{
        key: 'dept:north',
        type: 'department',
        label: '北区',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }],
    };
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getAllByRole('button', { name: '打开筛选' })[0]);

    expect(screen.getByRole('button', { name: '按周' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择范围 北区' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择范围 茅坡店' })).toBeTruthy();
  });

  it('shows selected meal business scopes and their point details', async () => {
    state = {
      ...state,
      dashboardFilters: { ...state.dashboardFilters as object, scopeKeys: ['dept:business-1', 'shop:201'], storeKeys: ['101', '102', '201'] },
      scopeTree: [{
        key: 'dept:business-1',
        type: 'department',
        label: '事业一部',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }, { key: 'shop:201', type: 'store', label: '南坪店', store_key: '201' }],
      data: {
        ...(state.data as object),
        mealTrend: {
          ...((state.data as { mealTrend: object }).mealTrend),
          store_trends: {
            '101': [mealTrendPoint('2026-07-15', 1000, 80)],
            '102': [mealTrendPoint('2026-07-15', 800, 60)],
            '201': [mealTrendPoint('2026-07-15', 700, 50)],
          },
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    expect(screen.getAllByText('事业一部').length).toBeGreaterThan(0);
    expect(screen.getAllByText('南坪店').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('meal-chart-point-2026-07-15'));
    const detail = screen.getByTestId('meal-chart-detail');
    expect(within(detail).getByText('2026-07-15')).toBeTruthy();
    expect(within(detail).getByText('午餐 · 元')).toBeTruthy();
    expect(within(detail).getByText('1,800.00')).toBeTruthy();
    expect(within(detail).getByText('700.00')).toBeTruthy();
  });

  it('recalculates selected turnover scopes and opens excluded-store details', async () => {
    state = {
      ...state,
      dashboardFilters: { ...state.dashboardFilters as object, scopeKeys: ['dept:business-1', 'shop:201'], storeKeys: ['101', '102', '201'] },
      scopeTree: [{
        key: 'dept:business-1',
        type: 'department',
        label: '事业一部',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }, { key: 'shop:201', type: 'store', label: '南坪店', store_key: '201' }],
      data: {
        ...(state.data as object),
        turnover: {
          data_status: 'ok',
          eligible_store_count: 2,
          table_count: 22,
          excluded_stores: [{ reason: '未配置桌台数', store_key: '102', store_label: '凤十二店' }],
          points: [],
          summary: [],
          store_summaries: [
            { store_key: '101', store_label: '茅坡店', table_count: 10, summary: [{ avg_daily_turnover: 0, period_key: 'lunch', period_label: '午餐', shop_order_count: 100 }] },
            { store_key: '102', store_label: '凤十二店', table_count: 0, summary: [{ avg_daily_turnover: 0, period_key: 'lunch', period_label: '午餐', shop_order_count: 500 }] },
            { store_key: '201', store_label: '南坪店', table_count: 12, summary: [{ avg_daily_turnover: 0, period_key: 'lunch', period_label: '午餐', shop_order_count: 36 }] },
          ],
          store_trends: {
            '101': [turnoverTrendPoint('2026-07-16', 100)],
            '102': [turnoverTrendPoint('2026-07-16', 500)],
            '201': [turnoverTrendPoint('2026-07-16', 36)],
          },
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '翻台率' }));

    expect(screen.getAllByText('事业一部').length).toBeGreaterThan(0);
    expect(screen.getAllByText('南坪店').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('meal-chart-point-2026-07-16'));
    const detail = screen.getByTestId('meal-chart-detail');
    expect(within(detail).getByText('10.00 次/桌')).toBeTruthy();
    expect(within(detail).getByText('3.00 次/桌')).toBeTruthy();
    expect(screen.getByText('有效 2 家门店 · 共 22 桌 · 排除 1 家 · 仅统计堂食订单')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '查看已排除门店' }));
    expect(screen.getByText('未配置桌台数')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '关闭已排除门店' }));
  });

  it('shows a turnover empty state when the selected scope has no valid tables', async () => {
    state = {
      ...state,
      dashboardFilters: { ...state.dashboardFilters as object, scopeKeys: ['shop:102'], storeKeys: ['102'] },
      scopeTree: [{ key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' }],
      data: {
        ...(state.data as object),
        turnover: {
          data_status: 'ok',
          eligible_store_count: 0,
          table_count: 0,
          excluded_stores: [{ reason: '未配置桌台数', store_key: '102', store_label: '凤十二店' }],
          points: [],
          summary: [],
          store_summaries: [{ store_key: '102', store_label: '凤十二店', table_count: 0, summary: [] }],
          store_trends: { '102': [turnoverTrendPoint('2026-07-16', 500)] },
        },
      },
    };
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByRole('button', { name: '翻台率' }));

    expect(screen.getByText('所选范围暂无有效桌台配置，无法计算翻台率')).toBeTruthy();
    expect(screen.queryByText('0.00 次/桌')).toBeNull();
  });

  it('labels a single meal scope in the selected detail', async () => {
    state = {
      ...state,
      dashboardFilters: { ...state.dashboardFilters as object, scopeKeys: ['dept:north'], storeKeys: ['101', '102'] },
      scopeTree: [{
        key: 'dept:north',
        type: 'department',
        label: '北区',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }],
    };
    const screen = await render(<DashboardScreen />);

    await fireEvent.press(screen.getByTestId('meal-chart-point-2026-07-16'));

    const detail = screen.getByTestId('meal-chart-detail');
    expect(within(detail).getByText('北区')).toBeTruthy();
    expect(within(detail).getByText('2026-07-16')).toBeTruthy();
    expect(within(detail).getByText('午餐 · 元')).toBeTruthy();
    expect(within(detail).getByText('1,800.00')).toBeTruthy();
  });
});

function mealTrendPoint(date: string, netIncome: number, orderCount: number) {
  const row = (period_key: 'breakfast' | 'lunch' | 'afternoon_tea' | 'dinner' | 'late_night', period_label: string) => ({
    avg_order_value: 0,
    income_amount: period_key === 'lunch' ? netIncome : 0,
    ma180: netIncome - 300,
    ma30: netIncome - 200,
    ma7: netIncome - 100,
    net_income: period_key === 'lunch' ? netIncome : 0,
    order_count: period_key === 'lunch' ? orderCount : 0,
    paid_amount: period_key === 'lunch' ? netIncome : 0,
    period_key,
    period_label,
    refund_amount: 0,
  });
  return {
    date,
    afternoon_tea: row('afternoon_tea', '下午茶'),
    breakfast: row('breakfast', '早餐'),
    dinner: row('dinner', '晚餐'),
    late_night: row('late_night', '夜宵'),
    lunch: row('lunch', '午餐'),
  };
}

function turnoverTrendPoint(date: string, lunchOrders: number) {
  const empty = { ma180: null, ma30: null, ma7: null, shop_order_count: 0, turnover: 0 };
  return {
    date,
    afternoon_tea: empty,
    breakfast: empty,
    dinner: empty,
    late_night: empty,
    lunch: { ma180: null, ma30: null, ma7: null, shop_order_count: lunchOrders, turnover: 0 },
  };
}
