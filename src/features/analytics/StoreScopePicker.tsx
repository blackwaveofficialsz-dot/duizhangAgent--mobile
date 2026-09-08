import { Check, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { normalizeScopeKeys, type StoreScopeNode } from './storeScope';

type Props = {
  nodes: StoreScopeNode[];
  onChange: (keys: string[]) => void;
  selectedKeys: string[];
};

export function StoreScopePicker({ nodes, onChange, selectedKeys }: Props) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const toggle = (key: string) => {
    const next = key === 'ALL'
      ? ['ALL']
      : selectedKeys.includes(key) ? selectedKeys.filter((item) => item !== key) : [...selectedKeys, key];
    onChange(normalizeScopeKeys(selectedKeys, next));
  };
  const renderNode = (node: StoreScopeNode, depth: number) => {
    const selected = selectedKeys.includes(node.key);
    const children = visibleChildren(node);
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.includes(node.key);
    return <View key={node.key}>
      <View style={[styles.row, { paddingLeft: depth * 18 }]}>
        {hasChildren ? <Pressable
          accessibilityLabel={`${isCollapsed ? '展开' : '收起'} ${node.label}`}
          accessibilityRole="button"
          onPress={() => setCollapsed((current) => current.includes(node.key) ? current.filter((key) => key !== node.key) : [...current, node.key])}
          style={styles.expandButton}
        >{isCollapsed ? <ChevronRight color={theme.text.secondary} size={18} /> : <ChevronDown color={theme.text.secondary} size={18} />}</Pressable> : <View style={styles.expandSpace} />}
        <Pressable
          accessibilityLabel={`选择范围 ${node.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          onPress={() => toggle(node.key)}
          style={styles.selectButton}
        >
          <View style={[styles.checkbox, selected && styles.checkboxActive]}>{selected ? <Check color={theme.action.onPrimary} size={14} /> : null}</View>
          <Text numberOfLines={1} style={styles.nodeLabel}>{node.label}</Text>
        </Pressable>
      </View>
      {!isCollapsed ? children.map((child) => renderNode(child, depth + 1)) : null}
    </View>;
  };

  const allSelected = selectedKeys.includes('ALL');
  return <View style={styles.tree}>
    <Pressable
      accessibilityLabel="选择范围 全部门店"
      accessibilityRole="button"
      accessibilityState={{ selected: allSelected }}
      onPress={() => toggle('ALL')}
      style={styles.allRow}
    >
      <View style={[styles.checkbox, allSelected && styles.checkboxActive]}>{allSelected ? <Check color={theme.action.onPrimary} size={14} /> : null}</View>
      <Text style={styles.nodeLabel}>全部门店</Text>
    </Pressable>
    {nodes.map((node) => renderNode(node, 0))}
  </View>;
}

function visibleChildren(node: StoreScopeNode): StoreScopeNode[] {
  const children = node.children ?? [];
  return node.type === 'department' && children.length === 1 && children[0].type === 'store'
    ? []
    : children;
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    tree: { borderBottomColor: theme.border.default, borderTopColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, borderTopWidth: StyleSheet.hairlineWidth },
    allRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 44, paddingHorizontal: 4 },
    row: { alignItems: 'center', flexDirection: 'row', minHeight: 44 },
    expandButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 32 },
    expandSpace: { width: 32 },
    selectButton: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 10, minHeight: 44, paddingRight: 8 },
    checkbox: { alignItems: 'center', borderColor: theme.border.strong, borderRadius: 4, borderWidth: 1, height: 22, justifyContent: 'center', width: 22 },
    checkboxActive: { backgroundColor: theme.action.primary, borderColor: theme.action.primary },
    nodeLabel: { color: theme.text.primary, flexShrink: 1, fontSize: 14, letterSpacing: 0 },
  });
}
