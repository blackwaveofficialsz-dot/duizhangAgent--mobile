import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { ConnectorRecordsScreen } from '@/features/tasks/ConnectorRecordsScreen';
import { goBackOneLevel } from '@/navigation/stackBack';

export default function ConnectorRecordsRoute() {
  const navigation = useNavigation();
  const router = useRouter();
  const { runId, taskId } = useLocalSearchParams<{ runId: string; taskId: string }>();
  return <ConnectorRecordsScreen
    onBack={() => goBackOneLevel(navigation, () => router.replace({
      pathname: '/tasks/[taskId]',
      params: { taskId: taskId ?? '' },
    }))}
    runId={runId ?? ''}
  />;
}
