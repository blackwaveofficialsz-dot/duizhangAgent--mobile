import { render } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

const mockAppHeader = jest.fn((_props: unknown) => null);
const mockStackScreen = jest.fn((_props: unknown) => null);
let mockTasksScreenOptions: ((args: { route: { name: string } }) => Record<string, unknown>) | null = null;

jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  const Stack = ({ children, screenOptions }: { children?: ReactNode; screenOptions: typeof mockTasksScreenOptions }) => {
    mockTasksScreenOptions = screenOptions;
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

describe('TasksLayout navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTasksScreenOptions = null;
  });

  it('registers list, detail and records in one Stack', async () => {
    const { default: TasksLayout } = require('../app/(app)/tasks/_layout') as typeof import('../app/(app)/tasks/_layout');
    await render(<TasksLayout />);

    const screens = mockStackScreen.mock.calls.map(([props]) => props as {
      name: string;
      options?: { headerShown?: boolean; title?: string };
    });
    expect(screens).toEqual([
      expect.objectContaining({ name: 'index', options: expect.objectContaining({ title: '任务' }) }),
      expect.objectContaining({ name: '[taskId]', options: expect.objectContaining({ headerShown: false }) }),
      expect.objectContaining({ name: '[taskId]/records', options: expect.objectContaining({ headerShown: false }) }),
    ]);
  });

  it('renders the task list header without the old drawer action', async () => {
    const { default: TasksLayout } = require('../app/(app)/tasks/_layout') as typeof import('../app/(app)/tasks/_layout');
    await render(<TasksLayout />);
    const options = mockTasksScreenOptions?.({
      route: { name: 'index' },
    });
    const header = options?.header as ((props: { options: { title?: string } }) => ReactElement) | undefined;

    await render(header!({ options: { title: '任务' } }));
    const props = mockAppHeader.mock.calls.at(-1)?.[0] as {
      leadingAction?: { onPress: () => void; type: string };
      title: string;
    };
    expect(props.leadingAction).toBeUndefined();
    expect(props.title).toBe('任务');
  });
});
