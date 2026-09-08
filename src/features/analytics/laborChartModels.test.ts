import type { LaborRow, LaborTrendPoint, LaborTrendResult } from '@/services/api/analytics';
import { buildLaborChartModel, laborComparisonSeries, summarizeLaborPoints, summarizeLaborRows } from './laborChartModels';

function point(overrides: Partial<LaborTrendPoint> = {}): LaborTrendPoint {
  return {
    actual_hours: 2,
    actual_hours_ma7: 2,
    actual_hours_ma30: null,
    actual_hours_ma180: null,
    actual_revenue_per_hour: 50,
    actual_revenue_per_hour_ma7: 50,
    actual_revenue_per_hour_ma30: null,
    actual_revenue_per_hour_ma180: null,
    headcount: 1,
    missing: false,
    net_revenue: 100,
    period: '2026-W29',
    period_end: '2026-07-19',
    period_start: '2026-07-13',
    planned_hours: 4,
    planned_hours_ma7: 4,
    planned_hours_ma30: null,
    planned_hours_ma180: null,
    planned_revenue_per_hour: 25,
    planned_revenue_per_hour_ma7: 25,
    planned_revenue_per_hour_ma30: null,
    planned_revenue_per_hour_ma180: null,
    ...overrides,
  };
}

function trend(overrides: Partial<LaborTrendResult> = {}): LaborTrendResult {
  return {
    date_from: '2026-07-13',
    date_to: '2026-07-19',
    granularity: 'week',
    moving_averages: [{ available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'MA4', window: 4 }],
    period: '2026-07-13_2026-07-19',
    points: [point()],
    store_key: '111',
    ...overrides,
  };
}

