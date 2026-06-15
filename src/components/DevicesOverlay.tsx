import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  StyleSheet,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {GlassesIcon, RingIcon, ServerIcon} from './Icons';

type DevicesOverlayProps = {
  visible: boolean;
  onClose: () => void;
  onOpenNas?: () => void;
};

export function DevicesOverlay({visible, onClose, onOpenNas}: DevicesOverlayProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={[styles.container, {backgroundColor: '#F3F1E9', paddingTop: insets.top}]}>
        {/* Header */}
        <View style={styles.stickyHeader}>
          <TouchableOpacity style={styles.backBtn} onPress={onClose}>
            <Text style={{fontSize: 20, color: '#28302C', fontWeight: '600'}}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>我的设备</Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView
          contentContainerStyle={{padding: 20, paddingBottom: insets.bottom + 30}}
          showsVerticalScrollIndicator={false}>

          {/* Glasses card */}
          <View style={styles.deviceCard}>
            <View style={styles.deviceCardHeader}>
              <View style={[styles.deviceIconWrap, {backgroundColor: '#DCEAE6'}]}>
                <GlassesIcon size={26} color="#3F8A82" />
              </View>
              <View style={{flex: 1}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                  <Text style={styles.deviceName}>拾光眼镜</Text>
                  <Text style={styles.deviceModel}>Vision A1</Text>
                </View>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, {backgroundColor: '#7FA868'}]} />
                  <Text style={styles.statusText}>蓝牙已连接 · 信号良好</Text>
                </View>
              </View>
              <View style={styles.batteryBlock}>
                <Text style={styles.batteryNum}>68%</Text>
                <Text style={styles.batteryEst}>约 5 小时</Text>
              </View>
            </View>
            <View style={styles.statsGrid}>
              <View style={styles.statCell}>
                <Text style={styles.statCellLabel}>今日采集</Text>
                <Text style={styles.statCellVal}>23 段</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statCellLabel}>存储</Text>
                <Text style={styles.statCellVal}>12.4 GB</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statCellLabel}>固件</Text>
                <Text style={styles.statCellVal}>最新</Text>
              </View>
            </View>
          </View>

          {/* Ring card */}
          <View style={styles.deviceCard}>
            <View style={styles.deviceCardHeader}>
              <View style={[styles.deviceIconWrap, {backgroundColor: '#E8EEDD'}]}>
                <RingIcon size={26} color="#7FA868" />
              </View>
              <View style={{flex: 1}}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                  <Text style={styles.deviceName}>拾光戒指</Text>
                  <Text style={styles.deviceModel}>Halo R1</Text>
                </View>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, {backgroundColor: '#7FA868'}]} />
                  <Text style={styles.statusText}>蓝牙已连接 · 佩戴中</Text>
                </View>
              </View>
              <View style={styles.batteryBlock}>
                <Text style={styles.batteryNum}>84%</Text>
                <Text style={styles.batteryEst}>约 2 天</Text>
              </View>
            </View>
            <View style={styles.statsGrid}>
              <View style={styles.statCell}>
                <Text style={styles.statCellLabel}>今日收藏</Text>
                <Text style={styles.statCellVal}>5 次</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statCellLabel}>静息心率</Text>
                <Text style={styles.statCellVal}>68</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statCellLabel}>手势</Text>
                <Text style={styles.statCellVal}>开</Text>
              </View>
            </View>
          </View>

          {/* NAS button */}
          <TouchableOpacity
            style={styles.nasBtn}
            onPress={() => { onClose(); onOpenNas?.(); }}
            activeOpacity={0.85}>
            <View style={[styles.nasIconWrap]}>
              <ServerIcon size={26} color="#A9CBB0" />
            </View>
            <View style={{flex: 1}}>
              <Text style={styles.nasName}>家庭记忆库 NAS <Text style={styles.nasModel}>拾光 N2</Text></Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, {backgroundColor: '#A9CBB0'}]} />
                <Text style={[styles.statusText, {color: '#A9CBB0'}]}>在线 · Wi-Fi 已连接</Text>
              </View>
            </View>
            <Text style={{color: '#A9CBB0', fontSize: 18}}>›</Text>
          </TouchableOpacity>

          {/* Add device dashed */}
          <TouchableOpacity style={styles.addDeviceBtn} activeOpacity={0.7}>
            <Text style={styles.addDeviceText}>+ 添加新设备</Text>
          </TouchableOpacity>
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
  headerTitle: {fontSize: 14, fontWeight: '600', color: '#28302C'},
  deviceCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE5D7',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
  },
  deviceCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginBottom: 14,
  },
  deviceIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  deviceName: {fontSize: 16, fontWeight: '700', color: '#28302C'},
  deviceModel: {fontSize: 11, color: '#9AA095', fontWeight: '500'},
  statusRow: {flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3},
  statusDot: {width: 6, height: 6, borderRadius: 3},
  statusText: {fontSize: 11.5, color: '#7FA868', fontWeight: '600'},
  batteryBlock: {alignItems: 'flex-end'},
  batteryNum: {fontSize: 18, fontWeight: '700', color: '#28302C', fontVariant: ['tabular-nums'] as any},
  batteryEst: {fontSize: 10.5, color: '#9AA095'},
  statsGrid: {flexDirection: 'row', gap: 8},
  statCell: {
    flex: 1,
    backgroundColor: '#F5F3EC',
    borderRadius: 12,
    padding: 10,
  },
  statCellLabel: {fontSize: 10.5, color: '#9AA095'},
  statCellVal: {fontSize: 14, fontWeight: '700', color: '#28302C', marginTop: 3},
  nasBtn: {
    backgroundColor: '#2F3A33',
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    marginBottom: 12,
  },
  nasIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    backgroundColor: 'rgba(169,203,176,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  nasName: {fontSize: 16, fontWeight: '700', color: '#EFEAD9'},
  nasModel: {fontSize: 11, color: '#A9B0A1', fontWeight: '500'},
  addDeviceBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C7CFC1',
    borderRadius: 18,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 2,
  },
  addDeviceText: {fontSize: 13.5, fontWeight: '600', color: '#6B7363'},
});
