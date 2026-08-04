/**
 * 传输状态浮标 —— 替代原来居中的「正在传输…」阻塞弹窗。传输/连接进行时只在底部浮一个
 * 小「传输中」药丸，用户可继续浏览/返回做别的事；点一下展开详情条(进度 + 取消/继续/知道了)。
 *
 * 同时覆盖两条链路：WiFi 快传(useMr20.wifi* 状态机) 与 蓝牙同步(syncing/syncProgress)。
 * 读全局状态，故在设备文件页 / 设备主页 / WiFi 快传页任意挂载都一致。
 */
import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {AlertCircle, Check, CheckCircle2, ChevronUp, Rocket, X} from 'lucide-react-native';
import {ProgressBar} from '../../ui/kit';
import {useMr20} from '../../hooks/useMr20';
import type {WifiConnectStep, WifiStepState} from '../../services/mr20WifiSync';
import {MR20_KEY_LEN} from '../../native/mr20/protocol';
import {HW} from './parts';

const stripMp3 = (n: string) => n.replace(/\.mp3$/i, '');

const WIFI_STEP_LABEL: Record<WifiConnectStep, string> = {
  provision: '初始化热点密码',
  open: '开启设备热点',
  join: '加入热点网络',
  reachable: '建立高速连接',
};
const WIFI_STEP_ORDER: WifiConnectStep[] = ['provision', 'open', 'join', 'reachable'];

