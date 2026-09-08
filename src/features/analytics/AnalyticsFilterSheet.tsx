import { X } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { beijingToday } from '@/utils/time';
import { AnalyticsCalendar } from './AnalyticsCalendar';
import type { AnalyticsFilters } from './analyticsFilters';
import { analyticsDateRange, createAnalyticsFilters, latestAnalyticsDate, normalizeStoreSelection, storeKeyForSelection } from './analyticsFilters';
import { createOrderAnalyticsFilters, normalizeOrderDimensions, orderPeriodRange, type OrderDimension } from './orderAnalytics';
import type { AnalyticsStoreOption } from './analyticsStore';
import { StoreScopePicker } from './StoreScopePicker';
import type { StoreScopeNode } from './storeScope';
import { TrendPeriodControls } from './TrendPeriodControls';
import { defaultTrendRange, normalizeTrendRange } from './trendPeriod';

type Props = { allowMultipleStores?: boolean; filters: AnalyticsFilters; onApply: (filters: AnalyticsFilters) => void; onClose: () => void; periodSelection?: 'range' | 'single'; scopeTree?: StoreScopeNode[]; scopeWarning?: (scopeKeys: string[]) => string | undefined; showOrderDimensions?: boolean; showSource?: boolean; showTrendPeriod?: boolean; stores?: AnalyticsStoreOption[]; today?: string; visible: boolean };

