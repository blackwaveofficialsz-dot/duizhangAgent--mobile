import { fireEvent, render } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { StyleSheet } from 'react-native';
import { StartupScreen } from './StartupScreen';

const useWindowDimensionsSpy = jest.spyOn(ReactNative, 'useWindowDimensions');
const reset = jest.fn();
const start = jest.fn();
const stop = jest.fn();
const interpolateSpy = jest.spyOn(ReactNative.Animated.Value.prototype, 'interpolate');
const timingSpy = jest.spyOn(ReactNative.Animated, 'timing');
const loopSpy = jest.spyOn(ReactNative.Animated, 'loop');
const sequenceSpy = jest.spyOn(ReactNative.Animated, 'sequence');

describe('StartupScreen', () => {
  beforeEach(() => {
    timingSpy.mockReturnValue({ reset, start, stop } as never);
    useWindowDimensionsSpy.mockReturnValue({
      fontScale: 1,
      height: 844,
      scale: 3,
      width: 390,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses the BlackWave logo on a full black startup screen', async () => {
    const screen = await render(<StartupScreen />);
    const logo = screen.getByLabelText('BlackWave 启动标识');
    const logoStyle = StyleSheet.flatten(logo.props.style);

    expect(screen.getByTestId('startup-screen')).toHaveStyle({ backgroundColor: '#000000' });
    expect(logo.props.resizeMode).toBe('contain');
    expect(logoStyle.width).toBe(312);
    expect(logoStyle.height).toBeCloseTo(308.93, 1);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('positions the logo center vertically on the startup screen', async () => {
    const screen = await render(<StartupScreen />);
    const logo = screen.getByLabelText('BlackWave 启动标识');
    const logoStyle = StyleSheet.flatten(logo.props.style);
    const content = screen.getByTestId('startup-content');
    const contentStyle = StyleSheet.flatten(content.props.style);

    expect(contentStyle.top).toBeCloseTo((844 * 0.5) - (logoStyle.height / 2), 1);
    expect(contentStyle.transform).toBeUndefined();
  });

  it('notifies when the JS startup screen has laid out', async () => {
    const onReady = jest.fn();
    const screen = await render(<StartupScreen onReady={onReady} />);

    fireEvent(screen.getByTestId('startup-screen'), 'layout');

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('animates the startup logo with one slow zoom-in only', async () => {
    const screen = await render(<StartupScreen />);

    expect(loopSpy).not.toHaveBeenCalled();
    expect(sequenceSpy).not.toHaveBeenCalled();
    expect(timingSpy).toHaveBeenCalledTimes(1);
    expect(timingSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      duration: 3_000,
      toValue: 1,
      useNativeDriver: true,
    }));
    expect(interpolateSpy).toHaveBeenCalledTimes(1);
    expect(interpolateSpy).toHaveBeenCalledWith(expect.objectContaining({
      inputRange: [0, 1],
      outputRange: [1, 1.5],
    }));

    screen.unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
