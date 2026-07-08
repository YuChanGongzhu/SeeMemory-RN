import React, {useRef, useState} from 'react';
import {View, Text, TextInput, Image, ScrollView, TouchableOpacity, Pressable, StyleSheet, Alert} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, ChevronRight, PenLine} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {useAuth} from '../auth/AuthContext';
import {usePoints} from '../hooks/usePoints';
import {EnvSwitchSheet} from '../ui/EnvSwitchSheet';

const APP_VERSION = '0.1.0';

/** 个人信息 — Prototype ProfileSettingsPage (App.jsx:3061). */
export function ProfilePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const {user, logout} = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.nickname || user?.username || '薯饼');
  const account = usePoints();
  const power = account?.balancePoints ?? 0;

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

        <View style={styles.card}>
          <View style={[styles.row, {borderBottomWidth: StyleSheet.hairlineWidth}]}>
            <Text style={styles.rowLabel}>绑定微信</Text>
            <Text style={styles.rowValueMuted}>已绑定</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>手机号</Text>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 4}}>
              <Text style={styles.rowValue}>去绑定</Text>
              <ChevronRight size={16} color={colors.textSub} />
            </View>
          </View>
        </View>

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

        <TouchableOpacity
          style={styles.logout}
          onPress={() => Alert.alert('退出登录', '确定要退出当前账号吗？', [{text: '取消', style: 'cancel'}, {text: '退出', style: 'destructive', onPress: () => {nav.home(); void logout();}}])}>
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>

        <Pressable onPress={onVersionTap} style={styles.versionWrap}>
          <Text style={styles.versionText}>SiMemory v{APP_VERSION}</Text>
        </Pressable>
      </ScrollView>

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
  versionWrap: {alignItems: 'center', paddingVertical: 24},
  versionText: {fontSize: 12, color: colors.textSub},
});
