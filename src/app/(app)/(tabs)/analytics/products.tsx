import { SafeAreaView } from 'react-native-safe-area-context';
import { AnalyticsModuleScaffold } from '@/features/analytics/AnalyticsModuleScaffold';
import { ProductInsightScreen } from '@/features/analytics/ProductInsightScreen';
import { useTheme } from '@/theme/ThemeProvider';

export default function ProductsRoute() {
  const { theme } = useTheme();
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.background.canvas, flex: 1 }}>
    <AnalyticsModuleScaffold activeModule="products"><ProductInsightScreen /></AnalyticsModuleScaffold>
  </SafeAreaView>;
}
