import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {StarIcon, ServerIcon} from './Icons';
import {
  getPointAccount,
  getOnShelfPointProducts,
  createPointRechargeOrder,
  type UserPointAccount,
  type PointRechargeProduct,
} from '../apis/requests/point';

type RechargeSheetProps = {
  visible: boolean;
  onClose: () => void;
};

function formatFen(fen: number): string {
  if (fen % 100 === 0) return `¥${fen / 100}`;
  return `¥${(fen / 100).toFixed(2)}`;
}

function tagFor(pkg: PointRechargeProduct, allPkgs: PointRechargeProduct[]): string | null {
  const maxSort = Math.max(...allPkgs.map(p => p.sort));
  if (pkg.sort === maxSort && pkg.bonusPoints > 0) return '最热门';
  if (pkg.bonusPoints > 0) return `多送 ${pkg.bonusPoints}`;
  return null;
}

export function RechargeSheet({visible, onClose}: RechargeSheetProps) {
  const insets = useSafeAreaInsets();
  const [account, setAccount] = useState<UserPointAccount | null>(null);
  const [products, setProducts] = useState<PointRechargeProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [ordering, setOrdering] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoadingProducts(true);
    Promise.all([getPointAccount(), getOnShelfPointProducts()])
      .then(([acc, prods]) => {
        setAccount(acc);
        const sorted = [...prods].sort((a, b) => a.sort - b.sort);
        setProducts(sorted);
        if (sorted.length > 0) {
          const popular = sorted.reduce((best, p) => p.sort > best.sort ? p : best, sorted[0]);
          setSelectedId(popular.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, [visible]);

  const curPkg = products.find(p => p.id === selectedId);

  const handleRecharge = async () => {
    if (!curPkg) return;
    setOrdering(true);
    try {
      const result = await createPointRechargeOrder(curPkg.id);
      Alert.alert(
        '充值订单已创建',
        `订单号：${result.orderNo}\n充值 ${curPkg.totalPoints.toLocaleString()} 积分\n金额：${formatFen(result.orderAmount)}\n\n请在支付宝完成支付。`,
        [{text: '确定', onPress: onClose}],
      );
    } catch (e) {
      Alert.alert('创建订单失败', e instanceof Error ? e.message : '请稍后重试');
    } finally {
      setOrdering(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, {paddingTop: insets.top}]}>
        <View style={styles.stickyHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <Text style={{fontSize: 20, color: '#28302C', fontWeight: '600'}}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>拾光积分</Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView
          contentContainerStyle={{padding: 20, paddingBottom: insets.bottom + 30}}
          showsVerticalScrollIndicator={false}>

          {/* Balance card */}
          <View style={styles.balanceCard}>
            <View style={styles.balanceGlow} />
            <Text style={styles.balanceLabel}>当前积分</Text>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceGoldIcon}>◈</Text>
              <Text style={styles.balanceNum}>
                {account != null ? account.balancePoints.toLocaleString() : '—'}
              </Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>累计充值</Text>
                <Text style={styles.statVal}>
                  {account != null ? `+${account.totalRechargedPoints.toLocaleString()}` : '—'}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>累计消耗</Text>
                <Text style={styles.statVal}>
                  {account != null ? account.totalConsumedPoints.toLocaleString() : '—'}
                </Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>冻结中</Text>
                <Text style={styles.statVal}>
                  {account != null ? account.frozenPoints.toLocaleString() : '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* Packages */}
          <Text style={styles.sectionTitle}>充值套餐</Text>
          {loadingProducts ? (
            <ActivityIndicator color="#3F8A82" style={{marginVertical: 24}} />
          ) : products.length === 0 ? (
            <Text style={styles.emptyText}>暂无可用套餐</Text>
          ) : (
            <View style={styles.pkgGrid}>
              {products.map(pkg => {
                const on = selectedId === pkg.id;
                const tag = tagFor(pkg, products);
                return (
                  <TouchableOpacity
                    key={String(pkg.id)}
                    style={[
                      styles.pkgCard,
                      {
                        backgroundColor: on ? '#FBF3E2' : '#FFFFFF',
                        borderColor: on ? '#E3A94F' : '#EAE5D7',
                        borderWidth: on ? 2 : 1,
                      },
                    ]}
                    onPress={() => setSelectedId(pkg.id)}
                    activeOpacity={0.7}>
                    {tag != null && (
                      <View style={styles.pkgTag}>
                        <Text style={styles.pkgTagText}>{tag}</Text>
                      </View>
                    )}
                    <Text style={styles.pkgPts}>{pkg.totalPoints.toLocaleString()}</Text>
                    <Text style={styles.pkgPtsLabel}>积分</Text>
                    <Text style={[styles.pkgPrice, {color: on ? '#C2803C' : '#28302C'}]}>
                      {formatFen(pkg.priceAmount)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Usage guide */}
          <View style={styles.usageCard}>
            <Text style={styles.usageTitle}>积分能做什么</Text>
            <View style={styles.usageRow}>
              <StarIcon size={17} color="#3F8A82" />
              <Text style={styles.usageAction}>AI 深度总结与追问</Text>
              <Text style={styles.usageCost}>10 分/次</Text>
            </View>
            <View style={styles.usageRow}>
              <Text style={{fontSize: 17, color: '#C2803C'}}>▶</Text>
              <Text style={styles.usageAction}>高清原片回放</Text>
              <Text style={styles.usageCost}>5 分/段</Text>
            </View>
            <View style={styles.usageRow}>
              <ServerIcon size={17} color="#7C92A6" />
              <Text style={styles.usageAction}>云端索引扩容</Text>
              <Text style={styles.usageCost}>按月</Text>
            </View>
          </View>

          {/* Recharge button */}
          <TouchableOpacity
            style={[styles.rechargeBtn, {opacity: !curPkg || ordering ? 0.6 : 1}]}
            activeOpacity={0.85}
            disabled={!curPkg || ordering}
            onPress={handleRecharge}>
            {ordering
              ? <ActivityIndicator color="#3A2E14" />
              : <Text style={styles.rechargeBtnText}>
                  立即充值{curPkg ? ` ${formatFen(curPkg.priceAmount)}` : ''}
                </Text>
            }
          </TouchableOpacity>
          <Text style={styles.rechargeHint}>每日记录、邀请家人、坚持打卡都能免费获得积分</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F3F1E9'},
  stickyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#F3F1E9',
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6E1D2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {fontSize: 14, fontWeight: '600', color: '#28302C'},
  balanceCard: {
    backgroundColor: '#2F3A33',
    borderRadius: 24,
    padding: 22,
    marginBottom: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  balanceGlow: {
    position: 'absolute',
    right: -30,
    top: -30,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(247,224,171,0.18)',
  },
  balanceLabel: {fontSize: 12, color: '#A9B0A1', letterSpacing: 1},
  balanceRow: {flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 6},
  balanceGoldIcon: {fontSize: 22, color: '#F2CC83'},
  balanceNum: {fontSize: 38, fontWeight: '700', color: '#EFEAD9', lineHeight: 44},
  statsRow: {flexDirection: 'row', gap: 18, marginTop: 16},
  statItem: {},
  statLabel: {fontSize: 11, color: '#A9B0A1'},
  statVal: {fontSize: 15, fontWeight: '700', color: '#EFEAD9', marginTop: 2},
  sectionTitle: {fontSize: 16, fontWeight: '600', color: '#28302C', marginBottom: 11, marginLeft: 2},
  emptyText: {fontSize: 13, color: '#9AA095', textAlign: 'center', paddingVertical: 20},
  pkgGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginBottom: 20},
  pkgCard: {
    width: '47%',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    position: 'relative',
  },
  pkgTag: {
    position: 'absolute',
    top: -9,
    left: '50%',
    transform: [{translateX: -28}],
    backgroundColor: '#C2803C',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  pkgTagText: {fontSize: 10, color: '#FFFFFF', fontWeight: '700'},
  pkgPts: {fontSize: 24, fontWeight: '700', color: '#28302C'},
  pkgPtsLabel: {fontSize: 11, color: '#9AA095', marginTop: 2},
  pkgPrice: {fontSize: 15, fontWeight: '700', marginTop: 9},
  usageCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
  },
  usageTitle: {fontSize: 12, color: '#9AA095', fontWeight: '600', marginBottom: 10},
  usageRow: {flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7},
  usageAction: {fontSize: 13, color: '#3F473F', flex: 1},
  usageCost: {fontSize: 11.5, color: '#9AA095'},
  rechargeBtn: {
    backgroundColor: '#E3A94F',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: 'rgba(227,169,79,0.6)',
    shadowOffset: {width: 0, height: 12},
    shadowOpacity: 1,
    shadowRadius: 26,
    elevation: 8,
  },
  rechargeBtnText: {fontSize: 15, fontWeight: '700', color: '#3A2E14'},
  rechargeHint: {textAlign: 'center', fontSize: 11, color: '#A7AC9E', marginTop: 12},
});
