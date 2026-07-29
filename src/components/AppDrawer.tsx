import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Zap, Cloud, Sparkles, Smartphone, Archive, CheckCircle2, ChevronRight, ShieldCheck} from 'lucide-react-native';
import {colors, radius, type as T} from '../design/tokens';
import {Avatar, ProgressBar} from '../ui/kit';
import {useAuth} from '../auth/AuthContext';
import {useAppDrawer} from '../hooks/useAppDrawer';
import {usePoints} from '../hooks/usePoints';
import {useActivityStats, ACTIVITY_WINDOW_DAYS} from '../hooks/useActivityStats';
import {useCreateSummary} from '../hooks/useCreateSummary';
import {useNav, type ScreenName} from '../navigation/nav';
import {SUBSCRIPTION_ENABLED} from '../config/features';
import {getApiEnv} from '../apis/core/env';

const {width: SCREEN_W} = Dimensions.get('window');
const DRAWER_W = Math.min(360, SCREEN_W * 0.85);

const HEAT_WEEKS = ACTIVITY_WINDOW_DAYS / 7; // 15 列
const HEAT_CELL = 12;
const HEAT_GAP = 4;

/** 本地日期 → YYYY-MM-DD（与后端 daily[].day 对齐，不能用 toISOString 会掉时区）。 */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 贡献热力图（15 列 × 7 行，每列一周）。窗口末尾对齐今天所在周，
 * 深浅用绝对阈值 0/≤1/≤3/>3（与记忆脉络页热力图同一口径，跨用户语义固定）。
 */
function Heatmap({daily}: {daily: {day: string; count: number}[]}) {
  const palette = [colors.bgSecondary, colors.textTertiary, colors.textSub, colors.textMain];
  const counts = new Map(daily.map(d => [d.day, d.count]));

  // 最后一列是本周：从今天所在周的周一往回推 HEAT_WEEKS-1 周作为起点。
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - (HEAT_WEEKS - 1) * 7);

  // flexWrap 是按行铺的，而每列要是一周 → 第 i 格 = 第 (i % HEAT_WEEKS) 周的第 (i / HEAT_WEEKS) 天。
  return (
    <View style={styles.heatmap}>
      {Array.from({length: ACTIVITY_WINDOW_DAYS}, (_, i) => {
        const week = i % HEAT_WEEKS;
        const weekday = Math.floor(i / HEAT_WEEKS);
        const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + weekday);
        const c = counts.get(dayKey(d)) ?? 0;
        const level = c === 0 ? 0 : c <= 1 ? 1 : c <= 3 ? 2 : 3;
        return <View key={i} style={[styles.heatCell, {backgroundColor: palette[level]}]} />;
      })}
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.6}>
      <View style={styles.menuIcon}>{icon}</View>
      <Text style={styles.menuLabel}>{label}</Text>
      <ChevronRight size={18} color={colors.textTertiary} />
    </TouchableOpacity>
  );
}

