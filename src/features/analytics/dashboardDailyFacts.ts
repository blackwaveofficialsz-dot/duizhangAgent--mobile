import type { AnalyticsFilters } from './analyticsFilters';
import type {
  MealPeriodKey,
  MealPeriodRow,
  MealPeriodTrendPoint,
  MealPeriodTrendResult,
  MealPeriodTurnoverPoint,
  MealPeriodTurnoverResult,
  MealPeriodsResult,
  RevenueTrendPoint,
  RevenueTrendResult,
} from '@/services/api/analytics';

type OrderFactTotals = {
  net_income_cent?: number;
  order_count?: number;
};

type OrderStoreDailyFact = OrderFactTotals & {
  source_totals?: Record<string, OrderFactTotals>;
  store_key: string;
};

export type OrderDailyFact = OrderFactTotals & {
  data_status?: string;
  date: string;
  source_totals?: Record<string, OrderFactTotals>;
  stores?: Record<string, OrderStoreDailyFact>;
};

type MealDailyPeriodFact = {
  income_amount_cent?: number;
  net_income_cent?: number;
  order_count?: number;
  paid_amount_cent?: number;
  period_key: MealPeriodKey;
  period_label?: string;
  refund_amount_cent?: number;
  shop_order_count?: number;
};

type MealDailyStoreFact = {
  data_status?: string;
  periods?: Partial<Record<MealPeriodKey, MealDailyPeriodFact>>;
  store_key: string;
  store_label?: string | null;
  table_count?: number | null;
  table_count_status?: string;
};

export type MealDailyFact = {
  data_status?: string;
  date: string;
  stores?: Record<string, MealDailyStoreFact>;
};

export type DashboardDailyFactProjection = {
  mealPeriods: MealPeriodsResult;
  mealTrend: MealPeriodTrendResult;
  revenue: RevenueTrendResult;
  revenueSources: { shop: RevenueTrendResult; takeout: RevenueTrendResult };
  turnover: MealPeriodTurnoverResult;
};

type MealCentTotals = {
  incomeAmountCent: number;
  netIncomeCent: number;
  orderCount: number;
  paidAmountCent: number;
  refundAmountCent: number;
  shopOrderCount: number;
};

const MEAL_PERIODS: Array<[MealPeriodKey, string]> = [
  ['breakfast', '早餐'],
  ['lunch', '午餐'],
  ['afternoon_tea', '下午茶'],
  ['dinner', '晚餐'],
  ['late_night', '夜宵'],
];
const MOVING_AVERAGE_WINDOWS = [7, 30, 180] as const;

export function projectDashboardDailyFacts(
  orderFacts: OrderDailyFact[],
  mealFacts: MealDailyFact[],
  filters: AnalyticsFilters,
): DashboardDailyFactProjection {
  const storeKeys = selectedStoreKeys(filters);
  const storeTrendKeys = shouldIncludeStoreTrends(filters, storeKeys) ? storeKeys : [];
  const revenue = revenueFromFacts(orderFacts, filters, storeKeys, storeTrendKeys);
  const shop = revenueFromFacts(orderFacts, { ...filters, sourceType: 'shop' }, storeKeys, storeTrendKeys);
  const takeout = revenueFromFacts(orderFacts, { ...filters, sourceType: 'takeout' }, storeKeys, storeTrendKeys);
  const mealTrend = mealTrendFromFacts(mealFacts, filters, storeKeys, storeTrendKeys);
  return {
    revenue,
    revenueSources: { shop, takeout },
    mealPeriods: mealPeriodsFromFacts(mealFacts, filters, storeKeys),
    mealTrend,
    turnover: turnoverFromFacts(mealFacts, filters, storeKeys),
  };
}

function revenueFromFacts(
  facts: OrderDailyFact[],
  filters: AnalyticsFilters,
  storeKeys: string[],
  storeTrendKeys: string[],
): RevenueTrendResult {
  const points = revenuePoints(facts, filters, storeKeys);
  const storeTrends = Object.fromEntries(storeTrendKeys.map((key) => [key, revenuePoints(facts, filters, [key])]));
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    granularity: 'day',
    metric: 'net_income',
    moving_averages: MOVING_AVERAGE_WINDOWS.map((window) => ({
      available: points.some((point) => typeof point[`ma${window}`] === 'number'),
      available_periods: points.filter((point) => !point.missing).length,
      field: `ma${window}`,
      label: `MA${window}`,
      window,
    })),
    points,
    source_type: filters.sourceType,
    store_key: filters.storeKey,
    ...(storeKeys.length ? { store_keys: storeKeys } : {}),
    ...(storeTrendKeys.length ? { store_trends: storeTrends } : {}),
  };
}

