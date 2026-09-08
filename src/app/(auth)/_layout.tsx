import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '@/features/auth/authStore';

export default function AuthLayout() {
  const status = useAuthStore((state) => state.status);
  if (status === 'signedIn') return <Redirect href="/(app)/(tabs)/analytics" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
