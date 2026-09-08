import { X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { PlatformDim, ProductDimension, ProductQueryScope } from '@/services/api/analytics';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { beijingToday } from '@/utils/time';
import { AnalyticsCalendar } from './AnalyticsCalendar';
import { analyticsDateRange, createAnalyticsFilters, latestAnalyticsDate, type AnalyticsFilters } from './analyticsFilters';
import type { AnalyticsStoreOption } from './analyticsStore';
import { StoreScopePicker } from './StoreScopePicker';
import type { StoreScopeNode } from './storeScope';
import { defaultTrendRange, normalizeTrendRange } from './trendPeriod';
import { TrendPeriodControls } from './TrendPeriodControls';

export type ProductScope = ProductQueryScope;

type Props = {
  filters: AnalyticsFilters;
  onApply: (filters: AnalyticsFilters, scope: ProductScope) => void;
  onClose: () => void;
  platforms: PlatformDim[];
  scope: ProductScope;
  scopeTree?: StoreScopeNode[];
  stores: AnalyticsStoreOption[];
  today?: string;
  visible: boolean;
};

const DIMENSIONS: Array<{ key: ProductDimension; label: string }> = [
  { key: 'all', label: '整合' },
  { key: 'shop', label: '分店铺' },
  { key: 'platform', label: '分平台' },
  { key: 'channel', label: '堂食/外卖' },
];

export const DEFAULT_PRODUCT_SCOPE: ProductScope = { dimKey: 'ALL', dimType: 'all' };

export function ProductFilterSheet({ filters, onApply, onClose, platforms, scope, scopeTree, stores, today = beijingToday(), visible }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [draftFilters, setDraftFilters] = useState(filters);
  const [draftScope, setDraftScope] = useState(scope);
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraftFilters(filters);
    setDraftScope(scope);
    setCustomOpen(false);
  }, [filters, scope, visible]);

  const setPreset = (preset: 'last10' | 'last30' | 'lastMonth') => {
    setCustomOpen(false);
    setDraftFilters((current) => ({ ...current, ...analyticsDateRange(preset, today) }));
  };
  const selectDimension = (dimType: ProductDimension) => {
    const dimKey = defaultDimKey(dimType, draftFilters, platforms);
    setDraftScope({ dimKey, dimType });
  };
  const selectStore = (dimKey: string) => {
    setDraftFilters((current) => ({ ...current, storeKey: dimKey, storeKeys: [dimKey] }));
    setDraftScope({ dimKey, dimType: 'shop' });
  };
  const reset = () => {
    setDraftFilters({ ...createAnalyticsFilters(today), ...defaultTrendRange('week', today), granularity: 'week' });
    setDraftScope(DEFAULT_PRODUCT_SCOPE);
    setCustomOpen(false);
  };
  const apply = () => {
    const granularity = draftFilters.granularity ?? 'day';
    const [dateFrom, dateTo] = normalizeTrendRange(granularity, draftFilters.dateFrom, draftFilters.dateTo, Boolean(draftFilters.includeCurrent), today);
    onApply({ ...draftFilters, dateFrom, dateTo, granularity }, draftScope);
    onClose();
  };
  const values = productDimensionValues(draftScope.dimType, stores, platforms);

  return <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
    <Pressable accessibilityLabel="关闭筛选" onPress={onClose} style={styles.backdrop} />
    <View accessibilityViewIsModal style={styles.sheet}>
      <View style={styles.header}><Text style={styles.title}>筛选条件</Text><Pressable accessibilityLabel="关闭筛选" accessibilityRole="button" onPress={onClose} style={styles.iconButton}><X color={theme.text.primary} size={20} /></Pressable></View>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <TrendPeriodControls filters={draftFilters} onChange={setDraftFilters} today={today} />
        <Text style={styles.label}>日期区间</Text>
        {(draftFilters.granularity ?? 'day') === 'day' ? <View style={styles.quickRanges}>
          {([['last10', '近10日'], ['last30', '近30日'], ['lastMonth', '上月']] as const).map(([value, label]) => <Pressable accessibilityRole="button" key={value} onPress={() => setPreset(value)} style={styles.quickButton}><Text style={styles.quickText}>{label}</Text></Pressable>)}
          <Pressable accessibilityRole="button" onPress={() => setCustomOpen((open) => !open)} style={[styles.quickButton, customOpen && styles.optionActive]}><Text style={[styles.quickText, customOpen && styles.optionTextActive]}>自定义</Text></Pressable>
        </View> : <Pressable accessibilityRole="button" onPress={() => setDraftFilters((current) => ({ ...current, ...defaultTrendRange(current.granularity ?? 'week', today) }))} style={styles.periodReset}><Text style={styles.quickText}>最近 5 个完整{draftFilters.granularity === 'month' ? '月' : '周'}</Text></Pressable>}
        <Pressable accessibilityLabel={`已选区间 ${draftFilters.dateFrom} 至 ${draftFilters.dateTo}`} accessibilityRole="button" accessibilityState={{ expanded: customOpen }} onPress={() => setCustomOpen((open) => !open)} style={styles.dateSummary}><Text style={styles.dateSummaryLabel}>已选区间</Text><Text style={styles.dateSummaryValue}>{draftFilters.dateFrom} 至 {draftFilters.dateTo}</Text></Pressable>
        {customOpen ? <AnalyticsCalendar dateFrom={draftFilters.dateFrom} dateTo={draftFilters.dateTo} maxDate={latestAnalyticsDate(today)} onChange={(dateFrom, dateTo) => setDraftFilters((current) => ({ ...current, dateFrom, dateTo }))} /> : null}

        <Text style={styles.label}>分析维度</Text>
        <View style={styles.options}>{DIMENSIONS.map((item) => <Choice accessibilityLabel={`选择分析维度 ${item.label}`} key={item.key} label={item.label} onPress={() => selectDimension(item.key)} selected={draftScope.dimType === item.key} styles={styles} theme={theme} />)}</View>

        {draftScope.dimType !== 'all' && draftScope.dimType !== 'shop' ? <>
          <Text style={styles.label}>{dimensionValueLabel(draftScope.dimType)}</Text>
          {values.length ? <View style={styles.options}>{values.map((item) => <Choice accessibilityLabel={`选择${dimensionValueLabel(draftScope.dimType)} ${item.label}`} key={item.key} label={item.label} onPress={() => setDraftScope((current) => ({ ...current, dimKey: item.key }))} selected={draftScope.dimKey === item.key} styles={styles} theme={theme} />)}</View> : <Text style={styles.empty}>暂无可选项</Text>}
        </> : null}

        {draftScope.dimType === 'shop' ? <>
          <Text style={styles.label}>{scopeTree?.length ? '经营范围' : '门店范围'}</Text>
          {scopeTree?.length ? <StoreScopePicker nodes={scopeTree} onChange={(scopeKeys) => setDraftFilters((current) => ({ ...current, scopeKeys }))} selectedKeys={draftFilters.scopeKeys ?? ['ALL']} /> : <View style={styles.options}>{[{ key: 'ALL', label: '全部门店' }, ...stores].map((store) => <Choice accessibilityLabel={`选择门店 ${store.label}`} key={store.key} label={store.label} onPress={() => selectStore(store.key)} selected={draftScope.dimKey === store.key} styles={styles} theme={theme} />)}</View>}
        </> : null}
      </ScrollView>
      <View style={styles.actions}><Pressable accessibilityRole="button" onPress={reset} style={styles.reset}><Text style={styles.resetText}>重置</Text></Pressable><Pressable accessibilityRole="button" onPress={apply} style={styles.confirm}><Text style={styles.confirmText}>确定</Text></Pressable></View>
    </View>
  </Modal>;
}

