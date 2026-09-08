import { SafeAreaView } from 'react-native-safe-area-context';
import { AnalyticsModuleScaffold } from '@/features/analytics/AnalyticsModuleScaffold';
import { RevenueAlertScreen } from '@/features/analytics/RevenueAlertScreen';
import { useTheme } from '@/theme/ThemeProvider';

export default function RevenueAlertsRoute() {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.background.canvas, flex: 1 }}>
      <AnalyticsModuleScaffold activeModule="alerts">
        <RevenueAlertScreen />
      </AnalyticsModuleScaffold>
    </SafeAreaView>
  );
}