/** 连接热点分步清单（对齐原型的网络状态展示）。 */
function WifiSteps({steps}: {steps: Record<WifiConnectStep, WifiStepState>}) {
  return (
    <View style={st.steps}>
      {/* provision（SK + WIFI&CH）只在首次配网时才跑，跑过一次就永远跳过。没跑的那些次
          若照样列一条空着不动的「初始化热点密码」，看上去像卡住了，所以未启动就不显示。 */}
      {WIFI_STEP_ORDER.filter(k => k !== 'provision' || steps[k] !== 'pending').map(k => {
        const s = steps[k];
        const color =
          s === 'done' ? HW.green : s === 'failed' ? HW.red : s === 'active' ? HW.blue : HW.textTertiary;
        return (
          <View key={k} style={st.stepRow}>
            <View style={[st.stepDot, {borderColor: color, backgroundColor: s === 'done' ? HW.green : 'transparent'}]}>
              {s === 'done' ? (
                <Check size={10} color="#fff" strokeWidth={3} />
              ) : s === 'active' ? (
                <ActivityIndicator size="small" color={HW.blue} />
              ) : null}
            </View>
            <Text style={[st.stepText, {color: s === 'pending' ? HW.textSub : HW.textMain}]}>
              {WIFI_STEP_LABEL[k]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function TransferBadge({bottom = 28}: {bottom?: number} = {}) {
  const {
    syncing,
    syncProgress,
    stopSync,
    wifiPhase,
    wifiSteps,
    wifiProgress,
    wifiSummary,
    wifiCred,
    cancelWifiTransfer,
    switchToWifiTransfer,
    continueWifiAfterManualJoin,
    retryWifiJoinWithPassword,
    resetWifiTransfer,
    error,
  } = useMr20();

  const [expanded, setExpanded] = useState(false);
  // 手输热点密码。自动入网的候选只有「设备自报 / 本地存过 / 出厂默认」三个来源，
  // 真实密码不在其中时，自动重试多少次都是同一批错密码——得让用户能自己填一个进来。
  const [manualPwd, setManualPwd] = useState('');
  // 进入手动页就把**设备自报的**密码预填进去。热点开着时 GJJY_BLE&WIFI 本来就能把它读出来，
  // 让用户对着空输入框猜、或者跑去问固件方，纯属把已经拿到手的信息又藏起来。
  // 用 `prev || …` 而不是直接覆盖：用户改过之后不能被下一次轮询把输入吞掉。
  useEffect(() => {
    if (wifiPhase === 'manual' && wifiCred?.reported) {
      setManualPwd(prev => prev || wifiCred.reported);
    }
  }, [wifiPhase, wifiCred?.reported]);

  const wifiActive = wifiPhase !== 'idle';
  const bleActive = syncing && !wifiActive;
  if (!wifiActive && !bleActive) {
    return null;
  }

  // 归一化出「显示态」，两条链路共用一套浮标。
  const kind: 'progress' | 'connecting' | 'manual' | 'done' | 'error' = bleActive
    ? 'progress'
    : wifiPhase === 'connecting'
    ? 'connecting'
    : wifiPhase === 'manual'
    ? 'manual'
    : wifiPhase === 'done'
    ? 'done'
    : wifiPhase === 'error'
    ? 'error'
    : 'progress';

  const prog = bleActive ? syncProgress : wifiProgress;
  const done = kind === 'done';
  const failed = kind === 'error';
  const busy = kind === 'progress' || kind === 'connecting';

  const label =
    kind === 'connecting'
      ? '连接设备热点…'
      : kind === 'manual'
      ? '请完成热点连接'
      : kind === 'done'
      ? `已同步 ${wifiSummary?.count ?? 0} 个`
      : kind === 'error'
      ? '同步失败'
      : prog
      ? `传输中 ${prog.completed}/${prog.total}`
      : '传输中…';

  const cancel = () => (bleActive ? stopSync() : cancelWifiTransfer());
  const dismiss = () => {
    setExpanded(false);
    resetWifiTransfer();
  };

  const Icon = done ? CheckCircle2 : failed || kind === 'manual' ? AlertCircle : null;
  const tint = done ? HW.green : failed || kind === 'manual' ? HW.red : HW.blue;

  return (
    <View style={[st.wrap, {bottom}]} pointerEvents="box-none">
      {expanded ? (
        <View style={st.card}>
          <View style={st.cardHead}>
            <Text style={st.cardTitle}>{label}</Text>
            <TouchableOpacity onPress={() => setExpanded(false)} hitSlop={st.hit}>
              <X size={18} color={HW.textSub} />
            </TouchableOpacity>
          </View>

          {kind === 'connecting' ? <WifiSteps steps={wifiSteps} /> : null}

          {busy && prog ? (
            <>
              {/* 总进度：X/Y 文件 */}
              <View style={st.overallRow}>
                <Text style={st.overallLabel}>总进度</Text>
                <Text style={st.overallCount}>
                  {prog.completed}/{prog.total}
                </Text>
              </View>
              <View style={st.progressWrap}>
                <ProgressBar
                  value={prog.completed}
                  total={prog.total || 1}
                  color={HW.blue}
                  height={6}
                />
              </View>
              {prog.current ? (
                <>
                  <Text style={st.file} numberOfLines={1}>
                    {stripMp3(prog.current.fname)}
                  </Text>
                  <View style={st.progressWrap}>
                    <ProgressBar
                      value={prog.current.received}
                      total={prog.current.size}
                      color={HW.blue}
                      height={6}
                    />
                  </View>
                </>
              ) : null}
            </>
          ) : null}

          {kind === 'manual' ? (
            <>
              {/* 报错优先：这里通常是「用密码 X 还是连不上」，得让用户看见自己刚试的那个值。 */}
              {error ? <Text style={st.errText}>{error}</Text> : null}
              <Text style={st.hintText}>
                自动连接热点
                {wifiCred?.ssid ? `「${wifiCred.ssid}」` : ''}
                未成功{wifiCred?.pwd ? `（试过的密码：${wifiCred.pwd}）` : ''}。
              </Text>
              {/* 设备自报的密码单独列一行、等宽字体。它是热点开着时用 GJJY_BLE&WIFI 读回来的，
                  是这台设备当下最权威的一份口供，值得让用户一眼看见并核对。 */}
              {wifiCred?.reported ? (
                <Text style={st.hintText}>
                  设备自报的热点密码：
                  <Text style={st.mono}>{wifiCred.reported}</Text>
                  （已填在下面，可直接连；不对就改成你知道的那个）
                </Text>
              ) : (
                <Text style={st.hintText}>
                  设备没有自报热点密码。如果你知道正确的密码，直接输在下面重试 ——
                  比去系统设置快，也不会因为切来切去超时。
                </Text>
              )}
              {/* 输入框直接摆在失败现场。让用户跑一趟系统设置的话，那一趟本身就必然
                  超出协议给热点的 30s 空闲窗口，回来时热点已经被设备自己关掉了。 */}
              <View style={st.pwdRow}>
                {/* maxLength 不按 MR20_KEY_LEN 卡：走到手输这一步，恰恰说明「热点密码就是
                    8 位绑定密钥」这个假设在这台设备上不成立——按它截断等于把唯一的
                    escape hatch 又焊回同一个假设上。上限按 WPA2 自己的规矩给 63。 */}
                <TextInput
                  style={st.pwdInput}
                  value={manualPwd}
                  onChangeText={setManualPwd}
                  placeholder={`热点密码（通常 ${MR20_KEY_LEN} 位）`}
                  placeholderTextColor={HW.textSub}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={63}
                />
                <TouchableOpacity
                  style={[st.primaryBtn, !manualPwd.trim() && st.btnDisabled]}
                  disabled={!manualPwd.trim()}
                  onPress={() =>
                    retryWifiJoinWithPassword(manualPwd).catch(() => undefined)
                  }>
                  <Text style={st.primaryBtnText}>用这个密码连</Text>
                </TouchableOpacity>
              </View>
              <Text style={st.hintText}>
                不知道密码？到「WiFi 管理 → 运行配网自检」跑一遍，日志会告诉你卡在哪一步。
              </Text>
            </>
          ) : null}
          {failed ? (
            <Text style={st.hintText}>{error || '已传完的录音已保留，可重试剩余文件。'}</Text>
          ) : null}
          {/* 蓝牙传输中才提示切换：WiFi 快传本身就是高速链路，没有可切的对象。 */}
          {bleActive ? (
            <Text style={st.hintText}>
              蓝牙较慢，可切到 WiFi 快传（约快 10×）。已传完的不会重传。
            </Text>
          ) : null}

          <View style={st.actions}>
            {kind === 'manual' ? (
              <>
                <TouchableOpacity style={st.ghostBtn} onPress={() => Linking.openSettings()}>
                  <Text style={st.ghostBtnText}>去系统设置</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={st.primaryBtn}
                  onPress={() => continueWifiAfterManualJoin().catch(() => undefined)}>
                  <Text style={st.primaryBtnText}>我已连接</Text>
                </TouchableOpacity>
              </>
            ) : busy ? (
              <>
                <TouchableOpacity style={st.ghostBtn} onPress={cancel}>
                  <Text style={st.ghostBtnText}>取消传输</Text>
                </TouchableOpacity>
                {/* 蓝牙同步中途改走 WiFi：打断 BLE 后用 WiFi 续传剩余文件。
                    WiFi 快传自身进行中不显示（无处可切）。 */}
                {bleActive ? (
                  <TouchableOpacity
                    style={st.primaryBtn}
                    onPress={() => switchToWifiTransfer().catch(() => undefined)}>
                    <Rocket size={15} color="#fff" />
                    <Text style={st.primaryBtnText}>切 WiFi 快传</Text>
                  </TouchableOpacity>
                ) : null}
              </>
            ) : (
              <TouchableOpacity style={st.primaryBtn} onPress={dismiss}>
                <Text style={st.primaryBtnText}>知道了</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : null}

      {/* 折叠药丸：常驻底部，点开/收起详情 */}
      <TouchableOpacity
        style={st.pill}
        activeOpacity={0.85}
        onPress={() => setExpanded(v => !v)}>
        {busy ? (
          <ActivityIndicator size="small" color={tint} />
        ) : Icon ? (
          <Icon size={18} color={tint} />
        ) : (
          <Rocket size={16} color={tint} />
        )}
        <Text style={st.pillText} numberOfLines={1}>
          {label}
        </Text>
        <ChevronUp
          size={16}
          color={HW.textTertiary}
          style={expanded ? st.chevOpen : undefined}
        />
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center'},
  pill: {flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: '86%', backgroundColor: '#fff', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: {width: 0, height: 4}, elevation: 6},
  pillText: {flexShrink: 1, fontSize: 14, color: HW.textMain, fontWeight: '600'},
  chevOpen: {transform: [{rotate: '180deg'}]},

  card: {width: '86%', backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: {width: 0, height: 6}, elevation: 8},
  cardHead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  cardTitle: {fontSize: 15, fontWeight: '700', color: HW.textMain},
  hit: {top: 8, bottom: 8, left: 8, right: 8},
  file: {fontSize: 13, color: HW.textSub, marginTop: 10},
  progressWrap: {marginTop: 8},
  overallRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12},
  overallLabel: {fontSize: 13, color: HW.textSub, fontWeight: '600'},
  overallCount: {fontSize: 13, color: HW.textMain, fontWeight: '700'},
  steps: {marginTop: 12, gap: 10},
  stepRow: {flexDirection: 'row', alignItems: 'center', gap: 10},
  stepDot: {width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center'},
  stepText: {fontSize: 13, fontWeight: '500'},
  hintText: {fontSize: 13, color: HW.textBody, lineHeight: 19, marginTop: 10},
  actions: {flexDirection: 'row', gap: 10, marginTop: 14},
  ghostBtn: {flex: 1, height: 42, borderRadius: 12, backgroundColor: HW.fill, alignItems: 'center', justifyContent: 'center'},
  ghostBtnText: {fontSize: 14, color: HW.textMain, fontWeight: '600'},
  primaryBtn: {flex: 1, flexDirection: 'row', gap: 6, height: 42, borderRadius: 12, backgroundColor: HW.blue, alignItems: 'center', justifyContent: 'center'},
  primaryBtnText: {fontSize: 14, color: '#fff', fontWeight: '700'},
  btnDisabled: {opacity: 0.4},
  errText: {fontSize: 13, color: HW.red, lineHeight: 19, marginTop: 10},
  mono: {fontFamily: 'Menlo', fontWeight: '700', color: HW.textMain},
  pwdRow: {flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center'},
  pwdInput: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    backgroundColor: HW.fill,
    paddingHorizontal: 12,
    fontSize: 15,
    // 密码是 8 位定长的乱码串，等宽字体能一眼看出输了几位、有没有把 0/O 看混。
    fontFamily: 'Menlo',
    color: HW.textMain,
  },
});
