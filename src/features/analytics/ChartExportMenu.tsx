import { Download, FileImage, FileSpreadsheet, Share2, X } from 'lucide-react-native';
import { useMemo, useState, type RefObject } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type View as NativeView } from 'react-native';
import { showToast } from '@/components/feedback/AppToast';
import type { PreviousPeriod } from '@/services/api/operationsAnalytics';
import { saveChartPng, shareChartPng, shareChartWorkbook, type ChartComparisonSummaryRow, type ChartExportColumn, type ChartExportSeries } from '@/services/files/shareChart';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { TrendGranularity } from './trendPeriod';

type Props = {
  captureTarget: RefObject<NativeView | null>;
  comparisonSummaryRows?: ChartComparisonSummaryRow[];
  dateFrom: string;
  dateTo: string;
  excludedDates?: string[];
  extraColumns?: ChartExportColumn[];
  granularity: TrendGranularity;
  hiddenSeriesIds?: string[];
  includeOrderCount?: boolean;
  previousPeriod?: PreviousPeriod | null;
  scopeLabel?: string;
  series: ChartExportSeries[];
  seriesMetrics?: ChartExportColumn[];
  title: string;
};

export function ChartExportMenu(props: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: 'png' | 'share' | 'xlsx') => {
    setBusy(true);
    try {
      if (action === 'xlsx') await shareChartWorkbook(props);
      else if (action === 'png') {
        await saveChartPng(props.captureTarget, props);
        showToast('PNG 已保存到系统相册', 'success');
      } else {
        await shareChartPng(props.captureTarget, { ...props, dialogTitle: `分享${props.title}` });
      }
      setOpen(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : '图表导出失败，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <Pressable accessibilityLabel={`导出${props.title}`} accessibilityRole="button" onPress={() => setOpen(true)} style={styles.iconButton}>
      <Download color={theme.text.primary} size={19} />
    </Pressable>
    <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
      <Pressable accessibilityLabel="关闭图表导出" onPress={() => setOpen(false)} style={styles.backdrop} />
      <View accessibilityViewIsModal style={styles.menu}>
        <View style={styles.header}><Text style={styles.title}>导出图表</Text><Pressable accessibilityLabel="关闭图表导出" accessibilityRole="button" onPress={() => setOpen(false)} style={styles.iconButton}><X color={theme.text.primary} size={19} /></Pressable></View>
        <ExportAction disabled={busy} icon={<FileImage color={theme.text.primary} size={20} />} label="保存 PNG" onPress={() => void run('png')} styles={styles} />
        <ExportAction disabled={busy} icon={<FileSpreadsheet color={theme.text.primary} size={20} />} label="导出 XLSX" onPress={() => void run('xlsx')} styles={styles} />
        <ExportAction disabled={busy} icon={<Share2 color={theme.text.primary} size={20} />} label="系统分享" onPress={() => void run('share')} styles={styles} />
      </View>
    </Modal>
  </>;
}

function ExportAction({ disabled, icon, label, onPress, styles }: { disabled: boolean; icon: React.ReactNode; label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.action, disabled && styles.disabled]}>{icon}<Text style={styles.actionText}>{label}</Text></Pressable>;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
    backdrop: { backgroundColor: theme.overlay.scrim, bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
    menu: { backgroundColor: theme.background.surface, borderRadius: 8, bottom: 24, left: 16, paddingBottom: 8, position: 'absolute', right: 16 },
    header: { alignItems: 'center', borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', justifyContent: 'space-between', paddingLeft: 16 },
    title: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    action: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 52, paddingHorizontal: 16 },
    actionText: { color: theme.text.primary, fontSize: 15, letterSpacing: 0 },
    disabled: { opacity: 0.45 },
  });
}
