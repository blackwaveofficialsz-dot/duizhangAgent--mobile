import {
  analyticsDateRange,
  createAnalyticsFilters,
  createDashboardAnalyticsFilters,
  createAnalyticsRequestGate,
  laborChartNavigationParams,
  normalizeStoreSelection,
  serializeAnalyticsFilters,
} from './analyticsFilters';

describe('analyticsFilters', () => {
  it('keeps shared insights on 30 days and gives the dashboard its own 10-day default', () => {
    const filters = createAnalyticsFilters('2026-07-16');

    expect(filters).toEqual({
      dateFrom: '2026-06-16',
      dateTo: '2026-07-15',
      granularity: 'day',
      includeCurrent: false,
      sourceType: 'all',
      storeKey: 'ALL',
      storeKeys: ['ALL'],
    });
    expect(createDashboardAnalyticsFilters('2026-07-16')).toMatchObject({
      dateFrom: '2026-07-06',
      dateTo: '2026-07-15',
      scopeKeys: ['ALL'],
    });
    expect(serializeAnalyticsFilters({ ...filters, sourceType: 'takeout', storeKey: 'shop-1', storeKeys: ['shop-1', 'shop-2'] })).toBe(
      'date_from=2026-06-16&date_to=2026-07-15&store_keys=shop-1&store_keys=shop-2&source_type=takeout&granularity=day&include_current=false',
    );
    expect(serializeAnalyticsFilters(filters)).toBe(
      'date_from=2026-06-16&date_to=2026-07-15&source_type=all&granularity=day&include_current=false',
    );
  });

  it('serializes store and explicit scope identities in a stable order', () => {
    const first = serializeAnalyticsFilters({
      ...createDashboardAnalyticsFilters('2026-07-16'),
      scopeKeys: ['shop:102', 'dept:north'],
      storeKeys: ['102', '101'],
    });
    const second = serializeAnalyticsFilters({
      ...createDashboardAnalyticsFilters('2026-07-16'),
      scopeKeys: ['dept:north', 'shop:102'],
      storeKeys: ['101', '102'],
    });

    expect(first).toBe(second);
    expect(first).toContain('scope_keys=dept%3Anorth');
    expect(first).toContain('scope_keys=shop%3A102');
  });

  it('builds the confirmed quick date ranges without including today', () => {
    expect(analyticsDateRange('last10', '2026-07-18')).toEqual({ dateFrom: '2026-07-08', dateTo: '2026-07-17' });
    expect(analyticsDateRange('last30', '2026-07-18')).toEqual({ dateFrom: '2026-06-18', dateTo: '2026-07-17' });
    expect(analyticsDateRange('lastMonth', '2026-07-18')).toEqual({ dateFrom: '2026-06-01', dateTo: '2026-06-30' });
  });

  it('keeps all stores mutually exclusive and removes duplicate store keys', () => {
    expect(normalizeStoreSelection(['ALL'], ['ALL', '101'])).toEqual(['101']);
    expect(normalizeStoreSelection(['101'], ['101', 'ALL'])).toEqual(['ALL']);
    expect(normalizeStoreSelection(['101'], ['101', '102', '101'])).toEqual(['101', '102']);
    expect(normalizeStoreSelection(['101'], [])).toEqual(['ALL']);
  });

  it('aborts the prior query and rejects stale responses after filters change', () => {
    const gate = createAnalyticsRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(first.signal.aborted).toBe(true);
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it('invalidates the current request when the signed-in identity is cleared', () => {
    const gate = createAnalyticsRequestGate();
    const request = gate.begin();

    gate.invalidate();

    expect(request.signal.aborted).toBe(true);
    expect(gate.isCurrent(request)).toBe(false);
  });

  it('builds stable labor navigation parameters for the shared chart and export layers', () => {
    expect(laborChartNavigationParams({
      ...createAnalyticsFilters('2026-07-16'),
      granularity: 'week',
      includeCurrent: true,
      scopeKeys: ['shop:102', 'dept:north', 'shop:102'],
      storeKeys: ['102', '101'],
    }, 'hours', ['112', '111', '112'])).toEqual({
      cacheKey: 'labor-dashboard-v5:date_from=2026-06-16&date_to=2026-07-15&store_keys=101&store_keys=102&scope_keys=dept%3Anorth&scope_keys=shop%3A102&source_type=all&granularity=week&include_current=true&comparison_mode=previous&metric_type=hours&department_keys=111&department_keys=112',
      dateFrom: '2026-06-16',
      dateTo: '2026-07-15',
      departmentKeys: '111,112',
      granularity: 'week',
      includeCurrent: 'true',
      laborMetric: 'hours',
      scopeKeys: 'dept:north,shop:102',
      sourceType: 'all',
      storeKeys: '101,102',
      type: 'labor-hours',
    });
  });

  it('keeps the all-scope sentinels in labor navigation instead of falling back to stale filters', () => {
    expect(laborChartNavigationParams(createAnalyticsFilters('2026-07-16'), 'efficiency', [])).toMatchObject({
      scopeKeys: 'ALL',
      storeKeys: 'ALL',
    });
  });
});