function revenuePoints(facts: OrderDailyFact[], filters: AnalyticsFilters, storeKeys: string[]): RevenueTrendPoint[] {
  const sorted = [...facts].sort((left, right) => left.date.localeCompare(right.date));
  const cents = sorted.map((fact) => {
    const totals = orderTotals(fact, storeKeys, filters.sourceType);
    return fact.data_status === 'ready' ? Number(totals.net_income_cent || 0) : null;
  });
  const averages = Object.fromEntries(MOVING_AVERAGE_WINDOWS.map((window) => [window, movingAverage(cents, window)]));
  return sorted.map((fact, index) => {
    const totals = orderTotals(fact, storeKeys, filters.sourceType);
    const point: RevenueTrendPoint = {
      period: fact.date,
      period_start: fact.date,
      period_end: fact.date,
      net_income: centsToYuan(totals.net_income_cent),
      order_count: Number(totals.order_count || 0),
      missing: fact.data_status !== 'ready',
    };
    for (const window of MOVING_AVERAGE_WINDOWS) {
      point[`ma${window}`] = averages[window][index] === null ? null : centsToYuan(averages[window][index]);
    }
    return point;
  }).filter((point) => point.period >= filters.dateFrom && point.period <= filters.dateTo);
}

function orderTotals(fact: OrderDailyFact, storeKeys: string[], sourceType: AnalyticsFilters['sourceType']): OrderFactTotals {
  const stores = Object.values(fact.stores || {});
  const selectedStores = storeKeys.length
    ? stores.filter((store) => storeKeys.includes(String(store.store_key)))
    : stores;
  if (!selectedStores.length) return sourceType === 'all' ? fact : fact.source_totals?.[sourceType] ?? {};
  return selectedStores.reduce<OrderFactTotals>((sum, store) => {
    const totals = sourceType === 'all' ? store : store?.source_totals?.[sourceType];
    sum.net_income_cent = Number(sum.net_income_cent || 0) + Number(totals?.net_income_cent || 0);
    sum.order_count = Number(sum.order_count || 0) + Number(totals?.order_count || 0);
    return sum;
  }, {});
}

function mealPeriodsFromFacts(facts: MealDailyFact[], filters: AnalyticsFilters, storeKeys: string[]): MealPeriodsResult {
  const fact = facts.find((item) => item.date === filters.dateTo);
  return {
    business_date: filters.dateTo,
    periods: mealRows(selectedMealStores(fact, storeKeys)),
    store_key: filters.storeKey,
  };
}

function mealTrendFromFacts(
  facts: MealDailyFact[],
  filters: AnalyticsFilters,
  storeKeys: string[],
  storeTrendKeys: string[],
): MealPeriodTrendResult {
  const points = mealTrendPoints(facts, filters, storeKeys);
  return {
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    points,
    store_key: filters.storeKey,
    ...(storeKeys.length ? { store_keys: storeKeys } : {}),
    ...(storeTrendKeys.length ? {
      store_trends: Object.fromEntries(storeTrendKeys.map((key) => [key, mealTrendPoints(facts, filters, [key])])),
    } : {}),
  };
}

function mealTrendPoints(facts: MealDailyFact[], filters: AnalyticsFilters, storeKeys: string[]): MealPeriodTrendPoint[] {
  const sorted = [...facts].sort((left, right) => left.date.localeCompare(right.date));
  const totals = sorted.map((fact) => mealCentTotals(selectedMealStores(fact, storeKeys)));
  const points = sorted.map((fact, index) => ({
    date: fact.date,
    ...Object.fromEntries(MEAL_PERIODS.map(([key, label]) => [key, mealRow(key, label, totals[index][key])])),
  })) as MealPeriodTrendPoint[];
  for (const [key] of MEAL_PERIODS) {
    const values = sorted.map((fact, index) => fact.data_status === 'ready' ? totals[index][key].netIncomeCent : null);
    for (const window of MOVING_AVERAGE_WINDOWS) {
      const averages = movingAverage(values, window);
      points.forEach((point, index) => {
        point[key][`ma${window}`] = averages[index] === null ? null : centsToYuan(averages[index]);
      });
    }
  }
  return points.filter((point, index) => (
    sorted[index].data_status === 'ready'
    && point.date >= filters.dateFrom
    && point.date <= filters.dateTo
  ));
}

