import type { ProductTrendResult } from '@/services/api/analytics';
import { buildMultiProductChartModel, buildProductChartModel, formatProductPeriodLabel, normalizeProductSelection, productPeriodRange } from './productChartModels';

const singleRangeTrend: ProductTrendResult = {
  date_from: '2026-07-01',
  date_to: '2026-07-31',
  dim_key: 'ALL',
  dim_type: 'all',
  granularity: 'week',
  metric: 'quantity',
  moving_averages: [
    { available: true, available_periods: 5, field: 'ma4', label: 'MA4', window: 4 },
    { available: false, available_periods: 5, field: 'ma12', label: 'MA12', window: 12 },
  ],
  points: [
    { ma180: null, ma30: null, ma7: null, ma4: 12, ma12: null, missing: false, order_count: 0, period: '2026-W27', period_end: '2026-07-05', period_start: '2026-06-29', quantity: 0, sales_amount: 0 },
    { ma180: null, ma30: null, ma7: null, ma4: 16, ma12: null, missing: true, order_count: 0, period: '2026-W28', period_end: '2026-07-12', period_start: '2026-07-06', quantity: 0, sales_amount: 0 },
  ],
  product_key: 'p-1',
  product_name: '招牌牛肉面',
};

describe('productChartModels', () => {
  it('normalizes the selected products to available ranking rows, defaults to two, and caps at five', () => {
    const rows = [
      { product_key: 'p-1', product_name: '招牌牛肉面' },
      { product_key: 'p-2', product_name: '酸菜牛肉面' },
      { product_key: 'p-3', product_name: '鲜肉馄饨' },
      { product_key: 'p-4', product_name: '红油抄手' },
      { product_key: 'p-5', product_name: '锅贴' },
      { product_key: 'p-6', product_name: '小酥肉' },
    ];

    expect(normalizeProductSelection(rows, [])).toEqual(['p-1', 'p-2']);
    expect(normalizeProductSelection(rows, ['p-2', 'missing'])).toEqual(['p-2', 'p-1']);
    expect(normalizeProductSelection(rows, ['p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6'])).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
  });

  it('uses one product series per selected product before scope or moving-average series', () => {
    const model = buildMultiProductChartModel({
      'p-1': { ...singleRangeTrend, product_key: 'p-1', product_name: '招牌牛肉面', points: [{ ...singleRangeTrend.points[0], quantity: 15 }] },
      'p-2': { ...singleRangeTrend, product_key: 'p-2', product_name: '酸菜牛肉面', points: [{ ...singleRangeTrend.points[0], quantity: 12 }] },
    }, []);

    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.series.map((item) => item.label)).toEqual(['招牌牛肉面', '酸菜牛肉面']);
    expect(model.series.map((item) => item.id)).toEqual(['product:p-1', 'product:p-2']);
  });

  it('keeps multi-product semantics when only one requested product trend succeeds', () => {
    const model = buildMultiProductChartModel({
      'p-2': { ...singleRangeTrend, product_key: 'p-2', product_name: '酸菜牛肉面', points: [{ ...singleRangeTrend.points[0], quantity: 12 }] },
    }, [], ['p-1', 'p-2']);

    expect(model).not.toBeNull();
    if (!model) return;
    expect(model.subtitle).toBe('2 款产品 · 销量对比');
    expect(model.series.map((item) => item.label)).toEqual(['酸菜牛肉面']);
    expect(model.series.map((item) => item.id)).toEqual(['product:p-2']);
  });

  it('uses server moving-average metadata for one range and keeps zero distinct from missing', () => {
    const model = buildProductChartModel(singleRangeTrend, []);

    expect(model.granularity).toBe('week');
    expect(model.series.map(({ available, field, id, label, primary }) => ({ available, field, id, label, primary }))).toEqual([
      { available: true, field: 'quantity', id: 'product:quantity', label: '销量', primary: true },
      { available: true, field: 'ma4', id: 'product:ma4', label: 'MA4', primary: false },
      { available: false, field: 'ma12', id: 'product:ma12', label: 'MA12（数据不足 5/12）', primary: false },
    ]);
    expect(model.points.map((point) => ({ missing: point.missing, quantity: point.quantity }))).toEqual([
      { missing: false, quantity: 0 },
      { missing: true, quantity: 0 },
    ]);
  });

  it('uses only explicit scope quantity lines for multiple ranges', () => {
    const model = buildProductChartModel({
      ...singleRangeTrend,
      store_trends: {
        '101': [
          { ma180: null, ma30: null, ma7: null, missing: false, order_count: 0, period: '2026-W27', quantity: 0, sales_amount: 0 },
          { ma180: null, ma30: null, ma7: null, missing: false, order_count: 2, period: '2026-W28', quantity: 3, sales_amount: 66 },
        ],
        '102': [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 0, period: '2026-W27', quantity: 0, sales_amount: 0 }],
        '201': [{ ma180: null, ma30: null, ma7: null, missing: false, order_count: 4, period: '2026-W27', quantity: 5, sales_amount: 110 }],
      },
    }, [
      { key: 'dept:north', label: '北区', storeKeys: ['101', '102'], type: 'department' },
      { key: 'shop:201', label: '南坪店', storeKeys: ['201'], type: 'store' },
    ]);

    expect(model.points).toEqual([]);
    expect(model.subtitle).toBe('2 个已选范围 · 范围对比');
    expect(model.series.map(({ field, id, label, primary, points }) => ({
      field, id, label, primary, points: points.map(({ missing, period, quantity }) => ({ missing, period, quantity })),
    }))).toEqual([
      { field: 'quantity', id: 'scope:dept:north', label: '北区', primary: true, points: [{ missing: false, period: '2026-W27', quantity: 0 }, { missing: true, period: '2026-W28', quantity: 3 }] },
      { field: 'quantity', id: 'scope:shop:201', label: '南坪店', primary: true, points: [{ missing: false, period: '2026-W27', quantity: 5 }] },
    ]);
  });

  it('formats daily weekly and monthly periods with an explicit range', () => {
    expect(formatProductPeriodLabel('2026-07-03', 'day')).toBe('07-03');
    expect(formatProductPeriodLabel('2026-W27', 'week')).toBe('W27');
    expect(formatProductPeriodLabel('2026-07', 'month')).toBe('2026-07');
    expect(productPeriodRange(singleRangeTrend.points[0], 'week')).toBe('06-29 至 07-05');
  });
});
