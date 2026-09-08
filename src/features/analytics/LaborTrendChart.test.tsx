import { act, fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { buildLaborTrendOption, LaborTrendChart, visibleLaborTrendPoints } from './LaborTrendChart';
import type { LaborComparisonSeries } from './laborChartModels';

const safeAreaMetrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 59 },
};

const points = [
  {
    actual_hours: 38,
    actual_hours_ma7: 36,
    actual_hours_ma30: 35,
    actual_hours_ma180: 34,
    actual_revenue_per_hour: 242,
    actual_revenue_per_hour_ma7: 236,
    actual_revenue_per_hour_ma30: 232,
    actual_revenue_per_hour_ma180: 228,
    headcount: 12,
    missing: false,
    net_revenue: 9196,
    period: '2026-07-17',
    planned_hours: 40,
    planned_hours_ma7: 39,
    planned_hours_ma30: 38,
    planned_hours_ma180: 37,
    planned_revenue_per_hour: 230,
    planned_revenue_per_hour_ma7: 228,
    planned_revenue_per_hour_ma30: 225,
    planned_revenue_per_hour_ma180: 222,
  },
  {
    actual_hours: 42,
    actual_hours_ma7: 38,
    actual_hours_ma30: 36,
    actual_hours_ma180: 35,
    actual_revenue_per_hour: 250,
    actual_revenue_per_hour_ma7: 239,
    actual_revenue_per_hour_ma30: 234,
    actual_revenue_per_hour_ma180: 229,
    headcount: 13,
    missing: false,
    net_revenue: 10500,
    period: '2026-07-18',
    planned_hours: 41,
    planned_hours_ma7: 40,
    planned_hours_ma30: 39,
    planned_hours_ma180: 38,
    planned_revenue_per_hour: 256,
    planned_revenue_per_hour_ma7: 231,
    planned_revenue_per_hour_ma30: 227,
    planned_revenue_per_hour_ma180: 224,
  },
];

function renderChart(chart: React.ReactNode) {
  return render(<SafeAreaProvider initialMetrics={safeAreaMetrics}>{chart}</SafeAreaProvider>);
}

