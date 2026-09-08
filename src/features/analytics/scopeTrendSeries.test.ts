import type {
  LaborTrendPoint,
  MealPeriodKey,
  MealPeriodRow,
  MealPeriodTrendPoint,
  MealPeriodTurnoverPoint,
  MealPeriodTurnoverResult,
  ProductTrendPoint,
} from '@/services/api/analytics';
import type { ExplicitStoreScope } from './storeScope';
import {
  buildLaborScopeTrendSeries,
  buildMealScopeTrendSeries,
  buildMealTurnoverScopeTrendSeries,
  buildScopeProductTrendSeries,
  selectMealTurnover,
} from './scopeTrendSeries';

const mealKeys: MealPeriodKey[] = ['breakfast', 'lunch', 'afternoon_tea', 'dinner', 'late_night'];
const lunch = (overrides: Partial<MealPeriodRow> = {}): MealPeriodRow => ({
  period_key: 'lunch', period_label: '午餐', order_count: 0, paid_amount: 0, income_amount: 0,
  refund_amount: 0, net_income: 0, avg_order_value: 0, ...overrides,
});
const mealPoint = (date: string, lunchRow: MealPeriodRow): MealPeriodTrendPoint => ({
  date,
  ...Object.fromEntries(mealKeys.map((key) => [key, key === 'lunch' ? lunchRow : lunch({ period_key: key })])),
}) as MealPeriodTrendPoint;
const turnoverPoint = (date: string, lunchOrders: number): MealPeriodTurnoverPoint => ({
  date,
  ...Object.fromEntries(mealKeys.map((key) => [key, { shop_order_count: key === 'lunch' ? lunchOrders : 0, turnover: 0 }])),
}) as MealPeriodTurnoverPoint;
const scope: ExplicitStoreScope = { key: 'dept:north', label: '北区', storeKeys: ['101', '102', '101'], departmentKeys: ['north-1', 'north-2', 'north-1'], type: 'department' };

