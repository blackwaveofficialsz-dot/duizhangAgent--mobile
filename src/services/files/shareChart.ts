import { Directory, File, Paths } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import type { RefObject } from 'react';
import type { View } from 'react-native';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { trendPointStatusText, type TrendGranularity } from '@/features/analytics/trendPeriod';
import type { PreviousPeriod } from '@/services/api/operationsAnalytics';
import { shareWorkbook } from './shareWorkbook';

const EXPORT_DIRECTORY = 'chart-exports';

type ChartExportPoint = {
  missing?: boolean;
  order_count?: number | null;
  period: string;
  period_end?: string;
  period_start?: string;
  [field: string]: unknown;
};

export type ChartExportSeries = {
  available?: boolean;
  field?: string;
  id: string;
  label: string;
  points: ChartExportPoint[];
  primary?: boolean;
  styleIndex?: number;
};

export type ChartExportColumn = { field: string; label: string };
export type ChartComparisonSummaryRow = {
  上期: number | string;
  变动率: number | string;
  差额: number | string;
  指标: string;
  本期: number | string;
  统计范围: '统计区间汇总';
};
type ResolvedChartExportColumn = ChartExportColumn & { series?: ChartExportSeries };

type ChartExportData = {
  comparisonSummaryRows?: ChartComparisonSummaryRow[];
  excludedDates?: string[];
  extraColumns?: ChartExportColumn[];
  hiddenSeriesIds?: string[];
  includeOrderCount?: boolean;
  previousPeriod?: PreviousPeriod | null;
  scopeLabel?: string;
  series: ChartExportSeries[];
  seriesMetrics?: ChartExportColumn[];
};

type ChartFileInput = ChartExportData & {
  dateFrom: string;
  dateTo: string;
  granularity: TrendGranularity;
  title: string;
};

export function buildChartExportRows({ extraColumns = [], includeOrderCount = true, scopeLabel, series, seriesMetrics = [] }: ChartExportData): Array<Record<string, string | number>> {
  const periods = [...new Set(series.flatMap((item) => item.points.map((point) => point.period)))].sort();
  const primarySeries = series.filter((item) => item.primary ?? true);
  const columns = uniqueColumns([
    ...series.flatMap((item) => seriesMetrics.length && (item.primary ?? true)
      ? seriesMetrics.map((metric) => ({ ...metric, label: primarySeries.length > 1 ? `${item.label} ${metric.label}` : metric.label, series: item }))
      : [{ field: item.field ?? 'net_income', label: item.label, series: item }]),
    ...extraColumns,
  ]);
  return periods.map((period) => {
    const periodPoints = series.flatMap((item) => item.points.filter((point) => point.period === period));
    const reference = periodPoints[0];
    const orderCounts = primarySeries.flatMap((item) => {
      const point = item.points.find((candidate) => candidate.period === period);
      return !point?.missing && typeof point?.order_count === 'number' ? [point.order_count] : [];
    });
    const row: Record<string, string | number> = {
      周期: period,
      开始日期: reference?.period_start ?? period,
      结束日期: reference?.period_end ?? period,
    };
    if (scopeLabel) row.范围 = scopeLabel;
    if (includeOrderCount && !seriesMetrics.length) row.订单数 = orderCounts.length ? orderCounts.reduce((sum, value) => sum + value, 0) : '';
    for (const column of columns) {
      const point = column.series?.points.find((candidate) => candidate.period === period)
        ?? periodPoints.find((candidate) => Object.prototype.hasOwnProperty.call(candidate, column.field));
      const value = point?.[column.field];
      row[column.label] = !point?.missing && typeof value === 'number' ? value : '';
    }
    if (extraColumns.length || seriesMetrics.length) row.缺失标记 = periodPoints.some((point) => point.missing) ? '缺失' : '';
    row.状态 = trendPointStatusText(reference) ?? '';
    return row;
  });
}

function uniqueColumns(columns: ResolvedChartExportColumn[]): ResolvedChartExportColumn[] {
  const counts = new Map<string, number>();
  return columns.map((column) => {
    const count = (counts.get(column.label) ?? 0) + 1;
    counts.set(column.label, count);
    return { ...column, label: count === 1 ? column.label : `${column.label} (${count})` };
  });
}

