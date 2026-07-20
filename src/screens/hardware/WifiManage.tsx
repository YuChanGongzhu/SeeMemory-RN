/**
 * WiFi 管理 —— 热点开关与 SSID/密码读取走真实 BLE 指令（WIFIO/WIFIC/WIFI/WIFIS）。
 * 「修改热点名称与密码」底层是真实 WIFI&CH，但当前固件未生效（见下方 WIFI_CH_SUPPORTED），入口先关。
 */
import React, {useEffect, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Copy, Eye, EyeOff} from 'lucide-react-native';
import {SubHeader, Card, Toggle, IosAlert, ModalInput, HW} from './parts';
import {Mr20DebugLog} from '../../components/mr20/Mr20DebugLog';
import {useMr20} from '../../hooks/useMr20';

/**
 * 改热点名/密码总开关。当前固件的 WIFI&CH **未生效**：发 `WIFI&CH&<ssid>&<pwd>` 后设备进
 * WIFIS 状态 4（修改密码中）但从不到 6，复位后凭据依旧——这是《固件反馈报告 0703》白纸黑字
 * 记录的已知问题（"参数格式不明/未生效，待固件方澄清"）。见 [[mr20-wifi-change-credentials]]。
 * 底层 changeHotspot / changeWifiCredentials（Mr20Client）保留且正确，等固件方给出确切格式并修好
 * 后，把此开关置 true 即可开回入口，无需改逻辑。
 */
const WIFI_CH_SUPPORTED = false;

type WifiState = 'off' | 'turning_on' | 'on' | 'turning_off';