function mealRows(stores: MealDailyStoreFact[]): MealPeriodRow[] {
  const totals = mealCentTotals(stores);
  return MEAL_PERIODS.map(([key, label]) => mealRow(key, label, totals[key]));
}

function mealCentTotals(stores: MealDailyStoreFact[]): Record<MealPeriodKey, MealCentTotals> {
  return Object.fromEntries(MEAL_PERIODS.map(([key]) => {
    const totals = stores.reduce<MealCentTotals>((sum, store) => {
      const period = store.periods?.[key];
      sum.incomeAmountCent += Number(period?.income_amount_cent || 0);
      sum.netIncomeCent += Number(period?.net_income_cent ?? period?.income_amount_cent ?? 0);
      sum.orderCount += Number(period?.order_count || 0);
      sum.paidAmountCent += Number(period?.paid_amount_cent || 0);
      sum.refundAmountCent += Number(period?.refund_amount_cent || 0);
      sum.shopOrderCount += Number(period?.shop_order_count ?? period?.order_count ?? 0);
      return sum;
    }, emptyMealCentTotals());
    return [key, totals];
  })) as Record<MealPeriodKey, MealCentTotals>;
}

function mealRow(key: MealPeriodKey, label: string, totals: MealCentTotals): MealPeriodRow {
  const paidAmount = centsToYuan(totals.paidAmountCent);
  return {
    period_key: key,
    period_label: label,
    order_count: totals.orderCount,
    paid_amount: paidAmount,
    income_amount: centsToYuan(totals.incomeAmountCent),
    refund_amount: centsToYuan(totals.refundAmountCent),
    net_income: centsToYuan(totals.netIncomeCent),
    avg_order_value: totals.orderCount ? Number((paidAmount / totals.orderCount).toFixed(2)) : 0,
  };
}

function turnoverFromFacts(facts: MealDailyFact[], filters: AnalyticsFilters, selectedKeys: string[]): MealPeriodTurnoverResult {
  const allKeys = [...new Set(facts.flatMap((fact) => Object.keys(fact.stores || {})))].sort();
  const storeKeys = selectedKeys.length ? selectedKeys : allKeys;
  const tableCountByStore = new Map<string, number>();
  const excluded = new Map<string, { reason: string; store_key: string; store_label: string }>();
  for (const fact of facts) {
    for (const key of storeKeys) {
      const store = fact.stores?.[key];
      if (!store) continue;
      const tableCount = Number(store.table_count || 0);
      if (tableCount > 0) tableCountByStore.set(key, tableCount);
      else excluded.set(key, { reason: '未配置桌数', store_key: key, store_label: store.store_label || key });
    }
  }
  const eligibleKeys = storeKeys.filter((key) => tableCountByStore.has(key));
  const tableCount = eligibleKeys.reduce((sum, key) => sum + Number(tableCountByStore.get(key) || 0), 0);
  const points = turnoverPoints(facts, filters, eligibleKeys, tableCount);
  const visibleFacts = facts.filter((fact) => fact.data_status === 'ready' && fact.date >= filters.dateFrom && fact.date <= filters.dateTo);
  const dayCount = Math.max(1, visibleFacts.length);
  const summary = MEAL_PERIODS.map(([key, label]) => {
    const orderCount = points.reduce((sum, point) => sum + Number(point[key].shop_order_count || 0), 0);
    return {
      avg_daily_turnover: tableCount ? Number((orderCount / tableCount / dayCount).toFixed(2)) : 0,
      period_key: key,
      period_label: label,
      shop_order_count: orderCount,
    };
  });
  const storeTrends = Object.fromEntries(eligibleKeys.map((key) => [
    key,
    turnoverPoints(facts, filters, [key], Number(tableCountByStore.get(key) || 0)),
  ]));
  return {
    data_status: eligibleKeys.length ? 'ok' : 'missing',
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    day_count: dayCount,
    eligible_store_count: eligibleKeys.length,
    excluded_stores: [...excluded.values()],
    points,
    store_summaries: eligibleKeys.map((key) => ({
      store_key: key,
      store_label: facts.find((fact) => fact.stores?.[key])?.stores?.[key]?.store_label || key,
      summary: turnoverSummaryForStore(facts, filters, key, Number(tableCountByStore.get(key) || 0)),
      table_count: Number(tableCountByStore.get(key) || 0),
    })),
    store_trends: storeTrends,
    summary,
    table_count: tableCount,
  };
}

