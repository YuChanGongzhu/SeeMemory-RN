import React, {useRef, useState} from 'react';
import {View, Text, TextInput, Image, ScrollView, TouchableOpacity, Pressable, Linking, StyleSheet, Alert} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, ChevronRight, PenLine} from 'lucide-react-native';
import {colors} from '../design/tokens';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {usePoints} from '../hooks/usePoints';
import {SUBSCRIPTION_ENABLED} from '../config/features';
import {PRIVACY_POLICY_URL} from '../config/legal';
import {HW, IosAlert} from './hardware/parts';
import {EnvSwitchSheet} from '../ui/EnvSwitchSheet';

const APP_VERSION = '0.1.0';

/** 个人信息 — Prototype ProfileSettingsPage (App.jsx:3061). */
export function ProfilePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {user, logout, deleteAccount, isGuest} = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.nickname || user?.username || '薯饼');
  const account = usePoints();
  const power = account?.balancePoints ?? 0;

  // 注销账号（App Store 5.1.1(v)）：两段确认 → 永久注销。
  // 不走短信验证码：码会发到正在操作的这台手机上，挡不住"拿着解锁手机的人"这个实际威胁，
  // 却会让 App Store 审核员卡在等一条永不到达的短信上（审核专用号不发真实短信）。
  // 苹果允许 confirmation steps 防误触，两段确认足矣。
  const [stage, setStage] = useState<'idle' | 'confirm' | 'final'>('idle');
  const [busy, setBusy] = useState(false);
  // 手机号存在 username 字段，phone 字段未必回填，两个都兜一下。
  const phone = user?.phone || user?.username || '';
  // 打码后的号，取不到时为空串；行内直接展示，弹窗文案另兜一层措辞。
  const maskedPhone = phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
  const phoneInCopy = maskedPhone || '你的手机号';

  const closeDelete = () => setStage('idle');

  const submitDelete = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await deleteAccount();
      closeDelete();
      // 注销成功后登录态已清空，回首页会落到登录门。
      nav.home();
      Alert.alert('账号已注销', '你的账号已永久注销。感谢使用 SiMemory。');
    } catch (e) {
      Alert.alert('注销失败', e instanceof Error && e.message ? e.message : '请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  // 隐蔽入口：连点版本号 7 次（1.5s 内）打开后端环境切换面板。
  const [showEnv, setShowEnv] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onVersionTap = () => {
    tapCount.current += 1;
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
    }
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
    }, 1500);
    if (tapCount.current >= 7) {
      tapCount.current = 0;
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
      }
      setShowEnv(true);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity onPress={nav.pop} hitSlop={{top: 8, bottom: 8, left: 8, right: 8}}>
          <ChevronLeft size={28} color={colors.textMain} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>个人信息</Text>
        <View style={{width: 28}} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.profile}>
          <Image source={images.avatar} style={styles.avatar} />
          {editing ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <TextInput style={styles.nameInput} value={name} onChangeText={setName} autoFocus />
              <TouchableOpacity style={styles.saveBtn} onPress={() => setEditing(false)}><Text style={styles.saveBtnText}>保存</Text></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center', gap: 8}} onPress={() => setEditing(true)}>
              <Text style={styles.name}>{name}</Text>
              <PenLine size={16} color={colors.textSub} />
            </TouchableOpacity>
          )}
        </View>

        {/* 微信绑定行已随「绑定微信/已绑定」占位文案一并移除：v1.0 未接微信 OAuth（见 LoginScreen），
            显示「已绑定」是假的。接入后再恢复。 */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>手机号</Text>
            <Text style={maskedPhone ? styles.rowValue : styles.rowValueMuted}>{maskedPhone || '未绑定'}</Text>
          </View>
        </View>

        {SUBSCRIPTION_ENABLED ? (
          <>
            <TouchableOpacity activeOpacity={0.9} style={styles.memberBanner} onPress={() => nav.push('membership')}>
              <View style={{flex: 1}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                  <Text style={styles.memberTitle}>会员权益</Text>
                  <View style={styles.memberBadge}><Text style={styles.memberBadgeText}>普通会员</Text></View>
                </View>
                <Text style={styles.memberSub}>升级会员，解锁强大算力与超大存储</Text>
              </View>
              <View style={styles.upgradeBtn}><Text style={styles.upgradeBtnText}>升级</Text></View>
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={() => nav.push('powerStore')}>
              <View style={styles.row}>
                <Text style={styles.rowLabel}>神经算力</Text>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}>
                  <Text style={styles.rowValue}>{power.toLocaleString()} 可用</Text>
                  <View style={styles.refillBtn}><Text style={styles.refillBtnText}>补充</Text></View>
                </View>
              </View>
            </TouchableOpacity>
          </>
        ) : null}

        {/* 隐私政策入口：原先只在硬件「关于设备」里有，需配对 MR20 才可达。
            App Store 5.1.1(i) 要求政策在 App 内可访问，故在此提供通用入口。 */}
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={styles.rowLabel}>隐私政策</Text>
            <ChevronRight size={16} color={colors.textSub} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.logout}
          onPress={() => Alert.alert('退出登录', '确定要退出当前账号吗？', [{text: '取消', style: 'cancel'}, {text: '退出', style: 'destructive', onPress: () => {nav.home(); void logout();}}])}>
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>

        {isGuest ? null : (
          <TouchableOpacity style={styles.deleteAccount} onPress={() => setStage('confirm')}>
            <Text style={styles.deleteAccountText}>注销账号</Text>
          </TouchableOpacity>
        )}

        <Pressable onPress={onVersionTap} style={styles.versionWrap}>
          <Text style={styles.versionText}>SiMemory v{APP_VERSION}</Text>
        </Pressable>
      </ScrollView>

      <IosAlert
        visible={stage === 'confirm'}
        onClose={closeDelete}
        title="注销账号"
        titleColor={HW.red}
        message={`注销后，你的账号将被永久关闭，其中的记忆与数据将无法再访问，且不可恢复。\n\n${phoneInCopy}将被解绑，可重新注册为新账号，但不会保留任何原有内容。`}
        buttons={[
          {text: '取消', onPress: closeDelete},
          {text: '继续', danger: true, bold: true, onPress: () => setStage('final')},
        ]}
      />

      <IosAlert
        visible={stage === 'final'}
        onClose={closeDelete}
        title="确认注销账号？"
        titleColor={HW.red}
        message="此操作不可撤销，账号中的全部内容将永久无法访问。"
        buttons={[
          {text: '取消', onPress: closeDelete},
          {text: busy ? '注销中…' : '确认注销', danger: true, bold: true, onPress: submitDelete},
        ]}
      />

      <EnvSwitchSheet visible={showEnv} onClose={() => setShowEnv(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bgApp},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16, backgroundColor: colors.bg},
  headerTitle: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.textMain},
  body: {padding: 20},
  profile: {alignItems: 'center', marginBottom: 40},
  avatar: {width: 80, height: 80, borderRadius: 40, marginBottom: 16},
  name: {fontSize: 20, fontWeight: '700', color: colors.textMain},
  nameInput: {backgroundColor: colors.border, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, width: 140, textAlign: 'center'},
  saveBtn: {backgroundColor: colors.dark, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10},
  saveBtnText: {color: '#fff', fontWeight: '600'},
  card: {backgroundColor: colors.bg, borderRadius: 16, overflow: 'hidden', marginBottom: 24},
  row: {paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomColor: colors.bgSecondary},
  rowLabel: {fontSize: 16, color: colors.textMain},
  rowDivider: {borderBottomWidth: StyleSheet.hairlineWidth},
  rowValue: {fontSize: 15, color: colors.textMain, fontWeight: '700'},
  rowValueMuted: {fontSize: 15, color: colors.textSub},
  memberBanner: {backgroundColor: colors.darkCard, borderRadius: 16, padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24},
  memberTitle: {color: '#fff', fontSize: 16, fontWeight: '700'},
  memberBadge: {backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4},
  memberBadgeText: {fontSize: 10, fontWeight: '700', color: '#fff'},
  memberSub: {color: colors.textSub, fontSize: 12, marginTop: 6},
  upgradeBtn: {backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8},
  upgradeBtnText: {color: colors.textMain, fontSize: 13, fontWeight: '700'},
  refillBtn: {backgroundColor: colors.dark, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4},
  refillBtnText: {color: '#fff', fontSize: 13, fontWeight: '600'},
  logout: {backgroundColor: colors.bgSecondary, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 8},
  logoutText: {fontSize: 16, fontWeight: '600', color: colors.textMain},
  deleteAccount: {paddingVertical: 16, alignItems: 'center', marginTop: 8},
  deleteAccountText: {fontSize: 15, fontWeight: '500', color: HW.red},
  versionWrap: {alignItems: 'center', paddingVertical: 24},
  versionText: {fontSize: 12, color: colors.textSub},
});
