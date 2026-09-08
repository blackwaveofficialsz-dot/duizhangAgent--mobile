import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { AnalyticsModuleTabs, type AnalyticsModuleKey } from './AnalyticsModuleTabs';

type Props = PropsWithChildren<{ activeModule: AnalyticsModuleKey }>;

export function AnalyticsModuleScaffold({ activeModule, children }: Props) {
  return (
    <View style={styles.container}>
      <AnalyticsModuleTabs activeModule={activeModule} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
});
