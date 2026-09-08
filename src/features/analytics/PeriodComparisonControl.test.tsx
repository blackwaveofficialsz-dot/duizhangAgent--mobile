import { fireEvent, render } from '@testing-library/react-native';
import * as ThemeProvider from '@/theme/ThemeProvider';
import { semanticThemes } from '@/theme/tokens';
import { PeriodComparisonControl } from './PeriodComparisonControl';

describe('PeriodComparisonControl', () => {
  beforeEach(() => {
    jest.spyOn(ThemeProvider, 'useTheme').mockReturnValue({
      hydrated: true,
      mode: 'light',
      resolvedMode: 'light',
      setMode: async () => {},
      theme: semanticThemes.light,
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports selected comparison and display modes', async () => {
    const screen = await render(<PeriodComparisonControl
      displayMode="difference"
      mode="previous"
      onDisplayModeChange={jest.fn()}
      onModeChange={jest.fn()}
    />);

    expect(screen.getByRole('button', { name: '与上期对比' }).props.accessibilityState)
      .toMatchObject({ selected: true, disabled: false });
    expect(screen.getByRole('button', { name: '差值' }).props.accessibilityState)
      .toMatchObject({ selected: true, disabled: false });
    expect(screen.getByRole('button', { name: '百分比' }).props.accessibilityState)
      .toMatchObject({ selected: false, disabled: false });
  });

  it('changes either mode through the supplied callbacks', async () => {
    const onModeChange = jest.fn();
    const onDisplayModeChange = jest.fn();
    const screen = await render(<PeriodComparisonControl
      displayMode="percentage"
      mode="previous"
      onDisplayModeChange={onDisplayModeChange}
      onModeChange={onModeChange}
    />);

    await fireEvent.press(screen.getByRole('button', { name: '不对比' }));
    await fireEvent.press(screen.getByRole('button', { name: '全部' }));

    expect(onModeChange).toHaveBeenCalledWith('none');
    expect(onDisplayModeChange).toHaveBeenCalledWith('all');
  });

  it('disables display controls when comparison is off without changing their selected state', async () => {
    const onDisplayModeChange = jest.fn();
    const screen = await render(<PeriodComparisonControl
      displayMode="previous"
      mode="none"
      onDisplayModeChange={onDisplayModeChange}
      onModeChange={jest.fn()}
    />);

    const previous = findNode(screen.toJSON(), '上期');
    const difference = findNode(screen.toJSON(), '差值');
    expect(previous).toBeDefined();
    expect(difference).toBeDefined();
    expect(previous).toMatchObject({ props: { accessibilityState: { selected: true, disabled: true } } });
    expect(difference).toMatchObject({ props: { accessibilityState: { selected: false, disabled: true } } });

    await fireEvent.press(screen.getByText('上期'));

    expect(onDisplayModeChange).not.toHaveBeenCalled();
  });
});

type RenderedNode = {
  children?: Array<RenderedNode | string> | null;
  props?: Record<string, unknown>;
};

function findNode(node: RenderedNode | Array<RenderedNode | string> | string | null, label: string): RenderedNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, label);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node === 'string') return undefined;
  if (node.props?.accessibilityLabel === label) return node;
  return findNode(node.children ?? null, label);
}