export function effectiveProductScope(scope: ProductScope): ProductScope {
  return scope.dimType === 'shop' && scope.dimKey === 'ALL' ? DEFAULT_PRODUCT_SCOPE : scope;
}

export function productScopeLabel(scope: ProductScope, stores: AnalyticsStoreOption[], platforms: PlatformDim[]): string {
  const effective = effectiveProductScope(scope);
  if (effective.dimType === 'all') return '整合 · 全部门店';
  const dimension = DIMENSIONS.find((item) => item.key === effective.dimType)?.label ?? '整合';
  const selected = productDimensionValues(effective.dimType, stores, platforms).find((item) => item.key === effective.dimKey)?.label ?? '已选范围';
  return `${dimension} · ${selected}`;
}

function Choice({ accessibilityLabel, label, onPress, selected, styles, theme }: { accessibilityLabel: string; label: string; onPress: () => void; selected: boolean; styles: ReturnType<typeof createStyles>; theme: AppTheme }) {
  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.option, selected && styles.optionActive]}><Text numberOfLines={1} style={[styles.optionText, selected && styles.optionTextActive]}>{label}</Text></Pressable>;
}

function defaultDimKey(dimType: ProductDimension, filters: AnalyticsFilters, platforms: PlatformDim[]): string {
  if (dimType === 'all') return 'ALL';
  if (dimType === 'shop') return filters.storeKey || 'ALL';
  if (dimType === 'platform') return String(platforms[0]?.platform_code ?? 'ALL');
  return 'shop';
}

