import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {StarIcon, ServerIcon} from './Icons';

const packages = [
  {id: 'p1', pts: '100', price: '¥6', tag: null},
  {id: 'p2', pts: '300', price: '¥18', tag: '多送 30'},
  {id: 'p3', pts: '1000', price: '¥58', tag: '最热门'},
  {id: 'p4', pts: '3000', price: '¥158', tag: '多送 500'},
];

type RechargeSheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function RechargeSheet({visible, onClose}: RechargeSheetProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState('p3');

  const curPkg = packages.find(p => p.id === selected) || packages[2];

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, {backgroundColor: '#F3F1E9', paddingTop: insets.top}]}>
        {/* Sticky header */}
        <View style={styles.stickyHeader}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onClose}>
            <Text style={{fontSize: 20, color: '#28302C', fontWeight: '600'}}>‹</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, {color: '#28302C'}]}>拾光积分</Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView
          contentContainerStyle={{padding: 20, paddingBottom: insets.bottom + 30}}
          showsVerticalScrollIndicator={false}>

          {/* Points balance card */}
          <View style={styles.balanceCard}>
            <View style={styles.balanceGlow} />
            <Text style={styles.balanceLabel}>当前积分</Text>
            <View style={styles.balanceRow}>
              <Text style={styles.balanceGoldIcon}>◈</Text>
              <Text style={styles.balanceNum}>1,280</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>本月获得</Text>
                <Text style={styles.statVal}>+450</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>本月已用</Text>
                <Text style={styles.statVal}>320</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statLabel}>连续记录</Text>
                <Text style={styles.statVal}>62 天</Text>
              </View>
            </View>
          </View>

          {/* Packages */}
          <Text style={styles.sectionTitle}>充值套餐</Text>
          <View style={styles.pkgGrid}>
            {packages.map(pkg => {
              const on = selected === pkg.id;
              return (
                <TouchableOpacity
                  key={pkg.id}
                  style={[
                    styles.pkgCard,
                    {
                      backgroundColor: on ? '#FBF3E2' : '#FFFFFF',
                      borderColor: on ? '#E3A94F' : '#EAE5D7',
                      borderWidth: on ? 2 : 1,
                    },
                  ]}
                  onPress={() => setSelected(pkg.id)}
                  activeOpacity={0.7}>
                  {pkg.tag && (
                    <View style={styles.pkgTag}>
                      <Text style={styles.pkgTagText}>{pkg.tag}</Text>
                    </View>
                  )}
                  <Text style={styles.pkgPts}>{pkg.pts}</Text>
                  <Text style={styles.pkgPtsLabel}>积分</Text>
                  <Text style={[styles.pkgPrice, {color: on ? '#C2803C' : '#28302C'}]}>
                    {pkg.price}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* What can points do */}
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
          <TouchableOpacity style={styles.rechargeBtn} activeOpacity={0.85}>
            <Text style={styles.rechargeBtnText}>立即充值 {curPkg.price}</Text>
          </TouchableOpacity>
          <Text style={styles.rechargeHint}>每日记录、邀请家人、坚持打卡都能免费获得积分</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
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
  headerTitle: {fontSize: 14, fontWeight: '600'},
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
  balanceNum: {
    fontSize: 38,
    fontWeight: '700',
    color: '#EFEAD9',
    lineHeight: 44,
  },
  statsRow: {flexDirection: 'row', gap: 18, marginTop: 16},
  statItem: {},
  statLabel: {fontSize: 11, color: '#A9B0A1'},
  statVal: {fontSize: 15, fontWeight: '700', color: '#EFEAD9', marginTop: 2},
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#28302C',
    marginBottom: 11,
    marginLeft: 2,
  },
  pkgGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 11,
    marginBottom: 20,
  },
  pkgCard: {
    width: '47%',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    position: 'relative',
    overflow: 'visible',
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
  pkgTagText: {fontSize: 10, color: '#FFFFFF', fontWeight: '700', whiteSpace: 'nowrap'} as any,
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
  usageTitle: {
    fontSize: 12,
    color: '#9AA095',
    fontWeight: '600',
    marginBottom: 10,
  },
  usageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
  },
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
  rechargeHint: {
    textAlign: 'center',
    fontSize: 11,
    color: '#A7AC9E',
    marginTop: 12,
  },
});
