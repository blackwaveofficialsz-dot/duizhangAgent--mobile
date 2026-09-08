import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockDispose = jest.fn();
const mockOn = jest.fn();
const mockSetOption = jest.fn();
const mockInit = jest.fn(() => ({ dispose: mockDispose, on: mockOn, setOption: mockSetOption }));
const mockUse = jest.fn();

jest.mock('@wuba/react-native-echarts/svgChart', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: React.forwardRef((props: { gesture?: unknown; useRNGH?: boolean }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({}));
      return React.createElement(Text, { testID: 'native-svg-chart' }, props.useRNGH ? (props.gesture ? 'tap' : 'all') : 'builtin');
    }),
    SVGRenderer: 'svg-renderer',
  };
});
jest.mock('echarts/charts', () => ({ __esModule: true, BarChart: 'bar-chart', LineChart: 'line-chart' }));
jest.mock('echarts/components', () => ({
  __esModule: true,
  DataZoomComponent: 'data-zoom',
  GridComponent: 'grid',
  TooltipComponent: 'tooltip',
}));
jest.mock('echarts/core', () => ({ __esModule: true, init: mockInit, use: mockUse }));

describe('EChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers only used modules and disposes the native chart', async () => {
    const { EChart } = require('./EChart') as typeof import('./EChart');
    const option = { series: [{ data: [1, 2], type: 'line' }] };
    const screen = await render(<EChart gestureMode="tap" height={180} option={option} testID="chart-host" />);
    await fireEvent(screen.getByTestId('chart-host'), 'layout', { nativeEvent: { layout: { width: 320 } } });

    await waitFor(() => expect(mockInit).toHaveBeenCalled());
    expect(mockUse).toHaveBeenCalledWith(['svg-renderer', 'bar-chart', 'line-chart', 'grid', 'tooltip', 'data-zoom']);
    expect(screen.getByTestId('native-svg-chart').props.children).toBe('tap');
    expect(mockSetOption).toHaveBeenCalledWith(option, true);

    await screen.unmount();
    expect(mockDispose).toHaveBeenCalledTimes(1);
  });

  it('uses the X-axis series index when crosshair events also contain a numeric Y axis', async () => {
    const { EChart } = require('./EChart') as typeof import('./EChart');
    const onSelect = jest.fn();
    const screen = await render(<EChart height={180} onDataIndexSelect={onSelect} option={{}} testID="chart-host" />);
    await fireEvent(screen.getByTestId('chart-host'), 'layout', { nativeEvent: { layout: { width: 320 } } });
    await waitFor(() => expect(mockOn).toHaveBeenCalledWith('updateAxisPointer', expect.any(Function)));
    const handler = mockOn.mock.calls.find(([event]) => event === 'updateAxisPointer')?.[1] as ((event: unknown) => void) | undefined;

    handler?.({
      axesInfo: [
        { axisDim: 'y', value: 12888 },
        { axisDim: 'x', seriesDataIndices: [{ dataIndex: 2 }], value: '2026-07-16' },
      ],
    });

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('forwards clicked series identity while keeping dataIndex as the first callback argument', async () => {
    const { EChart } = require('./EChart') as typeof import('./EChart');
    const onSelect = jest.fn();
    const screen = await render(<EChart height={180} onDataIndexSelect={onSelect} option={{}} testID="chart-host" />);
    await fireEvent(screen.getByTestId('chart-host'), 'layout', { nativeEvent: { layout: { width: 320 } } });
    await waitFor(() => expect(mockOn).toHaveBeenCalledWith('click', expect.any(Function)));
    const handler = mockOn.mock.calls.find(([event]) => event === 'click')?.[1] as ((event: unknown) => void) | undefined;

    handler?.({ dataIndex: 2, seriesId: 'scope:south', seriesName: '南坪店' });

    expect(onSelect).toHaveBeenCalledWith(2, {
      dataIndex: 2,
      seriesId: 'scope:south',
      seriesName: '南坪店',
    });
  });
});
