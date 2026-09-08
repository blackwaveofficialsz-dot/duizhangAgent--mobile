import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';

const mockRedirect = jest.fn((_props: { href: string }) => null);
const mockStack = jest.fn(({ children }: { children?: ReactNode; screenOptions?: unknown }) => children ?? null);
let mockAuthStatus = 'signedOut';

jest.mock('expo-router', () => {
  const Stack = (props: { children?: ReactNode; screenOptions?: unknown }) => mockStack(props);
  Stack.Screen = () => null;
  return { Redirect: (props: { href: string }) => mockRedirect(props), Stack };
});
jest.mock('@/config/env', () => ({ readRuntimeConfig: () => ({}) }));
jest.mock('@/features/auth/authStore', () => ({
  useAuthStore: (selector: (state: { status: string }) => unknown) => selector({ status: mockAuthStatus }),
}));

describe('authentication routing guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStatus = 'signedOut';
  });

  it('routes signed-out root visits to the native login route', async () => {
    const { default: HomeScreen } = require('../app/index') as typeof import('../app/index');
    await render(<HomeScreen />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/(auth)/login' });
  });

  it('routes signed-in root visits directly to analytics', async () => {
    mockAuthStatus = 'signedIn';
    const { default: HomeScreen } = require('../app/index') as typeof import('../app/index');
    await render(<HomeScreen />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/(app)/(tabs)/analytics' });
  });

  it('redirects signed-in users out of the auth stack', async () => {
    mockAuthStatus = 'signedIn';
    const { default: AuthLayout } = require('../app/(auth)/_layout') as typeof import('../app/(auth)/_layout');
    await render(<AuthLayout />);
    expect(mockRedirect).toHaveBeenCalledWith({ href: '/(app)/(tabs)/analytics' });
    expect(mockStack).not.toHaveBeenCalled();
  });

  it.each(['signedOut', 'signingIn', 'signingOut'])('renders the auth stack while status is %s', async (status) => {
    mockAuthStatus = status;
    const { default: AuthLayout } = require('../app/(auth)/_layout') as typeof import('../app/(auth)/_layout');
    await render(<AuthLayout />);
    expect(mockStack).toHaveBeenCalledWith(expect.objectContaining({ screenOptions: { headerShown: false } }));
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
