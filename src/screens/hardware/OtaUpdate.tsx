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
import {clearOtaLog, otaLog} from '../../services/otaLog';
import {getApiEnv, getBaseApiUrl} from '../../apis/core/env';
import {OtaLogPanel} from './OtaLogPanel';

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
  /**
   * 能不能刷 —— 和「有没有新版本」是两件事。
   *
   * 后端 `FirmwareManager.latest` 只有在**该型号一个固件都没登记**时才返回空壳；只要登记过，
   * `downloadUrl / size / md5` 一律照给，`hasUpdate` 仅仅是它拿 `versionCode` 比出来的一个布尔。
   * 也就是说版本号相同的时候，刷入所需的东西我们其实**一样不缺**，拦着不让刷纯粹是自我设限。
   *
   * 而「版本号相同但需要刷」在这个项目里是常态：固件方给了新包却忘了递增 versionCode、
   * 上一次刷到一半断了要重来、或者单纯想验证 OTA 链路本身通不通。
   */
  const canFlash = !!info?.downloadUrl && (info?.size ?? 0) > 0;
  /** 版本号没比当前高 → 这次是「重刷」而不是「升级」，文案和日志都该说实话。 */
  const isReflash = canFlash && !hasNew;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const checkUpdate = async () => {
    setChecking(true);
    setCheckMsg(null);
    // 环境必须记：固件按环境分库，发在正式却用测试环境查，返回和「已是最新」完全同形。
    otaLog(
      `检查更新：model=MR20 target=mcu current=${current} @ ${getApiEnv()}(${getBaseApiUrl()})`,
    );
    try {
      const res = await getLatestFirmware({model: 'MR20', target: 'mcu', current});
      if (!alive.current) {
        return;
      }
      setInfo(res);
      if (res.hasUpdate) {
        otaLog(
          `发现新版本 ${res.version}（versionCode=${res.versionCode}，${res.size} 字节，md5=${res.md5}，强制=${res.mandatory}）`,
        );
      } else if (res.version) {
        // 有登记行但版本码不够高：真·已是最新，或后台发的版本码没递增。
        otaLog(
          `服务端最新为 ${res.version}（versionCode=${res.versionCode}），不高于当前 ${current}，判定无更新`,
        );
      } else {
        // 响应里连 version 都没有 → findLatest 返回 null，该环境根本没登记过这个型号的固件。
        otaLog(
          `该环境未登记 MR20/mcu 的任何固件版本（响应无 version 字段）——` +
            `确认固件是否发布在 ${getApiEnv() === 'prod' ? '测试' : '正式'}环境而非当前环境`,
          'warn',
        );
      }
      if (!res.hasUpdate) {
        setCheckMsg('当前已是最新版本');
      }
    } catch (e) {
      otaLog(`检查更新失败：${String((e as Error)?.message || e)}`, 'error');
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
    // 这里判的是 downloadUrl 而**不是** hasUpdate：版本号相同照样允许刷，缺的只可能是包本身。
    if (!canFlash) {
      otaLog('服务端没有可下载的固件包（该环境未登记 MR20/mcu 版本），无法刷入', 'error');
      setFailMsg('服务端没有可下载的固件包，请先在管理端发布固件。');
      setOta('failure');
      return;
    }
    if (connState !== 'connected') {
      otaLog('设备未连接，终止升级', 'error');
      setFailMsg('设备未连接，请先连接设备蓝牙后重试');
      setOta('failure');
      return;
    }
    // 重试时清掉上一轮，避免两次记录混在一起看不清。
    clearOtaLog();
    otaLog(
      isReflash
        ? `开始重新刷入：${current} → ${info.version}（版本号未提升，属于重刷不是升级）`
        : `开始升级：${current} → ${info.version}`,
    );
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
      otaLog(`升级中断：${String((e as Error)?.message || e)}`, 'error');
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
        <View style={st.logSlotDark}>
          <OtaLogPanel dark />
        </View>
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
            {/* 版本号相同时的刷入入口。做成次要样式而不是和「立即更新」同款主按钮：
                它不是常规路径，但也不该被藏起来——需要它的时候（固件方没递增版本码、
                上次刷到一半失败）恰恰是最着急的时候。 */}
            {canFlash ? (
              <View style={st.reflash}>
                <TouchableOpacity
                  style={st.reflashBtn}
                  onPress={() => setOta('confirming')}>
                  <Text style={st.reflashBtnText}>
                    重新刷入 {info?.version}
                  </Text>
                </TouchableOpacity>
                <Text style={st.reflashHint}>
                  版本号相同也能刷。固件方发了新包但没递增版本码、上次刷到一半失败、
                  或想单独验证 OTA 链路时用。刷的是服务端当前这一版（{info?.size} 字节）。
                </Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={st.logSlot}>
          <OtaLogPanel />
        </View>
      </ScrollView>

      <IosAlert
        visible={ota === 'confirming'}
        onClose={() => setOta('idle')}
        title={
          isReflash ? `确定要重新刷入 ${info?.version} 吗？` : '确定要升级设备系统吗？'
        }
        message={
          isReflash
            ? `设备当前就是 ${current}，这会把同一版本的固件完整重写一遍，不是升级。` +
              '过程中无法使用其他功能，请保持设备连接与电量充足。'
            : '升级过程中无法使用其他功能，请保持设备连接与电量充足。'
        }
        buttons={[
          {text: '取消', onPress: () => setOta('idle')},
          {
            text: isReflash ? '重新刷入' : '立即升级',
            bold: true,
            onPress: startUpdate,
          },
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
  reflash: {alignSelf: 'stretch', alignItems: 'center', gap: 10, marginTop: 4},
  reflashBtn: {paddingHorizontal: 24, paddingVertical: 11, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.blue},
  reflashBtnText: {fontSize: 15, fontWeight: '600', color: HW.blue},
  reflashHint: {fontSize: 12, color: HW.textSub, lineHeight: 18, textAlign: 'center', paddingHorizontal: 12},
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
  // 临时调试面板占位，随 OtaLogPanel 一并删除。
  logSlot: {marginTop: 24},
  logSlotDark: {position: 'absolute', left: 20, right: 20, bottom: 32},
});
