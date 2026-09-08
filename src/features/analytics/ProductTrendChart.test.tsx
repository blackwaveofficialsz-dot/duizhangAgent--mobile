import { act, fireEvent, render, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState } from 'react';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import type { ProductChartModel } from './productChartModels';
import { buildProductTrendOption, ProductTrendChart, visibleProductTrendPoints } from './ProductTrendChart';

jest.mock('@/components/charts/EChart', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    EChart: ({ onDataIndexSelect, testID }: { onDataIndexSelect?: (index: number, selection?: unknown) => void; testID?: string }) => React.createElement(View, { onDataIndexSelect, testID }),
  };
});

const safeAreaMetrics = {
  frame: { height: 844, width: 390, x: 0, y: 0 },
  insets: { bottom: 34, left: 0, right: 0, top: 59 },
};

const points = [
  { ma7: 136.5, ma30: 136.5, ma180: 136.5, missing: false, order_count: 110, period: '2026-07-10', quantity: 141, sales_amount: 4820 },
  { ma7: 164, ma30: 159, ma180: 152, missing: false, order_count: 126, period: '2026-07-18', quantity: 162, sales_amount: 5560 },
];

function renderChart(chart: React.ReactNode) {
  return render(<SafeAreaProvider initialMetrics={safeAreaMetrics}>{chart}</SafeAreaProvider>);
}

function multiRangeModel(): ProductChartModel {
  return {
    granularity: 'week',
    points: [],
    series: [
      {
        available: true,
        field: 'quantity',
        id: 'scope:north',
        label: '北区',
        lineType: 'solid',
        points: [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 2, period: '2026-W27', quantity: 4, sales_amount: 80 }],
        primary: true,
        styleIndex: 0,
      },
      {
        available: true,
        field: 'quantity',
        id: 'scope:south',
        label: '南坪店',
        lineType: 'solid',
        points: [
          { ma180: null, ma30: null, ma7: null, missing: false, order_count: 3, period: '2026-W27', quantity: 5, sales_amount: 100 },
          { ma180: null, ma30: null, ma7: null, missing: false, order_count: 9, period: '2026-W28', quantity: 18, sales_amount: 360 },
        ],
        primary: true,
        styleIndex: 1,
      },
    ],
    subtitle: '2 个已选范围 · 范围对比',
    unit: '份',
  };
}