/** Global slide-in drawer — faithful to the prototype's AppDrawer. */
export function AppDrawer() {
  const insets = useSafeAreaInsets();
  const {drawerOpen, closeDrawer} = useAppDrawer();
  const {user, isGuest, logout} = useAuth();
  const account = usePoints();
  const activity = useActivityStats(drawerOpen);
  const nav = useNav();
  const {openCreateSummary} = useCreateSummary();

  const slide = useRef(new Animated.Value(-DRAWER_W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (drawerOpen) {
      Animated.parallel([
        Animated.timing(slide, {toValue: 0, duration: 260, useNativeDriver: true}),
        Animated.timing(fade, {toValue: 1, duration: 260, useNativeDriver: true}),
      ]).start();
    } else {
      slide.setValue(-DRAWER_W);
      fade.setValue(0);
    }
  }, [drawerOpen, slide, fade]);

  const go = (name: ScreenName) => {
    closeDrawer();
    nav.push(name);
  };

  const isTest = getApiEnv() === 'test';
  const name = isGuest ? '点击登录' : user?.nickname || user?.username || '我的记忆';
  const balance = account?.balancePoints ?? 0;
  const consumed = account?.totalConsumedPoints ?? 0;
  const totalEver = balance + consumed || 1;

  return (
    <Modal visible={drawerOpen} transparent animationType="none" onRequestClose={closeDrawer}>
      <Animated.View style={[styles.backdrop, {opacity: fade}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {width: DRAWER_W, paddingTop: insets.top + 28, paddingBottom: insets.bottom + 16, transform: [{translateX: slide}]},
        ]}>
        {/* 测试环境角标（prod 不显示） */}
        {isTest ? (
          <View style={[styles.envBadge, {top: insets.top + 12}]} pointerEvents="none">
            <Text style={styles.envBadgeText}>test</Text>
          </View>
        ) : null}

        {/* Profile header */}
        <TouchableOpacity
          style={styles.profile}
          activeOpacity={0.7}
          onPress={() => {
            if (isGuest) {
              // 抽屉自身是 Modal，再叠登录 Modal 在 iOS 上会撞 present；游客退登
              // 即回到 AuthGate 的全屏登录页，效果等同「点击登录」。
              closeDrawer();
              void logout();
              return;
            }
            go('profile');
          }}>
          <Avatar source={isGuest ? undefined : undefined} size={48} fallback={name} />
          <View style={{flex: 1, marginLeft: 12}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <Text style={styles.name} numberOfLines={1}>
                {name}
              </Text>
              {!isGuest && SUBSCRIPTION_ENABLED ? (
                <View style={styles.tierBadge}>
                  <Text style={styles.tierBadgeText}>普通</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.sub} numberOfLines={1}>
              {isGuest ? '点击登录查看日历与统计' : SUBSCRIPTION_ENABLED ? '会员专享特权' : '查看个人信息'}
            </Text>
          </View>
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{paddingBottom: 8}}>
          {/* 我的套餐 / 我的额度（订阅关闭时无升级入口，标题相应改为中性措辞） */}
          <View style={styles.packageCard}>
            <View style={styles.packageHead}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                <Zap size={15} color={colors.textMain} fill={colors.textMain} />
                <Text style={styles.packageTitle}>{SUBSCRIPTION_ENABLED ? '我的套餐' : '我的额度'}</Text>
              </View>
              {SUBSCRIPTION_ENABLED ? (
                <TouchableOpacity onPress={() => go('membership')}>
                  <Text style={styles.manage}>升级</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.barBlock}>
              <View style={styles.barHead}>
                <Text style={styles.barLabel}>神经算力</Text>
                <Text style={styles.barValue}>{balance.toLocaleString()} 积分可用</Text>
              </View>
              <ProgressBar value={balance} total={totalEver} color={colors.textMain} />
            </View>

            <View style={styles.barBlock}>
              <View style={styles.barHead}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 5}}>
                  <Cloud size={13} color={colors.textSub} />
                  <Text style={styles.barLabel}>云存储</Text>
                </View>
                <Text style={styles.barValue}>0 / 10 GB</Text>
              </View>
              <ProgressBar value={0} total={10} color={colors.storage} />
            </View>
          </View>

          {/* 记忆沉淀 */}
          <Text style={styles.sectionTitle}>记忆沉淀</Text>
          <TouchableOpacity
            style={styles.summaryBtn}
            activeOpacity={0.8}
            onPress={() => {
              closeDrawer();
              openCreateSummary();
            }}>
            <Sparkles size={16} color={colors.textMain} />
            <Text style={styles.summaryBtnText}>生成多维总结</Text>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.8} style={styles.statsRow} onPress={() => go('timeline')}>
            {[
              {n: String(activity?.total ?? 0), l: '全部记忆'},
              {n: String(activity?.active_days ?? 0), l: '累计天数'},
              {n: String(activity?.streak ?? 0), l: '连续天数'},
            ].map(s => (
              <View key={s.l} style={styles.statCell}>
                <Text style={styles.statNum}>{s.n}</Text>
                <Text style={styles.statLabel}>{s.l}</Text>
              </View>
            ))}
          </TouchableOpacity>

          {/* 无数据时不画格子——假花纹比留白更容易被当成真实记录。点击进「记忆脉络」热力视图。 */}
          {activity && activity.total > 0 ? (
            <TouchableOpacity activeOpacity={0.7} onPress={() => go('timeline')}>
              <Heatmap daily={activity.daily} />
            </TouchableOpacity>
          ) : null}

          {/* Menu */}
          <View style={{marginTop: 8}}>
            <MenuRow icon={<Smartphone size={20} color={colors.textMain} />} label="记忆粒" onPress={() => go('hardware')} />
            <MenuRow icon={<Archive size={20} color={colors.textMain} />} label="沉淀" onPress={() => go('archive')} />
            <MenuRow icon={<CheckCircle2 size={20} color={colors.textMain} />} label="待办提醒" onPress={() => go('todo')} />
            <MenuRow icon={<ShieldCheck size={20} color={colors.textMain} />} label="隐私与 AI" onPress={() => go('privacyAi')} />
          </View>
        </ScrollView>

        {!isGuest ? (
          <TouchableOpacity
            style={styles.logout}
            onPress={() => {
              closeDrawer();
              void logout();
            }}>
            <Text style={styles.logoutText}>退出登录</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)'},
  panel: {position: 'absolute', left: 0, top: 0, bottom: 0, paddingHorizontal: 20, backgroundColor: colors.bg},
  envBadge: {
    position: 'absolute',
    right: 16,
    zIndex: 10,
    backgroundColor: colors.danger,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  envBadgeText: {fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.5},
  profile: {flexDirection: 'row', alignItems: 'center', marginBottom: 20},
  name: {...(T.sysTitle as object), color: colors.textMain},
  sub: {fontSize: 12, color: colors.textSub, marginTop: 3},
  packageCard: {
    backgroundColor: colors.nested,
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 18,
  },
  packageHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  tierBadge: {backgroundColor: colors.bgSecondary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6},
  tierBadgeText: {fontSize: 10, fontWeight: '700', color: colors.textSub},
  manage: {fontSize: 13, fontWeight: '600', color: colors.textSub},
  packageTitle: {fontSize: 15, fontWeight: '600', color: colors.textMain},
  barBlock: {marginBottom: 12},
  barHead: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6},
  barLabel: {fontSize: 12, fontWeight: '500', color: colors.textMain},
  barValue: {fontSize: 11, color: colors.textSub},
  sectionTitle: {...(T.memTitle as object), color: colors.textMain, fontSize: 16, marginBottom: 12},
  summaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.premium,
    borderRadius: radius.lg,
    paddingVertical: 13,
    marginBottom: 16,
  },
  summaryBtnText: {fontSize: 14, fontWeight: '700', color: colors.textMain},
  statsRow: {flexDirection: 'row', backgroundColor: colors.nested, borderRadius: radius.xxl, paddingVertical: 16, marginBottom: 16},
  statCell: {flex: 1, alignItems: 'center', borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.border},
  statNum: {...(T.statNum as object), color: colors.textMain},
  statLabel: {...(T.statLabel as object), color: colors.textSub, marginTop: 2},
  // 固定宽度锁住「每行 15 格」（交给 flexWrap 自适应会变成 14/16 列，破坏一列一周的排布），
  // 宽度算 15 格 + 14 个间隙（原来按 15 个间隙算，右边多出一格宽），再 alignSelf 居中。
  heatmap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: HEAT_GAP,
    marginBottom: 16,
    alignSelf: 'center',
    width: HEAT_WEEKS * HEAT_CELL + (HEAT_WEEKS - 1) * HEAT_GAP,
  },
  heatCell: {width: HEAT_CELL, height: HEAT_CELL, borderRadius: 2},
  menuRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4, gap: 12},
  menuIcon: {width: 28, alignItems: 'center'},
  menuLabel: {flex: 1, ...(T.menuLabel as object), color: colors.textMain},
  logout: {marginTop: 8, paddingVertical: 13, alignItems: 'center'},
  logoutText: {fontSize: 14, fontWeight: '600', color: colors.danger},
});
