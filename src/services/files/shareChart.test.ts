import { shareWorkbook } from './shareWorkbook';
import { buildChartExportMetadata, buildChartExportRows, chartExportFileName, shareChartWorkbook } from './shareChart';

jest.mock('./shareWorkbook', () => ({ shareWorkbook: jest.fn() }));

const mockShareWorkbook = jest.mocked(shareWorkbook);

const points = [
  { period: '2026-W28', period_start: '2026-07-06', period_end: '2026-07-12', net_income: 1200, order_count: 80, ma4: 1100, missing: false },
  { period: '2026-W29', period_start: '2026-07-13', period_end: '2026-07-19', net_income: 1800, order_count: 120, ma4: 1400, missing: false, in_progress: true },
];

describe('shareChart', () => {
  beforeEach(() => mockShareWorkbook.mockReset().mockResolvedValue(undefined));

  it('exports all raw series while recording which series were visible', () => {
    const rows = buildChartExportRows({
      hiddenSeriesIds: ['revenue:ma4'],
      series: [
        { available: true, field: 'net_income', id: 'revenue:net', label: '净实收', points, primary: true, styleIndex: 0 },
        { available: true, field: 'ma4', id: 'revenue:ma4', label: 'MA4', points, primary: false, styleIndex: 1 },
        { available: false, field: 'ma12', id: 'revenue:ma12', label: 'MA12（数据不足 6/12）', points, primary: false, styleIndex: 2 },
      ],
    });

    expect(rows).toEqual([
      { 周期: '2026-W28', 开始日期: '2026-07-06', 结束日期: '2026-07-12', 订单数: 80, 净实收: 1200, MA4: 1100, 'MA12（数据不足 6/12）': '', 状态: '' },
      { 周期: '2026-W29', 开始日期: '2026-07-13', 结束日期: '2026-07-19', 订单数: 120, 净实收: 1800, MA4: 1400, 'MA12（数据不足 6/12）': '', 状态: '进行中，截至昨日' },
    ]);
    expect(buildChartExportMetadata({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
      granularity: 'week',
      hiddenSeriesIds: ['revenue:ma4'],
      series: [
        { available: true, field: 'net_income', id: 'revenue:net', label: '净实收', points, primary: true, styleIndex: 0 },
        { available: true, field: 'ma4', id: 'revenue:ma4', label: 'MA4', points, primary: false, styleIndex: 1 },
      ],
      title: '营收趋势-北区',
    })).toEqual([
      { 项目: '图表', 内容: '营收趋势-北区' },
      { 项目: '统计周期', 内容: '周' },
      { 项目: '日期范围', 内容: '2026-07-01 至 2026-07-20' },
      { 项目: '对比区间', 内容: '不对比' },
      { 项目: '全部系列', 内容: '净实收、MA4' },
      { 项目: '导出时可见系列', 内容: '净实收' },
    ]);
  });

  it('builds a filesystem-safe name containing granularity and date range', () => {
    expect(chartExportFileName('营收趋势 / 北区', 'week', '2026-07-01', '2026-07-20', 'xlsx')).toBe(
      '营收趋势-北区-周-2026-07-01_2026-07-20.xlsx',
    );
  });

  it('delegates workbook writing and cleanup to the shared exporter', async () => {
    await shareChartWorkbook({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
      granularity: 'week',
      series: [{ field: 'net_income', id: 'revenue:net', label: '净实收', points }],
      title: '营收趋势',
    });

    expect(mockShareWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      fileName: '营收趋势-周-2026-07-01_2026-07-20.xlsx',
      sheets: [expect.objectContaining({ name: '趋势数据' }), expect.objectContaining({ name: '导出说明' })],
      title: '营收趋势',
    }));
  });

  it('records the labor comparison period and excluded dates in export metadata', () => {
    expect(buildChartExportMetadata({
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
      excludedDates: ['2026-07-06', '2026-07-13'],
      granularity: 'week',
      previousPeriod: { date_from: '2026-06-10', date_to: '2026-06-29' },
      series: [{ field: 'actual_hours', id: 'labor:actual', label: '实际工时', points }],
      title: '工时趋势',
    } as never)).toEqual(expect.arrayContaining([
      { 项目: '对比区间', 内容: '2026-06-10 至 2026-06-29' },
      { 项目: '缺失/排除日期', 内容: '2026-07-06、2026-07-13' },
    ]));
  });

  it('keeps missing periods blank and does not overwrite duplicate series labels', () => {
    const missingPoints = [{ ...points[0], missing: true }];
    const rows = buildChartExportRows({
      series: [
        { field: 'net_income', id: 'source:shop', label: '净实收', points: missingPoints, primary: true, styleIndex: 0 },
        { field: 'ma4', id: 'source:takeout', label: '净实收', points: missingPoints, primary: false, styleIndex: 1 },
      ],
    });

    expect(rows).toEqual([expect.objectContaining({
      订单数: '',
      净实收: '',
      '净实收 (2)': '',
    })]);
  });

  it('keeps duplicate series labels bound to their own source points', () => {
    const rows = buildChartExportRows({
      series: [
        { field: 'net_income', id: 'source:shop', label: '净实收', points: [{ ...points[0], net_income: 800 }], primary: true, styleIndex: 0 },
        { field: 'net_income', id: 'source:takeout', label: '净实收', points: [{ ...points[0], net_income: 400 }], primary: true, styleIndex: 1 },
      ],
    });

    expect(rows).toEqual([expect.objectContaining({ 净实收: 800, '净实收 (2)': 400 })]);
  });

  it('keeps product sales, orders, and missing markers alongside the visible quantity series', () => {
    const rows = buildChartExportRows({
      seriesMetrics: [{ field: 'quantity', label: '销量' }, { field: 'sales_amount', label: '销售额' }, { field: 'order_count', label: '订单数' }],
      series: [{
        available: true,
        field: 'quantity',
        id: 'product:quantity',
        label: '销量',
        points: [
          { period: '2026-07-16', period_start: '2026-07-16', period_end: '2026-07-16', quantity: 15, sales_amount: 390, order_count: 12, missing: false },
          { period: '2026-07-17', period_start: '2026-07-17', period_end: '2026-07-17', quantity: 0, sales_amount: 0, order_count: 0, missing: true },
        ],
        primary: true,
        styleIndex: 0,
      }],
    });

    expect(rows).toEqual([
      { 周期: '2026-07-16', 开始日期: '2026-07-16', 结束日期: '2026-07-16', 订单数: 12, 销量: 15, 销售额: 390, 缺失标记: '', 状态: '' },
      { 周期: '2026-07-17', 开始日期: '2026-07-17', 结束日期: '2026-07-17', 订单数: '', 销量: '', 销售额: '', 缺失标记: '缺失', 状态: '数据不完整' },
    ]);
  });

  it('exports each product range with matching quantity sales and orders while retaining hidden ranges', () => {
    const rows = buildChartExportRows({
      hiddenSeriesIds: ['scope:south'],
      seriesMetrics: [{ field: 'quantity', label: '销量' }, { field: 'sales_amount', label: '销售额' }, { field: 'order_count', label: '订单数' }],
      series: [
        {
          field: 'quantity', id: 'scope:north', label: '北区', primary: true,
          points: [{ period: '2026-W27', period_start: '2026-06-29', period_end: '2026-07-05', quantity: 4, sales_amount: 80, order_count: 2, missing: false }],
        },
        {
          field: 'quantity', id: 'scope:south', label: '南区', primary: true,
          points: [{ period: '2026-W27', period_start: '2026-06-29', period_end: '2026-07-05', quantity: 5, sales_amount: 125, order_count: 3, missing: false }],
        },
      ],
    });

    expect(rows).toEqual([{
      周期: '2026-W27', 开始日期: '2026-06-29', 结束日期: '2026-07-05',
      '北区 销量': 4, '北区 销售额': 80, '北区 订单数': 2,
      '南区 销量': 5, '南区 销售额': 125, '南区 订单数': 3,
      缺失标记: '', 状态: '',
    }]);
  });

  it('exports labor hours with scope, headcount, and missing markers without order columns', () => {
    const rows = buildChartExportRows({
      includeOrderCount: false,
      extraColumns: [{ field: 'headcount', label: '人数' }],
      scopeLabel: '事业一部',
      series: [
        {
          field: 'actual_hours', id: 'labor-hours:actual', label: '实际工时', primary: true,
          points: [{ period: '2026-W28', period_start: '2026-07-06', period_end: '2026-07-12', actual_hours: 38, headcount: 12, missing: false }],
        },
        {
          field: 'planned_hours', id: 'labor-hours:planned', label: '排班工时', primary: true,
          points: [{ period: '2026-W28', period_start: '2026-07-06', period_end: '2026-07-12', planned_hours: 40, headcount: 12, missing: false }],
        },
      ],
    });

    expect(rows).toEqual([{
      周期: '2026-W28', 开始日期: '2026-07-06', 结束日期: '2026-07-12', 范围: '事业一部',
      实际工时: 38, 排班工时: 40, 人数: 12, 缺失标记: '', 状态: '',
    }]);
    expect(rows[0]).not.toHaveProperty('订单数');
  });

  it('writes labor comparison values to a dedicated interval summary sheet', async () => {
    const trendRows = buildChartExportRows({
      includeOrderCount: false,
      series: [{
        field: 'actual_hours', id: 'labor:actual', label: '实际工时', primary: true,
        points: [{ actual_hours: 30, missing: false, period: '2026-W28' }],
      }],
    });
    const comparisonSummaryRows = [
      { 统计范围: '统计区间汇总', 指标: '实际工时', 本期: 30, 上期: 27, 差额: 3, 变动率: 0.1111 },
      { 统计范围: '统计区间汇总', 指标: '排班工时', 本期: 33, 上期: 30, 差额: 3, 变动率: 0.1 },
    ];

    expect(trendRows).toEqual([expect.not.objectContaining({ 实际工时本期: 30 })]);
    await shareChartWorkbook({
      comparisonSummaryRows,
      dateFrom: '2026-07-01',
      dateTo: '2026-07-20',
      granularity: 'week',
      includeOrderCount: false,
      series: [{
        field: 'actual_hours', id: 'labor:actual', label: '实际工时', primary: true,
        points: [{ actual_hours: 30, missing: false, period: '2026-W28' }],
      }],
      title: '工时趋势',
    } as never);

    expect(mockShareWorkbook).toHaveBeenCalledWith(expect.objectContaining({
      sheets: [
        expect.objectContaining({ name: '趋势数据', rows: trendRows }),
        { name: '对比汇总', rows: comparisonSummaryRows },
        expect.objectContaining({ name: '导出说明' }),
      ],
    }));
  });
});