describe('ProductTrendChart', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'dark',
      resolvedMode: 'dark',
      setMode: async () => {},
      theme: semanticThemes.dark,
    });
  });

  it('uses the approved quantity line and hides moving-average nodes', () => {
    const option = buildProductTrendOption(points, semanticThemes.dark) as {
      series: Array<{ itemStyle: { color: string }; lineStyle: { width: number }; name: string; showSymbol: boolean; symbolSize: number }>;
      xAxis: { data: string[] };
      yAxis: { name: string };
    };

    expect(option.xAxis.data).toEqual(['2026-07-10', '2026-07-18']);
    expect(option.yAxis.name).toBe('销量（份）');
    expect(option.series[0]).toMatchObject({ itemStyle: { color: '#d5efe3' }, lineStyle: { width: 2.4 }, name: '每日销量', showSymbol: true, symbolSize: 5 });
    expect(option.series[1]).toMatchObject({ name: 'MA7', showSymbol: false, symbolSize: 0 });
  });

  it('keeps missing product dates so the chart can explain data gaps', () => {
    const missing = { ...points[1], missing: true, period: '2026-07-19' };

    expect(visibleProductTrendPoints([...points, missing]).map((point) => point.period)).toEqual(['2026-07-10', '2026-07-18', '2026-07-19']);
  });

  it('shows exact selected values below the portrait chart', async () => {
    const screen = await renderChart(<ProductTrendChart points={points} productName="虾仁鲜肉小馄饨" />);

    expect(screen.getByText('单品销量趋势')).toBeTruthy();
    expect(screen.getByText('每日销量 · MA7 / MA30 / MA180')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('product-chart-point-2026-07-10'));
    const detail = screen.getByTestId('product-chart-detail');
    expect(within(detail).getByText('2026-07-10')).toBeTruthy();
    expect(within(detail).getByText('销量 141 份')).toBeTruthy();
    expect(within(detail).getByText('销售额 ¥ 4,820')).toBeTruthy();
    expect(within(detail).getByText('订单数 110')).toBeTruthy();
  });

  it('requests fullscreen and places details in a fixed right column', async () => {
    const onFullscreen = jest.fn();
    const portrait = await renderChart(<ProductTrendChart onFullscreen={onFullscreen} points={points} productName="虾仁鲜肉小馄饨" />);
    await fireEvent.press(portrait.getByRole('button', { name: '全屏查看单品销量趋势' }));
    expect(onFullscreen).toHaveBeenCalledTimes(1);
    await portrait.unmount();

    const landscape = await renderChart(<ProductTrendChart detailPlacement="right" expanded points={points} productName="虾仁鲜肉小馄饨" showHeader={false} />);
    expect(landscape.getByTestId('product-chart-side-layout')).toHaveStyle({ flexDirection: 'row' });
    expect(landscape.getByTestId('product-chart-side-detail')).toHaveStyle({ position: 'relative', width: 208 });
    expect(landscape.queryByTestId('product-chart-detail')).toBeNull();
  });

  it('keeps the selected period and non-first series after the portrait chart remounts in landscape', async () => {
    function Harness() {
      const [landscape, setLandscape] = useState(false);
      const [selection, setSelection] = useState<{ period: string; seriesId?: string } | null>(null);
      return <ProductTrendChart
        detailPlacement={landscape ? 'right' : 'below'}
        expanded={landscape}
        key={landscape ? 'landscape' : 'portrait'}
        model={multiRangeModel()}
        onFullscreen={() => setLandscape(true)}
        onSelectionChange={setSelection}
        points={[]}
        productName="招牌牛肉面"
        selectedPeriod={selection?.period}
        selectedSeriesId={selection?.seriesId}
        showHeader={!landscape}
      />;
    }
    const screen = await renderChart(<Harness />);

    await act(() => screen.getByTestId('product-echart').props.onDataIndexSelect(0, {
      dataIndex: 0,
      seriesId: 'scope:south',
      seriesName: '南坪店',
    }));
    await fireEvent.press(screen.getByRole('button', { name: '全屏查看单品销量趋势' }));

    const detail = screen.getByTestId('product-chart-side-detail');
    expect(within(detail).getByText('2026-W27')).toBeTruthy();
    expect(within(detail).getByText('范围 南坪店')).toBeTruthy();
    expect(within(detail).getByText('销量 5 份')).toBeTruthy();
  });

  it('uses dynamic legend visibility while preserving a visible primary line and explains missing selections', async () => {
    const onToggleSeries = jest.fn();
    const model: ProductChartModel = {
      granularity: 'week',
      points: [
        { ...points[0], ma4: 136.5, ma12: null, period: '2026-W27', period_end: '2026-07-05', period_start: '2026-06-29', quantity: 0, sales_amount: 0 },
        { ...points[1], ma4: 164, ma12: null, missing: true, period: '2026-W28', period_end: '2026-07-12', period_start: '2026-07-06' },
      ],
      series: [
        { available: true, field: 'quantity', id: 'product:quantity', label: '销量', lineType: 'solid', points: [], primary: true, styleIndex: 0 },
        { available: true, field: 'ma4', id: 'product:ma4', label: 'MA4', lineType: 'dashed', points: [], primary: false, styleIndex: 1 },
        { available: false, field: 'ma12', id: 'product:ma12', label: 'MA12（数据不足 2/12）', lineType: 'dotted', points: [], primary: false, styleIndex: 2 },
      ],
      subtitle: 'MA4 / MA12',
      unit: '份',
    };
    model.series.forEach((series) => { series.points = model.points; });
    const screen = await renderChart(<ProductTrendChart hiddenSeriesIds={['product:ma4']} model={model} onToggleSeries={onToggleSeries} points={[]} productName="虾仁鲜肉小馄饨" />);

    await fireEvent.press(screen.getByRole('button', { name: '隐藏 销量' }));
    expect(onToggleSeries).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '显示 MA4' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '显示 MA4' }));
    expect(onToggleSeries).toHaveBeenCalledWith('product:ma4');
    expect(screen.getByRole('button', { name: 'MA12（数据不足 2/12）不可用' })).toBeTruthy();

    await fireEvent.press(screen.getByTestId('product-chart-point-2026-W28'));
    const detail = screen.getByTestId('product-chart-detail');
    expect(within(detail).getByText('2026-W28')).toBeTruthy();
    expect(within(detail).getByText('07-06 至 07-12')).toBeTruthy();
    expect(within(detail).getByText('销量 162 份')).toBeTruthy();
    expect(within(detail).getByText('销售额 ¥ 5,560')).toBeTruthy();
    expect(within(detail).getByText('订单数 126')).toBeTruthy();
    expect(within(detail).getByText('数据不完整')).toBeTruthy();
  });

  it('shows the second clicked range with that range metrics', async () => {
    const screen = await renderChart(<ProductTrendChart model={multiRangeModel()} points={[]} productName="招牌牛肉面" />);

    await act(() => screen.getByTestId('product-echart').props.onDataIndexSelect(1, {
      dataIndex: 1,
      seriesId: 'scope:south',
      seriesName: '南坪店',
    }));

    const detail = screen.getByTestId('product-chart-detail');
    expect(within(detail).getByText('范围 南坪店')).toBeTruthy();
    expect(within(detail).getByText('销量 18 份')).toBeTruthy();
    expect(within(detail).getByText('销售额 ¥ 360')).toBeTruthy();
    expect(within(detail).getByText('订单数 9')).toBeTruthy();
  });

  it('falls back to a visible primary range with a point when the chart background has no series identity', async () => {
    const screen = await renderChart(<ProductTrendChart model={multiRangeModel()} points={[]} productName="招牌牛肉面" />);

    await act(() => screen.getByTestId('product-echart').props.onDataIndexSelect(1));

    const detail = screen.getByTestId('product-chart-detail');
    expect(within(detail).getByText('范围 南坪店')).toBeTruthy();
    expect(within(detail).getByText('销量 18 份')).toBeTruthy();
  });
});
