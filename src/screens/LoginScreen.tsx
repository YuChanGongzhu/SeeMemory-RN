import React, {useState} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator,
  KeyboardAvoidingView, Platform, StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Link as LinkIcon, Check} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {images} from '../design/assets';
import {useAuth} from '../auth/AuthContext';
import {sendSmsVerification} from '../apis/requests/user';

type Step = 'main' | 'phone' | 'code' | 'bind';

/** 登录 — 真实手机号登录走 AuthContext。v1.0 暂不放微信一键授权（未接真实
 * OAuth，且放出即触发 App Store 4.8 Sign in with Apple 要求）；游客态经「随便看看」。 */
export function LoginScreen({prompt, onClose}: {prompt?: boolean; onClose?: () => void} = {}) {
  const insets = useSafeAreaInsets();
  const {login, loginAsGuest} = useAuth();
  // In prompt mode the user is already a guest; the "skip / WeChat" paths just
  // dismiss the overlay. Phone login remains the real auth path.
  const guestPath = prompt ? onClose || (() => {}) : loginAsGuest;
  const [step, setStep] = useState<Step>('main');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const getCode = async () => {
    if (phone.length < 11 || busy) return;
    setBusy(true);
    try {
      await sendSmsVerification(phone);
    } catch {
      // best-effort; still advance for demo flow
    }
    setBusy(false);
    setStep('code');
  };

  const confirmCode = async () => {
    if (code.length < 6 || busy) return;
    setBusy(true);
    try {
      await login(phone, code.trim());
      setDone(true); // AuthGate swaps to the app shortly after token is set
    } catch {
      setBusy(false);
      setStep('bind'); // demo: treat as new user needing WeChat bind
    }
  };

  const maskedPhone = phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');

  if (done) {
    return (
      <View style={[styles.root, styles.center]}>
        <View style={styles.successRing}>
          <Check size={36} color="#fff" strokeWidth={3} />
        </View>
        <Text style={styles.successText}>身份认证成功 ✦</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {step === 'main' ? (
        <>
          <TouchableOpacity style={[styles.skip, {top: insets.top + 16}]} onPress={guestPath}>
            <Text style={styles.skipText}>{prompt ? '关闭' : '随便看看'}</Text>
          </TouchableOpacity>
          <View style={styles.hero}>
            <Image source={images.ipStar} style={styles.logo} resizeMode="contain" />
            <Text style={styles.heroTitle}>唤醒你的专属 AI</Text>
            <Text style={styles.heroDesc}>AI 驱动的第二大脑，开启跨端记忆同步与调度</Text>
          </View>
          <View style={[styles.actions, {paddingBottom: insets.bottom + 40}]}>
            {/* v1.0：微信一键授权未接真实 OAuth，暂不放出（放出即触发 Sign in with Apple
                4.8 要求且属未完成功能）。以手机号登录为主入口，游客态见右上「随便看看」。 */}
            <TouchableOpacity style={styles.ctaBtn} onPress={() => setStep('phone')}>
              <Text style={styles.ctaText}>手机号快捷登录</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : step === 'phone' ? (
        <View style={[styles.form, {paddingTop: insets.top + 16}]}>
          <View style={styles.formHead}>
            <TouchableOpacity onPress={() => setStep('main')}><ChevronLeft size={28} color={colors.textMain} /></TouchableOpacity>
            <Text style={styles.formTitle}>手机号登录</Text>
          </View>
          <TextInput
            style={styles.input}
            placeholder="请输入手机号"
            placeholderTextColor={colors.textSub}
            keyboardType="number-pad"
            maxLength={11}
            value={phone}
            onChangeText={t => setPhone(t.replace(/\D/g, ''))}
          />
          <TouchableOpacity style={[styles.primaryBtn, {backgroundColor: phone.length >= 11 ? colors.primary : colors.border}]} onPress={getCode} disabled={phone.length < 11 || busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.primaryText, {color: phone.length >= 11 ? '#fff' : colors.textSub}]}>获取验证码</Text>}
          </TouchableOpacity>
        </View>
      ) : step === 'code' ? (
        <View style={[styles.form, {paddingTop: insets.top + 16}]}>
          <View style={styles.formHead}>
            <TouchableOpacity onPress={() => setStep('phone')}><ChevronLeft size={28} color={colors.textMain} /></TouchableOpacity>
            <Text style={styles.formTitle}>输入验证码</Text>
          </View>
          <Text style={styles.codeHint}>已发送至 +86 {maskedPhone}</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            placeholder="请输入6位验证码"
            placeholderTextColor={colors.textSub}
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={t => setCode(t.replace(/\D/g, ''))}
          />
          <TouchableOpacity style={[styles.primaryBtn, {backgroundColor: code.length >= 6 ? colors.primary : colors.border}]} onPress={confirmCode} disabled={code.length < 6 || busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={[styles.primaryText, {color: code.length >= 6 ? '#fff' : colors.textSub}]}>确认</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.form, styles.center, {paddingTop: insets.top + 16}]}>
          <View style={styles.bindIcon}><LinkIcon size={32} color={colors.textMain} /></View>
          <Text style={styles.bindTitle}>验证码有误</Text>
          <Text style={styles.bindDesc}>验证码不正确或已过期。{'\n'}你可以重新获取验证码，{'\n'}或先以游客身份体验。</Text>
          <TouchableOpacity style={[styles.ctaBtn, {marginTop: 40, alignSelf: 'stretch'}]} onPress={() => setStep('phone')}>
            <Text style={styles.ctaText}>重新登录</Text>
          </TouchableOpacity>
          <TouchableOpacity style={{marginTop: 16}} onPress={guestPath}>
            <Text style={styles.skipText}>先随便看看</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg},
  center: {alignItems: 'center', justifyContent: 'center'},
  skip: {position: 'absolute', right: 24, zIndex: 10},
  skipText: {color: colors.textSub, fontSize: 15, fontWeight: '600'},
  hero: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24},
  logo: {width: 112, height: 112, marginBottom: 24},
  heroTitle: {fontSize: 26, fontWeight: '700', color: colors.textMain, marginBottom: 12, letterSpacing: -0.5},
  heroDesc: {fontSize: 15, color: colors.textSub, textAlign: 'center', lineHeight: 22},
  actions: {paddingHorizontal: 24},
  ctaBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, height: 56, borderRadius: 16},
  ctaText: {color: '#fff', fontSize: 16, fontWeight: '700'},
  form: {flex: 1, paddingHorizontal: 24},
  formHead: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 32},
  formTitle: {fontSize: 20, fontWeight: '700', color: colors.textMain},
  input: {height: 48, backgroundColor: colors.bgSecondary, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, color: colors.textMain},
  codeHint: {fontSize: 14, color: colors.textSub, marginBottom: 24, marginLeft: 4},
  codeInput: {letterSpacing: 4, textAlign: 'center', fontWeight: '600'},
  primaryBtn: {height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 24},
  primaryText: {fontSize: 16, fontWeight: '600'},
  bindIcon: {width: 64, height: 64, borderRadius: 32, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center', marginBottom: 24},
  bindTitle: {fontSize: 20, fontWeight: '700', color: colors.textMain, textAlign: 'center'},
  bindDesc: {fontSize: 14, color: colors.textSub, textAlign: 'center', marginTop: 12, lineHeight: 22},
  successRing: {width: 72, height: 72, borderRadius: 36, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 20},
  successText: {fontSize: 18, fontWeight: '700', color: colors.textMain},
});
