import * as Network from 'expo-network';
import { create } from 'zustand';

export type DeviceNetworkStatus = 'unknown' | 'online' | 'offline';

type NetworkState = {
  status: DeviceNetworkStatus;
};

let monitoringGeneration = 0;

export const useNetworkStore = create<NetworkState>(() => ({ status: 'unknown' }));

export function isDeviceOffline(): boolean {
  return useNetworkStore.getState().status === 'offline';
}

export function isDeviceOnline(): boolean {
  return useNetworkStore.getState().status === 'online';
}

export function startNetworkMonitoring(): () => void {
  const generation = ++monitoringGeneration;
  let active = true;
  let listenerHasPublished = false;
  const publish = (state: Pick<Network.NetworkState, 'isConnected' | 'isInternetReachable'>) => {
    if (!active || generation !== monitoringGeneration) return;
    useNetworkStore.setState({ status: normalizeNetworkStatus(state) });
  };

  void Network.getNetworkStateAsync().then((state) => {
    if (!listenerHasPublished) publish(state);
  }).catch(() => {});
  const subscription = Network.addNetworkStateListener((state) => {
    listenerHasPublished = true;
    publish(state);
  });

  return () => {
    active = false;
    subscription.remove();
  };
}

function normalizeNetworkStatus(
  state: Pick<Network.NetworkState, 'isConnected' | 'isInternetReachable'>,
): DeviceNetworkStatus {
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  if (state.isConnected === true && state.isInternetReachable === true) return 'online';
  return 'unknown';
}
