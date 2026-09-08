import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

const mockAppHeader = jest.fn((_props: unknown) => null);
const mockStackScreen = jest.fn((_props: unknown) => null);
let mockProfileScreenOptions: ((args: {
  navigation: { getParent: () => { openDrawer: () => void } | undefined; goBack: () => void };
  route: { name: string };
}) => Record<string, unknown>) | null = null;

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = ({ children, screenOptions }: { children?: ReactNode; screenOptions: typeof mockProfileScreenOptions }) => {
    mockProfileScreenOptions = screenOptions;
    return React.createElement(React.Fragment, null, children);
  };
  Stack.Screen = (props: unknown) => mockStackScreen(props);
  return { Stack };
});
jest.mock('@/components/layout/AppHeader', () => ({
  AppHeader: (props: unknown) => mockAppHeader(props),
}));
jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({ theme: { background: { canvas: '#ffffff' } } }),
}));

describe('ProfileLayout navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProfileScreenOptions = null;
  });

  it('registers profile pages in one Stack and uses the real previous route for back', async () => {
    const { default: ProfileLayout } = require('../app/(app)/(tabs)/profile/_layout') as typeof import('../app/(app)/(tabs)/profile/_layout');
    await render(<ProfileLayout />);

    const screens = mockStackScreen.mock.calls.map(([props]) => props as { name: string; options?: { title?: string } });
    expect(screens.map((screen) => [screen.name, screen.options?.title])).toEqual([
      ['index', '我的'],
      ['account-security', '账号与安全'],
      ['change-password', '修改密码'],
      ['appearance', '外观设置'],
      ['notifications', '通知设置'],
      ['storage-privacy', '存储、隐私与关于'],
      ['cache-diagnostics', '本地缓存诊断'],
      ['privacy-policy', '隐私政策'],
      ['user-agreement', '用户协议'],
      ['third-party-sdks', '第三方 SDK 清单'],
      ['account-deletion', '账户删除申请'],
    ]);

    const goBack = jest.fn();
    const nestedOptions = mockProfileScreenOptions?.({
      navigation: { getParent: () => undefined, goBack },
      route: { name: 'appearance' },
    });
    const nestedHeader = nestedOptions?.header as ((props: { options: { title?: string } }) => ReactElement) | undefined;
    await render(nestedHeader!({ options: { title: '外观设置' } }));
    const nestedProps = mockAppHeader.mock.calls.at(-1)?.[0] as { leadingAction: { onPress: () => void; type: string } };
    expect(nestedProps.leadingAction.type).toBe('back');
    nestedProps.leadingAction.onPress();
    expect(goBack).toHaveBeenCalledTimes(1);

    const indexOptions = mockProfileScreenOptions?.({
      navigation: { getParent: () => undefined, goBack },
      route: { name: 'index' },
    });
    const indexHeader = indexOptions?.header as ((props: { options: { title?: string } }) => ReactElement) | undefined;
    await render(indexHeader!({ options: { title: '我的' } }));
    const indexProps = mockAppHeader.mock.calls.at(-1)?.[0] as { leadingAction?: { onPress: () => void; type: string } };
    expect(indexProps.leadingAction).toBeUndefined();
  });
});
