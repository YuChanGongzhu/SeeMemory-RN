/**
 * 首页头部「记忆粒」设备入口 —— 还原原型 HomeV2 顶部的蓝牙状态图标 + 设备状态弹层。
 *
 * 只读全局 useMr20 状态（连接/同步/电量/容量/待同步），不持有任何连接逻辑：
 * 连接/配对仍走「我的设备」页（nav.push('hardware')），本组件不改动硬件页。
 * 同步进度由首页挂载的 <TransferBadge/> 展示，这里只负责「看状态 + 一键同步 + 跳设备页」。
 */
import React, {useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Bluetooth,
  BluetoothConnected,
  BluetoothSearching,
  Battery,
  ChevronRight,
  HardDrive,
  Mic,
  Wifi,
} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {IconButton} from '../ui/kit';
import {BottomSheet} from '../ui/BottomSheet';
import {useNav} from '../navigation/nav';
import {useMr20} from '../hooks/useMr20';
import {isMr20WifiAvailable} from '../native/mr20/Mr20Native';

function fmtStorage(freeMb?: number): string | null {
  if (freeMb == null) {
    return null;
  }
  const whole = Math.max(0, Math.round(freeMb));
  const gb = Math.floor(whole / 1024);
  const mb = whole % 1024;
  return gb > 0 ? `剩余 ${gb}GB ${mb}MB` : `剩余 ${mb}MB`;
}

