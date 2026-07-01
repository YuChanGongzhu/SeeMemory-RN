/**
 * 录音模式说明 —— 当前模式来自真实 status.recMode（只读，硬件默认配置），
 * 下方两段静态说明照原型。
 */
import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {SubHeader, Card, HW} from './parts';
import {useMr20} from '../../hooks/useMr20';

export function RecordMode({onBack}: {onBack: () => void}) {
  const {status} = useMr20();
  const modeLabel = status.recMode === 'call' ? '通话模式' : '对话模式';

  return (
    <View style={st.root}>
      <SubHeader title="录音模式说明" onBack={onBack} />
      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <Card style={st.current}>
          <Text style={st.currentTitle}>当前为{modeLabel}</Text>
          <Text style={st.currentSub}>设备默认录音模式，已为您自动适配大多数场景</Text>
        </Card>

        <View style={st.explain}>
          <Text style={st.modeName}>通话模式</Text>
          <Text style={st.modeDesc}>优化近场人声清晰度，适合近距离通话、贴耳录制场景，人声更突出。</Text>
        </View>
        <View style={st.explain}>
          <Text style={st.modeName}>对话模式</Text>
          <Text style={st.modeDesc}>均衡声场与收音范围，适合多人交谈、会议、日常对话场景，声音更自然。</Text>
        </View>

        <Text style={st.disclaimer}>录音模式由设备硬件默认配置，暂不支持手动切换</Text>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20, gap: 12},
  current: {alignItems: 'center', paddingVertical: 24},
  currentTitle: {fontSize: 22, fontWeight: '700', color: HW.blue, marginBottom: 8},
  currentSub: {fontSize: 14, color: HW.textSub, textAlign: 'center', lineHeight: 21},
  explain: {backgroundColor: HW.card, borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  modeName: {fontSize: 16, fontWeight: '600', color: HW.textMain, marginBottom: 6},
  modeDesc: {fontSize: 14, color: HW.textBody, lineHeight: 22},
  disclaimer: {fontSize: 12, color: HW.textSub, textAlign: 'center', marginTop: 8},
});
