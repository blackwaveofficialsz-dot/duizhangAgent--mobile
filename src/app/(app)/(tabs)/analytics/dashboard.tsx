import { SafeAreaView } from 'react-native-safe-area-context';
import { AnalyticsModuleScaffold } from '@/features/analytics/AnalyticsModuleScaffold';
import { DashboardScreen } from '@/features/analytics/DashboardScreen';
import { useTheme } from '@/theme/ThemeProvider';

export default function DashboardRoute() {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.background.canvas, flex: 1 }}>
      <AnalyticsModuleScaffold activeModule="dashboard">
        <DashboardScreen />
      </AnalyticsModuleScaffold>
    </SafeAreaView>
  );
}
