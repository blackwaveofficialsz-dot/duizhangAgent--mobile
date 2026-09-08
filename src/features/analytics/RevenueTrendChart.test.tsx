import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { buildTrendOption, RevenueTrendChart } from './RevenueTrendChart';

const safeAreaMetrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 59 },
};

function renderChart(chart: React.ReactNode) {
  return render(<SafeAreaProvider initialMetrics={safeAreaMetrics}>{chart}</SafeAreaProvider>);
}

describe('RevenueTrendChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  it('hides redundant labels on both cross-axis pointers', () => {
    const option = buildTrendOption({
      orderCounts: [80],
      periods: ['2026-07-15'],
      series: [{ label: '净实收', primary: true, styleIndex: 0, values: [1200] }],
    }, semanticThemes.dark, 'currency') as {
      tooltip: { axisPointer: { label: Record<string, unknown> } };
      xAxis: { axisPointer: { label: Record<string, unknown> } };
      yAxis: { axisPointer: { label: Record<string, unknown> } };
    };

    expect(option.tooltip.axisPointer.label).toMatchObject({ show: false });
    expect(option.xAxis.axisPointer.label).toMatchObject({ show: false });
    expect(option.yAxis.axisPointer.label).toMatchObject({ show: false });
  });

  it('uses the approved soft palette and keeps moving-average nodes quiet', () => {
    const option = buildTrendOption({
      orderCounts: [80],
      periods: ['2026-07-15'],
      series: [
        { label: '净实收', primary: true, styleIndex: 0, values: [1200] },
        { label: 'MA7', primary: false, styleIndex: 1, values: [1100] },
      ],
    }, semanticThemes.dark, 'currency') as {
      series: Array<{
        itemStyle: { color: string };
        lineStyle: { color: string; width: number };
        showSymbol: boolean;
        symbolSize: number;
      }>;
    };

    expect(option.series[0]).toMatchObject({
      itemStyle: { color: '#d5efe3' },
      lineStyle: { color: '#d5efe3', width: 2.5 },
      showSymbol: true,
      symbolSize: 5,
    });
    expect(option.series[1]).toMatchObject({
      lineStyle: { color: '#5dbad2', width: 1.3 },
      showSymbol: false,
      symbolSize: 0,
    });
  });

  it('requests the dedicated fullscreen chart route from the dashboard chart', async () => {
    const onFullscreen = jest.fn();
    const screen = await renderChart(<RevenueTrendChart points={[
      { period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: null, missing: false },
      { period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: null, missing: false },
    ]} onFullscreen={onFullscreen} />);

    await fireEvent.press(screen.getByRole('button', { name: '全屏查看趋势' }));

    expect(onFullscreen).toHaveBeenCalledTimes(1);
  });

  it('matches the web dashboard revenue chart series', async () => {
    const screen = await renderChart(<RevenueTrendChart points={[
      { period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: 900, missing: false },
    ]} />);

    expect(screen.getByText('全部净实收趋势')).toBeTruthy();
    for (const label of ['净实收', 'MA7', 'MA30', 'MA180']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it('shows dine-in and takeout net revenue in the same chart', async () => {
    const screen = await renderChart(<RevenueTrendChart {...({
      comparison: {
        shop: [{ period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: 900, missing: false }],
        takeout: [{ period: '2026-07-15', net_income: 680, order_count: 42, ma7: 620, ma30: 580, ma180: 520, missing: false }],
      },
      points: [],
      title: '堂食/外卖净实收趋势',
    } as unknown as React.ComponentProps<typeof RevenueTrendChart>)} />);

    expect(screen.getAllByText('堂食').length).toBeGreaterThan(0);
    expect(screen.getAllByText('外卖').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));
    const detail = screen.getByTestId('revenue-chart-detail');
    expect(within(detail).getByText('1,200.00')).toBeTruthy();
    expect(within(detail).getByText('680.00')).toBeTruthy();
  });

  it('renders custom dashboard series with exact selected values', async () => {
    const screen = await renderChart(<RevenueTrendChart {...({
      points: [],
      series: [
        { label: '茅坡店 堂食', lineType: 'solid', primary: true, styleIndex: 0, points: [{ period: '2026-07-15', net_income: 1200, order_count: 80, ma7: null, ma30: null, ma180: null, missing: false }] },
        { label: '茅坡店 外卖', lineType: 'dashed', primary: true, styleIndex: 0, points: [{ period: '2026-07-15', net_income: 680, order_count: 42, ma7: null, ma30: null, ma180: null, missing: false }] },
      ],
    } as unknown as React.ComponentProps<typeof RevenueTrendChart>)} />);

    expect(screen.getAllByText('茅坡店 堂食').length).toBeGreaterThan(0);
    expect(screen.getAllByText('茅坡店 外卖').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));

    const detail = screen.getByTestId('revenue-chart-detail');
    expect(within(detail).getByText('1,200.00')).toBeTruthy();
    expect(within(detail).getByText('680.00')).toBeTruthy();
    expect(within(detail).getByText('订单 122')).toBeTruthy();
  });

  it('shows axes and the exact data for a selected business date', async () => {
    const onSelectPeriod = jest.fn();
    const screen = await renderChart(<RevenueTrendChart points={[
      { period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: 900, missing: false },
      { period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false },
    ]} onSelectPeriod={onSelectPeriod} />);

    expect(screen.getByTestId('revenue-chart-x-axis')).toBeTruthy();
    expect(screen.getByTestId('revenue-chart-y-axis')).toBeTruthy();
    expect(screen.getByLabelText('图表手势：仅点按')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));
    expect(onSelectPeriod).toHaveBeenCalledWith('2026-07-15');
    const detail = screen.getByTestId('revenue-chart-detail');
    expect(screen.queryByTestId('revenue-chart-side-layout')).toBeNull();
    expect(screen.queryByTestId('revenue-chart-side-detail')).toBeNull();
    expect(within(detail).getByText('2026-07-15')).toBeTruthy();
    expect(within(detail).getByText('订单 80')).toBeTruthy();
    expect(within(detail).getByText('1,200.00')).toBeTruthy();
  });

  it('falls back to the latest day when the portrait filter range changes', async () => {
    const screen = await renderChart(<RevenueTrendChart points={[
      { period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: 900, missing: false },
      { period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false },
    ]} />);
    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));

    await screen.rerender(<SafeAreaProvider initialMetrics={safeAreaMetrics}><RevenueTrendChart points={[
      { period: '2026-07-17', net_income: 2100, order_count: 130, ma7: 1300, ma30: 1100, ma180: 980, missing: false },
      { period: '2026-07-18', net_income: 2400, order_count: 145, ma7: 1450, ma30: 1180, ma180: 1010, missing: false },
    ]} /></SafeAreaProvider>);

    const detail = screen.getByTestId('revenue-chart-detail');
    expect(within(detail).getByText('2026-07-18')).toBeTruthy();
    expect(within(detail).getByText('订单 145')).toBeTruthy();
  });

  it('places selected metrics beside the plot in the fullscreen layout', async () => {
    const screen = await renderChart(<RevenueTrendChart detailPlacement="right" expanded points={[
      { period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, ma30: 1000, ma180: 900, missing: false },
      { period: '2026-07-16', net_income: 1800, order_count: 120, ma7: 1200, ma30: 1050, ma180: 950, missing: false },
    ]} />);

    expect(screen.getByTestId('revenue-chart-side-layout')).toHaveStyle({ flexDirection: 'row' });
    expect(screen.getByTestId('revenue-chart-plot-column')).toHaveStyle({ flex: 1 });
    expect(screen.getByLabelText('图表手势：完整')).toBeTruthy();
    const detail = screen.getByTestId('revenue-chart-side-detail');
    expect(detail).toHaveStyle({ position: 'relative', width: 208 });
    expect(within(detail).getByText('2026-07-16')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-15'));

    expect(within(detail).getByText('2026-07-15')).toBeTruthy();
    expect(within(detail).getByText('订单 80')).toBeTruthy();
  });

  it('toggles a stable legend series but keeps the final visible line', async () => {
    const onToggleSeries = jest.fn();
    const series = [
      { available: true, field: 'net_income', id: 'revenue:net', label: '净实收', primary: true, styleIndex: 0, points: [{ period: '2026-07-15', net_income: 1200, order_count: 80, missing: false }] },
      { available: true, field: 'ma7', id: 'revenue:ma7', label: 'MA7', primary: false, styleIndex: 1, points: [{ period: '2026-07-15', net_income: 1200, order_count: 80, ma7: 1100, missing: false }] },
    ];
    const screen = await renderChart(<RevenueTrendChart hiddenSeriesIds={['revenue:ma7']} onToggleSeries={onToggleSeries} points={[]} series={series} />);

    await fireEvent.press(screen.getByRole('button', { name: '显示 MA7' }));
    await fireEvent.press(screen.getByRole('button', { name: '隐藏 净实收' }));

    expect(onToggleSeries).toHaveBeenCalledTimes(1);
    expect(onToggleSeries).toHaveBeenCalledWith('revenue:ma7');
  });

  it('marks unavailable moving averages as disabled legend items', async () => {
    const screen = await renderChart(<RevenueTrendChart points={[]} series={[
      { available: true, field: 'net_income', id: 'revenue:net', label: '净实收', primary: true, styleIndex: 0, points: [{ period: '2026-W28', net_income: 1200, order_count: 80, missing: false }] },
      { available: false, field: 'ma12', id: 'revenue:ma12', label: 'MA12（数据不足 6/12）', primary: false, styleIndex: 1, points: [{ period: '2026-W28', net_income: 1200, order_count: 80, ma12: null, missing: false }] },
    ]} />);

    expect(screen.getByRole('button', { name: 'MA12（数据不足 6/12）不可用' }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('weights the fullscreen turnover summary by all point table counts while keeping selected values exact', async () => {
    const screen = await renderChart(<RevenueTrendChart detailPlacement="right" expanded points={[
      { period: '2026-07-15', net_income: 10, order_count: 100, total_table_count: 10, ma7: null, ma30: null, ma180: null, missing: false },
      { period: '2026-07-16', net_income: 3, order_count: 36, total_table_count: 12, ma7: null, ma30: null, ma180: null, missing: false },
    ]} valueMode="turnover" />);

    const detail = screen.getByTestId('revenue-chart-side-detail');
    expect(within(detail).getByText('6.18 次/桌')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('revenue-chart-point-2026-07-16'));

    expect(within(detail).getByText('3.00 次/桌')).toBeTruthy();
  });

  it('does not count moving-average table denominators in the turnover summary', async () => {
    const points = [
      { period: '2026-07-15', net_income: 10, order_count: 100, total_table_count: 10, ma7: 8, missing: false },
      { period: '2026-07-16', net_income: 3, order_count: 36, total_table_count: 12, ma7: 7, missing: false },
    ];
    const screen = await renderChart(<RevenueTrendChart detailPlacement="right" expanded points={[]} series={[
      { field: 'net_income', id: 'turnover', label: '翻台率', primary: true, styleIndex: 0, points },
      { field: 'ma7', id: 'turnover:ma7', label: 'MA7', primary: false, styleIndex: 1, points },
    ]} valueMode="turnover" />);

    expect(within(screen.getByTestId('revenue-chart-side-detail')).getByText('6.18 次/桌')).toBeTruthy();
  });
});
