import type { AnalyticsFilters } from './analyticsFilters';
import { buildMealChartModel, buildRevenueChartModel } from './dashboardChartModels';

const filters: AnalyticsFilters = {
  dateFrom: '2026-07-15',
  dateTo: '2026-07-16',
  sourceType: 'all',
  storeKey: 'ALL',
  storeKeys: ['101', '102'],
};

const storePoints = {
  '101': [point('2026-07-15', 1200, 80), point('2026-07-16', 1600, 95)],
  '102': [point('2026-07-15', 900, 60), point('2026-07-16', 1100, 72)],
};

const revenue = {
  date_from: filters.dateFrom,
  date_to: filters.dateTo,
  points: [point('2026-07-15', 2100, 140), point('2026-07-16', 2700, 167)],
  store_key: 'MULTI',
  store_keys: ['101', '102'],
  store_trends: storePoints,
};

describe('dashboardChartModels', () => {
  it('builds a store comparison for multi-store net revenue', () => {
    const model = buildRevenueChartModel({
      filters,
      mode: 'net',
      revenue,
      revenueSources: { shop: revenue, takeout: revenue },
      stores: [{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }],
    });

    expect(model.points).toEqual([]);
    expect(model.series?.map((series) => series.label)).toEqual(['茅坡店', '凤十二店']);
    expect(model.subtitle).toBe('2 家门店 · 门店对比');
  });

  it('keeps each store color while distinguishing dine-in and takeout line styles', () => {
    const shop = { ...revenue, store_trends: storePoints };
    const takeout = {
      ...revenue,
      store_trends: {
        '101': [point('2026-07-15', 500, 35), point('2026-07-16', 620, 40)],
        '102': [point('2026-07-15', 420, 28), point('2026-07-16', 510, 32)],
      },
    };
    const model = buildRevenueChartModel({
      filters,
      mode: 'sources',
      revenue,
      revenueSources: { shop, takeout },
      stores: [{ key: '101', label: '茅坡店' }, { key: '102', label: '凤十二店' }],
    });

    expect(model.series?.map(({ label, lineType, styleIndex }) => ({ label, lineType, styleIndex }))).toEqual([
      { label: '茅坡店 堂食', lineType: 'solid', styleIndex: 0 },
      { label: '茅坡店 外卖', lineType: 'dashed', styleIndex: 0 },
      { label: '凤十二店 堂食', lineType: 'solid', styleIndex: 1 },
      { label: '凤十二店 外卖', lineType: 'dashed', styleIndex: 1 },
    ]);
    expect(model.subtitle).toBe('同门店同色 · 堂食实线 / 外卖虚线');
  });

  it('maps meal business and turnover values into the shared trend chart', () => {
    const mealTrend = {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      points: [mealPoint('2026-07-15', 3900, 180), mealPoint('2026-07-16', 4200, 195)],
      store_key: 'ALL',
    };
    const turnover = {
      data_status: 'ok',
      eligible_store_count: 2,
      table_count: 36,
      summary: [],
      points: [
        turnoverPoint('2026-07-15', 2.2, 180),
        turnoverPoint('2026-07-16', 2.3, 195),
      ],
    };

    const business = buildMealChartModel(mealTrend, turnover, 'business', 'lunch');
    const tableTurns = buildMealChartModel(mealTrend, turnover, 'turnover', 'lunch');

    expect(business.points.map((item) => item.net_income)).toEqual([3900, 4200]);
    expect(business.valueMode).toBe('currency');
    expect(tableTurns.points.map((item) => item.net_income)).toEqual([2.2, 2.3]);
    expect(tableTurns.points.at(-1)?.order_count).toBe(195);
    expect((tableTurns.points.at(-1) as { total_table_count?: number } | undefined)?.total_table_count).toBe(36);
    expect(tableTurns.valueMode).toBe('turnover');
    expect(tableTurns.series?.map((series) => series.id)).toEqual([
      'meal:turnover:lunch',
      'meal:turnover:lunch:ma7',
      'meal:turnover:lunch:ma30',
      'meal:turnover:lunch:ma180',
    ]);
    expect(business.series?.map((series) => series.id)).toEqual([
      'meal:business:lunch',
      'meal:business:lunch:ma7',
      'meal:business:lunch:ma30',
      'meal:business:lunch:ma180',
    ]);
  });

  it('compares explicit meal business scopes without local moving averages', () => {
    const mealTrend = {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      points: [mealPoint('2026-07-15', 2500, 150)],
      store_key: 'MULTI',
      store_trends: {
        '101': [mealPoint('2026-07-15', 0, 0), mealPoint('2026-07-16', 1200, 80)],
        '102': [mealPoint('2026-07-15', 0, 0)],
        '201': [mealPoint('2026-07-15', 700, 50), mealPoint('2026-07-16', 900, 60)],
      },
    };
    const turnover = { data_status: 'ok', eligible_store_count: 3, table_count: 36, points: [], summary: [] };
    const scopes = [
      { key: 'dept:business-1', label: '事业一部', storeKeys: ['101', '102'], type: 'department' as const },
      { key: 'shop:201', label: '南坪店', storeKeys: ['201'], type: 'store' as const },
    ];

    const model = buildMealChartModel(mealTrend, turnover, 'business', 'lunch', scopes);

    expect(model.points).toEqual([]);
    expect(model.subtitle).toBe('2 个已选范围 · 范围对比');
    expect(model.series?.map(({ id, label, points }) => ({
      id,
      label,
      points: points.map(({ missing, net_income, period }) => ({ missing, net_income, period })),
    }))).toEqual([
      {
        id: 'scope:dept:business-1',
        label: '事业一部',
        points: [
          { missing: false, net_income: 0, period: '2026-07-15' },
          { missing: true, net_income: 1200, period: '2026-07-16' },
        ],
      },
      {
        id: 'scope:shop:201',
        label: '南坪店',
        points: [
          { missing: false, net_income: 700, period: '2026-07-15' },
          { missing: false, net_income: 900, period: '2026-07-16' },
        ],
      },
    ]);
    expect(model.series?.every((series) => series.primary && series.field === 'net_income')).toBe(true);
  });

  it('recalculates turnover for each explicit scope from eligible store orders and tables', () => {
    const mealTrend = { date_from: filters.dateFrom, date_to: filters.dateTo, points: [], store_key: 'MULTI' };
    const turnover = {
      data_status: 'ok',
      eligible_store_count: 3,
      table_count: 42,
      summary: [],
      excluded_stores: [{ reason: '未配置桌台数', store_key: '102', store_label: '凤十二店' }],
      store_summaries: [
        { store_key: '101', store_label: '茅坡店', table_count: 10, summary: [{ avg_daily_turnover: 0, period_key: 'lunch' as const, period_label: '午餐', shop_order_count: 100 }] },
        { store_key: '102', store_label: '凤十二店', table_count: 0, summary: [{ avg_daily_turnover: 0, period_key: 'lunch' as const, period_label: '午餐', shop_order_count: 500 }] },
        { store_key: '201', store_label: '南坪店', table_count: 12, summary: [{ avg_daily_turnover: 0, period_key: 'lunch' as const, period_label: '午餐', shop_order_count: 36 }] },
      ],
      store_trends: {
        '101': [turnoverPoint('2026-07-15', 0, 100)],
        '102': [turnoverPoint('2026-07-15', 0, 500)],
        '201': [turnoverPoint('2026-07-15', 0, 36)],
      },
    };
    const scopes = [
      { key: 'dept:business-1', label: '事业一部', storeKeys: ['101', '102'], type: 'department' as const },
      { key: 'shop:201', label: '南坪店', storeKeys: ['201'], type: 'store' as const },
    ];

    const model = buildMealChartModel(mealTrend, turnover, 'turnover', 'lunch', scopes);

    expect(model.points).toEqual([]);
    expect(model.subtitle).toBe('2 个已选范围 · 范围对比');
    expect(model.series?.map(({ id, label, points }) => ({
      id,
      label,
      points: points.map(({ ma7, net_income, order_count, period }) => ({ ma7, net_income, order_count, period })),
    }))).toEqual([
      {
        id: 'scope:dept:business-1',
        label: '事业一部',
        points: [{ ma7: null, net_income: 10, order_count: 100, period: '2026-07-15' }],
      },
      {
        id: 'scope:shop:201',
        label: '南坪店',
        points: [{ ma7: null, net_income: 3, order_count: 36, period: '2026-07-15' }],
      },
    ]);
  });

  it('does not fall back to aggregate meal business series when multiple scope trends are unavailable', () => {
    const mealTrend = {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      points: [mealPoint('2026-07-15', 2500, 150)],
      store_key: 'MULTI',
    };
    const turnover = { data_status: 'ok', eligible_store_count: 3, table_count: 36, points: [], summary: [] };

    const model = buildMealChartModel(mealTrend, turnover, 'business', 'lunch', [
      { key: 'dept:business-1', label: '事业一部', storeKeys: ['101', '102'], type: 'department' },
      { key: 'shop:201', label: '南坪店', storeKeys: ['201'], type: 'store' },
    ]);

    expect(model.points).toEqual([]);
    expect(model.series).toEqual([]);
  });

  it('keeps one meal scope on the backend aggregate line and moving averages', () => {
    const mealTrend = {
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      points: [mealPoint('2026-07-15', 3900, 180)],
      store_key: 'ALL',
      store_trends: { '101': [mealPoint('2026-07-15', 1000, 80)] },
    };
    const turnover = { data_status: 'ok', eligible_store_count: 1, table_count: 18, points: [], summary: [] };

    const model = buildMealChartModel(mealTrend, turnover, 'business', 'lunch', [
      { key: 'dept:north', label: '北区', storeKeys: ['101'], type: 'department' },
    ]);

    expect(model.points.map(({ ma7, net_income }) => ({ ma7, net_income }))).toEqual([{ ma7: 3800, net_income: 3900 }]);
    expect(model.series?.map((series) => series.id)).toEqual([
      'meal:business:lunch',
      'meal:business:lunch:ma7',
      'meal:business:lunch:ma30',
      'meal:business:lunch:ma180',
    ]);
  });

  it('shows turnover moving averages for one explicit scope', () => {
    const mealTrend = { date_from: filters.dateFrom, date_to: filters.dateTo, points: [], store_key: '101' };
    const point = turnoverPoint('2026-07-15', 2, 20);
    const turnover = {
      data_status: 'ok', eligible_store_count: 1, table_count: 10, summary: [], points: [point],
      store_summaries: [{ store_key: '101', store_label: '茅坡店', table_count: 10, summary: [] }],
      store_trends: { '101': [point] },
    };

    const model = buildMealChartModel(mealTrend, turnover, 'turnover', 'lunch', [
      { key: 'shop:101', label: '茅坡店', storeKeys: ['101'], type: 'store' },
    ]);

    expect(model.points[0]).toMatchObject({ ma7: 1.9, ma30: 1.7, ma180: 1.6 });
    expect(model.series?.map((series) => series.id)).toEqual([
      'scope:shop:101',
      'scope:shop:101:ma7',
      'scope:shop:101:ma30',
      'scope:shop:101:ma180',
    ]);
  });

  it('shows each explicitly selected scope and aggregates department stores', () => {
    const scopedFilters = {
      ...filters,
      scopeKeys: ['dept:north', 'shop:201'],
      storeKeys: ['101', '102', '201'],
    };
    const scopedRevenue = {
      ...revenue,
      store_keys: scopedFilters.storeKeys,
      store_trends: {
        ...storePoints,
        '201': [point('2026-07-15', 700, 50), point('2026-07-16', 800, 55)],
      },
    };

    const model = buildRevenueChartModel({
      filters: scopedFilters,
      mode: 'net',
      revenue: scopedRevenue,
      revenueSources: { shop: scopedRevenue, takeout: scopedRevenue },
      scopeTree: [{
        key: 'dept:north',
        type: 'department',
        label: '北区',
        children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }, { key: 'shop:201', type: 'store', label: '南坪店', store_key: '201' }],
      stores: [],
    });

    expect(model.series?.map((series) => ({ id: series.id, label: series.label }))).toEqual([
      { id: 'scope:dept:north', label: '北区' },
      { id: 'scope:shop:201', label: '南坪店' },
    ]);
    expect(model.series?.[0].points.map((item) => item.net_income)).toEqual([2100, 2700]);
    expect(model.series?.[0].points.every((item) => item.ma7 === null)).toBe(true);
  });

  it('aggregates scoped revenue in integer cents', () => {
    const scopedFilters = { ...filters, scopeKeys: ['dept:north'], storeKeys: ['101', '102'] };
    const scopedRevenue = {
      ...revenue,
      store_trends: {
        '101': [point('2026-07-15', 0.1, 1)],
        '102': [point('2026-07-15', 0.2, 1)],
      },
    };

    const model = buildRevenueChartModel({
      filters: scopedFilters,
      mode: 'net',
      revenue: scopedRevenue,
      revenueSources: { shop: scopedRevenue, takeout: scopedRevenue },
      scopeTree: [{
        key: 'dept:north', type: 'department', label: '北区', children: [
          { key: 'shop:101', type: 'store', label: '茅坡店', store_key: '101' },
          { key: 'shop:102', type: 'store', label: '凤十二店', store_key: '102' },
        ],
      }],
      stores: [],
    });

    expect(model.series?.[0].points[0].net_income).toBe(0.3);
  });


  it('keeps a single department as one aggregated line instead of expanding its stores', () => {
    const scopedFilters = { ...filters, scopeKeys: ['dept:north'] };
    const scopeTree = [{
      key: 'dept:north',
      type: 'department' as const,
      label: '北区',
      children: [
        { key: 'shop:101', type: 'store' as const, label: '茅坡店', store_key: '101' },
        { key: 'shop:102', type: 'store' as const, label: '凤十二店', store_key: '102' },
      ],
    }];

    const model = buildRevenueChartModel({
      filters: scopedFilters,
      mode: 'net',
      revenue,
      revenueSources: { shop: revenue, takeout: revenue },
      scopeTree,
      stores: [],
    });

    expect(model.series?.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'scope:dept:north', label: '北区' },
    ]);
    expect(model.series?.[0].points.map((item) => item.net_income)).toEqual([2100, 2700]);
  });

  it('shows a missing one-to-one department store date as zero', () => {
    const scopedFilters = { ...filters, scopeKeys: ['dept:tangcheng'], storeKeys: ['53945'] };
    const tangchengPoints = [
      point('2026-07-05', 1200, 80),
      { ...point('2026-07-06', 0, 0), missing: true },
    ];
    const scopedRevenue = {
      ...revenue,
      points: tangchengPoints,
      store_keys: ['53945'],
      store_trends: { '53945': tangchengPoints },
    };

    const model = buildRevenueChartModel({
      filters: scopedFilters,
      mode: 'net',
      revenue: scopedRevenue,
      revenueSources: { shop: scopedRevenue, takeout: scopedRevenue },
      scopeTree: [{
        key: 'dept:tangcheng',
        type: 'department',
        label: '唐城店',
        children: [{ key: 'shop:53945', type: 'store', label: '唐城医院店', store_key: '53945' }],
      }],
      stores: [],
    });

    expect(model.series?.[0].points.map(({ missing, net_income }) => ({ missing, net_income }))).toEqual([
      { missing: false, net_income: 1200 },
      { missing: false, net_income: 0 },
    ]);
  });

  it('keeps department totals continuous when one store is missing', () => {
    const scopedFilters = { ...filters, scopeKeys: ['dept:business-1'], storeKeys: ['53945', '53946'] };
    const scopedRevenue = {
      ...revenue,
      store_keys: scopedFilters.storeKeys,
      store_trends: {
        '53945': [point('2026-07-05', 1200, 80), { ...point('2026-07-06', 0, 0), missing: true }],
        '53946': [point('2026-07-05', 900, 60), point('2026-07-06', 1100, 72)],
      },
    };

    const model = buildRevenueChartModel({
      filters: scopedFilters,
      mode: 'net',
      revenue: scopedRevenue,
      revenueSources: { shop: scopedRevenue, takeout: scopedRevenue },
      scopeTree: [{
        key: 'dept:business-1',
        type: 'department',
        label: '事业1部',
        children: [
          { key: 'shop:53945', type: 'store', label: '唐城医院店', store_key: '53945' },
          { key: 'shop:53946', type: 'store', label: '凤八店', store_key: '53946' },
        ],
      }],
      stores: [],
    });

    expect(model.series?.[0].points.map(({ missing, net_income }) => ({ missing, net_income }))).toEqual([
      { missing: false, net_income: 2100 },
      { missing: false, net_income: 1100 },
    ]);
  });

  it('gives dine-in and takeout moving averages distinct labels and visual identities', () => {
    const sourceFilters = { ...filters, scopeKeys: ['ALL'], storeKey: 'ALL', storeKeys: ['ALL'] };
    const movingAverages = [{ field: 'ma7', label: 'MA7', window: 7, available: true, available_periods: 10 }];
    const shop = { ...revenue, moving_averages: movingAverages, store_trends: undefined };
    const takeout = { ...revenue, moving_averages: movingAverages, store_trends: undefined };

    const model = buildRevenueChartModel({
      filters: sourceFilters,
      mode: 'sources',
      revenue,
      revenueSources: { shop, takeout },
      stores: [],
    });

    expect(model.series?.map(({ id, label, styleIndex }) => ({ id, label, styleIndex }))).toEqual([
      { id: 'source:shop', label: '堂食', styleIndex: 0 },
      { id: 'source:takeout', label: '外卖', styleIndex: 1 },
      { id: 'source:shop:ma7', label: '堂食 MA7', styleIndex: 2 },
      { id: 'source:takeout:ma7', label: '外卖 MA7', styleIndex: 5 },
    ]);
  });

  it('uses backend moving-average metadata and describes unavailable lines', () => {
    const singleStoreFilters = { ...filters, granularity: 'week' as const, scopeKeys: ['shop:101'], storeKey: '101', storeKeys: ['101'] };
    const weeklyRevenue = {
      ...revenue,
      granularity: 'week' as const,
      moving_averages: [
        { field: 'ma4', label: 'MA4', window: 4, available: true, available_periods: 6 },
        { field: 'ma12', label: 'MA12', window: 12, available: false, available_periods: 6 },
      ],
      points: [{ ...point('2026-W28', 2100, 140), ma4: 1900, ma12: null }],
    };

    const model = buildRevenueChartModel({
      filters: singleStoreFilters,
      mode: 'net',
      revenue: weeklyRevenue,
      revenueSources: { shop: weeklyRevenue, takeout: weeklyRevenue },
      stores: [{ key: '101', label: '茅坡店' }],
    });

    expect(model.series?.map(({ available, field, id, label }) => ({ available, field, id, label }))).toEqual([
      { available: true, field: 'net_income', id: 'revenue:net', label: '净实收' },
      { available: true, field: 'ma4', id: 'revenue:ma4', label: 'MA4' },
      { available: false, field: 'ma12', id: 'revenue:ma12', label: 'MA12（数据不足 6/12）' },
    ]);
  });
});

