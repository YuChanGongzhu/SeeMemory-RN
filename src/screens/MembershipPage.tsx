import React, {useEffect, useState} from 'react';
import {View, Text, Image, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, Zap, Sparkles, Mic, RefreshCw, Search, Lightbulb, Database} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {images} from '../design/assets';
import {useNav} from '../navigation/nav';
import {getServiceEntitlements, getOnShelfCommerceProducts, createCommerceOrder, deriveTier} from '../apis/requests/membership';

type TierKey = 'none' | 'pro' | 'max';
const TIERS: Record<TierKey, {label: string; powerLabel: string; storage: string; monthPrice: number; yearPrice: number; yearMonthly: number}> = {
  none: {label: '基础版', powerLabel: '1万', storage: '10G', monthPrice: 0, yearPrice: 0, yearMonthly: 0},
  pro: {label: 'PRO', powerLabel: '50万', storage: '1T', monthPrice: 68, yearPrice: 588, yearMonthly: 49},
  max: {label: 'MAX', powerLabel: '200万', storage: '5T', monthPrice: 128, yearPrice: 1088, yearMonthly: 90.7},
};

/** 会员套餐 (dark) — Prototype MembershipPage (App.jsx:464). */
export function MembershipPage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const interceptMsg: string | undefined = nav.current.params?.interceptMsg;

  const [current, setCurrent] = useState<TierKey>(nav.current.params?.tier || 'none');
  const [tier, setTier] = useState<TierKey>(current === 'none' ? 'pro' : current);
  const [cycle, setCycle] = useState<'month' | 'year'>('year');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    getServiceEntitlements()
      .then(ents => {
        if (alive) setCurrent(deriveTier(ents || []).tier);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const purchase = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const products = await getOnShelfCommerceProducts();
      const label = t.label.toLowerCase();
      const wantYear = cycle === 'year';
      const match =
        products.find(p => {
          const hay = `${p.productCode} ${p.productName}`.toLowerCase();
          return hay.includes(label) && (wantYear ? /年|year/.test(hay) : /月|month/.test(hay));
        }) || products.find(p => `${p.productCode} ${p.productName}`.toLowerCase().includes(label));
      if (!match) {
        Alert.alert('暂未配置该套餐', '请稍后再试或联系客服。');
        return;
      }
      await createCommerceOrder(match.id);
      Alert.alert('订单已创建', '请在收银台完成支付。', [{text: '好', onPress: () => nav.pop()}]);
    } catch {
      Alert.alert('下单失败', '请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  const t = TIERS[tier];
  const price = cycle === 'year' ? t.yearPrice : t.monthPrice;
  const hasActive = current !== 'none';
  const activeLabel = current === 'max' ? 'MAX' : current === 'pro' ? 'PRO' : '普通';
  const isCurrent = tier === current;
  const isDowngrade = (current === 'max' && tier !== 'max') || (current === 'pro' && tier === 'none');

  const perks = [
    {icon: <Mic size={13} color="#A1A1AA" />, text: tier !== 'none' ? '长录音不限时' : '基础语音记录'},
    {icon: <RefreshCw size={13} color="#A1A1AA" />, text: tier !== 'none' ? '跨端实时同步' : '本地安全存储'},
    {icon: <Search size={13} color="#A1A1AA" />, text: tier !== 'none' ? '全局 AI 检索' : '基础检索功能'},
    {icon: <Lightbulb size={13} color="#A1A1AA" />, text: tier !== 'none' ? '灵感深度关联' : '日常记录'},
  ];

  return (
    <View style={styles.root}>
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <TouchableOpacity style={styles.backBtn} onPress={nav.pop}>
          <ChevronLeft size={24} strokeWidth={2.4} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>会员套餐</Text>
        <View style={{width: 40}} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {interceptMsg ? (
          <View style={styles.intercept}>
            <View style={styles.interceptIcon}><Zap size={20} color="#fff" fill="#fff" /></View>
            <View style={{flex: 1}}>
              <Text style={styles.interceptTitle}>会员专属权益</Text>
              <Text style={styles.interceptDesc}>{interceptMsg}</Text>
            </View>
          </View>
        ) : null}

        <View style={styles.userRow}>
          <Image source={images.avatar} style={styles.avatar} />
          <View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <Text style={styles.userName}>薯饼</Text>
              <View style={[styles.userBadge, {backgroundColor: hasActive ? '#fff' : 'rgba(255,255,255,0.2)'}]}>
                <Text style={[styles.userBadgeText, {color: hasActive ? colors.textMain : '#A1A1AA'}]}>{activeLabel}会员</Text>
              </View>
            </View>
            <Text style={styles.userSub}>{hasActive ? `尊享 ${activeLabel} 专属权益` : '当前为普通会员，体验基础功能'}</Text>
          </View>
        </View>

        <View style={styles.cycleToggle}>
          {(['month', 'year'] as const).map(c => (
            <TouchableOpacity key={c} style={[styles.cycleBtn, cycle === c && styles.cycleBtnOn]} onPress={() => setCycle(c)}>
              <Text style={[styles.cycleText, cycle === c && styles.cycleTextOn]}>{c === 'month' ? '连续包月' : '连续包年'}</Text>
              {c === 'year' ? <View style={styles.saveTag}><Text style={styles.saveTagText}>省更多</Text></View> : null}
            </TouchableOpacity>
          ))}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 12, paddingBottom: 8}} style={{marginBottom: 28}}>
          {(Object.keys(TIERS) as TierKey[]).map(key => {
            const tt = TIERS[key];
            const sel = tier === key;
            const isThisCurrent = current === key;
            const cardPrice = key === 'none' ? '免费' : cycle === 'year' ? `¥${tt.yearPrice}` : `¥${tt.monthPrice}`;
            const sub = key === 'none' ? '永久' : cycle === 'year' ? `折合 ¥${tt.yearMonthly}/月` : '灵活租赁';
            return (
              <TouchableOpacity key={key} activeOpacity={0.9} onPress={() => setTier(key)} style={[styles.tierCard, {backgroundColor: sel ? '#fff' : 'rgba(255,255,255,0.06)', borderColor: sel ? '#fff' : 'rgba(255,255,255,0.1)'}]}>
                {isThisCurrent ? <View style={styles.curTag}><Text style={styles.curTagText}>当前套餐</Text></View> : null}
                {key === 'max' && !isThisCurrent ? <View style={styles.recTag}><Text style={styles.recTagText}>重度推荐</Text></View> : null}
                <Text style={[styles.tierLabel, {color: sel ? colors.textSub : '#6B6B6B'}]}>{tt.label}</Text>
                <Text style={[styles.tierPrice, {color: sel ? colors.textMain : '#fff'}]}>{cardPrice}{key !== 'none' ? <Text style={[styles.tierUnit, {color: sel ? colors.textSub : '#6B6B6B'}]}> /{cycle === 'year' ? '年' : '月'}</Text> : null}</Text>
                <Text style={[styles.tierSub, {color: sel ? colors.textSub : '#6B6B6B'}]}>{sub}</Text>
                <View style={[styles.tierDivider, {backgroundColor: sel ? colors.border : 'rgba(255,255,255,0.1)'}]} />
                <View style={{gap: 6}}>
                  <View style={styles.tierFeat}><Zap size={11} color={sel ? colors.textMain : '#A1A1AA'} fill={sel ? colors.textMain : 'none'} /><Text style={[styles.tierFeatText, {color: sel ? colors.textMain : '#A1A1AA'}]}>算力 {tt.powerLabel}/月</Text></View>
                  <View style={styles.tierFeat}><Database size={11} color={sel ? colors.textMain : '#A1A1AA'} /><Text style={[styles.tierFeatText, {color: sel ? colors.textMain : '#A1A1AA'}]}>存储 {tt.storage}</Text></View>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.benefits}>
          <View style={styles.benefitsHead}>
            <Sparkles size={15} color="#fff" />
            <Text style={styles.benefitsTitle}>{tier === 'none' ? '普通会员权益' : '高级套餐权益详情'}</Text>
          </View>
          <View style={styles.benefitRow}>
            <View style={styles.benefitIcon}><Zap size={18} color="#fff" fill="#fff" /></View>
            <View style={{flex: 1}}>
              <Text style={styles.benefitTitle}>神经算力 {t.powerLabel} / 月</Text>
              <Text style={styles.benefitDesc}>每月自动发放，月底清零不累计。</Text>
            </View>
          </View>
          <View style={[styles.benefitRow, {borderBottomWidth: 0}]}>
            <View style={styles.benefitIcon}><Database size={18} color="#fff" /></View>
            <View style={{flex: 1}}>
              <Text style={styles.benefitTitle}>云存储空间 {t.storage}</Text>
              <Text style={styles.benefitDesc}>{tier !== 'none' ? '到期后数据默认保留 90 天，续费可完整恢复。' : '设备本地及有限的云端基础备份。'}</Text>
            </View>
          </View>
          <View style={styles.perkGrid}>
            {perks.map((p, i) => (
              <View key={i} style={styles.perk}>{p.icon}<Text style={styles.perkText}>{p.text}</Text></View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.actionBar, {paddingBottom: insets.bottom + 16}]}>
        <TouchableOpacity
          disabled={isCurrent || isDowngrade || submitting}
          onPress={() => (!isCurrent && !isDowngrade ? purchase() : undefined)}
          style={[styles.actionBtn, {backgroundColor: isCurrent || isDowngrade ? 'rgba(255,255,255,0.2)' : '#fff'}]}>
          {submitting ? (
            <ActivityIndicator color={colors.textMain} />
          ) : (
            <Text style={[styles.actionText, {color: isCurrent || isDowngrade ? '#A1A1AA' : colors.textMain}]}>
              {isCurrent ? '当前已在使用该套餐' : isDowngrade ? '当前套餐为更高等级' : `开通 ${t.label} · ¥${price}${cycle === 'year' ? '/年' : '/月'}`}
            </Text>
          )}
        </TouchableOpacity>
        {tier !== 'none' ? <Text style={styles.actionNote}>到期后数据保留 90 天 · 可随时取消自动续费</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.dark},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 16},
  backBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center'},
  headerTitle: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: '#fff'},
  body: {paddingHorizontal: 20, paddingBottom: 140},
  intercept: {flexDirection: 'row', gap: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)', borderRadius: radius.pill, padding: 20, marginBottom: 24},
  interceptIcon: {width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center'},
  interceptTitle: {fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: 6},
  interceptDesc: {fontSize: 13, color: '#A1A1AA', lineHeight: 21},
  userRow: {flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 28, paddingTop: 8},
  avatar: {width: 56, height: 56, borderRadius: 28, backgroundColor: '#333'},
  userName: {fontSize: 18, fontWeight: '700', color: '#fff'},
  userBadge: {paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10},
  userBadgeText: {fontSize: 11, fontWeight: '700'},
  userSub: {fontSize: 12, color: colors.textSub, marginTop: 4},
  cycleToggle: {flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12, padding: 4, marginBottom: 20},
  cycleBtn: {flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center'},
  cycleBtnOn: {backgroundColor: '#fff'},
  cycleText: {fontSize: 14, fontWeight: '600', color: colors.textSub},
  cycleTextOn: {color: colors.textMain},
  saveTag: {position: 'absolute', top: -8, right: 8, backgroundColor: '#fff', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6},
  saveTagText: {fontSize: 9, fontWeight: '700', color: colors.textMain},
  tierCard: {width: 150, borderRadius: 18, padding: 16, borderWidth: 2},
  curTag: {position: 'absolute', top: -10, alignSelf: 'center', left: 0, right: 0, marginHorizontal: 'auto', backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, alignItems: 'center'},
  curTagText: {fontSize: 10, fontWeight: '700', color: '#fff', textAlign: 'center'},
  recTag: {position: 'absolute', top: -10, right: -6, backgroundColor: '#fff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10},
  recTagText: {fontSize: 10, fontWeight: '700', color: colors.textMain},
  tierLabel: {fontSize: 13, fontWeight: '800', letterSpacing: 1, marginBottom: 6},
  tierPrice: {fontSize: 26, fontWeight: '800', marginBottom: 4},
  tierUnit: {fontSize: 12, fontWeight: '500'},
  tierSub: {fontSize: 12, marginBottom: 14},
  tierDivider: {height: 1, marginBottom: 12},
  tierFeat: {flexDirection: 'row', alignItems: 'center', gap: 5},
  tierFeatText: {fontSize: 12},
  benefits: {backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, padding: 20},
  benefitsHead: {flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16},
  benefitsTitle: {fontSize: 14, fontWeight: '700', color: '#fff'},
  benefitRow: {flexDirection: 'row', gap: 14, marginBottom: 18, paddingBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)'},
  benefitIcon: {width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center'},
  benefitTitle: {fontSize: 14, fontWeight: '600', color: '#fff', marginBottom: 3},
  benefitDesc: {fontSize: 12, color: colors.textSub, lineHeight: 19},
  perkGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4},
  perk: {flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, width: '47%'},
  perkText: {fontSize: 12, color: '#A1A1AA'},
  actionBar: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 16, backgroundColor: colors.dark},
  actionBtn: {borderRadius: 16, paddingVertical: 18, alignItems: 'center'},
  actionText: {fontSize: 17, fontWeight: '700'},
  actionNote: {textAlign: 'center', marginTop: 10, fontSize: 11, color: '#636366'},
});
