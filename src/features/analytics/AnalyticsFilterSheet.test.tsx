import { fireEvent, render } from '@testing-library/react-native';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { AnalyticsFilterSheet } from './AnalyticsFilterSheet';
import { createAnalyticsFilters } from './analyticsFilters';
import { createOrderAnalyticsFilters } from './orderAnalytics';

describe('AnalyticsFilterSheet', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('applies a quick range and multiple stores in one request', async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    const screen = await render(<AnalyticsFilterSheet
      allowMultipleStores
      filters={createAnalyticsFilters('2026-07-18')}
      onApply={onApply}
      onClose={onClose}
      stores={[{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }]}
      today="2026-07-18"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '近10日' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 茅坡店' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 凤十二店' }));

    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      dateFrom: '2026-07-08',
      dateTo: '2026-07-17',
      granularity: 'day',
      includeCurrent: false,
      sourceType: 'all',
      storeKey: 'ALL',
      storeKeys: ['101', '102'],
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps shared insight filters single-store by default', async () => {
    const onApply = jest.fn();
    const screen = await render(<AnalyticsFilterSheet
      filters={createAnalyticsFilters('2026-07-18')}
      onApply={onApply}
      onClose={jest.fn()}
      stores={[{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }]}
      today="2026-07-18"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '选择门店 茅坡店' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 凤十二店' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ storeKey: '102', storeKeys: ['102'] }));
  });

  it('clears dashboard scope and period state when applying a shared insight filter', async () => {
    const onApply = jest.fn();
    const screen = await render(<AnalyticsFilterSheet
      filters={{
        ...createAnalyticsFilters('2026-07-18'),
        dateFrom: '2026-03-01',
        dateTo: '2026-07-17',
        granularity: 'month',
        includeCurrent: true,
        scopeKeys: ['dept:north'],
        storeKeys: ['101', '102'],
      }}
      onApply={onApply}
      onClose={jest.fn()}
      stores={[{ key: '201', label: '南坪店' }]}
      today="2026-07-18"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '近10日' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择门店 南坪店' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-07-08',
      dateTo: '2026-07-17',
      granularity: 'day',
      includeCurrent: false,
      storeKey: '201',
      storeKeys: ['201'],
    }));
    expect(onApply.mock.calls[0][0]).not.toHaveProperty('scopeKeys');
  });

  it('opens a calendar for custom dates and disables today and future dates', async () => {
    const screen = await render(<AnalyticsFilterSheet
      filters={createAnalyticsFilters('2026-07-18')}
      onApply={jest.fn()}
      onClose={jest.fn()}
      today="2026-07-18"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '自定义' }));

    expect(screen.getByTestId('analytics-calendar')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择日期 2026-07-17' }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByRole('button', { name: '选择日期 2026-07-18' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('selects day week or month and keeps department and child scopes independent', async () => {
    const onApply = jest.fn();
    const screen = await render(<AnalyticsFilterSheet
      allowMultipleStores
      filters={createAnalyticsFilters('2026-07-21')}
      onApply={onApply}
      onClose={jest.fn()}
      scopeTree={[{
        key: 'dept:north',
        type: 'department',
        label: '北区',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }]}
      showTrendPeriod
      today="2026-07-21"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '按周' }));
    await fireEvent.press(screen.getByRole('button', { name: '包含当前周' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择范围 北区' }));
    await fireEvent.press(screen.getByRole('button', { name: '选择范围 茅坡店' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-20',
      granularity: 'week',
      includeCurrent: true,
      scopeKeys: ['dept:north', 'shop:101'],
    }));
  });

  it('normalizes an order selection to one complete ISO week or natural month', async () => {
    const weeklyApply = jest.fn();
    const weekly = await render(<AnalyticsFilterSheet
      filters={createOrderAnalyticsFilters('2026-07-21')}
      onApply={weeklyApply}
      onClose={jest.fn()}
      periodSelection="single"
      today="2026-07-21"
      visible
    />);

    await fireEvent.press(weekly.getByRole('button', { name: '按周' }));
    await fireEvent.press(weekly.getByRole('button', { name: '确定' }));

    expect(weeklyApply).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-07-13',
      dateTo: '2026-07-19',
      granularity: 'week',
      includeCurrent: false,
    }));

    const monthlyApply = jest.fn();
    const monthly = await render(<AnalyticsFilterSheet
      filters={createOrderAnalyticsFilters('2026-07-21')}
      onApply={monthlyApply}
      onClose={jest.fn()}
      periodSelection="single"
      today="2026-07-21"
      visible
    />);

    await fireEvent.press(monthly.getByRole('button', { name: '按月' }));
    await fireEvent.press(monthly.getByRole('button', { name: '确定' }));

    expect(monthlyApply).toHaveBeenCalledWith(expect.objectContaining({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      granularity: 'month',
      includeCurrent: false,
    }));
  });

  it('keeps platform and channel mutually exclusive in order dimensions', async () => {
    const onApply = jest.fn();
    const screen = await render(<AnalyticsFilterSheet
      filters={createOrderAnalyticsFilters('2026-07-21')}
      onApply={onApply}
      onClose={jest.fn()}
      periodSelection="single"
      showOrderDimensions
      today="2026-07-21"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '订单维度 分店铺' }));
    await fireEvent.press(screen.getByRole('button', { name: '订单维度 分平台' }));
    await fireEvent.press(screen.getByRole('button', { name: '订单维度 堂食/外卖' }));
    await fireEvent.press(screen.getByRole('button', { name: '确定' }));

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ orderDimensions: ['shop', 'platform'] }));
  });

  it('shows a labor scope mapping warning before the user confirms the filter', async () => {
    const screen = await render(<AnalyticsFilterSheet
      allowMultipleStores
      filters={createAnalyticsFilters('2026-07-21')}
      onApply={jest.fn()}
      onClose={jest.fn()}
      scopeTree={[{ key: 'shop:unmapped', type: 'store', label: '未映射门店', store_key: '999' }]}
      scopeWarning={() => '所选经营范围未映射钉钉部门，无法纳入人效统计。'}
      showTrendPeriod
      today="2026-07-21"
      visible
    />);

    await fireEvent.press(screen.getByRole('button', { name: '选择范围 未映射门店' }));

    expect(screen.getByText('所选经营范围未映射钉钉部门，无法纳入人效统计。')).toBeTruthy();
  });
});
