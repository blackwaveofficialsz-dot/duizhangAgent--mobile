import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/features/auth/authStore';

export default function AppLayout() {
  const status = useAuthStore((state) => state.status);

  if (status !== 'signedIn') {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="tasks" />
      <Stack.Screen name="tables/[messageId]" />
    </Stack>
  );
}