function point(period: string, net_income: number, order_count: number) {
  return { ma180: net_income - 300, ma30: net_income - 200, ma7: net_income - 100, missing: false, net_income, order_count, period };
}

function mealPoint(date: string, netIncome: number, orderCount: number) {
  const row = (period_key: 'breakfast' | 'lunch' | 'afternoon_tea' | 'dinner' | 'late_night', period_label: string) => ({
    avg_order_value: 0,
    income_amount: period_key === 'lunch' ? netIncome : 0,
    ma180: netIncome - 300,
    ma30: netIncome - 200,
    ma7: netIncome - 100,
    net_income: period_key === 'lunch' ? netIncome : 0,
    order_count: period_key === 'lunch' ? orderCount : 0,
    paid_amount: period_key === 'lunch' ? netIncome : 0,
    period_key,
    period_label,
    refund_amount: 0,
  });
  return {
    date,
    afternoon_tea: row('afternoon_tea', '下午茶'),
    breakfast: row('breakfast', '早餐'),
    dinner: row('dinner', '晚餐'),
    late_night: row('late_night', '夜宵'),
    lunch: row('lunch', '午餐'),
  };
}

function turnoverPoint(date: string, turnover: number, orderCount: number) {
  const empty = { ma180: 0, ma30: 0, ma7: 0, shop_order_count: 0, turnover: 0 };
  return {
    date,
    afternoon_tea: empty,
    breakfast: empty,
    dinner: empty,
    late_night: empty,
    lunch: { ma180: turnover - 0.4, ma30: turnover - 0.3, ma7: turnover - 0.1, shop_order_count: orderCount, turnover },
  };
}
