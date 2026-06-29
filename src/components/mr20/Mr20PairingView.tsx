import React, {useEffect, useState} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {useMr20} from '../../hooks/useMr20';

/** 未连接时的扫描 + 配对界面。配对成功后由父组件切换到设备主页。 */
export function Mr20PairingView() {
  const {theme} = useTheme();
  const c = theme.colors;
  const {
    connState,
    devices,
    startScan,
    stopScan,
    connectAndPair,
    clearPairing,
    error,
  } = useMr20();

  // 记住最近点过的设备，供「清除配对」用（恢复出厂需要 deviceId）。
  const [lastTried, setLastTried] = useState<{id: string; name: string} | null>(null);

  const busy = connState === 'connecting' || connState === 'pairing';
  const scanning = connState === 'scanning';

  useEffect(() => {
    return () => stopScan();
  }, [stopScan]);

  const confirmClear = () => {
    if (!lastTried) {
      return;
    }
    Alert.alert(
      '清除配对并恢复出厂',
      '这会清空记忆粒上的所有录音且不可恢复，仅在设备被其他密钥锁住、无法配对时使用。确定继续？',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '确定清除',
          style: 'destructive',
          onPress: () =>
            clearPairing(lastTried.id, lastTried.name).catch(() => undefined),
        },
      ],
    );
  };

  const stageText =
    connState === 'connecting'
      ? '连接中…'
      : connState === 'pairing'
        ? '配对中 · 读取设备信息…'
        : '';

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <View style={[styles.heroIcon, {backgroundColor: c.accentGlow || c.bgSecondary}]}>
          <View style={[styles.heroDot, {backgroundColor: c.accent}]} />
        </View>
        <Text style={[styles.heroTitle, {color: c.text}]}>连接你的记忆粒</Text>
        <Text style={[styles.heroDesc, {color: c.textSecondary}]}>
          打开记忆粒并靠近手机，点击下方按钮开始扫描
        </Text>
      </View>

      {busy ? (
        <View style={styles.busyBox}>
          <ActivityIndicator size="large" color={c.accent} />
          <Text style={[styles.busyText, {color: c.accent}]}>{stageText}</Text>
        </View>
      ) : (
        <>
          <TouchableOpacity
            style={[styles.scanBtn, {backgroundColor: c.buttonPrimary}]}
            onPress={() => (scanning ? stopScan() : startScan())}
            activeOpacity={0.85}>
            {scanning ? (
              <View style={styles.scanBtnInner}>
                <ActivityIndicator size="small" color={c.buttonPrimaryText} />
                <Text style={[styles.scanBtnText, {color: c.buttonPrimaryText}]}>
                  扫描中 · 点击停止
                </Text>
              </View>
            ) : (
              <Text style={[styles.scanBtnText, {color: c.buttonPrimaryText}]}>
                {devices.length > 0 ? '重新扫描' : '扫描记忆粒'}
              </Text>
            )}
          </TouchableOpacity>

          <View style={styles.list}>
            {devices.map(d => (
              <TouchableOpacity
                key={d.id}
                style={[styles.deviceRow, {backgroundColor: c.bgCard, borderColor: c.border}]}
                onPress={() => {
                  setLastTried({id: d.id, name: d.name});
                  connectAndPair(d.id, d.name).catch(() => undefined);
                }}
                activeOpacity={0.7}>
                <View style={{flex: 1}}>
                  <Text style={[styles.deviceName, {color: c.text}]}>{d.name}</Text>
                  <Text style={[styles.deviceMeta, {color: c.textMuted}]}>
                    {d.rssi != null ? `信号 ${d.rssi} dBm` : '附近设备'}
                    {' · 连接后获取 MAC'}
                  </Text>
                </View>
                <Text style={[styles.connect, {color: c.accent}]}>连接 ›</Text>
              </TouchableOpacity>
            ))}
            {scanning && devices.length === 0 ? (
              <Text style={[styles.hint, {color: c.textMuted}]}>正在搜索附近的记忆粒…</Text>
            ) : null}
          </View>
        </>
      )}

      {error ? <Text style={[styles.error, {color: c.error}]}>{error}</Text> : null}

      {!busy && lastTried ? (
        <TouchableOpacity
          style={[styles.clearBtn, {borderColor: c.border}]}
          onPress={confirmClear}
          activeOpacity={0.7}>
          <Text style={[styles.clearText, {color: c.error}]}>
            设备被其他密钥锁住？清除配对并恢复出厂（会清空设备录音）
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {paddingHorizontal: 20, paddingTop: 16},
  hero: {alignItems: 'center', marginBottom: 28, marginTop: 12},
  heroIcon: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  heroDot: {width: 30, height: 30, borderRadius: 15},
  heroTitle: {fontSize: 20, fontWeight: '700'},
  heroDesc: {fontSize: 13, marginTop: 8, textAlign: 'center', lineHeight: 19},
  busyBox: {alignItems: 'center', paddingVertical: 40, gap: 14},
  busyText: {fontSize: 14, fontWeight: '600'},
  scanBtn: {borderRadius: 16, paddingVertical: 15, alignItems: 'center'},
  scanBtnInner: {flexDirection: 'row', alignItems: 'center', gap: 8},
  scanBtnText: {fontSize: 15, fontWeight: '700'},
  list: {marginTop: 16, gap: 10},
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    padding: 15,
  },
  deviceName: {fontSize: 15, fontWeight: '700'},
  deviceMeta: {fontSize: 11, marginTop: 3},
  connect: {fontSize: 14, fontWeight: '700'},
  hint: {fontSize: 12.5, textAlign: 'center', marginTop: 18},
  error: {fontSize: 12.5, marginTop: 16, textAlign: 'center'},
  clearBtn: {
    marginTop: 18,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  clearText: {fontSize: 12.5, fontWeight: '600', textAlign: 'center', lineHeight: 18},
});
