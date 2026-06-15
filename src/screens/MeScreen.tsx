import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {GlassesIcon, RingIcon, ServerIcon, LockIcon, StarIcon, GridIcon, FamilyIcon} from '../components/Icons';
import {FadeUpView} from '../components/Animated';
import {NasPage} from '../components/NasPage';
import {DevicesOverlay} from '../components/DevicesOverlay';
import {RechargeSheet} from '../components/RechargeSheet';
import {useAuth} from '../auth/AuthContext';

export function MeScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const s = theme.spacing;
  const r = theme.radius;
  const {logout, isGuest} = useAuth();

  const [nasOpen, setNasOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      '退出登录',
      '确定要退出登录吗？',
      [
        {text: '取消', style: 'cancel'},
        {text: '退出', style: 'destructive', onPress: logout},
      ],
    );
  };

  return (
    <View style={[styles.container, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{paddingBottom: 100}}
        showsVerticalScrollIndicator={false}>

        {/* ── Profile ── */}
        <FadeUpView>
          <View style={[styles.profileSection, {paddingTop: insets.top + s.md + 10, paddingHorizontal: s.lg, marginBottom: s.md}]}>
            <View style={styles.profileRow}>
              {/* Avatar: radial gradient approximated with two overlapping Views */}
              <View style={styles.avatarOuter}>
                <View style={styles.avatarInner} />
              </View>
              <View style={{flex: 1}}>
                <Text style={[styles.profileName, {color: theme.colors.text}]}>春水初生</Text>
                <Text style={[styles.profileId, {color: theme.colors.textMuted}]}>拾光号 7507888057</Text>
              </View>
              <TouchableOpacity style={[styles.qrBtn, {borderColor: theme.colors.border, backgroundColor: theme.colors.bgCard}]}>
                <GridIcon size={18} color="#7C8474" />
              </TouchableOpacity>
            </View>
          </View>
        </FadeUpView>

        {/* ── Points card ── */}
        <FadeUpView delay={80}>
          <TouchableOpacity
            style={[styles.pointsCard, {marginHorizontal: s.lg, marginBottom: s.sm + 2}]}
            onPress={() => setRechargeOpen(true)}
            activeOpacity={0.85}>
            <View style={styles.pointsGlow} />
            <View style={styles.pointsTop}>
              <View style={styles.pointsLeft}>
                <StarIcon size={20} color="#F2CC83" />
                <Text style={styles.pointsLabel}>拾光积分</Text>
              </View>
              <View style={styles.pointsRechargePill}>
                <Text style={styles.pointsRechargeText}>充值 ›</Text>
              </View>
            </View>
            <View style={styles.pointsNumRow}>
              <Text style={styles.pointsNum}>1,280</Text>
              <Text style={styles.pointsUnit}>分 · 本月已用 320</Text>
            </View>
            <Text style={styles.pointsHint}>可用于 AI 深度总结 · 高清原片回放 · 云端索引扩容</Text>
          </TouchableOpacity>
        </FadeUpView>

        {/* ── 我的设备 ── */}
        <FadeUpView delay={130}>
          <Text style={[styles.sectionTitle, {marginHorizontal: s.lg + 2, marginBottom: 11, color: '#5F665B'}]}>
            我的设备
          </Text>
        </FadeUpView>

        {/* Device cards */}
        <FadeUpView delay={160}>
          <View style={[styles.devicesRow, {marginHorizontal: s.lg}]}>
            <TouchableOpacity
              style={[styles.deviceCard, {backgroundColor: theme.colors.bgCard, borderColor: theme.colors.border}]}
              onPress={() => setDevicesOpen(true)}
              activeOpacity={0.7}>
              <View style={styles.deviceCardHead}>
                <View style={[styles.deviceIconWrap, {backgroundColor: '#DCEAE6'}]}>
                  <GlassesIcon size={22} color="#3F8A82" />
                </View>
                <View style={[styles.deviceOnlineDot, {backgroundColor: '#7FA868', shadowColor: 'rgba(127,168,104,0.18)'}]} />
              </View>
              <Text style={[styles.deviceName, {color: theme.colors.text}]}>拾光眼镜</Text>
              <Text style={[styles.deviceModel, {color: theme.colors.textMuted}]}>Vision A1</Text>
              <View style={[styles.deviceStats, {borderTopColor: theme.colors.border}]}>
                <Text style={[styles.deviceStatsText, {color: theme.colors.textSecondary}]}>今天 23 段</Text>
                <Text style={[styles.deviceBattery, {color: '#7FA868'}]}>68%</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deviceCard, {backgroundColor: theme.colors.bgCard, borderColor: theme.colors.border}]}
              onPress={() => setDevicesOpen(true)}
              activeOpacity={0.7}>
              <View style={styles.deviceCardHead}>
                <View style={[styles.deviceIconWrap, {backgroundColor: '#E8EEDD'}]}>
                  <RingIcon size={22} color="#7FA868" />
                </View>
                <View style={[styles.deviceOnlineDot, {backgroundColor: '#7FA868', shadowColor: 'rgba(127,168,104,0.18)'}]} />
              </View>
              <Text style={[styles.deviceName, {color: theme.colors.text}]}>拾光戒指</Text>
              <Text style={[styles.deviceModel, {color: theme.colors.textMuted}]}>Halo R1</Text>
              <View style={[styles.deviceStats, {borderTopColor: theme.colors.border}]}>
                <Text style={[styles.deviceStatsText, {color: theme.colors.textSecondary}]}>今天收藏 5</Text>
                <Text style={[styles.deviceBattery, {color: '#7FA868'}]}>84%</Text>
              </View>
            </TouchableOpacity>
          </View>
        </FadeUpView>

        {/* NAS card */}
        <FadeUpView delay={200}>
          <TouchableOpacity
            style={[styles.nasCard, {backgroundColor: theme.colors.bgCard, borderColor: theme.colors.border, marginHorizontal: s.lg}]}
            onPress={() => setNasOpen(true)}
            activeOpacity={0.7}>
            <View style={styles.nasCardTop}>
              <View style={[styles.nasIconWrap]}>
                <ServerIcon size={24} color="#A9CBB0" />
              </View>
              <View style={{flex: 1}}>
                <Text style={[styles.nasTitle, {color: theme.colors.text}]}>家庭记忆库 · NAS</Text>
                <Text style={[styles.nasModel, {color: theme.colors.textMuted}]}>拾光 N2 · Wi-Fi 已连接</Text>
              </View>
              <View style={styles.nasOnlineBadge}>
                <Text style={styles.nasOnlineText}>在线</Text>
              </View>
            </View>
            <View style={[styles.storageBar, {backgroundColor: theme.colors.bgSecondary}]}>
              <View style={[styles.storageFill, {width: '52%'}]} />
            </View>
            <View style={styles.storageInfo}>
              <Text style={[styles.storageUsed, {color: theme.colors.textSecondary}]}>已用 2.1 TB / 4 TB</Text>
              <Text style={[styles.storageAction, {color: theme.colors.accent}]}>配网与管理 ›</Text>
            </View>
          </TouchableOpacity>
        </FadeUpView>

        {/* Family invite */}
        <FadeUpView delay={240}>
          <TouchableOpacity
            style={[styles.familyCard, {marginHorizontal: s.lg}]}
            activeOpacity={0.7}>
            <FamilyIcon size={26} color="#3F8A82" />
            <View style={{flex: 1}}>
              <Text style={[styles.familyTitle, {color: theme.colors.text}]}>邀请家人一起拾光</Text>
              <Text style={[styles.familyDesc, {color: theme.colors.textSecondary}]}>碰一碰，把记忆汇进同一个记忆库</Text>
            </View>
            <Text style={{color: '#3F8A82', fontSize: 18}}>›</Text>
          </TouchableOpacity>
        </FadeUpView>

        {/* Settings list */}
        <FadeUpView delay={280}>
          <View style={[styles.settingsList, {
            backgroundColor: theme.colors.bgCard,
            borderColor: theme.colors.border,
            marginHorizontal: s.lg,
          }]}>
            <TouchableOpacity style={[styles.settingRow, {borderBottomColor: theme.colors.border}]}>
              <LockIcon size={19} color="#7C8474" />
              <Text style={[styles.settingText, {color: theme.colors.text}]}>隐私与同步</Text>
              <Text style={{color: '#C3C8BB', fontSize: 17}}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.settingRow}>
              <StarIcon size={19} color="#7C8474" />
              <Text style={[styles.settingText, {color: theme.colors.text}]}>AI 授权管理</Text>
              <Text style={[styles.settingMeta, {color: theme.colors.textMuted}]}>阿里云百炼 · Qwen</Text>
            </TouchableOpacity>
          </View>
        </FadeUpView>

        {/* Logout */}
        <FadeUpView delay={320}>
          <TouchableOpacity
            style={[styles.logoutBtn, {
              marginHorizontal: s.lg,
              marginTop: s.md,
              backgroundColor: theme.colors.bgCard,
              borderColor: theme.colors.border,
            }]}
            onPress={handleLogout}>
            <Text style={styles.logoutText}>{isGuest ? '退出游客模式' : '退出登录'}</Text>
          </TouchableOpacity>
        </FadeUpView>
      </ScrollView>

      {/* Overlays */}
      <NasPage visible={nasOpen} onClose={() => setNasOpen(false)} />
      <DevicesOverlay
        visible={devicesOpen}
        onClose={() => setDevicesOpen(false)}
        onOpenNas={() => setNasOpen(true)}
      />
      <RechargeSheet visible={rechargeOpen} onClose={() => setRechargeOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  scrollView: {flex: 1},
  profileSection: {},
  profileRow: {flexDirection: 'row', alignItems: 'center', gap: 14},
  avatarOuter: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#3F8A82',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarInner: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#A9CBB0',
    opacity: 0.55,
  },
  profileName: {fontSize: 21, fontWeight: '700'},
  profileId: {fontSize: 12, marginTop: 3, fontVariant: ['tabular-nums'] as any},
  qrBtn: {borderWidth: 1, borderRadius: 16, padding: 8},
  // Points card
  pointsCard: {
    backgroundColor: '#2F3A33',
    borderRadius: 22,
    padding: 18,
    overflow: 'hidden',
    position: 'relative',
  },
  pointsGlow: {
    position: 'absolute',
    right: -20,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(247,224,171,0.22)',
  },
  pointsTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pointsLeft: {flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1},
  pointsLabel: {fontSize: 13, color: '#C9D2C5', fontWeight: '600', letterSpacing: 0.5},
  pointsRechargePill: {
    backgroundColor: 'rgba(242,204,131,0.16)',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 4,
  },
  pointsRechargeText: {fontSize: 12, color: '#F2CC83', fontWeight: '700'},
  pointsNumRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 13,
  },
  pointsNum: {fontSize: 34, fontWeight: '700', color: '#EFEAD9', lineHeight: 40},
  pointsUnit: {fontSize: 12, color: '#A9B0A1'},
  pointsHint: {fontSize: 11.5, color: '#A9B0A1', marginTop: 8},
  // Section title
  sectionTitle: {fontSize: 15, fontWeight: '600', letterSpacing: 0.5},
  // Device cards
  devicesRow: {flexDirection: 'row', gap: 11, marginBottom: 11},
  deviceCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    padding: 15,
  },
  deviceCardHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11},
  deviceIconWrap: {width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  deviceOnlineDot: {width: 7, height: 7, borderRadius: 4},
  deviceName: {fontSize: 14.5, fontWeight: '700'},
  deviceModel: {fontSize: 11, marginTop: 1},
  deviceStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    marginTop: 12,
    paddingTop: 11,
  },
  deviceStatsText: {fontSize: 11.5},
  deviceBattery: {fontSize: 11.5, fontWeight: '600', fontVariant: ['tabular-nums'] as any},
  // NAS card
  nasCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 11,
  },
  nasCardTop: {flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 13},
  nasIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: '#2F3A33',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nasTitle: {fontSize: 15, fontWeight: '700'},
  nasModel: {fontSize: 11.5, marginTop: 2},
  nasOnlineBadge: {
    backgroundColor: 'rgba(63,138,130,0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nasOnlineText: {fontSize: 10.5, fontWeight: '700', color: '#3F8A82'},
  storageBar: {height: 8, borderRadius: 5, overflow: 'hidden'},
  storageFill: {height: '100%', borderRadius: 5, backgroundColor: '#3F8A82'},
  storageInfo: {flexDirection: 'row', justifyContent: 'space-between', marginTop: 8},
  storageUsed: {fontSize: 11.5},
  storageAction: {fontSize: 11.5, fontWeight: '600'},
  // Family card
  familyCard: {
    backgroundColor: '#E8EEDD',
    borderWidth: 1,
    borderColor: '#D8E2C9',
    borderRadius: 20,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginBottom: 11,
  },
  familyTitle: {fontSize: 14, fontWeight: '700'},
  familyDesc: {fontSize: 11.5, marginTop: 2},
  // Settings list
  settingsList: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginBottom: 11,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  settingText: {flex: 1, fontSize: 14},
  settingMeta: {fontSize: 11},
  // Logout
  logoutBtn: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    alignItems: 'center',
  },
  logoutText: {fontSize: 14, fontWeight: '600', color: '#C0584A'},
});