describe('LaborTrendChart', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'dark',
      resolvedMode: 'dark',
      setMode: async () => {},
      theme: semanticThemes.dark,
    });
  });

  it('uses the approved soft series and hides moving-average nodes', () => {
    const option = buildLaborTrendOption(points, 'hours', semanticThemes.dark) as {
      series: Array<{ itemStyle: { color: string }; lineStyle: { width: number }; name: string; showSymbol: boolean; symbolSize: number }>;
      xAxis: { data: string[] };
      yAxis: { name: string };
    };

    expect(option.xAxis.data).toEqual(['2026-07-17', '2026-07-18']);
    expect(option.yAxis.name).toBe('工时（小时）');
    expect(option.series[0]).toMatchObject({ itemStyle: { color: '#d5efe3' }, lineStyle: { width: 2.4 }, name: '实际工时', showSymbol: true, symbolSize: 5 });
    expect(option.series[1]).toMatchObject({ itemStyle: { color: '#e6b86f' }, name: '排班工时', showSymbol: true, symbolSize: 5 });
    expect(option.series[2]).toMatchObject({ lineStyle: { width: 1.1 }, name: '实际 MA7', showSymbol: false, symbolSize: 0 });
  });

  it('shows dynamic moving averages as readable MA labels', async () => {
    const movingAverages = [
      { available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'ACTUAL_HOURS_MA4', window: 4 },
      { available: true, available_periods: 5, field: 'planned_hours_ma4', label: 'PLANNED_HOURS_MA4', window: 4 },
    ];
    const dynamicPoints = points.map((point) => ({ ...point, actual_hours_ma4: 37, planned_hours_ma4: 39 }));

    const screen = await renderChart(<LaborTrendChart metric="hours" movingAverages={movingAverages} points={dynamicPoints} />);
    const option = buildLaborTrendOption(dynamicPoints, 'hours', semanticThemes.dark, movingAverages) as { series: Array<{ name: string }> };

    expect(screen.getByText('实际 / 排班 · MA4')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 实际 MA4' })).toBeTruthy();
    expect(option.series.map((series) => series.name)).toEqual(['实际工时', '排班工时', '实际 MA4', '排班 MA4']);
  });

  it('keeps multiple dynamic moving-average windows visually distinct', () => {
    const movingAverages = [4, 12, 26].map((window) => ({ available: true, available_periods: 30, field: `actual_hours_ma${window}`, label: `MA${window}`, window }));
    const dynamicPoints = points.map((point) => ({ ...point, actual_hours_ma4: 37, actual_hours_ma12: 36, actual_hours_ma26: 35 }));

    const option = buildLaborTrendOption(dynamicPoints, 'hours', semanticThemes.dark, movingAverages, [], 'week') as { series: Array<{ itemStyle: { color: string }; name: string }> };
    const averageColors = option.series.filter((series) => series.name.startsWith('实际 MA')).map((series) => series.itemStyle.color);

    expect(new Set(averageColors).size).toBe(3);
  });

  it('renders each explicit labor scope as actual and planned comparison lines', async () => {
    const comparisonSeries: LaborComparisonSeries[] = [
      { available: true, field: 'actual_hours', id: 'scope:north:actual', label: '北区 实际', lineType: 'solid' as const, points, primary: true, styleIndex: 0 },
      { available: true, field: 'planned_hours', id: 'scope:north:planned', label: '北区 排班', lineType: 'dashed' as const, points, primary: true, styleIndex: 0 },
      { available: true, field: 'actual_hours', id: 'scope:south:actual', label: '南区 实际', lineType: 'solid' as const, points, primary: true, styleIndex: 1 },
      { available: true, field: 'planned_hours', id: 'scope:south:planned', label: '南区 排班', lineType: 'dashed' as const, points, primary: true, styleIndex: 1 },
    ];

    const screen = await renderChart(<LaborTrendChart comparisonSeries={comparisonSeries} metric="hours" points={points} />);
    const option = buildLaborTrendOption(points, 'hours', semanticThemes.dark, undefined, [], 'week', comparisonSeries) as { series: Array<{ data: number[]; lineStyle: { type: string }; name: string }> };

    expect(screen.getByText('2 个范围 · 实际 / 排班')).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 北区 实际' })).toBeTruthy();
    expect(option.series.map((series) => series.name)).toEqual(['北区 实际', '北区 排班', '南区 实际', '南区 排班']);
    expect(option.series[1]).toMatchObject({ data: [40, 41], lineStyle: { type: 'dashed' } });
  });

  it('shows the clicked comparison scope metrics instead of aggregate metrics', async () => {
    const southPoints = points.map((point, index) => ({
      ...point,
      actual_hours: index === 0 ? 10 : 12,
      actual_revenue_per_hour: index === 0 ? 123.4 : 125,
      net_revenue: index === 0 ? 1234 : 1500,
      planned_hours: index === 0 ? 20 : 24,
      planned_revenue_per_hour: index === 0 ? 61.7 : 62.5,
    }));
    const comparisonSeries: LaborComparisonSeries[] = [
      { available: true, field: 'actual_hours', id: 'scope:north:actual', label: '北区 实际', lineType: 'solid', points, primary: true, styleIndex: 0 },
      { available: true, field: 'planned_hours', id: 'scope:north:planned', label: '北区 排班', lineType: 'dashed', points, primary: true, styleIndex: 0 },
      { available: true, field: 'actual_hours', id: 'scope:south:actual', label: '南区 实际', lineType: 'solid', points: southPoints, primary: true, styleIndex: 1 },
      { available: true, field: 'planned_hours', id: 'scope:south:planned', label: '南区 排班', lineType: 'dashed', points: southPoints, primary: true, styleIndex: 1 },
    ];
    const screen = await renderChart(<LaborTrendChart comparisonSeries={comparisonSeries} metric="hours" points={points} />);

    await act(async () => {
      screen.getByTestId('labor-hours-echart').props.onDataIndexSelect(0, {
        dataIndex: 0,
        seriesId: 'scope:south:actual',
        seriesName: '南区 实际',
      });
    });

    const detail = screen.getByTestId('labor-hours-chart-detail');
    expect(within(detail).getByText('范围 南区')).toBeTruthy();
    expect(within(detail).getByText('10.00 小时')).toBeTruthy();
    expect(within(detail).getByText('20.00 小时')).toBeTruthy();
    expect(within(detail).getByText('¥ 1,234.00')).toBeTruthy();
    expect(within(detail).getByText('123.40 元/小时')).toBeTruthy();
  });

  it('does not show dates whose labor sync has not completed', () => {
    const unsynced = { ...points[1], actual_hours: 2, hours_synced: false, missing: false, period: '2026-07-19' };

    const visible = visibleLaborTrendPoints([...points, unsynced]);
    const option = buildLaborTrendOption(visible, 'hours', semanticThemes.dark) as { xAxis: { data: string[] } };

    expect(visible.map((point) => point.period)).toEqual(['2026-07-17', '2026-07-18']);
    expect(option.xAxis.data).toEqual(['2026-07-17', '2026-07-18']);
  });

  it('hides periods below 20 percent completeness even when the server reports sync complete', () => {
    const belowThreshold = { ...points[1], actual_hours: 2, period: '2026-07-19', planned_hours: 1094.53 };
    const atThreshold = { ...points[1], actual_hours: 20, period: '2026-07-20', planned_hours: 100 };
    const serverConfirmed = { ...points[1], actual_hours: 2, hours_synced: true, period: '2026-07-21', planned_hours: 100 };

    const visible = visibleLaborTrendPoints([...points, belowThreshold, atThreshold, serverConfirmed]);

    expect(visible.map((point) => point.period)).toEqual([
      '2026-07-17',
      '2026-07-18',
      '2026-07-20',
    ]);
  });

  it('formats null efficiency values as an em dash in the tooltip', () => {
    const option = buildLaborTrendOption(points, 'efficiency', semanticThemes.dark) as { tooltip: { formatter: (value: unknown) => string } };

    expect(option.tooltip.formatter([{ axisValue: '2026-07-17', seriesName: '实际人效', value: null }])).toContain('实际人效：—');
  });

  it('keeps a valid zero point while still hiding incomplete hours', () => {
    const validZero = { ...points[1], actual_hours: 0, net_revenue: 0, period: '2026-07-22', planned_hours: 0 };
    const incomplete = { ...points[1], actual_hours: 1, period: '2026-07-23', planned_hours: 100 };

    expect(visibleLaborTrendPoints([...points, validZero, incomplete]).map((point) => point.period)).toEqual([
      '2026-07-17',
      '2026-07-18',
      '2026-07-22',
    ]);
  });

  it('uses server-declared moving-average fields instead of fixed daily fields', () => {
    const option = buildLaborTrendOption(
      [{ ...points[0], actual_hours_ma4: 36, planned_hours_ma4: 39 }],
      'hours',
      semanticThemes.dark,
      [
        { available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'MA4', window: 4 },
        { available: true, available_periods: 5, field: 'planned_hours_ma4', label: 'MA4', window: 4 },
      ],
    ) as { series: Array<{ data: Array<number | null>; name: string }> };

    expect(option.series.map(({ data, name }) => ({ data, name }))).toEqual([
      { data: [38], name: '实际工时' },
      { data: [40], name: '排班工时' },
      { data: [36], name: '实际 MA4' },
      { data: [39], name: '排班 MA4' },
    ]);
  });

  it.each(['week', 'month'] as const)('does not fall back to daily moving averages for %s trends without metadata', (granularity) => {
    const option = buildLaborTrendOption(points, 'hours', semanticThemes.dark, undefined, [], granularity) as {
      series: Array<{ name: string }>;
    };

    expect(option.series.map(({ name }) => name)).toEqual(['实际工时', '排班工时']);
  });

  it('shows both portrait charts with exact selected values', async () => {
    const screen = await renderChart(<LaborTrendChart metric="efficiency" points={points} />);

    expect(screen.getByText('人效趋势')).toBeTruthy();
    expect(screen.getByText('实际人效 / 排班人效 · MA7 / MA30 / MA180')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('labor-efficiency-chart-point-2026-07-17'));
    const detail = screen.getByTestId('labor-efficiency-chart-detail');
    expect(within(detail).getByText('2026-07-17')).toBeTruthy();
    expect(within(detail).getByText('242.00 元/小时')).toBeTruthy();
    expect(within(detail).getByText('230.00 元/小时')).toBeTruthy();
  });

  it('supports a controlled selected period for portrait and landscape handoff', async () => {
    const onSelectPeriod = jest.fn();
    const screen = await renderChart(<LaborTrendChart
      metric="hours"
      onSelectPeriod={onSelectPeriod}
      points={points}
      selectedPeriod="2026-07-17"
    />);

    expect(within(screen.getByTestId('labor-hours-chart-detail')).getByText('38.00 小时')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('labor-hours-chart-point-2026-07-18'));
    expect(onSelectPeriod).toHaveBeenCalledWith('2026-07-18');
  });

  it('keeps each chart legend independent and lets dynamic averages be hidden', async () => {
    const screen = await renderChart(<>
      <LaborTrendChart metric="hours" movingAverages={[
        { available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'MA4', window: 4 },
        { available: true, available_periods: 5, field: 'planned_hours_ma4', label: 'MA4', window: 4 },
      ]} points={[{ ...points[0], actual_hours_ma4: 36, planned_hours_ma4: 39 }]} />
      <LaborTrendChart metric="efficiency" points={points} />
    </>);

    await fireEvent.press(screen.getByRole('button', { name: '隐藏 实际工时' }));
    await fireEvent.press(screen.getByRole('button', { name: '隐藏 实际 MA4' }));

    expect(screen.getByRole('button', { name: '显示 实际工时' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '显示 实际 MA4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '隐藏 实际人效' })).toBeTruthy();
  });

  it('shows selected point scope, period range, base metrics, and completeness explanation', async () => {
    const screen = await renderChart(<LaborTrendChart metric="hours" points={[{
      ...points[0],
      period_end: '2026-07-19',
      period_start: '2026-07-13',
    }]} scopeLabel="华东区" />);

    await fireEvent.press(screen.getByTestId('labor-hours-chart-point-2026-07-17'));
    const detail = screen.getByTestId('labor-hours-chart-detail');
    expect(within(detail).getByText('范围 华东区')).toBeTruthy();
    expect(within(detail).getByText('周期 2026-07-13 至 2026-07-19')).toBeTruthy();
    expect(within(detail).getByText('净实收')).toBeTruthy();
    expect(within(detail).getByText('¥ 9,196.00')).toBeTruthy();
    expect(within(detail).getByText('实际工时')).toBeTruthy();
    expect(within(detail).getByText('实际人效')).toBeTruthy();
    expect(within(detail).getByText('完整率：工时数据完整')).toBeTruthy();
  });

  it('requests fullscreen and places detail to the right in landscape', async () => {
    const onFullscreen = jest.fn();
    const portrait = await renderChart(<LaborTrendChart metric="hours" onFullscreen={onFullscreen} points={points} />);
    await fireEvent.press(portrait.getByRole('button', { name: '全屏查看工时趋势' }));
    expect(onFullscreen).toHaveBeenCalledTimes(1);
    await portrait.unmount();

    const landscape = await renderChart(<LaborTrendChart detailPlacement="right" expanded metric="hours" points={points} showHeader={false} />);
    expect(landscape.getByTestId('labor-hours-chart-side-layout')).toHaveStyle({ flexDirection: 'row' });
    const sideDetail = landscape.getByTestId('labor-hours-chart-side-detail');
    expect(sideDetail).toHaveStyle({ position: 'relative', width: 208 });
    expect(within(sideDetail).getByText('42.00 小时').parent).toHaveStyle({ flex: 0 });
    expect(landscape.queryByTestId('labor-hours-chart-detail')).toBeNull();
  });
});
