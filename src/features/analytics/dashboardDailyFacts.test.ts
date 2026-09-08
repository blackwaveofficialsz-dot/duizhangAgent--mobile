import { projectDashboardDailyFacts } from './dashboardDailyFacts';

const filters = {
  dateFrom: '2026-08-25',
  dateTo: '2026-08-26',
  granularity: 'day' as const,
  includeCurrent: false,
  scopeKeys: ['shop:A'],
  sourceType: 'all' as const,
  storeKey: 'A',
  storeKeys: ['A'],
};

it('projects order and meal V2 facts without aggregating yuan floats', () => {
  const orderFacts = [
    orderFact('2026-08-25', 10_000, 5_000, 3),
    orderFact('2026-08-26', 20_000, 0, 4),
  ];
  const mealFacts = [
    mealFact('2026-08-25', 10_000, 2, 4),
    mealFact('2026-08-26', 20_000, 4, 6),
  ];

  const result = projectDashboardDailyFacts(orderFacts, mealFacts, filters);

  expect(result.revenue.points).toEqual([
    expect.objectContaining({ period: '2026-08-25', net_income: 150, order_count: 3 }),
    expect.objectContaining({ period: '2026-08-26', net_income: 200, order_count: 4 }),
  ]);
  expect(result.revenueSources.shop.points).toEqual([
    expect.objectContaining({ period: '2026-08-25', net_income: 100 }),
    expect.objectContaining({ period: '2026-08-26', net_income: 200 }),
  ]);
  expect(result.revenueSources.takeout.points).toEqual([
    expect.objectContaining({ period: '2026-08-25', net_income: 50 }),
    expect.objectContaining({ period: '2026-08-26', net_income: 0 }),
  ]);
  expect(result.mealPeriods).toMatchObject({
    business_date: '2026-08-26',
    periods: expect.arrayContaining([
      expect.objectContaining({ period_key: 'lunch', net_income: 200, order_count: 4 }),
    ]),
  });
  expect(result.mealTrend.points[1].lunch).toMatchObject({ net_income: 200, ma7: 150 });
  expect(result.turnover.points).toEqual([
    expect.objectContaining({ lunch: expect.objectContaining({ shop_order_count: 4, turnover: 0.4 }) }),
    expect.objectContaining({ lunch: expect.objectContaining({ shop_order_count: 6, turnover: 0.6 }) }),
  ]);
  expect(result.turnover.summary).toEqual(expect.arrayContaining([
    expect.objectContaining({ period_key: 'lunch', shop_order_count: 10, avg_daily_turnover: 0.5 }),
  ]));
});

it('keeps selected stores isolated while retaining per-store trends', () => {
  const fact = orderFact('2026-08-25', 10_000, 0, 2);
  fact.stores.B = {
    store_key: 'B',
    order_count: 10,
    net_income_cent: 90_000,
    source_totals: { shop: { order_count: 10, net_income_cent: 90_000 } },
  };

  const result = projectDashboardDailyFacts([fact], [mealFact('2026-08-25', 10_000, 2, 4)], filters);

  expect(result.revenue.points[0]).toMatchObject({ net_income: 100, order_count: 2 });
  expect(result.revenue.store_trends?.A[0]).toMatchObject({ net_income: 100 });
  expect(result.revenue.store_trends?.B).toBeUndefined();
});

it('builds the all-store revenue total from confirmed store facts', () => {
  const fact = orderFact('2026-08-25', 10_000, 0, 2);
  fact.net_income_cent = 99_000;
  fact.order_count = 20;

  const result = projectDashboardDailyFacts([fact], [mealFact('2026-08-25', 10_000, 2, 4)], {
    ...filters,
    scopeKeys: ['ALL'],
    storeKey: 'ALL',
    storeKeys: [],
  });

  expect(result.revenue.points[0]).toMatchObject({ net_income: 100, order_count: 2 });
});

function orderFact(date: string, shopCent: number, takeoutCent: number, orderCount: number) {
  return {
    data_status: 'ready',
    date,
    net_income_cent: shopCent + takeoutCent,
    order_count: orderCount,
    source_totals: {
      shop: { net_income_cent: shopCent, order_count: orderCount },
      takeout: { net_income_cent: takeoutCent, order_count: 0 },
    },
    stores: {
      A: {
        store_key: 'A',
        net_income_cent: shopCent + takeoutCent,
        order_count: orderCount,
        source_totals: {
          shop: { net_income_cent: shopCent, order_count: orderCount },
          takeout: { net_income_cent: takeoutCent, order_count: 0 },
        },
      },
    } as Record<string, {
      net_income_cent: number;
      order_count: number;
      source_totals: Record<string, { net_income_cent: number; order_count: number }>;
      store_key: string;
    }>,
  };
}

function mealFact(date: string, netIncomeCent: number, orderCount: number, shopOrderCount: number) {
  return {
    data_status: 'ready',
    date,
    stores: {
      A: {
        data_status: 'ready',
        periods: {
          lunch: {
            income_amount_cent: netIncomeCent,
            net_income_cent: netIncomeCent,
            order_count: orderCount,
            paid_amount_cent: netIncomeCent,
            period_key: 'lunch' as const,
            period_label: '午餐',
            refund_amount_cent: 0,
            shop_order_count: shopOrderCount,
          },
        },
        store_key: 'A',
        table_count: 10,
        table_count_status: 'ready',
      },
    },
  };
}
