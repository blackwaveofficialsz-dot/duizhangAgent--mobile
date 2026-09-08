import type { OrderRow } from '@/services/api/analytics';
import { buildOrderPeriodRows, buildOrderStoreRows } from './orderStoreTable';

function orderRow(
  dimKey: string,
  dimLabel: string,
  values: Partial<OrderRow> = {},
): OrderRow {
  return {
    avg_order_value: 0,
    dim_key: dimKey,
    dim_label: dimLabel,
    net_income: 0,
    order_count: 0,
    paid_amount: 0,
    refund_amount: 0,
    refund_rate: 0,
    ...values,
  };
}

describe('orderStoreTable', () => {
  it('keeps store totals while splitting channel values with integer cents', () => {
    const rows = buildOrderStoreRows(
      [
        orderRow('101|shop', '唐城医院店 · 堂食', {
          income_amount: 12.34,
          net_income: 10.1,
          order_count: 2,
          paid_amount: 12.2,
          refund_amount: 2.1,
        }),
        orderRow('101|takeout', '唐城医院店 · 外卖', {
          income_amount: 22.22,
          net_income: 20.2,
          order_count: 3,
          paid_amount: 23.23,
          refund_amount: 2.02,
        }),
      ],
      'channel',
      [
        orderRow('101', '唐城医院店', {
          income_amount: 34.56,
          net_income: 30.3,
          order_count: 5,
          paid_amount: 35.43,
          refund_amount: 4.12,
        }),
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        breakdown: expect.objectContaining({
          shop: expect.objectContaining({ netIncomeCent: 1010, orderCount: 2 }),
          takeout: expect.objectContaining({ netIncomeCent: 2020, orderCount: 3 }),
        }),
        storeKey: '101',
        storeLabel: '唐城医院店',
        totals: expect.objectContaining({
          incomeAmountCent: 3456,
          netIncomeCent: 3030,
          orderCount: 5,
          paidAmountCent: 3543,
          refundAmountCent: 412,
        }),
      }),
    ]);
  });

  it('fills a missing daily record with zero values', () => {
    const periods = buildOrderPeriodRows(
      [
        {
          data: { rows: [orderRow('101', '唐城医院店', { net_income: 12, order_count: 2 })] },
          date: '2026-07-01',
          version: 'v1',
        },
        {
          data: { rows: [orderRow('101', '唐城医院店', { net_income: 8, order_count: 1 })] },
          date: '2026-07-03',
          version: 'v2',
        },
      ],
      '101',
      'day',
      '2026-07-01',
      '2026-07-03',
    );

    expect(periods.map((period) => [period.key, period.metrics.netIncomeCent, period.metrics.orderCount])).toEqual([
      ['2026-07-01', 1200, 2],
      ['2026-07-02', 0, 0],
      ['2026-07-03', 800, 1],
    ]);
  });

  it('keeps the server refund rate when legacy rows omit refund amounts', () => {
    const [row] = buildOrderStoreRows([
      orderRow('101', '唐城医院店', {
        net_income: 1234.5,
        order_count: 40,
        refund_rate: 0.032,
      }),
    ], 'total');

    expect(row.totals.refundRate).toBe(0.032);
  });

  it('aggregates records by complete calendar weeks and months', () => {
    const records = [
      {
        data: { rows: [orderRow('101', '唐城医院店', { net_income: 12, order_count: 2 })] },
        date: '2026-07-01',
        version: 'v1',
      },
      {
        data: { rows: [orderRow('101', '唐城医院店', { net_income: 8, order_count: 1 })] },
        date: '2026-07-08',
        version: 'v2',
      },
      {
        data: { rows: [orderRow('101', '唐城医院店', { net_income: 3, order_count: 1 })] },
        date: '2026-08-01',
        version: 'v3',
      },
    ];

    expect(buildOrderPeriodRows(records, '101', 'week', '2026-07-01', '2026-07-10').map((period) => [
      period.key, period.dateFrom, period.dateTo, period.metrics.netIncomeCent,
    ])).toEqual([
      ['2026-W27', '2026-07-01', '2026-07-05', 1200],
      ['2026-W28', '2026-07-06', '2026-07-10', 800],
    ]);
    expect(buildOrderPeriodRows(records, '101', 'month', '2026-07-01', '2026-08-01').map((period) => [
      period.key, period.dateFrom, period.dateTo, period.metrics.netIncomeCent,
    ])).toEqual([
      ['2026-07', '2026-07-01', '2026-07-31', 2000],
      ['2026-08', '2026-08-01', '2026-08-01', 300],
    ]);
  });
});
