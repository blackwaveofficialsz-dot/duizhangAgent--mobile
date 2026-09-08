import type { ComponentProps } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AppDrawerContent } from './AppDrawerContent';
import {
  defaultDrawerTabForRoute,
  getDrawerWidth,
  useNavigationStore,
} from './navigationStore';
import { semanticThemes } from '@/theme/tokens';
import * as ThemeProvider from '@/theme/ThemeProvider';

const mockUseDrawerStatus = jest.fn(() => 'closed');
const useThemeSpy = jest.spyOn(ThemeProvider, 'useTheme');

function mockTheme(theme: 'light' | 'dark') {
  useThemeSpy.mockReturnValue({
    hydrated: true,
    mode: theme,
    resolvedMode: theme,
    setMode: async () => {},
    theme: semanticThemes[theme],
  });
}

jest.mock('expo-router/drawer', () => ({
  useDrawerStatus: () => mockUseDrawerStatus(),
}));

jest.mock('lucide-react-native', () => {
  const { View } = jest.requireActual('react-native');
  const Icon = (props: object) => <View {...props} />;

  return {
    BarChart3: Icon,
    History: Icon,
    MessageCircle: Icon,
    SquarePen: Icon,
    Trash2: Icon,
    UserRound: Icon,
    X: Icon,
  };
});

function createDrawerProps(routeName = 'chat') {
  const routes = ['chat', 'tasks', 'analytics', 'profile'].map((name) => ({
    key: `${name}-key`,
    name,
  }));

  return {
    navigation: {
      closeDrawer: jest.fn(),
      emit: jest.fn(() => ({ defaultPrevented: false })),
      navigate: jest.fn(),
    },
    state: {
      index: routes.findIndex((route) => route.name === routeName),
      routes,
    },
  } as unknown as ComponentProps<typeof AppDrawerContent>;
}

describe('AppDrawerContent', () => {
  beforeEach(() => {
    mockUseDrawerStatus.mockReturnValue('closed');
    mockTheme('light');
    useNavigationStore.setState({ activeTab: 'navigation' });
  });

  it('renders two tabs and the three visible navigation entries', async () => {
    const props = createDrawerProps('analytics');
    const screen = await render(<AppDrawerContent {...props} />);

    expect(screen.getByRole('tab', { name: '导航', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '对话历史', selected: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: '对话' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '任务' })).toBeNull();
    expect(screen.getByRole('button', { name: '经营看板' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '我的' })).toBeTruthy();
    expect(screen.getByTestId('drawer-brand-mark')).toBeTruthy();
    expect(screen.getByText('BlackWave 寰澜').props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(screen.getByText('经营看板').props.style).color).toBe(
      semanticThemes.light.text.primary,
    );
    expect(StyleSheet.flatten(screen.getByRole('tab', { name: '导航' }).props.style).borderBottomColor)
      .toBe(semanticThemes.light.text.primary);
  });

  it('uses an explicit empty state instead of fake conversation data', async () => {
    const props = createDrawerProps();
    const screen = await render(<AppDrawerContent {...props} />);

    await fireEvent.press(screen.getByRole('tab', { name: '对话历史' }));

    expect(screen.getByText('暂无对话记录')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '置顶' })).toBeNull();
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重命名' })).toBeNull();
  });

  it('keeps the active tab readable in dark mode', async () => {
    mockTheme('dark');
    const screen = await render(<AppDrawerContent {...createDrawerProps()} />);

    expect(StyleSheet.flatten(screen.getByText('导航').props.style).color).toBe(
      semanticThemes.dark.text.primary,
    );
    expect(StyleSheet.flatten(screen.getByRole('tab', { name: '导航' }).props.style).borderBottomColor)
      .toBe(semanticThemes.dark.text.primary);
  });

  it('navigates with the Drawer state and closes the drawer', async () => {
    const props = createDrawerProps();
    const screen = await render(<AppDrawerContent {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: '经营看板' }));

    expect(props.navigation.navigate).toHaveBeenCalledWith('analytics');
    expect(props.navigation.closeDrawer).toHaveBeenCalledTimes(1);
    expect(props.navigation.emit).toHaveBeenCalledWith({
      canPreventDefault: true,
      target: 'analytics-key',
      type: 'drawerItemPress',
    });
  });

  it('opens the nested profile navigator from the Drawer', async () => {
    const props = createDrawerProps();
    const screen = await render(<AppDrawerContent {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: '我的' }));

    expect(props.navigation.navigate).toHaveBeenCalledWith('profile');
    expect(props.navigation.closeDrawer).toHaveBeenCalledTimes(1);
  });

  it('respects prevented drawer item presses', async () => {
    const props = createDrawerProps();
    props.navigation.emit = jest.fn(({ target, type }) => ({
      defaultPrevented: true,
      preventDefault: jest.fn(),
      target,
      type,
    })) as unknown as typeof props.navigation.emit;
    const screen = await render(<AppDrawerContent {...props} />);

    await fireEvent.press(screen.getByRole('button', { name: '经营看板' }));

    expect(props.navigation.navigate).not.toHaveBeenCalled();
    expect(props.navigation.closeDrawer).not.toHaveBeenCalled();
  });

  it('resets the tab for the current route whenever the drawer opens', async () => {
    const props = createDrawerProps('chat');
    const screen = await render(<AppDrawerContent {...props} />);
    expect(useNavigationStore.getState().activeTab).toBe('navigation');

    mockUseDrawerStatus.mockReturnValue('open');
    await act(() => screen.rerender(<AppDrawerContent {...props} />));

    await waitFor(() => expect(useNavigationStore.getState().activeTab).toBe('history'));
  });

  it('defaults chat to history and other primary routes to navigation', () => {
    expect(defaultDrawerTabForRoute('chat')).toBe('history');
    expect(defaultDrawerTabForRoute('tasks')).toBe('navigation');
    expect(defaultDrawerTabForRoute('analytics')).toBe('navigation');
    expect(defaultDrawerTabForRoute('profile')).toBe('navigation');
  });

  it.each([
    [320, 224],
    [375, 262.5],
    [390, 273],
    [430, 301],
    [834, 360],
  ])('uses 70%% of %ipx and caps the drawer at 360px', (windowWidth, expected) => {
    expect(getDrawerWidth(windowWidth)).toBe(expected);
  });
});
