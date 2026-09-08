import { Stack, useRouter } from 'expo-router';
import { AppHeader } from '@/components/layout/AppHeader';
import { goBackOneLevel } from '@/navigation/stackBack';
import { useTheme } from '@/theme/ThemeProvider';

const MODULE_ROUTES = new Set(['index', 'dashboard', 'orders', 'products', 'labor', 'alerts']);
const DETAIL_FALLBACKS: Record<string, string> = {
  'orders/detail': '/analytics/orders',
  'products/trend': '/analytics/products',
  'labor/detail': '/analytics/labor',
};

export default function AnalyticsLayout() {
  const router = useRouter();
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={({ navigation, route }) => {
        const isModule = MODULE_ROUTES.has(route.name);
        return {
          ...(isModule ? { animation: 'none' as const } : {}),
          contentStyle: { backgroundColor: theme.background.canvas },
          header: ({ options }) => (
            <AppHeader
              leadingAction={{
                type: 'back',
                onPress: () => goBackOneLevel(
                  navigation,
                  () => router.replace((DETAIL_FALLBACKS[route.name] ?? '/analytics') as never),
                ),
              }}
              title={options.title ?? '经营看板'}
            />
          ),
          headerShown: !isModule,
        };
      }}
    >
      <Stack.Screen name="index" options={{ title: '经营看板' }} />
      <Stack.Screen name="dashboard" options={{ title: '经营看板' }} />
      <Stack.Screen name="orders" options={{ title: '经营看板' }} />
      <Stack.Screen name="products" options={{ title: '经营看板' }} />
      <Stack.Screen name="labor" options={{ title: '经营看板' }} />
      <Stack.Screen name="alerts" options={{ title: '经营看板' }} />
      <Stack.Screen name="orders/detail" options={{ title: '订单详情' }} />
      <Stack.Screen name="products/trend" options={{ title: '商品趋势' }} />
      <Stack.Screen name="labor/detail" options={{ title: '人效详情' }} />
    </Stack>
  );
}
