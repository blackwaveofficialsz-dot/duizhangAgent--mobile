import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/theme/ThemeProvider';
import type { AppTheme } from '@/theme/tokens';

export type LegalDocumentKind = 'privacy' | 'agreement' | 'sdks';

const documents: Record<LegalDocumentKind, {
  intro: string;
  sections: Array<{ body: string; title: string }>;
}> = {
  privacy: {
    intro: '本说明适用于 BlackWave 寰澜内部试用版，说明应用为提供对账、任务、对话和经营分析功能而处理的数据。',
    sections: [
      { title: '处理范围', body: '应用处理登录账号、用户与租户标识，以及你主动提交或有权限访问的业务数据。数据仅用于身份校验、权限隔离和你发起的业务操作。' },
      { title: '本地存储', body: '离线只读缓存按用户和租户隔离，并使用加密数据库保存。登录凭证不写入离线业务缓存；退出登录或手动清理时会删除业务缓存和临时文件。' },
      { title: '权限与通知', body: '文件权限仅在你选择上传、下载或分享时使用。当前版本尚未接入 JPush，不会注册推送设备或伪造通知授权状态。' },
      { title: '账户与数据', body: '账户删除需提交申请并完成身份核验。部分财务记录或审计信息可能依据适用法规和企业合规要求保留，具体范围会在处理申请时说明。' },
    ],
  },
  agreement: {
    intro: '使用 BlackWave 寰澜前，请确认你已获得所属组织授权，并仅在授权范围内处理业务数据。',
    sections: [
      { title: '账号使用', body: '账号仅限本人使用。你应妥善保管登录凭证，不得绕过租户权限、冒用他人身份或访问未获授权的数据。' },
      { title: '数据责任', body: '你应确保上传和处理数据的来源合法、内容准确，并遵守所属组织的财务、隐私和信息安全制度。' },
      { title: '结果复核', body: '应用生成的对账、分析和智能建议用于辅助工作。涉及财务确认、审批或对外披露时，应由有权限的人员复核。' },
      { title: '停止使用', body: '你可以停止使用应用、清理本地数据，或通过账户删除申请入口提交服务器账户及相关数据的处理申请。' },
    ],
  },
  sdks: {
    intro: '以下能力随当前应用构建启用。它们仅在对应功能需要时工作；JPush 尚未接入，不属于当前启用清单。',
    sections: [
      { title: 'Expo / React Native', body: '用途：提供应用运行、界面渲染、路由和设备适配能力。应用不会仅因框架运行而主动上传业务数据。' },
      { title: 'Expo SecureStore / SQLite / FileSystem', body: '用途：在本机保存登录安全材料、加密离线只读缓存和临时文件，并在退出或清理时删除相关本地数据。' },
      { title: 'Expo DocumentPicker / Sharing', body: '用途：在你主动操作时选择上传文件，或将已下载报表交给系统分享面板。处理范围限于你选择的文件和分享目标。' },
      { title: '推送服务', body: '当前版本未接入 JPush 或其他系统推送 SDK，不会采集推送注册 ID，也不会展示可用的通知开关。' },
    ],
  },
};

export function LegalDocumentScreen({ kind }: { kind: LegalDocumentKind }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const document = documents[kind];

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.effectiveDate}>生效日期：2026年7月17日</Text>
        <Text style={styles.intro}>{document.intro}</Text>
        <View style={styles.sections}>
          {document.sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={styles.body}>{section.body}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background.canvas },
    content: { paddingBottom: 36, paddingHorizontal: 20, paddingTop: 24 },
    effectiveDate: { color: theme.text.muted, fontSize: 13, letterSpacing: 0 },
    intro: { color: theme.text.secondary, fontSize: 15, letterSpacing: 0, lineHeight: 23, marginTop: 18 },
    sections: { borderBottomColor: theme.border.default, borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 24 },
    section: { borderTopColor: theme.border.default, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 18 },
    sectionTitle: { color: theme.text.primary, fontSize: 16, fontWeight: '600', letterSpacing: 0 },
    body: { color: theme.text.secondary, fontSize: 15, letterSpacing: 0, lineHeight: 23, marginTop: 7 },
  });
}
