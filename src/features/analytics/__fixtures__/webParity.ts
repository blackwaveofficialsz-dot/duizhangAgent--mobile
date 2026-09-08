import type { LaborTrendResult, ProductTrendResult } from '@/services/api/analytics';

export const productTrendFixture = {
  date_from: '2026-06-01',
  date_to: '2026-06-28',
  dim_key: '53961',
  dim_type: 'shop',
  granularity: 'week',
  metric: 'quantity',
  moving_averages: [{ available: true, available_periods: 4, field: 'ma4', label: '4周均线', window: 4 }],
  points: [
    { in_progress: true, ma4: 8, ma7: 8, ma30: null, ma180: null, missing: false, order_count: 4, period: '2026-W26', period_end: '2026-06-28', period_start: '2026-06-22', quantity: 8, sales_amount: 120 },
    { in_progress: false, ma4: null, ma7: null, ma30: null, ma180: null, missing: true, order_count: 0, period: '2026-W25', period_end: '2026-06-21', period_start: '2026-06-15', quantity: 0, sales_amount: 0 },
  ],
  product_key: 'name:招牌 牛肉面',
  product_name: '招牌牛肉面',
  store_keys: ['53961'],
  store_trends: {
    '53961': [{ in_progress: true, ma4: 8, ma7: 8, ma30: null, ma180: null, missing: false, order_count: 4, period: '2026-W26', period_end: '2026-06-28', period_start: '2026-06-22', quantity: 8, sales_amount: 120 }],
  },
} satisfies ProductTrendResult;

const zeroLaborTrendPoint = {
  actual_hours: 0,
  actual_hours_ma4: 0,
  actual_hours_ma7: 0,
  actual_hours_ma30: 0,
  actual_hours_ma180: 0,
  actual_revenue_per_hour: 0,
  actual_revenue_per_hour_ma4: 0,
  actual_revenue_per_hour_ma7: 0,
  actual_revenue_per_hour_ma30: 0,
  actual_revenue_per_hour_ma180: 0,
  headcount: 0,
  in_progress: true,
  missing: false,
  net_revenue: 0,
  period: '2026-06',
  period_end: '2026-06-30',
  period_start: '2026-06-01',
  planned_hours: 0,
  planned_hours_ma4: 0,
  planned_hours_ma7: 0,
  planned_hours_ma30: 0,
  planned_hours_ma180: 0,
  planned_revenue_per_hour: 0,
  planned_revenue_per_hour_ma4: 0,
  planned_revenue_per_hour_ma7: 0,
  planned_revenue_per_hour_ma30: 0,
  planned_revenue_per_hour_ma180: 0,
};

export const laborTrendFixture = {
  date_from: '2026-06-01',
  date_to: '2026-06-30',
  granularity: 'month',
  moving_averages: [
    { available: true, available_periods: 4, field: 'actual_hours_ma4', label: '实际工时4月均线', window: 4 },
    { available: true, available_periods: 4, field: 'actual_revenue_per_hour_ma4', label: '实际人效4月均线', window: 4 },
    { available: true, available_periods: 4, field: 'planned_hours_ma4', label: '计划工时4月均线', window: 4 },
    { available: true, available_periods: 4, field: 'planned_revenue_per_hour_ma4', label: '计划人效4月均线', window: 4 },
  ],
  period: '2026-06-01_2026-06-30',
  points: [zeroLaborTrendPoint],
  store_key: 'MULTI',
  store_keys: ['dept:central', 'dept:north'],
  store_trends: {
    'dept:central': [zeroLaborTrendPoint],
    'dept:north': [zeroLaborTrendPoint],
  },
} satisfies LaborTrendResult;

export const scopeFixture = {
  departmentMappings: [
    { departmentKey: 'dept:north', storeKey: '53961' },
    { departmentKey: 'dept:central', storeKey: '53961' },
    { departmentKey: 'dept:central', storeKey: '53962' },
  ],
  singleStoreKey: '53961',
};