export function buildChartExportMetadata(input: ChartFileInput): Array<{ 项目: string; 内容: string }> {
  const visibleSeries = input.series.filter((item) => item.available !== false && !input.hiddenSeriesIds?.includes(item.id));
  const periodLabel = input.granularity === 'week' ? '周' : input.granularity === 'month' ? '月' : '日';
  const metadata = [
    { 项目: '图表', 内容: input.title },
    { 项目: '统计周期', 内容: periodLabel },
    { 项目: '日期范围', 内容: `${input.dateFrom} 至 ${input.dateTo}` },
    { 项目: '对比区间', 内容: input.previousPeriod ? `${input.previousPeriod.date_from} 至 ${input.previousPeriod.date_to}` : '不对比' },
    { 项目: '全部系列', 内容: input.series.map((item) => item.label).join('、') },
    { 项目: '导出时可见系列', 内容: visibleSeries.map((item) => item.label).join('、') },
  ];
  if (input.excludedDates?.length) metadata.push({ 项目: '缺失/排除日期', 内容: input.excludedDates.join('、') });
  return metadata;
}

export function chartExportFileName(title: string, granularity: TrendGranularity, dateFrom: string, dateTo: string, extension: 'png' | 'xlsx'): string {
  const periodLabel = granularity === 'week' ? '周' : granularity === 'month' ? '月' : '日';
  const safeTitle = title.trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || '图表';
  return `${safeTitle}-${periodLabel}-${dateFrom}_${dateTo}.${extension}`;
}

export async function shareChartWorkbook(input: ChartFileInput): Promise<void> {
  const rows = buildChartExportRows(input);
  if (!rows.length) throw new Error('当前没有可导出的图表数据');
  await shareWorkbook({
    fileName: chartExportFileName(input.title, input.granularity, input.dateFrom, input.dateTo, 'xlsx'),
    sheets: [
      { name: '趋势数据', rows },
      ...(input.comparisonSummaryRows?.length ? [{ name: '对比汇总', rows: input.comparisonSummaryRows }] : []),
      { name: '导出说明', rows: buildChartExportMetadata(input) },
    ],
    title: input.title,
  });
}

export async function shareChartPng(target: RefObject<View | null>, input: Omit<ChartFileInput, 'series'> & { dialogTitle?: string }): Promise<void> {
  await assertSharingAvailable();
  await withChartPng(target, input, async (file) => {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: input.dialogTitle ?? `分享${input.title}`,
      mimeType: 'image/png',
      UTI: 'public.png',
    });
  });
}

export async function saveChartPng(target: RefObject<View | null>, input: Omit<ChartFileInput, 'series'>): Promise<void> {
  const permission = await MediaLibrary.requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('需要允许访问照片，才能保存 PNG');
  await withChartPng(target, input, async (file) => {
    await MediaLibrary.saveToLibraryAsync(file.uri);
  });
}

async function withChartPng(target: RefObject<View | null>, input: Omit<ChartFileInput, 'series'>, action: (file: File) => Promise<void>): Promise<void> {
  if (!target.current) throw new Error('图表尚未准备完成');
  const capturedUri = await captureRef(target, { format: 'png', quality: 1, result: 'tmpfile' });
  const file = createExportFile(chartExportFileName(input.title, input.granularity, input.dateFrom, input.dateTo, 'png'));
  try {
    await new File(capturedUri).copy(file, { overwrite: true });
    await action(file);
  } finally {
    deleteFile(file);
    releaseCapture(capturedUri);
  }
}

function createExportFile(name: string): File {
  const directory = new Directory(Paths.cache, EXPORT_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  const file = new File(directory, name);
  file.create({ intermediates: true, overwrite: true });
  return file;
}

async function assertSharingAvailable(): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw new Error('当前设备不支持系统分享');
}

function deleteFile(file: File): void {
  try { if (file.exists) file.delete(); } catch {}
}