function turnoverPoints(
  facts: MealDailyFact[],
  filters: AnalyticsFilters,
  storeKeys: string[],
  tableCount: number,
): MealPeriodTurnoverPoint[] {
  const sorted = [...facts].sort((left, right) => left.date.localeCompare(right.date));
  const points = sorted.map((fact) => {
    const totals = mealCentTotals(selectedMealStores(fact, storeKeys));
    return {
      date: fact.date,
      ...Object.fromEntries(MEAL_PERIODS.map(([key]) => [key, {
        ma7: null,
        ma30: null,
        ma180: null,
        shop_order_count: totals[key].shopOrderCount,
        turnover: tableCount ? Number((totals[key].shopOrderCount / tableCount).toFixed(2)) : 0,
      }])),
    } as MealPeriodTurnoverPoint;
  });
  for (const [key] of MEAL_PERIODS) {
    const values = points.map((point, index) => sorted[index].data_status === 'ready' ? Math.round(point[key].turnover * 100) : null);
    for (const window of MOVING_AVERAGE_WINDOWS) {
      const averages = movingAverage(values, window);
      points.forEach((point, index) => {
        point[key][`ma${window}`] = averages[index] === null ? null : Number((Number(averages[index]) / 100).toFixed(2));
      });
    }
  }
  return points.filter((point, index) => (
    sorted[index].data_status === 'ready'
    && point.date >= filters.dateFrom
    && point.date <= filters.dateTo
  ));
}

function turnoverSummaryForStore(facts: MealDailyFact[], filters: AnalyticsFilters, key: string, tableCount: number) {
  const visible = facts.filter((fact) => fact.data_status === 'ready' && fact.date >= filters.dateFrom && fact.date <= filters.dateTo);
  const dayCount = Math.max(1, visible.length);
  const totals = visible.map((fact) => mealCentTotals(selectedMealStores(fact, [key])));
  return MEAL_PERIODS.map(([periodKey, label]) => {
    const orderCount = totals.reduce((sum, item) => sum + item[periodKey].shopOrderCount, 0);
    return {
      avg_daily_turnover: tableCount ? Number((orderCount / tableCount / dayCount).toFixed(2)) : 0,
      period_key: periodKey,
      period_label: label,
      shop_order_count: orderCount,
    };
  });
}

function selectedMealStores(fact: MealDailyFact | undefined, storeKeys: string[]): MealDailyStoreFact[] {
  const stores = Object.values(fact?.stores || {});
  if (!storeKeys.length) return stores;
  const selected = new Set(storeKeys);
  return stores.filter((store) => selected.has(String(store.store_key)));
}

function selectedStoreKeys(filters: AnalyticsFilters): string[] {
  const values = filters.storeKeys?.length ? filters.storeKeys : [filters.storeKey];
  return [...new Set(values.filter((key) => key && key !== 'ALL'))].sort();
}

function shouldIncludeStoreTrends(filters: AnalyticsFilters, storeKeys: string[]): boolean {
  return storeKeys.length > 1 || Boolean(filters.scopeKeys?.some((key) => key !== 'ALL'));
}

function centsToYuan(value: number | null | undefined): number {
  return Number((Number(value || 0) / 100).toFixed(2));
}

function movingAverage(values: Array<number | null>, window: number): Array<number | null> {
  return values.map((_, index) => {
    const available = values.slice(Math.max(0, index - window + 1), index + 1)
      .filter((value): value is number => value !== null);
    return available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : null;
  });
}

function emptyMealCentTotals(): MealCentTotals {
  return {
    incomeAmountCent: 0,
    netIncomeCent: 0,
    orderCount: 0,
    paidAmountCent: 0,
    refundAmountCent: 0,
    shopOrderCount: 0,
  };
}
