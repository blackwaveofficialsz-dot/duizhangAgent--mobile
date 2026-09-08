import * as Network from 'expo-network';
import { isDeviceOnline, startNetworkMonitoring, useNetworkStore } from './networkStore';

const getNetworkStateAsync = jest.mocked(Network.getNetworkStateAsync);
const addNetworkStateListener = jest.mocked(Network.addNetworkStateListener);

describe('networkStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useNetworkStore.setState({ status: 'unknown' });
  });

  it('publishes the initial device state and later connectivity changes', async () => {
    let onChange: ((state: { isConnected?: boolean; isInternetReachable?: boolean }) => void) | undefined;
    const remove = jest.fn();
    getNetworkStateAsync.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);
    addNetworkStateListener.mockImplementation((listener) => {
      onChange = listener as typeof onChange;
      return { remove } as never;
    });

    const stop = startNetworkMonitoring();
    await Promise.resolve();
    expect(useNetworkStore.getState().status).toBe('offline');

    onChange?.({ isConnected: true, isInternetReachable: true });
    expect(useNetworkStore.getState().status).toBe('online');

    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('treats an unreachable internet connection as offline', async () => {
    getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: false } as never);
    addNetworkStateListener.mockReturnValue({ remove: jest.fn() } as never);

    const stop = startNetworkMonitoring();
    await Promise.resolve();

    expect(useNetworkStore.getState().status).toBe('offline');
    stop();
  });

  it('does not permit writes until internet reachability is confirmed', async () => {
    getNetworkStateAsync.mockResolvedValue({ isConnected: true, isInternetReachable: undefined } as never);
    addNetworkStateListener.mockReturnValue({ remove: jest.fn() } as never);

    const stop = startNetworkMonitoring();
    await Promise.resolve();

    expect(useNetworkStore.getState().status).toBe('unknown');
    expect(isDeviceOnline()).toBe(false);
    stop();
  });

  it('ignores a delayed initial result after monitoring stops', async () => {
    let resolveInitial: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void) | undefined;
    getNetworkStateAsync.mockReturnValue(new Promise((resolve) => { resolveInitial = resolve; }) as never);
    addNetworkStateListener.mockReturnValue({ remove: jest.fn() } as never);

    const stop = startNetworkMonitoring();
    stop();
    resolveInitial?.({ isConnected: false, isInternetReachable: false });
    await Promise.resolve();

    expect(useNetworkStore.getState().status).toBe('unknown');
  });

  it('does not let a delayed initial snapshot overwrite a newer listener event', async () => {
    let onChange: ((state: { isConnected?: boolean; isInternetReachable?: boolean }) => void) | undefined;
    let resolveInitial: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void) | undefined;
    getNetworkStateAsync.mockReturnValue(new Promise((resolve) => { resolveInitial = resolve; }) as never);
    addNetworkStateListener.mockImplementation((listener) => {
      onChange = listener as typeof onChange;
      return { remove: jest.fn() } as never;
    });

    const stop = startNetworkMonitoring();
    onChange?.({ isConnected: false, isInternetReachable: false });
    resolveInitial?.({ isConnected: true, isInternetReachable: true });
    await Promise.resolve();

    expect(useNetworkStore.getState().status).toBe('offline');
    stop();
  });
});
