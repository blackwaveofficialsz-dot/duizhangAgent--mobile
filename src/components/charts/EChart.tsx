import SvgChart, { SVGRenderer } from '@wuba/react-native-echarts/svgChart';
import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components';
import { init, use, type EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { GestureType } from 'react-native-gesture-handler';

use([
  SVGRenderer,
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  DataZoomComponent,
]);

type ChartInstance = ReturnType<typeof init>;

export type EChartDataSelection = {
  dataIndex: number;
  seriesId?: string;
  seriesName?: string;
};

type Props = {
  gestureMode?: 'all' | 'tap';
  height: number;
  onDataIndexSelect?: (index: number, selection?: EChartDataSelection) => void;
  option: EChartsCoreOption;
  testID?: string;
};

export function EChart({ gestureMode = 'all', height, onDataIndexSelect, option, testID }: Props) {
  const hostRef = useRef<never>(null);
  const instanceRef = useRef<ChartInstance | null>(null);
  const selectRef = useRef(onDataIndexSelect);
  const [width, setWidth] = useState(0);
  selectRef.current = onDataIndexSelect;

  useEffect(() => {
    if (!hostRef.current || width <= 0) return;
    const chart = init(hostRef.current, undefined, { height, renderer: 'svg', width });
    instanceRef.current = chart;
    chart.setOption(option, true);
    chart.on('click', (event) => notifySelectedIndex(event, selectRef.current));
    chart.on('updateAxisPointer', (event) => notifyAxisPointerIndex(event, selectRef.current));
    return () => {
      instanceRef.current = null;
      chart.dispose();
    };
  }, [height, width]);

  useEffect(() => {
    instanceRef.current?.setOption(option, true);
  }, [option]);

  const onLayout = (event: LayoutChangeEvent) => {
    const nextWidth = Math.round(event.nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== width) setWidth(nextWidth);
  };

  return (
    <View onLayout={onLayout} style={[styles.container, { height }]} testID={testID}>
      {width > 0 ? <SvgChart
        gesture={gestureMode === 'tap' ? (gestures) => gestures[2] as unknown as GestureType : undefined}
        ref={hostRef}
        useRNGH
      /> : null}
    </View>
  );
}

function notifySelectedIndex(event: unknown, callback?: Props['onDataIndexSelect']): void {
  if (!callback || !isRecord(event) || typeof event.dataIndex !== 'number') return;
  const seriesId = stringValue(event.seriesId);
  const seriesName = stringValue(event.seriesName);
  if (!seriesId && !seriesName) {
    callback(event.dataIndex);
    return;
  }
  callback(event.dataIndex, { dataIndex: event.dataIndex, seriesId, seriesName });
}

function notifyAxisPointerIndex(event: unknown, callback?: Props['onDataIndexSelect']): void {
  if (!callback || !isRecord(event) || !Array.isArray(event.axesInfo)) return;
  const axis = event.axesInfo.find((item) => (
    isRecord(item) && (item.axisDim === 'x' || item.axisDimension === 'x')
  ));
  if (!isRecord(axis)) return;
  if (typeof axis.value === 'number') {
    callback(axis.value);
    return;
  }
  if (!Array.isArray(axis.seriesDataIndices)) return;
  const seriesIndex = axis.seriesDataIndices.find(isRecord);
  if (!seriesIndex) return;
  const index = typeof seriesIndex.dataIndex === 'number'
    ? seriesIndex.dataIndex
    : seriesIndex.dataIndexInside;
  if (typeof index === 'number') callback(index);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const styles = StyleSheet.create({ container: { alignSelf: 'stretch', overflow: 'hidden', width: '100%' } });
