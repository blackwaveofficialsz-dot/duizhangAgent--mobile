import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { NativeTabs, type NativeTabsTriggerIconProps } from 'expo-router/unstable-native-tabs';
import { useTheme } from '@/theme/ThemeProvider';

export default function AppTabLayout() {
  const pathname = usePathname();
  const { theme } = useTheme();
  const isChatRoute = pathname === '/chat' || pathname.startsWith('/chat/');

  return (
    <NativeTabs
      backBehavior="history"
      blurEffect="systemUltraThinMaterial"
      disableIndicator
      disableTransparentOnScrollEdge={false}
      iconColor={{ default: theme.text.muted, selected: theme.action.primary }}
      labelStyle={{
        default: { color: theme.text.muted, fontSize: 11, fontWeight: '600' },
        selected: { color: theme.action.primary, fontSize: 11, fontWeight: '600' },
      }}
      labelVisibilityMode="labeled"
      hidden={isChatRoute}
      minimizeBehavior="automatic"
      shadowColor={theme.border.default}
      tintColor={theme.action.primary}
    >
      <NativeTabs.Trigger accessibilityLabel="经营" name="analytics" testID="tab-analytics">
        <NativeTabs.Trigger.Label>经营</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...nativeTabIcon('chart.bar', 'bar_chart')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger accessibilityLabel="我的" name="profile" testID="tab-profile">
        <NativeTabs.Trigger.Label>我的</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...nativeTabIcon('person', 'person_outline')} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger accessibilityLabel="对话" name="chat" role="search" testID="tab-chat">
        <NativeTabs.Trigger.Label>对话</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon {...nativeTabIcon('message', 'chat_bubble_outline')} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function nativeTabIcon(
  sf: 'chart.bar' | 'message' | 'person',
  md: 'bar_chart' | 'chat_bubble_outline' | 'person_outline',
): NativeTabsTriggerIconProps {
  return (Platform.OS === 'android' ? { md } : { sf }) as NativeTabsTriggerIconProps;
}
