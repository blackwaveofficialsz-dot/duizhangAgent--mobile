import { buildOrderDetailTrendModel } from './orderDetailTrend';
import type { OrderPeriodRow } from './orderStoreTable';

function period(key: string, netIncomeCent: number, orderCount = 1, complete = true): OrderPeriodRow {
  return {
    complete,
    dateFrom: key.length === 7 ? `${key}-01` : key,
    dateTo: key.length === 7 ? `${key}-28` : key,
    key,
    label: key,
    metrics: {
      avgOrderValueCent: orderCount > 0 ? Math.round(netIncomeCent / orderCount) : 0,
      incomeAmountCent: netIncomeCent,
      netIncomeCent,
      orderCount,
      paidAmountCent: netIncomeCent,
      refundAmountCent: 0,
      refundRate: 0,
    },
  };
}

describe('orderDetailTrend', () => {
  it('builds day moving averages like the dashboard from the visible cached periods', () => {
    const rows = Array.from({ length: 5 }, (_, index) => period(`2026-08-${String(index + 1).padStart(2, '0')}`, (index + 1) * 100));

    const model = buildOrderDetailTrendModel(rows, 'day');

    expect(model.series.map((item) => [item.field, item.label, item.available])).toEqual([
      ['net_income', '净实收', true],
      ['ma7', 'MA7', true],
      ['ma30', 'MA30', true],
      ['ma180', 'MA180', true],
    ]);
    expect(model.points[0].ma7).toBe(1);
    expect(model.points[4]).toMatchObject({ ma7: 3, ma30: 3, ma180: 3 });
  });

  it('uses weekly and monthly MA windows instead of day MA labels', () => {
    const weekly = buildOrderDetailTrendModel(
      Array.from({ length: 5 }, (_, index) => period(`2026-W${String(index + 1).padStart(2, '0')}`, (index + 1) * 100)),
      'week',
    );
    const monthly = buildOrderDetailTrendModel(
      Array.from({ length: 5 }, (_, index) => period(`2026-${String(index + 1).padStart(2, '0')}`, (index + 1) * 100)),
      'month',
    );

    expect(weekly.series.map((item) => [item.field, item.label, item.available])).toEqual([
      ['net_income', '净实收', true],
      ['ma4', 'MA4', true],
      ['ma12', 'MA12', true],
      ['ma26', 'MA26', true],
    ]);
    expect(weekly.points[3].ma4).toBe(2.5);
    expect(weekly.points[4].ma26).toBe(3);
    expect(monthly.series.map((item) => [item.field, item.label, item.available])).toEqual([
      ['net_income', '净实收', true],
      ['ma3', 'MA3', true],
      ['ma6', 'MA6', true],
      ['ma12', 'MA12', true],
    ]);
    expect(monthly.points[2].ma3).toBe(2);
    expect(monthly.points[4].ma12).toBe(3);
  });

  it('keeps partial weekly and monthly periods chartable when they contain synced order data', () => {
    const weekly = buildOrderDetailTrendModel([period('2026-W35', 2932675, 1621, false)], 'week');
    const monthly = buildOrderDetailTrendModel([period('2026-08', 3789220, 2130, false)], 'month');

    expect(weekly.points[0]).toMatchObject({ missing: false, net_income: 29326.75, order_count: 1621, ma4: 29326.75, ma12: 29326.75, ma26: 29326.75 });
    expect(weekly.series.map((item) => [item.field, item.label, item.available])).toEqual([
      ['net_income', '净实收', true],
      ['ma4', 'MA4', true],
      ['ma12', 'MA12', true],
      ['ma26', 'MA26', true],
    ]);
    expect(monthly.points[0]).toMatchObject({ missing: false, net_income: 37892.2, order_count: 2130, ma3: 37892.2, ma6: 37892.2, ma12: 37892.2 });
  });

  it('keeps incomplete empty periods missing', () => {
    const model = buildOrderDetailTrendModel([period('2026-W34', 0, 0, false)], 'week');

    expect(model.points[0]).toMatchObject({ missing: true, ma4: null, ma12: null, ma26: null });
    expect(model.series.map((item) => [item.field, item.label, item.available])).toEqual([
      ['net_income', '净实收', true],
      ['ma4', 'MA4（数据不足 0/4）', false],
      ['ma12', 'MA12（数据不足 0/12）', false],
      ['ma26', 'MA26（数据不足 0/26）', false],
    ]);
  });
});
