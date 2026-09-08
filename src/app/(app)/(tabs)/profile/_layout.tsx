import { Stack } from 'expo-router';
import { AppHeader } from '@/components/layout/AppHeader';
import { useTheme } from '@/theme/ThemeProvider';

export default function ProfileLayout() {
  const { theme } = useTheme();

  return (
    <Stack
      screenOptions={({ navigation, route }) => ({
        contentStyle: { backgroundColor: theme.background.canvas },
        header: ({ options }) => (
          <AppHeader
            leadingAction={route.name === 'index'
              ? undefined
              : {
                  type: 'back',
                  onPress: () => navigation.goBack(),
                }}
            title={options.title ?? '我的'}
          />
        ),
        headerShown: true,
      })}
    >
      <Stack.Screen name="index" options={{ title: '我的' }} />
      <Stack.Screen name="account-security" options={{ title: '账号与安全' }} />
      <Stack.Screen name="change-password" options={{ title: '修改密码' }} />
      <Stack.Screen name="appearance" options={{ title: '外观设置' }} />
      <Stack.Screen name="notifications" options={{ title: '通知设置' }} />
      <Stack.Screen name="storage-privacy" options={{ title: '存储、隐私与关于' }} />
      <Stack.Screen name="cache-diagnostics" options={{ title: '本地缓存诊断' }} />
      <Stack.Screen name="privacy-policy" options={{ title: '隐私政策' }} />
      <Stack.Screen name="user-agreement" options={{ title: '用户协议' }} />
      <Stack.Screen name="third-party-sdks" options={{ title: '第三方 SDK 清单' }} />
      <Stack.Screen name="account-deletion" options={{ title: '账户删除申请' }} />
    </Stack>
  );
}
