import { SafeAreaView } from 'react-native-safe-area-context';
import { AnalyticsModuleScaffold } from '@/features/analytics/AnalyticsModuleScaffold';
import { LaborInsightScreen } from '@/features/analytics/LaborInsightScreen';
import { useTheme } from '@/theme/ThemeProvider';

export default function LaborRoute() {
  const { theme } = useTheme();
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.background.canvas, flex: 1 }}>
    <AnalyticsModuleScaffold activeModule="labor"><LaborInsightScreen /></AnalyticsModuleScaffold>
  </SafeAreaView>;
}
