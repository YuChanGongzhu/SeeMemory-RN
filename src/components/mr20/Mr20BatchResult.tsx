/**
 * 后端批处理结果卡：展示组级「场景总结」+「值得回顾的问题」（服务端 AI 产出）。
 * 单条录音的转写文本仍在收件箱条目里显示，这里只放组级洞察。
 */
import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import type {Mr20BatchState} from '../../hooks/useMr20';

export function Mr20BatchResult({batch}: {batch: Mr20BatchState | null}) {
  const {theme} = useTheme();
  const c = theme.colors;

  const hasSummary = !!batch?.summary?.trim();
  const hasQuestions = !!batch?.questions?.length;
  if (!batch || (!hasSummary && !hasQuestions)) {
    return null;
  }

  return (
    <View style={[styles.card, {backgroundColor: c.bgCard, borderColor: c.border}]}>
      {hasSummary ? (
        <>
          <Text style={[styles.title, {color: c.text}]}>场景总结</Text>
          <Text style={[styles.summary, {color: c.textSecondary}]}>{batch.summary}</Text>
        </>
      ) : null}

      {hasQuestions ? (
        <>
          <Text style={[styles.title, {color: c.text, marginTop: hasSummary ? 16 : 0}]}>
            值得回顾的问题
          </Text>
          {batch.questions!.map((q, i) => (
            <View key={i} style={styles.qRow}>
              <Text style={[styles.qDot, {color: c.accent}]}>·</Text>
              <Text style={[styles.qText, {color: c.textSecondary}]}>{q}</Text>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 12},
  title: {fontSize: 14, fontWeight: '700', marginBottom: 8},
  summary: {fontSize: 12.5, lineHeight: 20},
  qRow: {flexDirection: 'row', marginTop: 8, gap: 8},
  qDot: {fontSize: 13, fontWeight: '700', lineHeight: 19},
  qText: {flex: 1, fontSize: 12.5, lineHeight: 19},
});
