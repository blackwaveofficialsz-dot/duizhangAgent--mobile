import { Redirect } from 'expo-router';
import { readRuntimeConfig } from '@/config/env';
import { useAuthStore } from '@/features/auth/authStore';

readRuntimeConfig();

export default function HomeScreen() {
  const status = useAuthStore((state) => state.status);
  if (status === 'restoring') return null;
  return status === 'signedIn'
    ? <Redirect href="/(app)/(tabs)/analytics" />
    : <Redirect href="/(auth)/login" />;
}