describe('laborChartModels', () => {
  it('sums range rows before recomputing efficiency and leaves zero denominators empty', () => {
    const rows: LaborRow[] = [
      { actual_hours: 2, headcount: 1, hours_gap: 2, net_revenue: 100, planned_hours: 4, revenue_per_hour: 50, store_key: '111', store_label: '甲', uncovered: false },
      { actual_hours: 3, headcount: 2, hours_gap: -3, net_revenue: 200, planned_hours: 6, revenue_per_hour: 66.67, store_key: '112', store_label: '乙', uncovered: false },
    ];

    expect(summarizeLaborRows(rows)).toEqual({
      actualEfficiency: 60,
      actualHours: 5,
      headcount: 3,
      netRevenue: 300,
      plannedEfficiency: 30,
      plannedHours: 10,
    });
    expect(summarizeLaborRows([{ ...rows[0], actual_hours: 0, planned_hours: 0 }])).toMatchObject({ actualEfficiency: null, plannedEfficiency: null });
  });

  it('keeps single-range server period boundaries and dynamic moving averages', () => {
    const model = buildLaborChartModel(trend(), ['111']);

    expect(model.movingAverages).toEqual([{ available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'MA4', window: 4 }]);
    expect(model.points).toEqual([expect.objectContaining({
      actual_revenue_per_hour: 50,
      period: '2026-W29',
      period_end: '2026-07-19',
      period_start: '2026-07-13',
      planned_revenue_per_hour: 25,
    })]);
  });

  it('preserves the distinction between missing and explicitly empty moving-average metadata', () => {
    const legacyResponse = trend();
    delete legacyResponse.moving_averages;

    expect(buildLaborChartModel(legacyResponse, ['111']).movingAverages).toBeUndefined();
    expect(buildLaborChartModel(trend({ moving_averages: [] }), ['111']).movingAverages).toEqual([]);
  });

  it('uses the server aggregate for multiple departments with period boundaries and moving averages intact', () => {
    const model = buildLaborChartModel(trend({
      points: [point({ actual_hours: 5, actual_hours_ma4: 4.5, headcount: 3, net_revenue: 300, planned_hours: 20, period_end: '2026-07-19', period_start: '2026-07-13' })],
      store_key: 'MULTI',
      store_trends: {
        '111': [point({ actual_hours: 1, headcount: 1, net_revenue: 100, planned_hours: 10 })],
        '112': [point({ actual_hours: 4, headcount: 2, net_revenue: 200, planned_hours: 10 })],
      },
    }), ['111', '112']);

    expect(model.movingAverages).toEqual([{ available: true, available_periods: 5, field: 'actual_hours_ma4', label: 'MA4', window: 4 }]);
    expect(model.points).toEqual([expect.objectContaining({
      actual_hours: 5,
      actual_hours_ma4: 4.5,
      actual_revenue_per_hour: 60,
      headcount: 3,
      net_revenue: 300,
      period_end: '2026-07-19',
      period_start: '2026-07-13',
      planned_hours: 20,
      planned_revenue_per_hour: 15,
    })]);

    const incomplete = buildLaborChartModel(trend({
      points: [point({ actual_hours: 2, net_revenue: 300, planned_hours: 200 })],
      store_key: 'MULTI',
      store_trends: {
        '111': [point({ actual_hours: 1, net_revenue: 100, planned_hours: 100 })],
        '112': [point({ actual_hours: 1, net_revenue: 200, planned_hours: 100 })],
      },
    }), ['111', '112']);
    expect(incomplete.points).toEqual([]);
    expect(incomplete.allPoints[0]).toMatchObject({ availability: 'filtered', actual_revenue_per_hour: 150 });
  });

  it('builds actual and planned comparison series for distinguishable explicit scopes', () => {
    const model = buildLaborChartModel(trend({
      points: [point({ actual_hours: 5, net_revenue: 300, planned_hours: 20 })],
      store_trends: {
        '111': [point({ actual_hours: 1, net_revenue: 100, planned_hours: 10 })],
        '112': [point({ actual_hours: 4, net_revenue: 200, planned_hours: 10 })],
      },
    }), ['111', '112'], [
      { departmentKeys: ['111'], key: 'shop:801', label: '北大街', storeKeys: ['801'], type: 'store' },
      { departmentKeys: ['112'], key: 'shop:803', label: '科技路', storeKeys: ['803'], type: 'store' },
    ]);

    expect(model.movingAverages).toEqual([]);
    expect(model.comparisonScopes).toEqual([
      expect.objectContaining({ id: 'scope:shop:801', label: '北大街', points: [expect.objectContaining({ actual_hours: 1, actual_revenue_per_hour: 100 })] }),
      expect.objectContaining({ id: 'scope:shop:803', label: '科技路', points: [expect.objectContaining({ actual_hours: 4, actual_revenue_per_hour: 50 })] }),
    ]);
    expect(laborComparisonSeries(model.comparisonScopes, 'hours')).toEqual([
      expect.objectContaining({ field: 'actual_hours', id: 'scope:shop:801:actual', label: '北大街 实际', points: [expect.objectContaining({ actual_hours: 1, actual_revenue_per_hour: 100 })] }),
      expect.objectContaining({ field: 'planned_hours', id: 'scope:shop:801:planned', label: '北大街 排班', points: [expect.objectContaining({ planned_hours: 10, planned_revenue_per_hour: 10 })] }),
      expect.objectContaining({ field: 'actual_hours', id: 'scope:shop:803:actual', label: '科技路 实际', points: [expect.objectContaining({ actual_hours: 4, actual_revenue_per_hour: 50 })] }),
      expect.objectContaining({ field: 'planned_hours', id: 'scope:shop:803:planned', label: '科技路 排班', points: [expect.objectContaining({ planned_hours: 10, planned_revenue_per_hour: 20 })] }),
    ]);
    expect(model.points[0]).toMatchObject({ actual_hours: 5, period_start: '2026-07-13', period_end: '2026-07-19' });
  });

  it('preserves a valid zero period while returning null efficiency', () => {
    const model = buildLaborChartModel(trend({ points: [point({ actual_hours: 0, net_revenue: 0, planned_hours: 0 })] }), ['111']);

    expect(model.points[0]).toMatchObject({ actual_revenue_per_hour: null, availability: 'visible', planned_revenue_per_hour: null });
  });

  it('summarizes only visible chart periods before recomputing efficiency', () => {
    const model = buildLaborChartModel(trend({ points: [
      point({ actual_hours: 10, headcount: 2, net_revenue: 1_000, period: '2026-W29', planned_hours: 10 }),
      point({ actual_hours: 2, headcount: 1, hours_synced: true, net_revenue: 1_000, period: '2026-W30', planned_hours: 100 }),
    ] }), ['111']);

    expect(summarizeLaborPoints(model.points)).toEqual({
      actualEfficiency: 100,
      actualHours: 10,
      headcount: 2,
      netRevenue: 1_000,
      plannedEfficiency: 100,
      plannedHours: 10,
    });
  });
});
