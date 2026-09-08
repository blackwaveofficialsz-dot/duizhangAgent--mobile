import type { LaborTrendPoint } from '@/services/api/analytics';
import { LABOR_COMPLETENESS_STATUS, laborCompletenessStatus, MIN_LEGACY_LABOR_COMPLETENESS_RATIO } from './laborCompleteness';

function point(overrides: Partial<LaborTrendPoint> = {}): LaborTrendPoint {
  return {
    actual_hours: 10,
    actual_hours_ma7: null,
    actual_hours_ma30: null,
    actual_hours_ma180: null,
    actual_revenue_per_hour: 100,
    actual_revenue_per_hour_ma7: null,
    actual_revenue_per_hour_ma30: null,
    actual_revenue_per_hour_ma180: null,
    headcount: 1,
    missing: false,
    net_revenue: 1000,
    period: '2026-07-20',
    planned_hours: 20,
    planned_hours_ma7: null,
    planned_hours_ma30: null,
    planned_hours_ma180: null,
    planned_revenue_per_hour: 50,
    planned_revenue_per_hour_ma7: null,
    planned_revenue_per_hour_ma30: null,
    planned_revenue_per_hour_ma180: null,
    ...overrides,
  };
}

describe('laborCompleteness', () => {
  it('keeps missing, filtered, and valid zero points distinct', () => {
    expect(laborCompletenessStatus(point({ missing: true }))).toBe(LABOR_COMPLETENESS_STATUS.missing);
    expect(laborCompletenessStatus(point({ actual_hours: 1, planned_hours: 10 }))).toBe(LABOR_COMPLETENESS_STATUS.filtered);
    expect(laborCompletenessStatus(point({ actual_hours: 0, planned_hours: 0, net_revenue: 0 }))).toBe(LABOR_COMPLETENESS_STATUS.visible);
  });

  it('uses sync status only when completeness cannot be calculated', () => {
    expect(MIN_LEGACY_LABOR_COMPLETENESS_RATIO).toBe(0.2);
    expect(laborCompletenessStatus(point({ actual_hours: 2, planned_hours: 10 }))).toBe(LABOR_COMPLETENESS_STATUS.visible);
    expect(laborCompletenessStatus(point({ actual_hours: 1.99, planned_hours: 10 }))).toBe(LABOR_COMPLETENESS_STATUS.filtered);
    expect(laborCompletenessStatus(point({ actual_hours: 2, hours_synced: true, planned_hours: 100 }))).toBe(LABOR_COMPLETENESS_STATUS.filtered);
    expect(laborCompletenessStatus(point({ actual_hours: 10, hours_synced: false, planned_hours: 10 }))).toBe(LABOR_COMPLETENESS_STATUS.visible);
    expect(laborCompletenessStatus(point({ actual_hours: 0, hours_synced: true, planned_hours: 0 }))).toBe(LABOR_COMPLETENESS_STATUS.visible);
    expect(laborCompletenessStatus(point({ actual_hours: 0, hours_synced: false, planned_hours: 0 }))).toBe(LABOR_COMPLETENESS_STATUS.filtered);
  });
});