export function WifiManage({onBack}: {onBack: () => void}) {
  const {connState, openHotspot, closeHotspot, getHotspotInfo, changeHotspot, logs} = useMr20();
  const [wifiState, setWifiState] = useState<WifiState>('off');
  // SSID/密码以设备 WIFI 指令读到的为准（SSID 通常是设备名 YLF20_xxxx）；这里仅占位。
  const [ssid, setSsid] = useState('');
  const [pwd, setPwd] = useState('12345678');
  const [showPwd, setShowPwd] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draftSsid, setDraftSsid] = useState('');
  const [draftPwd, setDraftPwd] = useState('');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const busy = wifiState === 'turning_on' || wifiState === 'turning_off';

  // 进页面读一次真实热点状态/凭据（状态 1/2 视为已开）。
  useEffect(() => {
    if (connState !== 'connected') {
      return;
    }
    let alive = true;
    getHotspotInfo()
      .then(info => {
        if (!alive || !info) {
          return;
        }
        if (info.ssid) {
          setSsid(info.ssid);
        }
        if (info.pwd) {
          setPwd(info.pwd);
        }
        setWifiState(info.state === 1 || info.state === 2 ? 'on' : 'off');
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [connState, getHotspotInfo]);

  const toggle = () => {
    if (busy) {
      return;
    }
    setErrMsg(null);
    if (wifiState === 'off') {
      setWifiState('turning_on');
      openHotspot()
        .then(() => getHotspotInfo())
        .then(info => {
          if (info?.ssid) {
            setSsid(info.ssid);
          }
          if (info?.pwd) {
            setPwd(info.pwd);
          }
          setWifiState('on');
        })
        .catch(e => {
          setErrMsg(String((e as Error)?.message || e));
          setWifiState('off');
        });
    } else {
      setWifiState('turning_off');
      closeHotspot()
        .then(() => setWifiState('off'))
        .catch(() => setWifiState('off'));
    }
  };

  // 改名/改密：发真实 WIFI&CH，成功后回读确认；固件不回包，靠轮询 WIFIS 判定，改后设备复位。
  const saveConfig = async () => {
    if (saving) {
      return;
    }
    const newSsid = draftSsid.trim();
    const newPwd = draftPwd.trim();
    if (!newSsid && !newPwd) {
      setEditOpen(false);
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      await changeHotspot(newSsid || ssid, newPwd || pwd);
      setEditOpen(false);
      // 改后设备会复位，回读一次（可能因复位暂时读不到，就退回本地草稿值）。
      const info = await getHotspotInfo().catch(() => null);
      setSsid(info?.ssid || newSsid || ssid);
      setPwd(info?.pwd || newPwd || pwd);
      Alert.alert('已提交修改', '设备将复位以应用新的热点信息，请稍候重连。');
    } catch (e) {
      // 关掉弹窗让页面上的错误横幅可见。
      setEditOpen(false);
      setErrMsg(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const statusMsg = errMsg
    ? errMsg
    : wifiState === 'turning_on' || wifiState === 'turning_off'
    ? '正在发送指令...'
    : connState !== 'connected'
    ? '请先连接设备蓝牙'
    : null;

  return (
    <View style={st.root}>
      <SubHeader title="WiFi 管理" onBack={onBack} />
      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <Card style={{paddingVertical: 0}}>
          <View style={st.toggleRow}>
            <Text style={st.toggleLabel}>WiFi 热点</Text>
            <Toggle on={wifiState === 'on' || wifiState === 'turning_on'} onToggle={toggle} disabled={busy} />
          </View>
        </Card>

        {statusMsg ? <Text style={st.statusMsg}>{statusMsg}</Text> : null}

        <Text style={st.desc}>设备专属高速热点，用于快速下载大录音文件，无法连接网络上网。</Text>

        {wifiState === 'on' ? (
          <Card style={{marginTop: 16, paddingVertical: 0}}>
            <View style={[st.infoRow, st.infoBorder]}>
              <Text style={st.infoKey}>热点名称</Text>
              <View style={st.infoVal}>
                <Text style={st.infoValText}>{ssid || '设备热点'}</Text>
                <TouchableOpacity hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                  <Copy size={16} color={HW.textSub} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={st.infoRow}>
              <Text style={st.infoKey}>热点密码</Text>
              <View style={st.infoVal}>
                <Text style={[st.infoValText, !showPwd && {letterSpacing: 2}]}>
                  {showPwd ? pwd : '••••••••'}
                </Text>
                <TouchableOpacity onPress={() => setShowPwd(v => !v)} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                  {showPwd ? <EyeOff size={16} color={HW.textSub} /> : <Eye size={16} color={HW.textSub} />}
                </TouchableOpacity>
                <TouchableOpacity hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
                  <Copy size={16} color={HW.textSub} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={st.guide}>
              <Text style={st.guideText}>连接后可通过 192.168.200.1:8475 高速传输文件</Text>
            </View>
          </Card>
        ) : null}

        <TouchableOpacity
          activeOpacity={WIFI_CH_SUPPORTED ? 0.7 : 1}
          style={[st.modifyRow, !WIFI_CH_SUPPORTED && st.modifyRowDisabled]}
          onPress={() => {
            if (!WIFI_CH_SUPPORTED) {
              Alert.alert(
                '暂不支持修改',
                '当前设备固件尚不支持在 App 内修改热点名称与密码，固件支持后将开放此功能。',
              );
              return;
            }
            setDraftSsid(ssid);
            setDraftPwd(pwd);
            setEditOpen(true);
          }}>
          <Text style={[st.modifyText, !WIFI_CH_SUPPORTED && st.modifyTextDisabled]}>
            修改热点名称与密码
          </Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          {WIFI_CH_SUPPORTED
            ? '修改后设备会自动复位以生效，期间需重新连接。'
            : '当前固件暂不支持在 App 内修改，需固件支持后开放。'}
        </Text>

        <View style={st.tips}>
          <Text style={st.tipsTitle}>温馨提示</Text>
          <Text style={st.tip}>• 下载超过 10 分钟的长录音时，开启 WiFi 速度比蓝牙快 10 倍以上</Text>
          <Text style={st.tip}>• 开启后 30 秒无设备连接，会自动关闭以节省设备电量</Text>
          <Text style={st.tip}>• 蓝牙断开后，WiFi 也会自动关闭</Text>
          <Text style={st.tip}>• 升级、配置密码时，无法手动关闭 WiFi</Text>
        </View>

        {/* 协议调试日志：看开热点 WIFIO/WIFIS 真实往返 */}
        <Mr20DebugLog logs={logs} />
      </ScrollView>

      <IosAlert
        visible={editOpen}
        onClose={() => (saving ? undefined : setEditOpen(false))}
        title="修改热点信息"
        message="修改后设备会复位以生效，期间需重新连接。"
        buttons={[
          {text: '取消', onPress: () => (saving ? undefined : setEditOpen(false))},
          {text: saving ? '修改中…' : '确认', bold: true, onPress: saveConfig},
        ]}>
        <View style={{width: '100%', gap: 8, marginTop: 12}}>
          <ModalInput value={draftSsid} onChangeText={setDraftSsid} placeholder="新热点名称" />
          <ModalInput value={draftPwd} onChangeText={setDraftPwd} placeholder="新热点密码" />
        </View>
      </IosAlert>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20},
  toggleRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16},
  toggleLabel: {fontSize: 16, fontWeight: '500', color: HW.textMain},
  statusMsg: {fontSize: 13, color: HW.textSub, marginTop: 12, paddingHorizontal: 4},
  desc: {fontSize: 13, color: HW.textSub, marginTop: 12, paddingHorizontal: 4, lineHeight: 19},
  infoRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16},
  infoBorder: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HW.divider},
  infoKey: {fontSize: 15, color: HW.textSub},
  infoVal: {flexDirection: 'row', alignItems: 'center', gap: 8},
  infoValText: {fontSize: 15, fontWeight: '500', color: HW.textMain},
  guide: {paddingBottom: 16},
  guideText: {fontSize: 12, color: HW.textSub, lineHeight: 17},
  modifyRow: {marginTop: 16, backgroundColor: HW.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  modifyRowDisabled: {opacity: 0.55},
  modifyText: {fontSize: 16, fontWeight: '500', color: HW.textMain},
  modifyTextDisabled: {color: HW.textTertiary},
  modifyHint: {fontSize: 12, color: HW.textSub, marginTop: 8, paddingHorizontal: 4, lineHeight: 17},
  tips: {marginTop: 16, paddingHorizontal: 4},
  tipsTitle: {fontSize: 12, fontWeight: '600', color: HW.textSub, marginBottom: 6},
  tip: {fontSize: 12, color: HW.textSub, lineHeight: 20},
});
