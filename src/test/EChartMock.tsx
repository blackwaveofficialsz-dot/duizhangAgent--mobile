import { createElement } from 'react';
import { View } from 'react-native';

export function EChart({ gestureMode = 'all', height, onDataIndexSelect, testID }: { gestureMode?: 'all' | 'tap'; height: number; onDataIndexSelect?: (index: number, selection?: unknown) => void; testID?: string }) {
  return createElement(View, {
    accessibilityLabel: gestureMode === 'tap' ? '图表手势：仅点按' : '图表手势：完整',
    onDataIndexSelect,
    style: { height },
    testID,
  } as never);
}