describe('scopeTrendSeries', () => {
  it('returns no points for an empty explicit range', () => {
    expect(buildMealScopeTrendSeries([{ ...scope, storeKeys: [] }], {})).toEqual({ 'dept:north': [] });
    expect(buildScopeProductTrendSeries([{ ...scope, storeKeys: [] }], {})).toEqual({ 'dept:north': [] });
    expect(buildLaborScopeTrendSeries([{ ...scope, storeKeys: [], departmentKeys: [] }], {})).toEqual({ 'dept:north': [] });
  });

  it('recalculates meal business ratios from de-duplicated raw totals without moving averages', () => {
    const series = buildMealScopeTrendSeries([scope, { ...scope, key: 'shop:101', storeKeys: ['101'], type: 'store' }], {
      '101': [mealPoint('2026-07-01', lunch({ order_count: 2, paid_amount: 40, income_amount: 35, refund_amount: 5, net_income: 30, avg_order_value: 20 }))],
      '102': [mealPoint('2026-07-01', lunch({ order_count: 3, paid_amount: 90, income_amount: 80, refund_amount: 10, net_income: 70, avg_order_value: 30 }))],
    });

    expect(series['dept:north'][0].lunch).toEqual(expect.objectContaining({
      order_count: 5, paid_amount: 130, income_amount: 115, refund_amount: 15,
      net_income: 100, avg_order_value: 26, ma7: null, ma30: null, ma180: null,
    }));
    expect(series['shop:101'][0].lunch).toEqual(expect.objectContaining({ ma7: null, ma30: null, ma180: null }));
  });

  it('aggregates meal financial fields in integer cents', () => {
    const series = buildMealScopeTrendSeries([scope], {
      '101': [mealPoint('2026-07-01', lunch({ order_count: 1, paid_amount: 0.1, income_amount: 0.1, refund_amount: 0, net_income: 0.1 }))],
      '102': [mealPoint('2026-07-01', lunch({ order_count: 1, paid_amount: 0.2, income_amount: 0.2, refund_amount: 0.1, net_income: 0.1 }))],
    });

    expect(series['dept:north'][0].lunch).toEqual(expect.objectContaining({
      paid_amount: 0.3,
      income_amount: 0.3,
      refund_amount: 0.1,
      net_income: 0.2,
    }));
  });

  it('aggregates product sales amounts in integer cents', () => {
    const series = buildScopeProductTrendSeries([scope], {
      '101': [{ period: '2026-07-01', quantity: 1, sales_amount: 0.1, order_count: 1, missing: false, ma7: null, ma30: null, ma180: null }],
      '102': [{ period: '2026-07-01', quantity: 1, sales_amount: 0.2, order_count: 1, missing: false, ma7: null, ma30: null, ma180: null }],
    });

    expect(series['dept:north'][0].sales_amount).toBe(0.3);
  });

  it('aggregates labor net revenue in integer cents', () => {
    const series = buildLaborScopeTrendSeries([scope], {
      'north-1': [laborPoint({ net_revenue: 0.1, actual_hours: 1 })],
      'north-2': [laborPoint({ net_revenue: 0.2, actual_hours: 1 })],
    });

    expect(series['dept:north'][0].net_revenue).toBe(0.3);
  });


  it('marks a product period missing when one required store point is absent', () => {
    const series = buildScopeProductTrendSeries([scope], {
      '101': [{ period: '2026-07-01', quantity: 2, sales_amount: 20, order_count: 2, missing: false, ma7: 2, ma30: 2, ma180: 2 }],
      '102': [],
    });

    expect(series['dept:north']).toEqual([expect.objectContaining({
      quantity: 2, sales_amount: 20, order_count: 2, missing: true, ma7: null, ma30: null, ma180: null,
    })]);
  });

  it('keeps the real weekly range when aggregating product scopes', () => {
    const series = buildScopeProductTrendSeries([scope], {
      '101': [{ period: '2026-W27', period_start: '2026-06-29', period_end: '2026-07-05', quantity: 2, sales_amount: 20, order_count: 2, missing: false, ma7: null, ma30: null, ma180: null }],
      '102': [{ period: '2026-W27', period_start: '2026-06-29', period_end: '2026-07-05', quantity: 3, sales_amount: 30, order_count: 3, missing: false, ma7: null, ma30: null, ma180: null }],
    });

    expect(series['dept:north'][0]).toMatchObject({ period_start: '2026-06-29', period_end: '2026-07-05' });
  });

  it('recalculates labor efficiency from de-duplicated department totals and returns null for zero hours', () => {
    const series = buildLaborScopeTrendSeries([scope], {
      'north-1': [laborPoint({ net_revenue: 100, actual_hours: 2, planned_hours: 4, headcount: 1 })],
      'north-2': [laborPoint({ net_revenue: 200, actual_hours: 3, planned_hours: 6, headcount: 2 })],
    });
    const zeroHours = buildLaborScopeTrendSeries([{ ...scope, key: 'dept:zero', departmentKeys: ['north-1'] }], {
      'north-1': [laborPoint({ actual_hours: 0, planned_hours: 0 })],
    });

    expect(series['dept:north']).toEqual([expect.objectContaining({
      net_revenue: 300, actual_hours: 5, planned_hours: 10, headcount: 3,
      actual_revenue_per_hour: 60, planned_revenue_per_hour: 30,
    })]);
    expect(zeroHours['dept:zero'][0]).toEqual(expect.objectContaining({
      actual_revenue_per_hour: null, planned_revenue_per_hour: null,
    }));
  });

  it('excludes stores without tables and omits points when the selected range has no valid tables', () => {
    const result: MealPeriodTurnoverResult = {
      data_status: 'ok', eligible_store_count: 2, table_count: 10, summary: [],
      store_summaries: [
        { store_key: '101', store_label: '茅坡店', table_count: 10, summary: [] },
        { store_key: '102', store_label: '凤十二店', table_count: 0, summary: [] },
      ],
      store_trends: {
        '101': [turnoverPoint('2026-07-01', 20)],
        '102': [turnoverPoint('2026-07-01', 100)],
      },
    };

    expect(selectMealTurnover(result, scope.storeKeys)?.points?.[0].lunch).toMatchObject({ shop_order_count: 20, turnover: 2 });
    expect(selectMealTurnover(result, ['102'])?.points).toEqual([]);
  });

  it('omits dates that belong only to stores without tables', () => {
    const result: MealPeriodTurnoverResult = {
      data_status: 'ok', eligible_store_count: 2, table_count: 10, summary: [],
      store_summaries: [
        { store_key: '101', store_label: '茅坡店', table_count: 10, summary: [] },
        { store_key: '102', store_label: '凤十二店', table_count: 0, summary: [] },
      ],
      store_trends: {
        '101': [turnoverPoint('2026-07-01', 20)],
        '102': [turnoverPoint('2026-07-02', 100)],
      },
    };

    expect(selectMealTurnover(result, scope.storeKeys)?.points.map((point) => point.date)).toEqual(['2026-07-01']);
  });

  it('preserves backend turnover moving averages for one explicit store', () => {
    const point = turnoverPoint('2026-07-01', 20);
    point.lunch = { ...point.lunch, turnover: 2, ma7: 1.7, ma30: 1.5, ma180: 1.2 };
    const result: MealPeriodTurnoverResult = {
      data_status: 'ok', eligible_store_count: 1, table_count: 10, summary: [],
      points: [point],
      store_summaries: [{ store_key: '101', store_label: '茅坡店', table_count: 10, summary: [] }],
      store_trends: { '101': [point] },
    };
    const storeScope = { ...scope, key: 'shop:101', storeKeys: ['101'], type: 'store' as const };

    const series = buildMealTurnoverScopeTrendSeries([storeScope], result);

    expect(series['shop:101'][0].lunch).toMatchObject({ turnover: 2, ma7: 1.7, ma30: 1.5, ma180: 1.2 });
  });

  it('calculates turnover moving averages for one explicit department', () => {
    const result: MealPeriodTurnoverResult = {
      data_status: 'ok', eligible_store_count: 2, table_count: 20, summary: [],
      store_summaries: [
        { store_key: '101', store_label: '茅坡店', table_count: 10, summary: [] },
        { store_key: '102', store_label: '凤十二店', table_count: 10, summary: [] },
      ],
      store_trends: {
        '101': [turnoverPoint('2026-07-01', 20), turnoverPoint('2026-07-02', 0)],
        '102': [turnoverPoint('2026-07-01', 20), turnoverPoint('2026-07-02', 40)],
      },
    };

    const series = buildMealTurnoverScopeTrendSeries([{ ...scope, storeKeys: ['101', '102'] }], result);

    expect(series['dept:north'].map(({ lunch: row }) => ({
      turnover: row.turnover, ma7: row.ma7, ma30: row.ma30, ma180: row.ma180,
    }))).toEqual([
      { turnover: 2, ma7: 2, ma30: 2, ma180: 2 },
      { turnover: 2, ma7: 2, ma30: 2, ma180: 2 },
    ]);
  });
});

function laborPoint(overrides: Partial<LaborTrendPoint>): LaborTrendPoint {
  return {
    period: '2026-W27', net_revenue: 0, actual_hours: 0, planned_hours: 0, headcount: 0, missing: false,
    actual_revenue_per_hour: 0, planned_revenue_per_hour: 0,
    actual_hours_ma7: null, actual_hours_ma30: null, actual_hours_ma180: null,
    actual_revenue_per_hour_ma7: null, actual_revenue_per_hour_ma30: null, actual_revenue_per_hour_ma180: null,
    planned_hours_ma7: null, planned_hours_ma30: null, planned_hours_ma180: null,
    planned_revenue_per_hour_ma7: null, planned_revenue_per_hour_ma30: null, planned_revenue_per_hour_ma180: null,
    ...overrides,
  };
}
