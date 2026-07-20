import React, {useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ShieldCheck} from 'lucide-react-native';
import {colors} from '../design/tokens';
import {AI_VENDORS, PRIVACY_POLICY_URL} from '../config/legal';

/**
 * 首启隐私与 AI 处理告知（App Store 5.1.1(i) / 5.1.2(i)）。
 *
 * 在任何数据被采集或发往第三方之前展示，用户必须主动点「同意并继续」才能进入 App。
 * 不提供"稍后再说"——未同意即无法使用，这是取得处理依据的前提。
 */
export function ConsentScreen({onAgree}: {onAgree: () => void}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);

  const agree = () => {
    if (busy) {
      return;
    }
    setBusy(true);
    onAgree();
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.body, {paddingTop: insets.top + 32, paddingBottom: 24}]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <ShieldCheck size={28} color={colors.textMain} />
        </View>
        <Text style={styles.title}>隐私与 AI 处理告知</Text>
        <Text style={styles.lead}>
          SiMemory 通过 AI 把你的录音整理成记忆。开始使用前，请了解你的内容会被如何处理。
        </Text>

        <Text style={styles.sectionTitle}>我们会处理什么</Text>
        <Text style={styles.paragraph}>
          你主动录制的音频、由此转写的文本，以及你添加的笔记、图片与文档。
        </Text>

        <Text style={styles.sectionTitle}>会发送给谁</Text>
        <Text style={styles.paragraph}>
          为完成语音转写与 AI 总结，上述内容会发送给下列第三方服务商处理：
        </Text>

        <View style={styles.card}>
          {AI_VENDORS.map((v, i) => (
            <View key={v.vendor} style={[styles.row, i < AI_VENDORS.length - 1 && styles.rowBorder]}>
              <Text style={styles.vendor}>{v.vendor}</Text>
              <Text style={styles.detail}>
                {v.data} · {v.purpose}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.paragraph}>
          这些服务商仅按我们的指令处理数据，不会将其用于自身模型训练。我们不会出售你的个人信息，也不会用于广告或跨应用追踪。
        </Text>

        <Text style={styles.sectionTitle}>你的选择</Text>
        <Text style={styles.paragraph}>
          你可以随时停止使用相关功能，或在「我的 — 个人信息」中注销账号以终止处理。
        </Text>

        <TouchableOpacity onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          <Text style={styles.link}>阅读完整《隐私政策》</Text>
        </TouchableOpacity>
      </ScrollView>

      <View style={[styles.footer, {paddingBottom: insets.bottom + 16}]}>
        <TouchableOpacity style={styles.agreeBtn} onPress={agree} disabled={busy}>
          <Text style={styles.agreeText}>同意并继续</Text>
        </TouchableOpacity>
        <Text style={styles.footnote}>点击「同意并继续」即表示你已阅读并同意上述内容与《隐私政策》</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  body: {paddingHorizontal: 24},
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {fontSize: 24, fontWeight: '700', color: colors.textMain, marginBottom: 12},
  lead: {fontSize: 15, lineHeight: 23, color: colors.textSub, marginBottom: 28},
  sectionTitle: {fontSize: 16, fontWeight: '700', color: colors.textMain, marginBottom: 8},
  paragraph: {fontSize: 14, lineHeight: 22, color: colors.textSub, marginBottom: 20},
  card: {backgroundColor: colors.bg, borderRadius: 16, paddingHorizontal: 16, marginBottom: 20},
  row: {paddingVertical: 12},
  rowBorder: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border},
  vendor: {fontSize: 14, fontWeight: '600', color: colors.textMain, marginBottom: 3},
  detail: {fontSize: 12, lineHeight: 18, color: colors.textSub},
  link: {fontSize: 14, fontWeight: '600', color: colors.textMain, textDecorationLine: 'underline'},
  footer: {
    paddingHorizontal: 24,
    paddingTop: 12,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  agreeBtn: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  agreeText: {fontSize: 16, fontWeight: '600', color: '#fff'},
  footnote: {fontSize: 11, lineHeight: 16, color: colors.textSub, textAlign: 'center', marginTop: 10},
});
