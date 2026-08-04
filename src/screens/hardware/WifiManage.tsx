/**
 * WiFi 管理 —— 热点开关与 SSID/密码读取走真实 BLE 指令（WIFIO/WIFIC/WIFI/WIFIS）。
 *
 * 密码这块的关键事实（协议 0801，推导见 protocol.ts 的 Cmd.syncWifiPassword）：
 * **热点密码 == SK 绑定密钥，固定 8 位**；SSID 是设备名（YLF20_xxxx），改不了。
 * 所以这页提供两条路：
 *   1. 「保存热点密码」——用户已知道密码，只存本地供入网用，不下发任何指令，零风险。
 *   2. 「初始化热点密码」——用户不知道密码/要换一个，走 SK&<8位> + WIFI&CH（无参）真正改设备。
 *      会改变设备绑定状态，故加二次确认。
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  Alert,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {Copy, Eye, EyeOff} from 'lucide-react-native';
import {SubHeader, Card, Toggle, IosAlert, ModalInput, HW} from './parts';
import {Mr20DebugLog} from '../../components/mr20/Mr20DebugLog';
import {useMr20} from '../../hooks/useMr20';
import {MR20_KEY_LEN, isValidDeviceKey} from '../../native/mr20/protocol';

type WifiState = 'off' | 'turning_on' | 'on' | 'turning_off';
/**
 * 密码弹窗的五种用途：只存本地 / 下发给设备 / 跑完整配网自检 /
 * 先 SK&RESET 重置密钥再跑自检（设备被别的密钥绑住时用）/
 * 只验一个密码能不能连上热点（`joinTest`，只读，不改设备）。
 */
type PwdMode = 'save' | 'init' | 'diagnose' | 'resetDiagnose' | 'joinTest';

