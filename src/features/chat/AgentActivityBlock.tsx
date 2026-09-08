import { CheckCircle2, ChevronDown, ChevronUp, CircleDashed, XCircle } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import type { AgentActivity, AgentActivityStatus } from '@/types/chat';

type AgentActivityBlockProps = {
  activity: AgentActivity;
  testID: string;
};

const STATUS_LABELS: Record<AgentActivityStatus, string> = {
  running: '正在分析',
  completed: '已完成',
  partial: '结果不完整',
  empty: '暂无数据',
  unavailable: '暂不可用',
  failed: '分析失败',
  cancelled: '已停止',
  interrupted: '连接中断',
};

export function AgentActivityBlock({ activity, testID }: AgentActivityBlockProps) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const terminal = activity.status !== 'running';
  const [expanded, setExpanded] = useState(false);
  const currentStep = activity.steps.find((step) => step.status === 'running') ?? activity.steps.at(-1);
  const statusLabel = STATUS_LABELS[activity.status];
  const elapsed = formatElapsed(activity.total_duration_ms ?? activity.elapsed_ms);
  const Icon = statusIcon(activity.status);
  const color = statusColor(activity.status, theme);
  const summary = activity.status === 'completed'
    ? `已完成 ${activity.steps.length} 项分析活动 · ${elapsed}`
    : activity.status === 'running'
      ? currentStep?.label ?? activity.label
      : activity.label;

  useEffect(() => {
    if (terminal) setExpanded(false);
  }, [terminal]);

  return (
    <View accessibilityRole={activity.status === 'running' ? 'progressbar' : undefined} style={styles.block} testID={testID}>
      <Pressable
        accessibilityLabel={`${expanded ? '收起' : '展开'}分析活动`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.summary, pressed && styles.pressed]}
      >
        <Icon color={color} size={18} strokeWidth={2} />
        <View style={styles.summaryContent}>
          {activity.status === 'completed' ? (
            <Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.primary}>{summary}</Text>
          ) : (
            <>
              <Text accessibilityLiveRegion="polite" style={[styles.status, { color }]}>{statusLabel}</Text>
              <Text accessibilityLiveRegion="polite" numberOfLines={1} style={styles.primary}>{summary}</Text>
            </>
          )}
        </View>
        {activity.status !== 'completed' ? <Text style={styles.elapsed}>{elapsed}</Text> : null}
        {expanded ? <ChevronUp color={theme.text.secondary} size={18} strokeWidth={2} /> : <ChevronDown color={theme.text.secondary} size={18} strokeWidth={2} />}
      </Pressable>
      {expanded ? (
        <View style={styles.details}>
          {activity.steps.slice(0, 6).map((step) => (
            <View key={step.step_id} style={styles.step}>
              <Text style={styles.stepLabel}>{step.label}</Text>
              <Text style={styles.stepStatus}>{STATUS_LABELS[step.status]} · {formatElapsed(step.elapsed_ms)}</Text>
              {step.detail ? <Text style={styles.detail}>{step.detail}</Text> : null}
            </View>
          ))}
          {activity.scope.length ? <Text style={styles.meta}>范围：{activity.scope.slice(0, 3).join(' · ')}</Text> : null}
          {activity.sources.length ? <Text style={styles.meta}>来源：{activity.sources.slice(0, 3).join(' · ')}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function formatElapsed(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} 秒`;
}

function statusIcon(status: AgentActivityStatus) {
  if (status === 'completed') return CheckCircle2;
  if (status === 'failed' || status === 'unavailable' || status === 'cancelled' || status === 'interrupted') return XCircle;
  return CircleDashed;
}

function statusColor(status: AgentActivityStatus, theme: AppTheme): string {
  if (status === 'completed') return theme.status.success;
  if (status === 'failed') return theme.status.danger;
  if (status === 'running') return theme.status.info;
  return theme.status.warning;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    block: { backgroundColor: theme.background.subtle, borderColor: theme.border.default, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
    summary: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 },
    summaryContent: { flex: 1, minWidth: 0 },
    primary: { color: theme.text.primary, fontSize: 14, fontWeight: '600', letterSpacing: 0, lineHeight: 20 },
    status: { fontSize: 12, fontWeight: '600', letterSpacing: 0, lineHeight: 18 },
    elapsed: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0 },
    details: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, gap: 8, padding: 12 },
    step: { gap: 2 },
    stepLabel: { color: theme.text.primary, fontSize: 14, letterSpacing: 0, lineHeight: 20 },
    stepStatus: { color: theme.text.secondary, fontSize: 12, letterSpacing: 0, lineHeight: 18 },
    detail: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
    meta: { color: theme.text.secondary, fontSize: 13, letterSpacing: 0, lineHeight: 19 },
    pressed: { opacity: 0.62 },
  });
}
