import React, {useEffect, useRef, useState} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {useAuth} from '../auth/AuthContext';
import {sendSmsVerification} from '../apis/requests/user';

const PHONE_RE = /^1\d{10}$/;

export function LoginScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const {login} = useAuth();
  const [phone, setPhone] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  const startCountdown = () => {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleSendSms = async () => {
    if (!PHONE_RE.test(phone)) {
      Alert.alert('提示', '请输入正确的手机号');
      return;
    }
    if (countdown > 0 || isSendingSms) {
      return;
    }
    setIsSendingSms(true);
    try {
      await sendSmsVerification(phone);
      startCountdown();
    } catch (error) {
      Alert.alert('发送失败', error instanceof Error ? error.message : '验证码发送失败');
    } finally {
      setIsSendingSms(false);
    }
  };

  const handleLogin = async () => {
    if (!PHONE_RE.test(phone)) {
      Alert.alert('提示', '请输入正确的手机号');
      return;
    }
    if (!captcha.trim()) {
      Alert.alert('提示', '请输入验证码');
      return;
    }
    setIsLoggingIn(true);
    try {
      await login(phone, captcha.trim());
      // On success the AuthProvider flips the gate; nothing else to do here.
    } catch (error) {
      Alert.alert('登录失败', error instanceof Error ? error.message : '登录失败，请重试');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const s = theme.spacing;
  const r = theme.radius;
  const c = theme.colors;
  const canSendSms = countdown === 0 && !isSendingSms;

  return (
    <KeyboardAvoidingView
      style={[styles.container, {backgroundColor: c.bg}]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.inner, {paddingTop: insets.top + s.xxl, paddingHorizontal: s.lg}]}>
        <View style={{marginBottom: s.xxl}}>
          <Text style={{fontSize: 30}}>{theme.mode === 'warm' ? '🌿' : '◉'}</Text>
          <Text style={[styles.title, {color: c.text, marginTop: s.md}]}>
            {theme.mode === 'warm' ? '欢迎回来' : '登录'}
          </Text>
          <Text style={[styles.subtitle, {color: c.textSecondary, marginTop: s.xs}]}>
            使用手机号登录，开启你的记忆助手
          </Text>
        </View>

        {/* Phone */}
        <Text style={[styles.label, {color: c.textMuted, marginBottom: s.xs}]}>手机号</Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: c.input,
              borderColor: c.inputBorder,
              borderRadius: r.md,
              color: c.text,
              paddingHorizontal: s.md,
              paddingVertical: s.sm + 2,
              marginBottom: s.md,
            },
          ]}
          placeholder="请输入手机号"
          placeholderTextColor={c.textMuted}
          keyboardType="phone-pad"
          maxLength={11}
          value={phone}
          onChangeText={setPhone}
          editable={!isLoggingIn}
        />

        {/* Captcha + send */}
        <Text style={[styles.label, {color: c.textMuted, marginBottom: s.xs}]}>验证码</Text>
        <View style={{flexDirection: 'row', gap: s.sm, marginBottom: s.xl}}>
          <TextInput
            style={[
              styles.input,
              {
                flex: 1,
                backgroundColor: c.input,
                borderColor: c.inputBorder,
                borderRadius: r.md,
                color: c.text,
                paddingHorizontal: s.md,
                paddingVertical: s.sm + 2,
              },
            ]}
            placeholder="请输入验证码"
            placeholderTextColor={c.textMuted}
            keyboardType="number-pad"
            maxLength={6}
            value={captcha}
            onChangeText={setCaptcha}
            editable={!isLoggingIn}
          />
          <TouchableOpacity
            style={[
              styles.smsButton,
              {
                backgroundColor: canSendSms ? c.bgCard : c.bgSecondary,
                borderColor: canSendSms ? c.borderAccent : c.border,
                borderRadius: r.md,
                paddingHorizontal: s.md,
                opacity: canSendSms ? 1 : 0.6,
              },
            ]}
            onPress={handleSendSms}
            disabled={!canSendSms}>
            {isSendingSms ? (
              <ActivityIndicator size="small" color={c.accent} />
            ) : (
              <Text style={{color: c.accent, fontSize: 13, fontWeight: '600'}}>
                {countdown > 0 ? `${countdown}s` : '获取验证码'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login */}
        <TouchableOpacity
          style={[
            styles.loginButton,
            {
              backgroundColor: c.buttonPrimary,
              borderRadius: theme.mode === 'warm' ? r.pill : r.md,
              paddingVertical: s.md,
            },
          ]}
          onPress={handleLogin}
          disabled={isLoggingIn}>
          {isLoggingIn ? (
            <ActivityIndicator size="small" color={c.buttonPrimaryText} />
          ) : (
            <Text style={{color: c.buttonPrimaryText, fontSize: 15, fontWeight: '700'}}>登录</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  inner: {flex: 1},
  title: {fontSize: 26, fontWeight: '700'},
  subtitle: {fontSize: 13},
  label: {fontSize: 12, fontWeight: '600'},
  input: {borderWidth: 1, fontSize: 15},
  smsButton: {borderWidth: 1, alignItems: 'center', justifyContent: 'center', minWidth: 104},
  loginButton: {alignItems: 'center', justifyContent: 'center'},
});
