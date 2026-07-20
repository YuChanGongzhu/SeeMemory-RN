/**
 * 系统更新 OTA（MCU 真实升级）—— 检查更新查服务端最新版本 → 下载并校验 bin →
 * 走 BLE OTA 流式发送（OTA&LEN → DEV&OTA → 244B/帧 → OT&OVER）→ 成功/失败。
 * 升级期间独占 BLE（协议要求 OTA 期间禁发其他指令），成功后设备复位重连回读新版本。
 */
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Svg, {Circle} from 'react-native-svg';
import {Check, X} from 'lucide-react-native';
import {SubHeader, Card, IosAlert, HW} from './parts';
import {useMr20} from '../../hooks/useMr20';
import {getLatestFirmware, FirmwareInfo} from '../../apis/requests/firmware';
import {downloadFirmwareBin} from '../../services/firmwareOta';

type OtaState = 'idle' | 'confirming' | 'upgrading' | 'success' | 'failure';

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
  const {status, connState, runOtaMcu} = useMr20();
  const [ota, setOta] = useState<OtaState>('idle');
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'download' | 'send'>('download');
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<FirmwareInfo | null>(null);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [failMsg, setFailMsg] = useState('');
  const alive = useRef(true);

  // 当前版本以真实 status.firmware 为准，未连时回退到传入的兜底值。
  const current = status.firmware || fwVersion;
  const hasNew = !!info?.hasUpdate;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const checkUpdate = async () => {
    setChecking(true);
    setCheckMsg(null);
    try {
      const res = await getLatestFirmware({model: 'MR20', target: 'mcu', current});
      if (!alive.current) {
        return;
      }
      setInfo(res);
      if (!res.hasUpdate) {
        setCheckMsg('当前已是最新版本');
      }
    } catch (e) {
      if (alive.current) {
        setCheckMsg(`检查更新失败：${String((e as Error)?.message || e)}`);
      }
    } finally {
      if (alive.current) {
        setChecking(false);
      }
    }
  };

  const startUpdate = async () => {
    if (!info) {
      return;
    }
    if (connState !== 'connected') {
      setFailMsg('设备未连接，请先连接设备蓝牙后重试');
      setOta('failure');
      return;
    }
    setOta('upgrading');
    setStage('download');
    setProgress(0);
    try {
      const bin = await downloadFirmwareBin(info);
      if (!alive.current) {
        return;
      }
      setStage('send');
      await runOtaMcu(bin, (sent, total) => {
        if (alive.current && total > 0) {
          setProgress(Math.min(100, Math.round((sent / total) * 100)));
        }
      });
      if (alive.current) {
        setOta('success');
      }
    } catch (e) {
      if (alive.current) {
        setFailMsg(String((e as Error)?.message || e));
        setOta('failure');
      }
    }
  };

  // 全屏深色：升级中 / 成功 / 失败
  if (ota === 'upgrading' || ota === 'success' || ota === 'failure') {
    return (
      <View style={st.fullDark}>
        {ota === 'upgrading' ? (
          <>
            <View style={st.ringWrap}>
              <Ring progress={progress} size={120} color={HW.blue} />
              <Text style={st.ringPct}>{stage === 'download' ? '' : `${Math.min(progress, 100)}%`}</Text>
            </View>
            <Text style={st.darkTitle}>
              {stage === 'download' ? '正在下载固件...' : '正在写入设备，请勿断开连接'}
            </Text>
            <Text style={st.darkSub}>
              {stage === 'download' ? '正在校验固件完整性' : '升级期间无法使用其他功能，请耐心等待'}
            </Text>
          </>
        ) : ota === 'success' ? (
          <>
            <View style={[st.resultOrb, {backgroundColor: HW.green}]}>
              <Check size={40} color="#fff" strokeWidth={3} />
            </View>
            <Text style={st.darkTitleLg}>升级成功</Text>
            <Text style={st.darkSub}>设备即将重启，重连后版本将自动更新</Text>
            <View style={st.failBtns}>
              <TouchableOpacity
                style={[st.failBtn, {backgroundColor: HW.blue}]}
                onPress={() => {
                  setOta('idle');
                  setInfo(null);
                }}>
                <Text style={st.failBtnText}>完成</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <View style={[st.resultOrb, {backgroundColor: HW.red}]}>
              <X size={40} color="#fff" strokeWidth={3} />
            </View>
            <Text style={st.darkTitleLg}>升级失败</Text>
            <Text style={st.darkSub}>{failMsg || '固件传输中断，请保持设备靠近手机后重试'}</Text>
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
          <Text style={st.versionNow}>当前版本 {current}</Text>
          {connState !== 'connected' ? (
            <Text style={st.versionTime}>设备未连接，升级前请先连接蓝牙</Text>
          ) : null}
        </View>

        {hasNew && info ? (
          <Card style={st.newCard}>
            <View style={st.newHead}>
              <View style={st.redDot} />
              <Text style={st.newTitle}>发现新版本 {info.version}</Text>
            </View>
            <Text style={st.logHead}>更新内容：</Text>
            <Text style={st.logLine}>{info.changelog || '优化与问题修复'}</Text>
            <TouchableOpacity style={st.updateBtn} onPress={() => setOta('confirming')}>
              <Text style={st.updateBtnText}>立即更新</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <View style={st.latest}>
            <Text style={st.latestText}>{checkMsg || '点击检查是否有可用更新'}</Text>
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
        message="升级过程中无法使用其他功能，请保持设备连接与电量充足。"
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
  latestText: {fontSize: 16, fontWeight: '500', color: HW.textMain, textAlign: 'center', paddingHorizontal: 20},
  checkBtn: {flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 24},
  checkBtnText: {fontSize: 15, fontWeight: '600'},
  fullDark: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 40},
  ringWrap: {width: 120, height: 120, alignItems: 'center', justifyContent: 'center'},
  ringPct: {position: 'absolute', fontSize: 24, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums']},
  darkTitle: {fontSize: 16, fontWeight: '600', color: '#fff', marginTop: 24, textAlign: 'center'},
  darkTitleLg: {fontSize: 20, fontWeight: '600', color: '#fff'},
  darkSub: {fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 12},
  resultOrb: {width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  failBtns: {flexDirection: 'row', gap: 12, marginTop: 32, alignSelf: 'stretch'},
  failBtn: {flex: 1, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center'},
  failBtnText: {color: '#fff', fontSize: 16, fontWeight: '500'},
});
