import { type DrawerContentComponentProps, useDrawerStatus } from 'expo-router/drawer';
import {
  BarChart3,
  MessageCircle,
  UserRound,
  X,
} from 'lucide-react-native';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BrandMark } from '@/components/brand/BrandMark';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';
import { ConversationHistory } from '@/features/chat/ConversationHistory';
import { useNavigationStore } from './navigationStore';

const NAV_ITEMS = [
  { route: 'chat', label: '对话', Icon: MessageCircle },
  { route: 'analytics', label: '经营看板', Icon: BarChart3 },
  { route: 'profile', label: '我的', Icon: UserRound },
] as const;

export function AppDrawerContent({ navigation, state }: DrawerContentComponentProps) {
  const { theme } = useTheme();
  const activeTab = useNavigationStore((store) => store.activeTab);
  const prepareDrawerForRoute = useNavigationStore((store) => store.prepareDrawerForRoute);
  const setActiveTab = useNavigationStore((store) => store.setActiveTab);
  const drawerStatus = useDrawerStatus();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const activeRoute = state.routes[state.index]?.name;

  const navigate = (route: (typeof NAV_ITEMS)[number]['route']) => {
    const target = state.routes.find((item) => item.name === route)?.key;
    const event = navigation.emit({ type: 'drawerItemPress', target, canPreventDefault: true });
    if (event.defaultPrevented) return;

    navigation.navigate(route);
    navigation.closeDrawer();
  };

  useEffect(() => {
    if (drawerStatus === 'open' && activeRoute) {
      prepareDrawerForRoute(activeRoute);
    }
  }, [activeRoute, drawerStatus, prepareDrawerForRoute]);

  return (
    <SafeAreaView
      accessibilityViewIsModal
      edges={['top', 'bottom']}
      importantForAccessibility="yes"
      style={styles.container}
    >
      <View style={styles.drawerHeader}>
        <View style={styles.brandBlock}>
          <BrandMark size={38} testID="drawer-brand-mark" />
          <View style={styles.brandCopy}>
            <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.brand}>
              BlackWave 寰澜
            </Text>
            <Text numberOfLines={1} style={styles.sectionLabel}>移动工作台</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="关闭侧边栏"
          accessibilityRole="button"
          onPress={() => navigation.closeDrawer()}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <X color={theme.text.secondary} size={21} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.tabs}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'navigation' }}
          onPress={() => setActiveTab('navigation')}
          style={({ pressed }) => [
            styles.tab,
            activeTab === 'navigation' && styles.tabActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.tabText, activeTab === 'navigation' && styles.tabTextActive]}>
            导航
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'history' }}
          onPress={() => setActiveTab('history')}
          style={({ pressed }) => [
            styles.tab,
            activeTab === 'history' && styles.tabActive,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            对话历史
          </Text>
        </Pressable>
      </View>

      {activeTab === 'navigation' ? (
        <ScrollView contentContainerStyle={styles.navigationList} showsVerticalScrollIndicator={false}>
          {NAV_ITEMS.map(({ route, label, Icon }) => {
            const selected = activeRoute === route;
            return (
              <Pressable
                accessibilityLabel={label}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={route}
                onPress={() => navigate(route)}
                style={({ pressed }) => [
                  styles.navigationItem,
                  selected && styles.navigationItemActive,
                  pressed && styles.pressed,
                ]}
              >
                <Icon
                  color={selected ? theme.text.primary : theme.text.secondary}
                  size={21}
                  strokeWidth={2}
                />
                <Text style={[styles.navigationText, selected && styles.navigationTextActive]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : <ConversationHistory onSessionOpened={() => navigate('chat')} />}
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background.surface,
    },
    drawerHeader: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: 20,
      paddingRight: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.default,
    },
    brandBlock: {
      alignItems: 'center',
      flex: 1,
      flexDirection: 'row',
      gap: 10,
      minWidth: 0,
      paddingRight: 8,
    },
    brandCopy: {
      flex: 1,
      minWidth: 0,
    },
    brand: {
      color: theme.text.primary,
      fontSize: 18,
      fontWeight: '400',
      letterSpacing: 0,
    },
    sectionLabel: {
      marginTop: 3,
      color: theme.text.muted,
      fontSize: 12,
      letterSpacing: 0,
    },
    iconButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabs: {
      minHeight: 52,
      flexDirection: 'row',
      paddingHorizontal: 12,
      paddingTop: 8,
      gap: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border.default,
    },
    tab: {
      flex: 1,
      minWidth: 0,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabActive: {
      borderBottomColor: theme.text.primary,
    },
    tabText: {
      color: theme.text.secondary,
      fontSize: 14,
      fontWeight: '400',
      letterSpacing: 0,
    },
    tabTextActive: {
      color: theme.text.primary,
      fontWeight: '600',
    },
    navigationList: {
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 4,
    },
    navigationItem: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: 8,
      paddingHorizontal: 12,
    },
    navigationItemActive: {
      backgroundColor: theme.background.subtle,
    },
    navigationText: {
      flexShrink: 1,
      color: theme.text.primary,
      fontSize: 15,
      fontWeight: '500',
      letterSpacing: 0,
    },
    navigationTextActive: {
      color: theme.text.primary,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.68,
    },
  });
}
