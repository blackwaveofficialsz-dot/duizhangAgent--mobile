import type { ReactNode } from 'react';
import { View } from 'react-native';

type Props = {
  children: ReactNode;
  renderRightActions?: () => ReactNode;
};

export default function ReanimatedSwipeableMock({ children, renderRightActions }: Props) {
  return <View>{children}{renderRightActions?.()}</View>;
}
