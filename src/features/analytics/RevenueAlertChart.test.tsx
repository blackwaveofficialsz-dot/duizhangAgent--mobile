import { render, within } from '@testing-library/react-native';
import { act } from 'react';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import type { RevenueAlert } from '@/services/api/analytics';
import { RevenueAlertChart } from './RevenueAlertChart';

jest.mock('@/components/charts/EChart', () => {
  const React = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { EChart: (props: object) => React.createElement(View, props) };
});

const alerts: RevenueAlert[] = [
  { actual_amount: 1120, baseline_amount: 1000, business_date: '2026-07-16', deviation_pct: 0.12, direction: 'over', shop_key: 's-1', shop_label: '门店一', status: 'open' },
  { actual_amount: 700, baseline_amount: 1000, business_date: '2026-07-16', deviation_pct: -0.3, direction: 'under', shop_key: 's-2', shop_label: '门店二', status: 'open' },
];

describe('RevenueAlertChart', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  it('sorts by absolute deviation and renders explicit store and percentage axes', async () => {
    const screen = await render(<RevenueAlertChart alerts={alerts} />);
    const chart = screen.getByTestId('revenue-alert-echart');
    const option = chart.props.option as {
      grid: { containLabel?: boolean; outerBoundsContain?: string; outerBoundsMode?: string };
      series: Array<{ data: Array<{ itemStyle: { color: string }; value: number }> }>;
      xAxis: { name: string; type: string };
      yAxis: { data: string[]; name: string; type: string };
    };

    expect(option.grid).toEqual(expect.objectContaining({
      outerBoundsContain: 'axisLabel',
      outerBoundsMode: 'same',
    }));
    expect(option.grid.containLabel).toBeUndefined();
    expect(option.xAxis).toEqual(expect.objectContaining({ name: '偏离率（%）', type: 'value' }));
    expect(option.yAxis).toEqual(expect.objectContaining({ data: ['门店二', '门店一'], name: '门店', type: 'category' }));
    expect(option.series[0].data).toEqual([
      expect.objectContaining({ itemStyle: { color: semanticThemes.light.status.danger }, value: -30 }),
      expect.objectContaining({ itemStyle: { color: semanticThemes.light.status.success }, value: 12 }),
    ]);
  });

  it('shows actual revenue, baseline and direction when a bar is selected', async () => {
    const screen = await render(<RevenueAlertChart alerts={alerts} />);
    const chart = screen.getByTestId('revenue-alert-echart');

    await act(() => chart.props.onDataIndexSelect(0));

    const detail = screen.getByTestId('revenue-alert-chart-detail');
    expect(within(detail).getByText('门店二')).toBeTruthy();
    expect(within(detail).getByText('偏低 30.0%')).toBeTruthy();
    expect(within(detail).getByText('实际净实收 700.00')).toBeTruthy();
    expect(within(detail).getByText('历史基线 1,000.00')).toBeTruthy();
  });
});
