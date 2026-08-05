import React, {useEffect, useRef, useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, ActivityIndicator} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {QrCode, CircleCheck, RefreshCw} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {BottomSheet} from './BottomSheet';
import {getWechatBinding, type WechatQrStatus} from '../apis/requests/wechat';

const POLL_INTERVAL_MS = 2000;
const TERMINAL: WechatQrStatus[] = ['confirmed', 'failed', 'expired'];

const STATUS_COPY: Record<WechatQrStatus, string> = {
  wait: '请使用微信扫码绑定',
  scaned: '已扫码，请在手机上确认',
  confirmed: '微信已绑定',
  failed: '绑定失败，请重试',
  expired: '二维码已过期，请重新生成',
};

const genNonce = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 轮询到 confirmed 时触发一次，调用方据此刷新健康度/放行后续操作。 */
  onBound?: () => void;
}

/** 绑定微信：与 see-mem-studio-web 的 wechat-dialog.tsx 对齐（同一套 /app/wechat/binding 轮询协议）。 */
export function WechatBindSheet({visible, onClose, onBound}: Props) {
  const [nonce, setNonce] = useState(genNonce);
  const [status, setStatus] = useState<WechatQrStatus>('wait');
  const [qrcode, setQrcode] = useState('');
  const [error, setError] = useState('');
  const boundNotified = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setStatus('wait');
    setQrcode('');
    setError('');
    boundNotified.current = false;
  }, [visible, nonce]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let stopped = false;

    const sync = async () => {
      try {
        const next = await getWechatBinding(nonce);
        if (cancelled) return;
        setStatus(next.status);
        setError(next.error ?? '');
        if (next.qrcode) setQrcode(next.qrcode);
        if (TERMINAL.includes(next.status)) stopped = true;
        if (next.status === 'confirmed' && !boundNotified.current) {
          boundNotified.current = true;
          onBound?.();
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, nonce]);

  const statusText = error || STATUS_COPY[status];
  const canRetry = Boolean(error) || status === 'failed' || status === 'expired';

  return (
    <BottomSheet visible={visible} onClose={onClose} title="绑定微信">
      <View style={styles.body}>
        <Text style={styles.hint}>提醒到点会通过微信通知你，需要先扫码绑定。</Text>
        <View style={styles.qrBox}>
          {qrcode ? (
            <QRCode value={qrcode} size={200} color={colors.textMain} backgroundColor={colors.bg} />
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
        <View style={styles.statusRow}>
          {status === 'confirmed' ? (
            <CircleCheck size={16} color={colors.success} />
          ) : (
            <QrCode size={16} color={colors.textSub} />
          )}
          <Text style={[styles.statusText, status === 'confirmed' && {color: colors.success}]}>{statusText}</Text>
        </View>
        {canRetry ? (
          <TouchableOpacity style={styles.retryBtn} onPress={() => setNonce(genNonce())}>
            <RefreshCw size={14} color={colors.textMain} />
            <Text style={styles.retryText}>重新生成二维码</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>{status === 'confirmed' ? '完成' : '关闭'}</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {alignItems: 'center', paddingBottom: 8},
  hint: {fontSize: 13, color: colors.textSub, textAlign: 'center', marginBottom: 20},
  qrBox: {
    width: 232,
    height: 232,
    borderRadius: radius.xl,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16},
  statusText: {fontSize: 14, color: colors.textSub, fontWeight: '600'},
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 12,
  },
  retryText: {fontSize: 13, fontWeight: '600', color: colors.textMain},
  closeBtn: {alignSelf: 'stretch', borderRadius: radius.lg, paddingVertical: 15, alignItems: 'center', backgroundColor: colors.dark},
  closeText: {color: '#fff', fontSize: 16, fontWeight: '700'},
});
