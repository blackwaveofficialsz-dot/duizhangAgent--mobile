import { Stack } from 'expo-router';
import { AppHeader } from '@/components/layout/AppHeader';
import { useTheme } from '@/theme/ThemeProvider';

export default function TasksLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={() => ({
        contentStyle: { backgroundColor: theme.background.canvas },
        header: ({ options }) => (
          <AppHeader
            title={options.title ?? '任务'}
          />
        ),
        headerShown: true,
      })}
    >
      <Stack.Screen name="index" options={{ title: '任务' }} />
      <Stack.Screen name="[taskId]" options={{ headerShown: false }} />
      <Stack.Screen name="[taskId]/records" options={{ headerShown: false }} />
    </Stack>
  );
}