export function AnalyticsFilterSheet({ allowMultipleStores = false, filters, onApply, onClose, periodSelection = 'range', scopeTree, scopeWarning, showOrderDimensions = false, showSource = true, showTrendPeriod = false, stores = [], today = beijingToday(), visible }: Props) {
  const singlePeriod = periodSelection === 'single';
  const showPeriodControls = showTrendPeriod || singlePeriod;
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [draft, setDraft] = useState(() => normalizeFilters(filters, showPeriodControls, showTrendPeriod));
  const [customOpen, setCustomOpen] = useState(false);
  useEffect(() => {
    if (visible) {
      setDraft(normalizeFilters(filters, showPeriodControls, showTrendPeriod));
      setCustomOpen(false);
    }
  }, [filters, showPeriodControls, showTrendPeriod, visible]);
  const apply = () => {
    if (!showPeriodControls) {
      const { scopeKeys: _scopeKeys, ...sharedFilters } = draft;
      onApply({ ...sharedFilters, granularity: 'day', includeCurrent: false });
      onClose();
      return;
    }
    const granularity = draft.granularity ?? 'day';
    const [dateFrom, dateTo] = singlePeriod
      ? (() => {
        const range = orderPeriodRange(granularity, draft.dateTo, Boolean(draft.includeCurrent), today);
        return [range.dateFrom, range.dateTo] as const;
      })()
      : normalizeTrendRange(granularity, draft.dateFrom, draft.dateTo, Boolean(draft.includeCurrent), today);
    onApply({ ...draft, dateFrom, dateTo, granularity });
    onClose();
  };
  const setPreset = (preset: 'last10' | 'last30' | 'lastMonth') => {
    setCustomOpen(false);
    setDraft((current) => ({ ...current, ...analyticsDateRange(preset, today) }));
  };
  const toggleStore = (key: string) => {
    setDraft((current) => {
      if (!allowMultipleStores) {
        const storeKeys = [key];
        return { ...current, storeKey: key, storeKeys };
      }
      const selected = current.storeKeys;
      const next = key === 'ALL'
        ? ['ALL']
        : selected.includes(key) ? selected.filter((item) => item !== key) : [...selected, key];
      const storeKeys = normalizeStoreSelection(selected, next);
      return { ...current, storeKey: storeKeyForSelection(storeKeys), storeKeys };
    });
  };
  const toggleOrderDimension = (dimension: OrderDimension) => {
    setDraft((current) => {
      const selected = current.orderDimensions ?? [];
      const next = selected.includes(dimension)
        ? selected.filter((item) => item !== dimension)
        : [...selected, dimension];
      return { ...current, orderDimensions: normalizeOrderDimensions(next) };
    });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable accessibilityLabel="关闭筛选" onPress={onClose} style={styles.backdrop} />
      <View accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>筛选条件</Text>
          <Pressable accessibilityLabel="关闭筛选" accessibilityRole="button" onPress={onClose} style={styles.iconButton}>
            <X color={theme.text.primary} size={20} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {singlePeriod ? <OrderPeriodControls filters={draft} onChange={setDraft} today={today} /> : showTrendPeriod ? <TrendPeriodControls filters={draft} onChange={setDraft} today={today} /> : null}
          <Text style={styles.label}>日期区间</Text>
          {!singlePeriod && (draft.granularity ?? 'day') === 'day' ? <View style={styles.quickRanges}>
            {([['last10', '近10日'], ['last30', '近30日'], ['lastMonth', '上月']] as const).map(([value, label]) => (
              <Pressable accessibilityRole="button" key={value} onPress={() => setPreset(value)} style={styles.quickButton}><Text style={styles.quickText}>{label}</Text></Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setCustomOpen((open) => !open)} style={[styles.quickButton, customOpen && styles.segmentActive]}><Text style={[styles.quickText, customOpen && styles.segmentTextActive]}>自定义</Text></Pressable>
          </View> : !singlePeriod ? <Pressable accessibilityRole="button" onPress={() => setDraft((current) => ({ ...current, ...defaultTrendRange(current.granularity ?? 'day', today) }))} style={styles.periodReset}><Text style={styles.quickText}>最近 5 个完整{draft.granularity === 'week' ? '周' : '月'}</Text></Pressable> : null}
          <Pressable accessibilityLabel={`已选区间 ${draft.dateFrom} 至 ${draft.dateTo}`} accessibilityRole="button" accessibilityState={{ expanded: customOpen }} onPress={() => setCustomOpen((open) => !open)} style={styles.dateSummary}>
            <Text style={styles.dateSummaryLabel}>已选区间</Text><Text style={styles.dateSummaryValue}>{draft.dateFrom} 至 {draft.dateTo}</Text>
          </Pressable>
          {customOpen ? <AnalyticsCalendar dateFrom={draft.dateFrom} dateTo={draft.dateTo} maxDate={latestAnalyticsDate(today)} onChange={(dateFrom, dateTo) => setDraft((current) => {
            if (singlePeriod) return { ...current, ...orderPeriodRange(current.granularity ?? 'day', dateTo, Boolean(current.includeCurrent), today) };
            if (!showTrendPeriod) return { ...current, dateFrom, dateTo };
            const normalized = normalizeTrendRange(current.granularity ?? 'day', dateFrom, dateTo, Boolean(current.includeCurrent), today);
            return { ...current, dateFrom: normalized[0], dateTo: normalized[1] };
          })} /> : null}
          <Text style={styles.label}>{scopeTree ? '经营范围' : '门店'}</Text>
          {scopeTree ? <StoreScopePicker nodes={scopeTree} onChange={(scopeKeys) => setDraft((current) => ({ ...current, scopeKeys }))} selectedKeys={draft.scopeKeys ?? ['ALL']} /> : <View style={styles.storeOptions}>
            {[{ key: 'ALL', label: '全部门店' }, ...stores].map((store) => {
              const selected = draft.storeKeys.includes(store.key);
              return <Pressable
                accessibilityLabel={`选择门店 ${store.label}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={store.key}
                onPress={() => toggleStore(store.key)}
                style={[styles.storeOption, selected && styles.segmentActive]}
              >
                <Text numberOfLines={1} style={[styles.segmentText, selected && styles.segmentTextActive]}>{store.label}</Text>
              </Pressable>;
            })}
          </View>}
          {scopeTree && scopeWarning?.(draft.scopeKeys ?? ['ALL']) ? <Text style={styles.scopeWarning}>{scopeWarning(draft.scopeKeys ?? ['ALL'])}</Text> : null}
          {showSource ? <>
            <Text style={styles.label}>订单来源</Text>
            <View style={styles.segmented}>
              {([['all', '全部'], ['shop', '堂食'], ['takeout', '外卖']] as const).map(([value, label]) => (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: draft.sourceType === value }} key={value} onPress={() => setDraft((current) => ({ ...current, sourceType: value }))} style={[styles.segment, draft.sourceType === value && styles.segmentActive]}>
                  <Text style={[styles.segmentText, draft.sourceType === value && styles.segmentTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </> : null}
          {showOrderDimensions ? <>
            <Text style={styles.label}>统计维度</Text>
            <View style={styles.segmented}>
              {([['shop', '分店铺'], ['platform', '分平台'], ['channel', '堂食/外卖']] as const).map(([value, label]) => {
                const selected = draft.orderDimensions?.includes(value) ?? false;
                return <Pressable accessibilityLabel={`订单维度 ${label}`} accessibilityRole="button" accessibilityState={{ selected }} key={value} onPress={() => toggleOrderDimension(value)} style={[styles.segment, selected && styles.segmentActive]}>
                  <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text>
                </Pressable>;
              })}
            </View>
          </> : null}
        </ScrollView>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={() => { setDraft(singlePeriod ? createOrderAnalyticsFilters(today) : createAnalyticsFilters(today)); setCustomOpen(false); }} style={styles.reset}><Text style={styles.resetText}>重置</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={apply} style={styles.confirm}><Text style={styles.confirmText}>确定</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
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
    quickButton: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flex: 1, height: 38, justifyContent: 'center' },
    periodReset: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, height: 40, justifyContent: 'center' },
    quickText: { color: theme.text.primary, fontSize: 12, letterSpacing: 0 },
    dateSummary: { alignItems: 'center', backgroundColor: theme.background.subtle, borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 12 },
    dateSummaryLabel: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    dateSummaryValue: { color: theme.text.primary, fontFamily: 'monospace', fontSize: 12, letterSpacing: 0 },
    segmented: { flexDirection: 'row', gap: 6 },
    storeOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    storeOption: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, height: 40, justifyContent: 'center', maxWidth: '100%', minWidth: 96, paddingHorizontal: 14 },
    segment: { alignItems: 'center', borderColor: theme.border.default, borderRadius: 8, borderWidth: 1, flex: 1, height: 40, justifyContent: 'center' },
    segmentActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    segmentText: { color: theme.text.primary, fontSize: 14, letterSpacing: 0 },
    segmentTextActive: { color: theme.action.onPrimary },
    scopeWarning: { color: theme.status.warning, fontSize: 12, letterSpacing: 0 },
    actions: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12 },
    reset: { alignItems: 'center', borderColor: theme.border.strong, borderRadius: 8, borderWidth: 1, flex: 1, height: 48, justifyContent: 'center' },
    resetText: { color: theme.text.primary, fontSize: 15, letterSpacing: 0 },
    confirm: { alignItems: 'center', backgroundColor: theme.action.primary, borderRadius: 8, flex: 1, height: 48, justifyContent: 'center' },
    confirmText: { color: theme.action.onPrimary, fontSize: 15, fontWeight: '600', letterSpacing: 0 },
  });
}

function normalizeFilters(filters: AnalyticsFilters, showPeriodControls: boolean, showTrendPeriod: boolean): AnalyticsFilters {
  const storeKeys = filters.storeKeys?.length ? filters.storeKeys : [filters.storeKey || 'ALL'];
  const normalized: AnalyticsFilters = {
    ...filters,
    granularity: showPeriodControls ? filters.granularity ?? 'day' : 'day',
    includeCurrent: showPeriodControls && Boolean(filters.includeCurrent),
    storeKey: storeKeyForSelection(storeKeys),
    storeKeys,
  };
  if (showTrendPeriod) normalized.scopeKeys = filters.scopeKeys?.length ? filters.scopeKeys : ['ALL'];
  else delete normalized.scopeKeys;
  return normalized;
}

function OrderPeriodControls({ filters, onChange, today }: { filters: AnalyticsFilters; onChange: (filters: AnalyticsFilters) => void; today: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const granularity = filters.granularity ?? 'day';
  return <>
    <Text style={styles.label}>统计周期</Text>
    <View accessibilityRole="tablist" style={styles.segmented}>
      {([['day', '日'], ['week', '周'], ['month', '月']] as const).map(([value, label]) => {
        const selected = value === granularity;
        return <Pressable accessibilityLabel={`按${label}`} accessibilityRole="button" accessibilityState={{ selected }} key={value} onPress={() => onChange({ ...filters, ...orderPeriodRange(value, filters.dateTo, Boolean(filters.includeCurrent), today), granularity: value })} style={[styles.segment, selected && styles.segmentActive]}>
          <Text style={[styles.segmentText, selected && styles.segmentTextActive]}>{label}</Text>
        </Pressable>;
      })}
    </View>
  </>;
}