export function HomeDeviceButton() {
  const nav = useNav();
  const {
    connState,
    syncing,
    wifiPhase,
    status,
    recording,
    inbox,
    deviceFiles,
    connectedDevice,
    syncNow,
    startWifiTransferPending,
    hasPaired,
    reconnectSaved,
  } = useMr20();
  const [open, setOpen] = useState(false);

  const connected = connState === 'connected';
  const busy =
    connState === 'scanning' ||
    connState === 'connecting' ||
    connState === 'pairing';
  const transferring = syncing || wifiPhase !== 'idle';
  const pending = deviceFiles?.pending ?? 0;
  const hasNew = connected && pending > 0 && !transferring;

  // 图标态：传输中转圈 > 已连接绿 > 连接中蓝 > 未连接灰。
  const icon = transferring ? (
    <ActivityIndicator size="small" color={colors.auraProject} />
  ) : connected ? (
    <BluetoothConnected size={22} color={colors.focus} strokeWidth={2} />
  ) : busy ? (
    <BluetoothSearching size={22} color={colors.auraProject} strokeWidth={2} />
  ) : (
    <Bluetooth size={22} color={colors.textSub} strokeWidth={2} />
  );

  const goHardware = () => {
    setOpen(false);
    // 先让弹层(Modal)在本帧内关闭并提交，下一帧再切页。否则 setOpen(false) 与
    // nav.push 会被 React 批到同一次提交：Modal 在其祖先「首页帧」被 display:none
    // 隐藏的同一拍收到 visible=false，iOS 原生 modal 不会被正常 dismiss，残留一层
    // 透明全屏 modal 拦截所有点击 → 返回首页后点不开弹层、点不动界面。
    requestAnimationFrame(() => nav.push('hardware'));
  };

  // 手动重连：留在首页，force 绕过「每会话只自动一次」的门控。弹层保持打开，
  // 让用户看到图标/文案切到「重新连接中」。
  const doReconnect = () => {
    reconnectSaved(true).catch(() => undefined);
  };

  // 蓝牙同步：内部扫盘同步全部待传，无需预先列文件。
  const doSync = () => {
    setOpen(false);
    syncNow().catch(() => undefined);
  };

  // WiFi 快传：列出待同步文件后开热点快传；自动入网失败的「去系统设置/我已连接」
  // 引导由已挂在首页的 TransferBadge 承接。
  const doWifiSync = () => {
    setOpen(false);
    startWifiTransferPending().catch(() => undefined);
  };

  const deviceName = connectedDevice?.name || 'MR20 记忆粒';
  const battery = status.battery;
  const storage = fmtStorage(status.spaceFreeMb);

  return (
    <>
      <View>
        <IconButton onPress={() => setOpen(true)} bg="transparent" size={38}>
          {icon}
        </IconButton>
        {hasNew ? <View style={st.dot} /> : null}
      </View>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="记忆粒设备">
        {connected ? (
          <>
            {/* 设备行 + 连接状态 */}
            <View style={st.devRow}>
              <View style={st.devIcon}>
                <BluetoothConnected size={20} color="#fff" strokeWidth={2} />
              </View>
              <Text style={st.devName} numberOfLines={1}>
                {deviceName}
              </Text>
              <View style={st.connBadge}>
                <View style={st.connDot} />
                <Text style={st.connText}>已连接</Text>
              </View>
            </View>

            {/* 录音 / 待机 */}
            <View style={st.stateRow}>
              <Mic size={15} color={recording ? colors.danger : colors.textSub} />
              <Text style={st.stateText}>
                {recording
                  ? `正在录音 · 已录 ${Math.max(0, Math.round(recording.seconds))}s`
                  : `当前待机${inbox.length ? ` · 本地 ${inbox.length} 段录音` : ''}`}
              </Text>
            </View>

            {/* 电量 + 存储 */}
            <View style={st.statRow}>
              <View style={st.statCell}>
                <Battery size={15} color={colors.textSub} />
                <Text style={st.statText}>
                  {battery != null ? `电量 ${battery}%` : '电量 —'}
                </Text>
              </View>
              <View style={st.statCell}>
                <HardDrive size={15} color={colors.textSub} />
                <Text style={st.statText}>{storage ?? '存储 —'}</Text>
              </View>
            </View>

            {/* 待同步：两种传输方式二选一（蓝牙同步 / WiFi 快传） */}
            {pending > 0 ? (
              <>
                <Text style={st.syncHint}>
                  {transferring ? '正在传输录音…' : `${pending} 段新录音待同步`}
                </Text>
                <View style={st.syncRow}>
                  <TouchableOpacity
                    style={[st.syncBtn, st.syncBtnDark]}
                    activeOpacity={0.85}
                    onPress={doSync}
                    disabled={transferring}>
                    <Bluetooth size={17} color="#fff" strokeWidth={2} />
                    <Text style={st.syncBtnDarkText}>蓝牙同步</Text>
                  </TouchableOpacity>
                  {isMr20WifiAvailable ? (
                    <TouchableOpacity
                      style={[st.syncBtn, st.syncBtnLight]}
                      activeOpacity={0.85}
                      onPress={doWifiSync}
                      disabled={transferring}>
                      <Wifi size={17} color={colors.auraProject} strokeWidth={2} />
                      <Text style={st.syncBtnLightText}>WiFi 快传</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            ) : deviceFiles == null && !transferring ? (
              /* 文件列表还没读到（连上后有 2s 稳定期 + 扫描耗时）：显示缓冲，
                 不要抢跳「暂无新录音待同步」误导用户。 */
              <View style={[st.noNew, st.noNewLoading]}>
                <ActivityIndicator size="small" color={colors.auraProject} />
                <Text style={st.noNewText}>正在读取设备录音…</Text>
              </View>
            ) : (
              <View style={st.noNew}>
                <Text style={st.noNewText}>
                  {transferring ? '正在同步录音…' : '暂无新录音待同步'}
                </Text>
              </View>
            )}

            <TouchableOpacity style={st.ghostRow} activeOpacity={0.7} onPress={goHardware}>
              <Text style={st.ghostText}>设备文件与设置</Text>
              <ChevronRight size={18} color={colors.textTertiary} />
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={st.emptyIconWrap}>
              {busy ? (
                <ActivityIndicator size="large" color={colors.auraProject} />
              ) : (
                <Bluetooth size={34} color={colors.textSub} />
              )}
            </View>
            <Text style={st.emptyTitle}>
              {busy
                ? hasPaired
                  ? '正在重新连接上次的记忆粒…'
                  : '正在连接记忆粒…'
                : '记忆粒未连接'}
            </Text>
            <Text style={st.emptySub}>
              {busy
                ? '正在自动查找并连接你上次配对的设备，请确保设备已开机并靠近手机。'
                : hasPaired
                ? '上次的设备不在附近，或蓝牙未开启。靠近设备后可重新连接。'
                : '连接记忆粒后可自动同步录音，并在这里查看设备状态。'}
            </Text>
            {busy ? null : hasPaired ? (
              <TouchableOpacity style={st.primaryBtn} activeOpacity={0.85} onPress={doReconnect}>
                <Text style={st.primaryText}>重新连接</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={st.primaryBtn} activeOpacity={0.85} onPress={goHardware}>
                <Text style={st.primaryText}>连接设备</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </BottomSheet>
    </>
  );
}

const st = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.bgApp,
  },

  devRow: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16},
  devIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  devName: {flex: 1, fontSize: 16, fontWeight: '600', color: colors.textMain},
  connBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(52,199,89,0.1)',
  },
  connDot: {width: 6, height: 6, borderRadius: 3, backgroundColor: colors.focus},
  connText: {fontSize: 12, color: colors.focus, fontWeight: '600'},

  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgApp,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  stateText: {fontSize: 14, color: colors.textMain, fontWeight: '500'},

  statRow: {flexDirection: 'row', gap: 12, marginBottom: 20},
  statCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgApp,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statText: {fontSize: 14, color: colors.textMain, fontWeight: '500'},

  primaryBtn: {
    height: 52,
    borderRadius: radius.xxl,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {color: '#fff', fontSize: 16, fontWeight: '700'},

  syncHint: {fontSize: 13, color: colors.textSub, marginBottom: 10, textAlign: 'center'},
  syncRow: {flexDirection: 'row', gap: 12},
  syncBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  syncBtnDark: {backgroundColor: colors.dark},
  syncBtnDarkText: {color: '#fff', fontSize: 15, fontWeight: '700'},
  syncBtnLight: {
    backgroundColor: colors.bgApp,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  syncBtnLightText: {color: colors.textMain, fontSize: 15, fontWeight: '700'},
  noNew: {alignItems: 'center', paddingVertical: 8},
  noNewLoading: {flexDirection: 'row', justifyContent: 'center', gap: 8},
  noNewText: {fontSize: 14, color: colors.textSub},

  ghostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    marginTop: 4,
  },
  ghostText: {fontSize: 15, color: colors.textMain, fontWeight: '500'},

  emptyIconWrap: {alignItems: 'center', marginBottom: 20, marginTop: 4},
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textMain,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    color: colors.textSub,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
    paddingHorizontal: 8,
  },
});
