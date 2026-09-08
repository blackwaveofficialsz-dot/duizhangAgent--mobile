import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { TaskDetailScreen } from '@/features/tasks/TaskDetailScreen';
import { goBackOneLevel } from '@/navigation/stackBack';

export default function TaskDetailRoute() {
  const navigation = useNavigation();
  const router = useRouter();
  const { taskId } = useLocalSearchParams<{ taskId: string }>();
  return <TaskDetailScreen
    onBack={() => goBackOneLevel(navigation, () => router.replace('/tasks'))}
    onOpenRecords={(runId) => router.push({
      pathname: '/tasks/[taskId]/records',
      params: { taskId: taskId ?? '', runId },
    })}
    taskId={taskId ?? ''}
  />;
}