function productDimensionValues(dimType: ProductDimension, stores: AnalyticsStoreOption[], platforms: PlatformDim[]): Array<{ key: string; label: string }> {
  if (dimType === 'shop') return [{ key: 'ALL', label: '全部门店' }, ...stores];
  if (dimType === 'platform') return platforms.map((item) => ({ key: String(item.platform_code), label: item.platform_name || `平台 ${item.platform_code}` }));
  if (dimType === 'channel') return [{ key: 'shop', label: '堂食' }, { key: 'takeout', label: '外卖' }];
  return [];
}

function dimensionValueLabel(dimType: ProductDimension): string {
  if (dimType === 'platform') return '平台';
  if (dimType === 'channel') return '堂食/外卖';
  return '';
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    backdrop: { backgroundColor: theme.overlay.scrim, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    sheet: { backgroundColor: theme.background.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, bottom: 0, left: 0, maxHeight: '88%', paddingBottom: 12, position: 'absolute', right: 0 },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
    title: { color: theme.text.primary, fontSize: 18, fontWeight: '600', letterSpacing: 0, paddingLeft: 16 },
    iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    scrollContent: { gap: 10, paddingBottom: 12, paddingHorizontal: 16 },
    label: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, marginTop: 2 },
    quickRanges: { flexDirection: 'row', gap: 6 },
    periodReset: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, height: 38, justifyContent: 'center' },
    quickButton: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flex: 1, height: 38, justifyContent: 'center' },
    quickText: { color: theme.text.primary, fontSize: 12, letterSpacing: 0 },
    dateSummary: { alignItems: 'center', backgroundColor: theme.background.subtle, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 12 },
    dateSummaryLabel: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    dateSummaryValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    option: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, height: 40, justifyContent: 'center', maxWidth: '100%', minWidth: 96, paddingHorizontal: 14 },
    optionActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    optionText: { color: theme.text.primary, fontSize: 13, letterSpacing: 0 },
    optionTextActive: { color: theme.action.onPrimary },
    empty: { color: theme.text.muted, fontSize: 12, letterSpacing: 0 },
    actions: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
    reset: { alignItems: 'center', borderColor: theme.border.strong, borderRadius: 8, borderWidth: 1, flex: 1, height: 48, justifyContent: 'center' },
    resetText: { color: theme.text.primary, fontSize: 15, letterSpacing: 0 },
    confirm: { alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 8, flex: 1, height: 48, justifyContent: 'center' },
    confirmText: { color: theme.action.onPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
  });
}
