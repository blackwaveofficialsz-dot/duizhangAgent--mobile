import { SafeAreaView } from 'react-native-safe-area-context';
import { AnalyticsModuleScaffold } from '@/features/analytics/AnalyticsModuleScaffold';
import { OrderInsightScreen } from '@/features/analytics/OrderInsightScreen';
import { useTheme } from '@/theme/ThemeProvider';

export default function OrdersRoute() {
  const { theme } = useTheme();
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.background.canvas, flex: 1 }}>
    <AnalyticsModuleScaffold activeModule="orders"><OrderInsightScreen /></AnalyticsModuleScaffold>
  </SafeAreaView>;
}
