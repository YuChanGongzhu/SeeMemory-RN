import React, {useEffect, useState} from 'react';
import {View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Alert, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {X} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {useNav} from '../navigation/nav';
import {
  getPointAccount,
  getOnShelfPointProducts,
  createPointRechargeOrder,
  type UserPointAccount,
  type PointRechargeProduct,
} from '../apis/requests/point';

/** 加购算力包 — Prototype PowerStorePage (App.jsx:2961). Wired to real /point/* APIs. */
export function PowerStorePage() {
  const nav = useNav();
  const insets = useSafeAreaInsets();

  const [account, setAccount] = useState<UserPointAccount | null>(null);
  const [products, setProducts] = useState<PointRechargeProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getPointAccount().catch(() => null), getOnShelfPointProducts().catch(() => [])])
      .then(([acc, prods]) => {
        if (!alive) return;
        setAccount(acc);
        setProducts(prods || []);
        if (prods && prods.length) setSelectedId(prods[Math.min(1, prods.length - 1)].id);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const balance = account?.balancePoints ?? 0;
  const consumed = account?.totalConsumedPoints ?? 0;
  const total = balance + consumed;
  const usedPct = total > 0 ? (consumed / total) * 100 : 0;
  const selected = products.find(p => p.id === selectedId) || null;
  const priceYuan = selected ? (selected.priceAmount / 100).toFixed(2) : '0.00';

  const confirm = async () => {
    if (!selected || submitting) return;
    setSubmitting(true);
    try {
      await createPointRechargeOrder(selected.id);
      Alert.alert('订单已创建', '请在收银台完成支付。', [{text: '好', onPress: () => nav.pop()}]);
    } catch {
      Alert.alert('下单失败', '请稍后重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={[styles.root, {paddingTop: insets.top + 12}]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>加购算力包</Text>
          <Text style={styles.sub}>Pro / Max 会员专享加购</Text>
        </View>
        <TouchableOpacity style={styles.close} onPress={nav.pop}>
          <X size={18} color={colors.textSub} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{marginTop: 40}} />
      ) : (
        <ScrollView contentContainerStyle={{paddingBottom: insets.bottom + 24}} showsVerticalScrollIndicator={false}>
          <View style={styles.progress}>
            <View style={styles.progressHead}>
              <Text style={styles.progressVal}>{balance.toLocaleString()} <Text style={{color: colors.textSub}}>可用</Text></Text>
              <Text style={styles.progressPct}>已用 {usedPct.toFixed(1)}%</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, {width: `${usedPct}%`}]} />
            </View>
          </View>

          {products.length === 0 ? (
            <Text style={styles.empty}>暂无可购买的算力包</Text>
          ) : (
            <View style={styles.pkgRow}>
              {products.slice(0, 3).map(p => {
                const sel = selectedId === p.id;
                return (
                  <TouchableOpacity key={p.id} activeOpacity={0.85} onPress={() => setSelectedId(p.id)} style={[styles.pkg, {backgroundColor: sel ? colors.dark : colors.nested, borderColor: sel ? colors.dark : 'transparent'}]}>
                    <Text style={[styles.pkgLabel, {color: sel ? '#fff' : colors.textMain}]}>{(p.totalPoints ?? p.pointsAmount).toLocaleString()}</Text>
                    <Text style={[styles.pkgName, {color: sel ? colors.textTertiary : colors.textSub}]} numberOfLines={1}>{p.productName}</Text>
                    <Text style={[styles.pkgPrice, {color: sel ? colors.textTertiary : colors.textSub}]}>¥{(p.priceAmount / 100).toFixed(0)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TouchableOpacity style={[styles.payBtn, {opacity: selected && !submitting ? 1 : 0.5}]} onPress={confirm} disabled={!selected || submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.payBtnText}>确认支付 ¥{priceYuan}</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20},
  title: {fontSize: 20, fontWeight: '700', color: colors.textMain},
  sub: {fontSize: 12, color: colors.textSub, marginTop: 2},
  close: {width: 32, height: 32, borderRadius: 16, backgroundColor: colors.bgSecondary, alignItems: 'center', justifyContent: 'center'},
  progress: {backgroundColor: colors.nested, borderRadius: 16, padding: 16, marginBottom: 24},
  progressHead: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
  progressVal: {fontSize: 14, fontWeight: '600', color: colors.textMain},
  progressPct: {fontSize: 13, color: colors.textSub, fontWeight: '500'},
  track: {height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: 'hidden'},
  fill: {height: 8, borderRadius: 4, backgroundColor: colors.premium},
  pkgRow: {flexDirection: 'row', gap: 12, marginBottom: 32},
  pkg: {flex: 1, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 10, alignItems: 'center', borderWidth: 2},
  pkgLabel: {fontSize: 16, fontWeight: '700', marginBottom: 4},
  pkgName: {fontSize: 11, marginBottom: 4},
  pkgPrice: {fontSize: 12, fontWeight: '600'},
  empty: {textAlign: 'center', color: colors.textSub, marginVertical: 32},
  payBtn: {backgroundColor: colors.dark, borderRadius: 16, paddingVertical: 18, alignItems: 'center'},
  payBtnText: {color: '#fff', fontSize: 17, fontWeight: '700'},
});
