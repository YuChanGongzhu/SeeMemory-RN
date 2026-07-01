/**
 * 系统更新 OTA（模拟）—— 协议层无 OTA 能力，按原型还原：检查更新 → 确认弹窗 →
 * 全屏深色环形进度 → 成功/失败。本地 state + 定时器驱动。
 */
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';
import {Check, Loader2, X} from 'lucide-react-native';
import {SubHeader, Card, IosAlert, HW} from './parts';

type OtaState = 'idle' | 'confirming' | 'upgrading' | 'success' | 'failure';
const NEW_VERSION = 'V1.1.0';

function Ring({progress, size, color}: {progress: number; size: number; color: string}) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(progress, 100) / 100);
  return (
    <Svg width={size} height={size} style={{transform: [{rotate: '-90deg'}]}}>
      <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={6} />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function OtaUpdate({onBack, fwVersion}: {onBack: () => void; fwVersion: string}) {
  const [ota, setOta] = useState<OtaState>('idle');
  const [progress, setProgress] = useState(0);
  const [hasNew, setHasNew] = useState(false);
  const [checking, setChecking] = useState(false);
  const [version, setVersion] = useState(fwVersion);
  const timers = useRef<Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>>([]);

  useEffect(
    () => () => {
      timers.current.forEach(t => {
        clearTimeout(t as ReturnType<typeof setTimeout>);
        clearInterval(t as ReturnType<typeof setInterval>);
      });
    },
    [],
  );

  const checkUpdate = () => {
    setChecking(true);
    timers.current.push(
      setTimeout(() => {
        setChecking(false);
        setHasNew(true);
      }, 1500),
    );
  };

  const startUpdate = () => {
    setOta('upgrading');
    setProgress(0);
    const iv = setInterval(() => {
      setProgress(p => {
        const next = p + Math.floor(5 + Math.random() * 15);
        if (next >= 100) {
          clearInterval(iv);
          timers.current.push(
            setTimeout(() => {
              setOta('success');
              timers.current.push(
                setTimeout(() => {
                  setVersion(NEW_VERSION);
                  setHasNew(false);
                  setOta('idle');
                }, 3000),
              );
            }, 400),
          );
          return 100;
        }
        return next;
      });
    }, 500);
    timers.current.push(iv);
  };

  // 全屏深色：升级中 / 成功 / 失败
  if (ota === 'upgrading' || ota === 'success' || ota === 'failure') {
    return (
      <View style={st.fullDark}>
        {ota === 'upgrading' ? (
          <>
            <View style={st.ringWrap}>
              <Ring progress={progress} size={120} color={HW.blue} />
              <Text style={st.ringPct}>{Math.min(progress, 100)}%</Text>
            </View>
            <Text style={st.darkTitle}>正在升级设备，请勿断开连接</Text>
            <Text style={st.darkSub}>约需 3-5 分钟，请耐心等待</Text>
          </>
        ) : ota === 'success' ? (
          <>
            <View style={[st.resultOrb, {backgroundColor: HW.green}]}>
              <Check size={40} color="#fff" strokeWidth={3} />
            </View>
            <Text style={st.darkTitleLg}>升级成功</Text>
            <Text style={st.darkSub}>设备即将重启...</Text>
          </>
        ) : (
          <>
            <View style={[st.resultOrb, {backgroundColor: HW.red}]}>
              <X size={40} color="#fff" strokeWidth={3} />
            </View>
            <Text style={st.darkTitleLg}>升级失败</Text>
            <Text style={st.darkSub}>固件传输中断，请保持设备靠近手机后重试</Text>
            <View style={st.failBtns}>
              <TouchableOpacity style={[st.failBtn, {backgroundColor: 'rgba(255,255,255,0.1)'}]} onPress={() => setOta('idle')}>
                <Text style={st.failBtnText}>返回</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.failBtn, {backgroundColor: HW.blue}]} onPress={startUpdate}>
                <Text style={st.failBtnText}>重试</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={st.root}>
      <SubHeader title="系统更新" onBack={onBack} />
      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <View style={st.versionHead}>
          <Text style={st.versionNow}>当前版本 {version}</Text>
          <Text style={st.versionTime}>最后更新时间: 2026-05-12 10:00</Text>
        </View>

        {hasNew ? (
          <Card style={st.newCard}>
            <View style={st.newHead}>
              <View style={[st.redDot]} />
              <Text style={st.newTitle}>发现新版本 {NEW_VERSION}</Text>
            </View>
            <Text style={st.logHead}>更新内容：</Text>
            <Text style={st.logLine}>1. 优化了拾音降噪算法，提升复杂环境下的清晰度</Text>
            <Text style={st.logLine}>2. 提升了 WiFi 传输稳定性，下载速度提高 20%</Text>
            <Text style={st.logLine}>3. 修复了部分场景下电量显示不准确的问题</Text>
            <TouchableOpacity style={st.updateBtn} onPress={() => setOta('confirming')}>
              <Text style={st.updateBtnText}>立即更新</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View style={st.latest}>
            <Text style={st.latestText}>当前已是最新版本</Text>
            <TouchableOpacity
              style={[st.checkBtn, {backgroundColor: checking ? HW.fill : '#E5E5EA'}]}
              disabled={checking}
              onPress={checkUpdate}>
              {checking ? <ActivityIndicator size="small" color={HW.textSub} /> : null}
              <Text style={[st.checkBtnText, {color: checking ? HW.textSub : HW.textMain}]}>
                {checking ? '正在检查...' : '检查更新'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      <IosAlert
        visible={ota === 'confirming'}
        onClose={() => setOta('idle')}
        title="确定要升级设备系统吗？"
        message="升级过程中无法使用其他功能，请保持设备连接。"
        buttons={[
          {text: '取消', onPress: () => setOta('idle')},
          {text: '立即升级', bold: true, onPress: startUpdate},
        ]}
      />
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20},
  versionHead: {alignItems: 'center', paddingVertical: 24},
  versionNow: {fontSize: 14, fontWeight: '500', color: HW.textSub},
  versionTime: {fontSize: 12, color: HW.textTertiary, marginTop: 4},
  newCard: {padding: 20},
  newHead: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16},
  redDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: HW.red},
  newTitle: {fontSize: 18, fontWeight: '700', color: HW.textMain},
  logHead: {fontSize: 14, fontWeight: '600', color: HW.textMain, marginBottom: 8},
  logLine: {fontSize: 14, color: HW.textBody, lineHeight: 22},
  updateBtn: {marginTop: 20, height: 48, borderRadius: 14, backgroundColor: HW.blue, alignItems: 'center', justifyContent: 'center'},
  updateBtnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  latest: {alignItems: 'center', gap: 20, paddingVertical: 20},
  latestText: {fontSize: 16, fontWeight: '500', color: HW.textMain},
  checkBtn: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24},
  checkBtnText: {fontSize: 15, fontWeight: '600'},
  fullDark: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 40},
  ringWrap: {width: 120, height: 120, alignItems: 'center', justifyContent: 'center'},
  ringPct: {position: 'absolute', fontSize: 24, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums']},
  darkTitle: {fontSize: 16, fontWeight: '600', color: '#fff', marginTop: 24},
  darkTitleLg: {fontSize: 20, fontWeight: '600', color: '#fff'},
  darkSub: {fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 12},
  resultOrb: {width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  failBtns: {flexDirection: 'row', gap: 12, marginTop: 32, alignSelf: 'stretch'},
  failBtn: {flex: 1, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  failBtnText: {color: '#fff', fontSize: 16, fontWeight: '500'},
});