export function WifiManage({onBack}: {onBack: () => void}) {
  const {
    connState,
    openHotspot,
    closeHotspot,
    getHotspotInfo,
    initHotspotPassword,
    saveHotspotPassword,
    resetHotspotKey,
    diagnoseWifiSetup,
    testHotspotJoin,
    logs,
  } = useMr20();
  const [wifiState, setWifiState] = useState<WifiState>('off');
  // SSID 以设备 WIFI 指令读到的为准（通常是设备名 YLF20_xxxx）；这里仅占位。
  const [ssid, setSsid] = useState('');
  const [pwd, setPwd] = useState('');
  // 上面这串密码是谁给的。必须在界面上标出来：设备自报的出厂值和手机本地的兜底值可能是
  // **同一串字符**，只看密码本身分不出「设备还是出厂态」和「设备根本没回话」。
  const [pwdFrom, setPwdFrom] = useState<'device' | 'local' | null>(null);
  // 用户是否已在 App 里设过密码。没设过就还在用设备回的值（可能是旧值）——要提示他去设。
  const [hasSavedPwd, setHasSavedPwd] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [pwdMode, setPwdMode] = useState<PwdMode | null>(null);
  const [draftPwd, setDraftPwd] = useState('');
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // 配网自检：整条链路要跑近一分钟，所以边跑边把日志推到界面上，别让用户以为卡死。
  const [diagLines, setDiagLines] = useState<string[]>([]);
  const [diagRunning, setDiagRunning] = useState(false);
  const diagBoxRef = useRef<ScrollView | null>(null);

  const busy = wifiState === 'turning_on' || wifiState === 'turning_off';

  // 进页面读一次真实热点状态/凭据，之后每 5s 复读一次（状态 1/2 视为已开）。
  //
  // 必须轮询：协议 0801 明确热点「开启后 30 秒内没有设备连接将自动关闭」，且客户端断开后 5s
  // 内也关。只在进页面读一次的话，用户打开开关看到「已开启」，半分钟后设备其实早关了，
  // 界面还亮着——再点一下反而变成「关闭」，与真机状态完全相反。
  useEffect(() => {
    if (connState !== 'connected') {
      return;
    }
    let alive = true;
    const read = () => {
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
          setPwdFrom(info.pwdFrom);
          setHasSavedPwd(Boolean(info.savedPwd));
          // 开/关过程中不要被轮询结果打断，否则开关会在中途来回跳。
          setWifiState(prev =>
            prev === 'turning_on' || prev === 'turning_off'
              ? prev
              : info.state === 1 || info.state === 2
              ? 'on'
              : 'off',
          );
        })
        .catch(() => undefined);
    };
    read();
    const timer = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
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
          setPwdFrom(info?.pwdFrom ?? null);
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

  const openPwdDialog = (mode: PwdMode) => {
    setErrMsg(null);
    // joinTest 预填当前显示的密码（多半就是设备自报的那个）——要验的第一个候选就是它，
    // 让用户从空白开始敲一遍纯属白费事。
    setDraftPwd(mode === 'save' || mode === 'joinTest' ? pwd : '');
    setPwdMode(mode);
  };

  /**
   * 确认密码弹窗。
   * - save：只写本地，之后入网优先用它（设备回的 PWD 在部分固件上是旧值）。
   * - init：SK&<8位> + WIFI&CH 真改设备，约需 10 秒，改完设备复位。
   */
  const confirmPwd = async () => {
    if (saving) {
      return;
    }
    const next = draftPwd.trim();
    // joinTest 是「只读验证」，故意不套 isValidDeviceKey：它管的是「SK 绑定密钥必须 8 位」，
    // 是我们对设备的假设；而要验的恰恰可能是一个不符合这个假设的密码。只按 WPA2 的 8~63 验。
    if (pwdMode === 'joinTest') {
      if (next.length < 8 || next.length > 63) {
        setErrMsg('WiFi 密码需要 8~63 位（WPA2 的规定）。');
        setPwdMode(null);
        return;
      }
      setPwdMode(null);
      runJoinTest(next);
      return;
    }
    if (!isValidDeviceKey(next)) {
      setErrMsg(`热点密码必须是 ${MR20_KEY_LEN} 位英文字母或数字（不能含中文、空格）。`);
      setPwdMode(null);
      return;
    }
    const mode = pwdMode;
    if (mode === 'diagnose' || mode === 'resetDiagnose') {
      setPwdMode(null);
      runDiagnose(next, mode === 'resetDiagnose');
      return;
    }
    setSaving(true);
    setErrMsg(null);
    try {
      if (mode === 'save') {
        await saveHotspotPassword(next);
        setPwd(next);
        setHasSavedPwd(true);
        setPwdMode(null);
        Alert.alert('已保存', '下次 WiFi 快传会用这个密码连接设备热点。');
      } else {
        await initHotspotPassword(next);
        setPwd(next);
        setHasSavedPwd(true);
        setPwdMode(null);
        Alert.alert(
          '已设置',
          '设备热点密码已更新为新密码，设备会复位以生效，请稍候重连蓝牙。',
        );
      }
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      // 「密钥已设置成功但未确认」这条：密码其实已写进设备也已存本地，界面要跟着更新，
      // 否则用户看到报错以为没生效，又去设一遍。
      if (msg.includes('密钥已设置成功')) {
        setPwd(next);
        setHasSavedPwd(true);
      }
      setPwdMode(null); // 关弹窗让页面上的错误横幅可见
      setErrMsg(msg);
    } finally {
      setSaving(false);
    }
  };

  /**
   * 跑完整配网自检：SK → WIFI&CH → WIFIO → WIFI → 入网 → socket → WIFIC，逐步打日志。
   * 失败也不抛给横幅——日志本身就是结论，最后一行写着该做什么。
   */
  const runDiagnose = (key: string, resetFirst = false) => {
    setDiagRunning(true);
    setErrMsg(null);
    setDiagLines([]);
    diagnoseWifiSetup(key, line => setDiagLines(prev => [...prev, line]), {
      resetFirst,
    })
      .then(report => {
        setHasSavedPwd(true);
        if (report.ok) {
          setPwd(report.pwd);
          setSsid(report.ssid || ssid);
        }
        Alert.alert(report.ok ? '配网成功' : '配网未完成', report.verdict);
      })
      .catch(e => {
        const msg = String((e as Error)?.message || e);
        setDiagLines(prev => [...prev, `自检中断：${msg}`]);
        setErrMsg(msg);
      })
      .finally(() => setDiagRunning(false));
  };

  /**
   * 只验一个密码：开热点 → 读 WIFI → 用这个密码入网 → 建 socket。**一条写指令都不发**，
   * 所以随便跑多少次都没有副作用，跟「初始化热点密码」完全不是一回事。
   *
   * 复用自检那套日志框和导出按钮——两者产出的都是同一种东西（带时间戳的逐步记录），
   * 各做一份 UI 只会让「该看哪个框」变成新的困惑。
   */
  const runJoinTest = (candidate: string) => {
    setDiagRunning(true);
    setErrMsg(null);
    setDiagLines([]);
    testHotspotJoin(candidate, line => setDiagLines(prev => [...prev, line]))
      .then(report => {
        if (report.ok) {
          setPwd(report.pwd);
          setSsid(report.ssid || ssid);
          setHasSavedPwd(true);
        }
        Alert.alert(report.ok ? '这个密码可用' : '没能连上', report.verdict);
      })
      .catch(e => {
        const msg = String((e as Error)?.message || e);
        setDiagLines(prev => [...prev, `测试中断：${msg}`]);
        setErrMsg(msg);
      })
      .finally(() => setDiagRunning(false));
  };

  const shareDiagLog = () => {
    Share.share({message: diagLines.join('\n')}).catch(() => undefined);
  };

  // 重置绑定密钥：设备会当场断 BLE，属于不可逆操作，二次确认。
  const confirmReset = () => {
    Alert.alert(
      '重置设备密钥？',
      '用于设备被别的密钥绑定、无法设置新密码时解绑。设备会立即断开蓝牙连接，' +
        '本地保存的热点密码也会清除，之后需要重新连接并重新设置密码。',
      [
        {text: '取消', style: 'cancel'},
        {
          text: '重置',
          style: 'destructive',
          onPress: () => {
            resetHotspotKey()
              .then(() => {
                setPwd('');
                setHasSavedPwd(false);
                Alert.alert('已发送重置指令', '设备已断开蓝牙，请重新连接后设置新密码。');
              })
              .catch(e => setErrMsg(String((e as Error)?.message || e)));
          },
        },
      ],
    );
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
              <Text style={st.infoKey}>
                热点密码
                {/* 来源标签。没有它的话，设备自报的出厂值和本地兜底值在屏幕上一模一样，
                    「密码怎么查都是 SeeMemor」就永远说不清是设备的意思还是我们自己填的。 */}
                {pwdFrom ? (
                  <Text style={st.infoKeyFrom}>
                    {pwdFrom === 'device' ? ' · 设备自报' : ' · 手机本地（设备未回）'}
                  </Text>
                ) : null}
              </Text>
              <View style={st.infoVal}>
                <Text style={[st.infoValText, !showPwd && {letterSpacing: 2}]}>
                  {pwd ? (showPwd ? pwd : '••••••••') : '未设置'}
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

        {/* 上面显示的密码来自设备 WIFI 指令，是 MCU 里存的值；热点上真正生效的密码在 WiFi
            模组里，要发过 WIFI&CH 才会刷进去。首次快传会自动跑这一步，不用用户操心。 */}
        {!hasSavedPwd ? (
          <View style={st.notice}>
            <Text style={st.noticeText}>
              首次使用 WiFi 快传时，App 会自动按协议做一次热点密码初始化（约 10 秒，仅首次）。
              若之后仍提示「无法加入网络」，可用下方「运行配网自检」看是哪一步没通。
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.7}
          style={st.modifyRow}
          disabled={connState !== 'connected' || diagRunning}
          onPress={() => openPwdDialog('diagnose')}>
          <Text
            style={[
              st.modifyText,
              st.primaryText,
              (connState !== 'connected' || diagRunning) && st.modifyTextDisabled,
            ]}>
            {diagRunning ? '配网自检进行中…' : '运行配网自检'}
          </Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          按协议完整走一遍：设密钥 → 同步密码 → 开热点 → 取凭据 → 入网 → 建立 socket，
          每一步的指令和回包都记在下方日志里。整个过程约 1 分钟，连不上时先跑这个。
        </Text>

        <TouchableOpacity
          activeOpacity={0.7}
          style={st.modifyRow}
          disabled={connState !== 'connected' || diagRunning}
          onPress={() => openPwdDialog('resetDiagnose')}>
          <Text
            style={[
              st.modifyText,
              (connState !== 'connected' || diagRunning) && st.modifyTextDisabled,
            ]}>
            重置密钥后重新配网
          </Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          上面那个跑到「SK&ERR」或密码怎么设都连不上时用：先发 SK&RESET 把设备上的旧密钥清掉、
          自动重连，再重新设密钥并同步热点密码。只重置密钥，不会删设备上的录音。
        </Text>

        {diagLines.length ? (
          <View style={st.diagBox}>
            <ScrollView
              ref={diagBoxRef}
              style={st.diagScroll}
              nestedScrollEnabled
              onContentSizeChange={() =>
                diagBoxRef.current?.scrollToEnd({animated: true})
              }>
              {diagLines.map((line, i) => (
                <Text key={i} style={st.diagLine}>
                  {line}
                </Text>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={st.diagShare}
              onPress={shareDiagLog}
              disabled={diagRunning}>
              <Text style={st.diagShareText}>导出日志</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <TouchableOpacity
          activeOpacity={0.7}
          style={st.modifyRow}
          disabled={connState !== 'connected'}
          onPress={() => openPwdDialog('init')}>
          <Text
            style={[st.modifyText, connState !== 'connected' && st.modifyTextDisabled]}>
            初始化热点密码
          </Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          只做「设密钥 + 同步密码」两步，不验证入网。
          约需 10 秒，完成后设备会复位，期间需重新连接。
        </Text>

        <TouchableOpacity
          activeOpacity={0.7}
          style={st.modifyRow}
          disabled={connState !== 'connected' || diagRunning}
          onPress={() => openPwdDialog('joinTest')}>
          <Text
            style={[
              st.modifyText,
              (connState !== 'connected' || diagRunning) && st.modifyTextDisabled,
            ]}>
            手动输入密码连接热点
          </Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          输一个密码，当场开热点并用它连一次，逐步打日志。不改设备任何配置，可反复试。
          {'\n'}比在系统「无线局域网」里手连可靠得多：热点开着后 30 秒无人连入就会自动关闭，
          而切出去找 SSID、敲密码、点加入，这一趟通常就把 30 秒用光了 —— 那时报的
          「无法加入网络」和密码对不对没有关系。
        </Text>

        <TouchableOpacity
          activeOpacity={0.7}
          style={st.modifyRow}
          disabled={connState !== 'connected'}
          onPress={() => openPwdDialog('save')}>
          <Text
            style={[st.modifyText, connState !== 'connected' && st.modifyTextDisabled]}>
            我已知道密码，直接保存
          </Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          不修改设备，只把密码记在手机上供快传入网使用。
        </Text>

        <TouchableOpacity
          activeOpacity={0.7}
          style={st.modifyRow}
          disabled={connState !== 'connected'}
          onPress={confirmReset}>
          <Text style={[st.modifyText, st.dangerText]}>重置设备密钥</Text>
        </TouchableOpacity>
        <Text style={st.modifyHint}>
          设备提示「已被另一把密钥绑定」时用。会立即断开蓝牙，需重新连接。
        </Text>

        <View style={st.tips}>
          <Text style={st.tipsTitle}>温馨提示</Text>
          <Text style={st.tip}>• 热点密码就是设备绑定密钥，固定 {MR20_KEY_LEN} 位；热点名称是设备名，无法修改</Text>
          <Text style={st.tip}>• 下载超过 10 分钟的长录音时，开启 WiFi 速度比蓝牙快 10 倍以上</Text>
          <Text style={st.tip}>• 开启后 30 秒无设备连接，会自动关闭以节省设备电量</Text>
          <Text style={st.tip}>• 蓝牙断开后，WiFi 也会自动关闭</Text>
          <Text style={st.tip}>• 升级、配置密码时，无法手动关闭 WiFi</Text>
        </View>

        {/* 协议调试日志：看开热点 WIFIO/WIFIS 真实往返 */}
        <Mr20DebugLog logs={logs} />
      </ScrollView>

      <IosAlert
        visible={pwdMode !== null}
        onClose={() => (saving ? undefined : setPwdMode(null))}
        title={
          pwdMode === 'resetDiagnose'
            ? '重置密钥后重新配网'
            : pwdMode === 'diagnose'
            ? '配网自检'
            : pwdMode === 'joinTest'
            ? '用这个密码连一次'
            : pwdMode === 'init'
            ? '初始化热点密码'
            : '保存热点密码'
        }
        message={
          pwdMode === 'resetDiagnose'
            ? `会先发 SK&RESET 清掉设备上的旧绑定密钥（蓝牙会断开，App 自动重连），` +
              `再把密钥和热点密码都设成你输入的这 ${MR20_KEY_LEN} 位值，最后验证入网。` +
              '设备上的录音不受影响。过程约 1 分半，期间请让设备保持开机并放在手机旁边。'
            : pwdMode === 'diagnose'
            ? `设一个 ${MR20_KEY_LEN} 位密码（字母或数字），自检会用它把整条链路走通。` +
              '过程约 1 分钟，期间请让设备保持开机并放在手机旁边。'
            : pwdMode === 'joinTest'
            ? '当场开热点，用这个密码连一次，每一步都打日志。' +
              '不发任何写指令、不改设备配置，可以反复试不同的密码。' +
              `连上了会自动存为本地密码。长度按 WiFi 规矩 8~63 位即可，不限 ${MR20_KEY_LEN} 位。`
            : pwdMode === 'init'
            ? `设置一个 ${MR20_KEY_LEN} 位新密码（字母或数字）。这会同时改写设备的绑定密钥，` +
              '约需 10 秒，完成后设备复位，需重新连接蓝牙。'
            : `输入你已知道的 ${MR20_KEY_LEN} 位热点密码。只保存在手机上，不会修改设备。`
        }
        buttons={[
          {text: '取消', onPress: () => (saving ? undefined : setPwdMode(null))},
          {
            text: saving
              ? pwdMode === 'init'
                ? '设置中…'
                : '保存中…'
              : pwdMode === 'diagnose' || pwdMode === 'resetDiagnose'
              ? '开始'
              : pwdMode === 'joinTest'
              ? '连一次'
              : '确认',
            bold: true,
            onPress: confirmPwd,
          },
        ]}>
        <View style={{width: '100%', gap: 8, marginTop: 12}}>
          {/* joinTest 不按 MR20_KEY_LEN 截断：要验的可能恰恰是一个不符合「8 位绑定密钥」
              这个假设的密码，按它截断等于把验证工具焊死在待验的假设上。 */}
          <ModalInput
            value={draftPwd}
            onChangeText={setDraftPwd}
            placeholder={
              pwdMode === 'joinTest'
                ? `热点密码（通常 ${MR20_KEY_LEN} 位）`
                : `${MR20_KEY_LEN} 位字母或数字`
            }
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={pwdMode === 'joinTest' ? 63 : MR20_KEY_LEN}
          />
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
  infoKeyFrom: {fontSize: 11, color: HW.textSub, opacity: 0.7},
  infoVal: {flexDirection: 'row', alignItems: 'center', gap: 8},
  infoValText: {fontSize: 15, fontWeight: '500', color: HW.textMain},
  guide: {paddingBottom: 16},
  guideText: {fontSize: 12, color: HW.textSub, lineHeight: 17},
  notice: {marginTop: 16, backgroundColor: HW.card, borderRadius: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  noticeText: {fontSize: 12, color: HW.textSub, lineHeight: 18},
  modifyRow: {marginTop: 16, backgroundColor: HW.card, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  modifyText: {fontSize: 16, fontWeight: '500', color: HW.textMain},
  modifyTextDisabled: {color: HW.textTertiary},
  dangerText: {color: '#E5484D'},
  primaryText: {color: '#0A7AFF'},
  diagBox: {marginTop: 12, borderRadius: 16, backgroundColor: '#11140F', padding: 10},
  diagScroll: {maxHeight: 280},
  diagLine: {fontSize: 10.5, fontFamily: 'Menlo', color: '#C9D2C5', lineHeight: 15},
  diagShare: {marginTop: 8, paddingVertical: 8, alignItems: 'center', borderRadius: 10, backgroundColor: '#1E2419'},
  diagShareText: {fontSize: 12, fontWeight: '600', color: '#7FD0C6'},
  modifyHint: {fontSize: 12, color: HW.textSub, marginTop: 8, paddingHorizontal: 4, lineHeight: 17},
  tips: {marginTop: 16, paddingHorizontal: 4},
  tipsTitle: {fontSize: 12, fontWeight: '600', color: HW.textSub, marginBottom: 6},
  tip: {fontSize: 12, color: HW.textSub, lineHeight: 20},
});
