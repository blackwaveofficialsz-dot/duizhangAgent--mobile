import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { OrderStoreTable } from './OrderStoreTableView';
import type { OrderStoreMetrics, OrderStoreTableRow } from './orderStoreTable';

const metrics: OrderStoreMetrics = {
  avgOrderValueCent: 0,
  incomeAmountCent: 0,
  netIncomeCent: 0,
  orderCount: 0,
  paidAmountCent: 0,
  refundAmountCent: 0,
  refundRate: 0,
};

function row(storeLabel: string): OrderStoreTableRow {
  return {
    breakdown: {},
    breakdownLabels: {},
    storeKey: storeLabel,
    storeLabel,
    totals: metrics,
  };
}

describe('OrderStoreTable', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  it('keeps the fixed store column compact and truncates long store names on one line', async () => {
    await render(
      <OrderStoreTable
        comparison={null}
        comparisonMode="previous"
        displayMode="percentage"
        onPressStore={jest.fn()}
        rows={[row('袁记肉夹馍（唐城医院直营店）')]}
        secondaryDimension="total"
      />,
    );

    expect(StyleSheet.flatten(screen.getByTestId('order-fixed-store-column').props.style).width).toBe(82);

    const storeName = screen.getByText('袁记肉夹馍（唐城医院直营店）');
    expect(storeName.props.numberOfLines).toBe(1);
    expect(storeName.props.ellipsizeMode).toBe('tail');
  });
});
