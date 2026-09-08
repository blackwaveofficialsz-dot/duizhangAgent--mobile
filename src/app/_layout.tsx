import 'react-native-gesture-handler';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StartupScreen } from '@/components/brand/StartupScreen';
import { AppToast } from '@/components/feedback/AppToast';
import { useAnalyticsStore } from '@/features/analytics/analyticsStore';
import { useAuthStore } from '@/features/auth/authStore';
import { useChatStore } from '@/features/chat/chatStore';
import { useTaskStore } from '@/features/tasks/taskStore';
import { cleanupExpiredReportFiles } from '@/services/files/downloadReport';
import { startNetworkMonitoring, useNetworkStore } from '@/services/network/networkStore';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';

const RECONNECT_RETRY_DELAY_MS = 5_000;
const STARTUP_SCREEN_MIN_DURATION_MS = 3_000;

void SplashScreen.preventAutoHideAsync().catch(() => {});

async function syncTrustedState(): Promise<boolean> {
  const results = await Promise.allSettled([
    useChatStore.getState().loadSessions(),
    useTaskStore.getState().refresh(),
    useAnalyticsStore.getState().refresh(),
    useAnalyticsStore.getState().loadStores(),
  ]);
  const chat = useChatStore.getState();
  const tasks = useTaskStore.getState();
  const analytics = useAnalyticsStore.getState();
  const storesSynced = results[3].status === 'fulfilled' && results[3].value === true;
  return results.every((result) => result.status === 'fulfilled')
    && storesSynced
    && !chat.isOffline
    && !tasks.isOffline
    && !analytics.isOffline
    && tasks.status !== 'error'
    && analytics.status !== 'error';
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AppRoot />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

export function AppRoot() {
  const { hydrated, resolvedMode } = useTheme();
  const [startupScreenReady, setStartupScreenReady] = useState(false);
  const [startupHoldElapsed, setStartupHoldElapsed] = useState(false);
  const authStatus = useAuthStore((state) => state.status);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const networkStatus = useNetworkStore((state) => state.status);
  const previousNetworkStatus = useRef(networkStatus);
  const appStateStatus = useRef(AppState.currentState ?? 'active');
  const authStatusRef = useRef(authStatus);
  const networkStatusRef = useRef(networkStatus);
  const reconnectPending = useRef(false);
  const reconnectRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startupScreenReadyRef = useRef(false);
  authStatusRef.current = authStatus;
  networkStatusRef.current = networkStatus;

  useEffect(() => {
    if (!startupScreenReady) return undefined;
    const timer = setTimeout(() => setStartupHoldElapsed(true), STARTUP_SCREEN_MIN_DURATION_MS);
    return () => clearTimeout(timer);
  }, [startupScreenReady]);

  const handleStartupScreenReady = useCallback(() => {
    if (startupScreenReadyRef.current) return;
    startupScreenReadyRef.current = true;
    setStartupScreenReady(true);
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  const runTrustedStateSync = useCallback(() => {
    if (reconnectRetryTimer.current) clearTimeout(reconnectRetryTimer.current);
    reconnectRetryTimer.current = null;
    const attempt = () => {
      if (
        authStatusRef.current !== 'signedIn'
        || networkStatusRef.current !== 'online'
      ) return;
      if (appStateStatus.current !== 'active') {
        reconnectPending.current = true;
        return;
      }
      void syncTrustedState().then((succeeded) => {
        if (succeeded) return;
        if (appStateStatus.current !== 'active') {
          reconnectPending.current = true;
          return;
        }
        if (
          authStatusRef.current === 'signedIn'
          && networkStatusRef.current === 'online'
        ) reconnectRetryTimer.current = setTimeout(attempt, RECONNECT_RETRY_DELAY_MS);
      });
    };
    attempt();
  }, []);

  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    const stop = startNetworkMonitoring();
    return () => {
      stop();
      if (reconnectRetryTimer.current) clearTimeout(reconnectRetryTimer.current);
    };
  }, []);

  useEffect(() => {
    const previous = previousNetworkStatus.current;
    previousNetworkStatus.current = networkStatus;
    if (networkStatus !== 'online' && reconnectRetryTimer.current) {
      clearTimeout(reconnectRetryTimer.current);
      reconnectRetryTimer.current = null;
    }
    if (previous === 'online' || networkStatus !== 'online' || authStatus !== 'signedIn') return;
    if (appStateStatus.current !== 'active') {
      reconnectPending.current = true;
      return;
    }
    reconnectPending.current = false;
    runTrustedStateSync();
  }, [authStatus, networkStatus, runTrustedStateSync]);

  useEffect(() => {
    void Promise.resolve(ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)).catch(() => {});
  }, []);

  useEffect(() => {
    cleanupExpiredReportFiles();
    const subscription = AppState.addEventListener('change', (state) => {
      appStateStatus.current = state;
      if (state === 'background') cleanupExpiredReportFiles();
      if (
        state === 'active'
        && authStatusRef.current === 'signedIn'
      ) {
        void useAuthStore.getState().refreshStoredSession({ ifNeeded: true });
      }
      if (
        state === 'active'
        && reconnectPending.current
        && authStatusRef.current === 'signedIn'
        && networkStatusRef.current === 'online'
      ) {
        reconnectPending.current = false;
        runTrustedStateSync();
      }
    });
    return () => {
      subscription.remove();
      cleanupExpiredReportFiles();
    };
  }, [runTrustedStateSync]);

  if (!hydrated || !startupHoldElapsed) {
    return (
      <>
        <StatusBar style="light" />
        <StartupScreen onReady={handleStartupScreenReady} />
      </>
    );
  }

  return (
    <>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="chart" />
      </Stack>
      <AppToast />
    </>
  );
}
