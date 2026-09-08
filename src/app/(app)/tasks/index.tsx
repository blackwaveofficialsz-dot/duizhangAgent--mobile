import { SafeAreaView } from 'react-native-safe-area-context';
import { TaskListScreen } from '@/features/tasks/TaskListScreen';
import { useTheme } from '@/theme/ThemeProvider';

export default function TasksScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={{ backgroundColor: theme.background.canvas, flex: 1 }}>
      <TaskListScreen />
    </SafeAreaView>
  );
}
