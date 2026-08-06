import React, {useEffect, useRef, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Alert, Linking, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import {QrCode, CircleCheck, RefreshCw, CheckCircle2, Download, MessageCircle} from 'lucide-react-native';
import {colors, radius, space, type as T} from '../design/tokens';
import {Card} from '../ui/kit';
import {PageHeader} from '../ui/Header';
import {useNav} from '../navigation/nav';
import {getWechatBinding, type WechatQrStatus} from '../apis/requests/wechat';
import {saveBase64ImageToCameraRoll} from '../native/SaveImageModule';
import {useWechatHealth} from '../hooks/useWechatHealth';

const WECHAT_SCHEME = 'weixin://';

const jumpToWechat = async () => {
  try {
    const supported = await Linking.canOpenURL(WECHAT_SCHEME);
    if (!supported) {
      Alert.alert('未检测到微信', '请先在此设备上安装微信客户端。');
      return;
    }
    await Linking.openURL(WECHAT_SCHEME);
  } catch {
    Alert.alert('打开失败', '暂时无法跳转到微信，请稍后重试。');
  }
};

const POLL_INTERVAL_MS = 2000;
const TERMINAL: WechatQrStatus[] = ['confirmed', 'failed', 'expired'];

// 与 see-mem-studio-web 的 wechat-dialog.tsx（QRCode.toDataURL 参数：errorCorrectionLevel "M"，
// dark #1E293B / light #FFFFFF）对齐，两端生成同一份二维码视觉规格。
const QR_ECL = 'M';
const QR_DARK = '#1E293B';
const QR_LIGHT = '#FFFFFF';

const STATUS_COPY: Record<WechatQrStatus, string> = {
  wait: '请使用微信扫码接入',
  scaned: '已扫码，请在手机上确认',
  confirmed: '微信已接入',
  failed: '接入失败，请重试',
  expired: '二维码已过期，请重新生成',
};

const genNonce = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/**
 * 微信接入 — 全屏页面，页面壳（返回箭头+居中标题）沿用 ChatPage/其余子页共用的 PageHeader，
 * 内容对齐 app-prototype v2 的 WechatBindV2（价值条 + 二维码卡「保存到相册」+ 步骤清单 + 成功页），
 * 轮询协议与 WechatBindSheet.tsx 一致（/app/wechat/binding）。
 */
export function WechatBindPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const qrRef = useRef<{toDataURL: (cb: (data: string) => void) => void} | null>(null);
  const {healthy, loading: healthLoading, refresh: refreshHealth} = useWechatHealth();
  const [forceRebind, setForceRebind] = useState(false);
  const [nonce, setNonce] = useState(genNonce);
  const [status, setStatus] = useState<WechatQrStatus>('wait');
  const [qrcode, setQrcode] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // 每次进入都重新查一次微信连接状态（对齐 see-mem-studio-web 的 WechatIndicator 做法）：
  // 已接入就不再走扫码流程，直接给「打开微信」入口；只有未接入或用户主动要求重新绑定才轮询二维码。
  const showBindFlow = forceRebind || healthy === false;

  useEffect(() => {
    setStatus('wait');
    setQrcode('');
    setError('');
    setSaved(false);
  }, [nonce]);

  useEffect(() => {
    if (!showBindFlow) return;

    let cancelled = false;
    let stopped = false;

    const sync = async () => {
      try {
        const next = await getWechatBinding(nonce);
        if (cancelled) return;
        setStatus(next.status);
        setError(next.error ?? '');
        if (next.qrcode) setQrcode(next.qrcode);
        if (next.status === 'confirmed') void refreshHealth();
        if (TERMINAL.includes(next.status)) stopped = true;
      } catch {
        if (!cancelled) {
          setError('暂时无法获取微信二维码，请稍后重试');
          stopped = true;
        }
      }
    };

    void sync();
    const timer = setInterval(() => {
      if (!stopped) void sync();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [nonce, showBindFlow, refreshHealth]);

  const statusText = error || STATUS_COPY[status];
  const canRetry = Boolean(error) || status === 'failed' || status === 'expired';
  const scanned = status === 'scaned' || status === 'confirmed';
  const confirmed = status === 'confirmed';

  if (healthLoading && healthy === null && !forceRebind) {
    return (
      <View style={styles.root}>
        <PageHeader title="微信接入" onBack={nav.pop} />
        <View style={styles.successBody}>
          <ActivityIndicator color={colors.textSub} />
        </View>
      </View>
    );
  }

  if (healthy === true && !forceRebind) {
    return (
      <View style={styles.root}>
        <PageHeader title="微信接入" onBack={nav.pop} />
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <MessageCircle size={44} color={colors.primary} />
          </View>
          <Text style={styles.successTitle}>微信已接入</Text>
          <Text style={styles.successDesc}>
            直接在微信里和 Remmy 对话{'\n'}内容会自动整理并同步到这里的记忆库
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={jumpToWechat}>
            <Text style={styles.primaryBtnText}>打开微信</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rebindLink} onPress={() => setForceRebind(true)}>
            <Text style={styles.rebindLinkText}>重新绑定微信</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const handleSave = () => {
    if (!qrRef.current || saving || !qrcode) return;
    setSaving(true);
    qrRef.current.toDataURL(async (base64: string) => {
      try {
        await saveBase64ImageToCameraRoll(base64);
        setSaved(true);
      } catch {
        Alert.alert('保存失败', '请检查是否已授权 Remmy 访问相册。');
      } finally {
        setSaving(false);
      }
    });
  };

  if (confirmed) {
    return (
      <View style={styles.root}>
        <PageHeader title="扫码绑定微信" onBack={nav.pop} />
        <View style={styles.successBody}>
          <View style={styles.successIcon}>
            <CheckCircle2 size={52} color={colors.primary} />
          </View>
          <Text style={styles.successTitle}>接入成功</Text>
          <Text style={styles.successDesc}>
            绑定后，你在微信中的对话{'\n'}会自动整理并同步到 Remmy 的记忆库
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={jumpToWechat}>
            <Text style={styles.primaryBtnText}>打开微信</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rebindLink} onPress={nav.pop}>
            <Text style={styles.rebindLinkText}>返回</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <PageHeader title="扫码绑定微信" onBack={nav.pop} />
      <ScrollView
        contentContainerStyle={[styles.body, {paddingBottom: insets.bottom + 24}]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.valueBar}>
          <Text style={styles.valueBarText}>微信对话</Text>
          <Text style={styles.valueBarDot}>·</Text>
          <Text style={styles.valueBarText}>实时同步</Text>
          <Text style={styles.valueBarDot}>·</Text>
          <Text style={styles.valueBarText}>统一记忆</Text>
        </View>

        <Card style={styles.qrCard} padding={20}>
          <Text style={styles.qrTitle}>Remmy 专属绑定码</Text>
          <Text style={styles.qrSub}>每个账号唯一，请勿转发</Text>
          <View style={styles.qrBox}>
            {qrcode ? (
              <QRCode
                value={qrcode}
                size={180}
                ecl={QR_ECL}
                quietZone={8}
                color={QR_DARK}
                backgroundColor={QR_LIGHT}
                getRef={c => (qrRef.current = c)}
              />
            ) : (
              <ActivityIndicator color={colors.textSub} />
            )}
          </View>
          <View style={styles.statusRow}>
            {confirmed ? <CircleCheck size={16} color={colors.success} /> : <QrCode size={16} color={colors.textSub} />}
            <Text style={styles.statusText}>{statusText}</Text>
          </View>
          {canRetry ? (
            <TouchableOpacity style={styles.retryBtn} onPress={() => setNonce(genNonce())}>
              <RefreshCw size={14} color={colors.textMain} />
              <Text style={styles.retryText}>重新生成二维码</Text>
            </TouchableOpacity>
          ) : null}
        </Card>

        <Card padding={20}>
          <Text style={styles.stepsTitle}>操作步骤</Text>
          {[
            {text: '点击下方「保存二维码」按钮', done: saved},
            {text: '打开微信 → 右上角「+」→ 扫一扫', done: scanned},
            {text: '切换至「相册」，选取刚才保存的二维码', done: scanned},
            {text: '手机弹出提示后点击确认，即完成接入', done: confirmed},
          ].map((s, i, arr) => (
            <View key={i} style={[styles.stepRow, i < arr.length - 1 ? {marginBottom: 14} : null]}>
              <View style={[styles.stepDot, s.done && styles.stepDotDone]}>
                {s.done ? (
                  <CheckCircle2 size={14} color={colors.onDark} />
                ) : (
                  <Text style={styles.stepIndex}>{i + 1}</Text>
                )}
              </View>
              <Text style={[styles.stepText, s.done && styles.stepTextDone]}>{s.text}</Text>
            </View>
          ))}
        </Card>

        {status === 'scaned' ? (
          <View style={styles.checkingBar}>
            <ActivityIndicator size="small" color={colors.textMain} />
            <Text style={styles.checkingText}>正在等待微信确认…</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.saveBtn, (!qrcode || saving) && styles.saveBtnDisabled]}
          disabled={!qrcode || saving}
          onPress={handleSave}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.onDark} />
          ) : (
            <Download size={18} color={colors.onDark} />
          )}
          <Text style={styles.saveBtnText}>{saved ? '已保存，可重新保存' : '保存二维码至相册'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  body: {padding: space.page, gap: 16},
  valueBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    paddingVertical: 10,
  },
  valueBarText: {fontSize: 12, fontWeight: '500', color: colors.textSub, letterSpacing: 0.3},
  valueBarDot: {fontSize: 12, color: colors.textTertiary},
  qrCard: {alignItems: 'center'},
  qrTitle: {...(T.memTitle as object), color: colors.textMain},
  qrSub: {fontSize: 13, color: colors.textSub, marginTop: 4, marginBottom: 20},
  qrBox: {
    width: 200,
    height: 200,
    borderRadius: radius.xl,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  statusText: {fontSize: 13, color: colors.textSub, fontWeight: '500'},
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 14,
  },
  retryText: {fontSize: 13, fontWeight: '600', color: colors.textMain},
  stepsTitle: {...(T.memTitle as object), color: colors.textMain, marginBottom: 16},
  stepRow: {flexDirection: 'row', gap: 12, alignItems: 'flex-start'},
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: {backgroundColor: colors.primary},
  stepIndex: {fontSize: 12, fontWeight: '700', color: colors.textSub},
  stepText: {flex: 1, fontSize: 14, lineHeight: 21, color: colors.textMain, paddingTop: 2},
  stepTextDone: {color: colors.textSub, textDecorationLine: 'line-through'},
  checkingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  checkingText: {fontSize: 13, fontWeight: '500', color: colors.textMain},
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 15,
  },
  saveBtnDisabled: {opacity: 0.4},
  saveBtnText: {color: colors.onDark, fontSize: 16, fontWeight: '600'},
  successBody: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32},
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successTitle: {...(T.bigTitle as object), color: colors.textMain, marginBottom: 12},
  successDesc: {fontSize: 14, lineHeight: 22, color: colors.textSub, textAlign: 'center', marginBottom: 36},
  primaryBtn: {alignSelf: 'stretch', backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: 15, alignItems: 'center'},
  primaryBtnText: {color: colors.onDark, fontSize: 16, fontWeight: '700'},
  rebindLink: {marginTop: 16, paddingVertical: 8, paddingHorizontal: 12},
  rebindLinkText: {fontSize: 13, fontWeight: '500', color: colors.textSub},
});
