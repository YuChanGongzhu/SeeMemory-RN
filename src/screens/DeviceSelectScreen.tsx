import React, {useCallback, useEffect, useState} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {useAuth} from '../auth/AuthContext';
import {
  getMigrationProgress,
  switchMemoryStudio,
  type MemoryStudio,
} from '../apis/requests/device';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const STAGE_LABELS: Record<string, string> = {
  EXPORTING: '导出记忆中…',
  IMPORTING: '导入记忆中…',
  SWITCHING: '切换盒子中…',
  FINALIZING: '收尾中…',
};

export function DeviceSelectScreen({onClose}: {onClose: () => void}) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const {devices, selectedDevice, refreshDevices, selectDevice} = useAuth();
  const [loading, setLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchStage, setSwitchStage] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await refreshDevices();
    } catch (error) {
      Alert.alert('加载失败', error instanceof Error ? error.message : '获取设备列表失败');
    } finally {
      setLoading(false);
    }
  }, [refreshDevices]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = async (device: MemoryStudio) => {
    try {
      await selectDevice(device);
    } catch (error) {
      Alert.alert('切换失败', error instanceof Error ? error.message : '选择设备失败');
    }
  };

  const handleSetCurrent = async (device: MemoryStudio) => {
    if (switchingId) {
      return;
    }
    setSwitchingId(device.id);
    setSwitchStage('发起切换…');
    try {
      const {progressId} = await switchMemoryStudio(device.id);
      // Poll until the async migration finishes (cap ~3min).
      for (let i = 0; i < 90; i++) {
        await sleep(2000);
        const progress = await getMigrationProgress(progressId);
        setSwitchStage(progress.stage ? STAGE_LABELS[progress.stage] || progress.stage : '切换中…');
        if (progress.status === 'DONE') {
          await selectDevice(device);
          await refreshDevices();
          setSwitchingId(null);
          setSwitchStage('');
          return;
        }
        if (progress.status === 'FAILED') {
          throw new Error(progress.error || '切换失败');
        }
      }
      throw new Error('切换超时，请稍后在列表中确认状态');
    } catch (error) {
      Alert.alert('切换失败', error instanceof Error ? error.message : '切换当前盒子失败');
    } finally {
      setSwitchingId(null);
      setSwitchStage('');
    }
  };

  const s = theme.spacing;
  const r = theme.radius;
  const c = theme.colors;

  const renderItem = ({item}: {item: MemoryStudio}) => {
    const isSelected = selectedDevice?.subDomain === item.subDomain;
    const isSwitching = switchingId === item.id;
    return (
      <View
        style={[
          styles.card,
          {
            backgroundColor: c.bgCard,
            borderColor: isSelected ? c.accent : c.border,
            borderRadius: r.lg,
            padding: s.md,
            marginBottom: s.sm,
          },
        ]}>
        <TouchableOpacity onPress={() => handleSelect(item)} activeOpacity={0.8}>
          <View style={styles.cardHeader}>
            <Text style={{color: c.text, fontSize: 15, fontWeight: '700'}} numberOfLines={1}>
              {item.name || item.subDomain || '未命名盒子'}
            </Text>
            <View style={{flexDirection: 'row', gap: s.xs}}>
              {item.isCurrent ? (
                <Badge text="当前活跃" bg={c.success} color="#FFF" r={r.sm} s={s} />
              ) : null}
              {isSelected ? (
                <Badge text="App 已连" bg={c.accent} color={c.buttonPrimaryText} r={r.sm} s={s} />
              ) : null}
            </View>
          </View>
          <Text style={{color: c.textSecondary, fontSize: 12, marginTop: s.xs}} numberOfLines={1}>
            {item.model ? `${item.model} · ` : ''}
            {item.subDomain}.remote.seemem.com
          </Text>
        </TouchableOpacity>

        {!item.isCurrent ? (
          <TouchableOpacity
            style={[
              styles.switchButton,
              {
                borderColor: c.borderAccent,
                borderRadius: r.md,
                paddingVertical: s.sm,
                marginTop: s.sm,
                opacity: switchingId && !isSwitching ? 0.5 : 1,
              },
            ]}
            onPress={() => handleSetCurrent(item)}
            disabled={!!switchingId}>
            {isSwitching ? (
              <View style={{flexDirection: 'row', alignItems: 'center', gap: s.sm}}>
                <ActivityIndicator size="small" color={c.accent} />
                <Text style={{color: c.accent, fontSize: 12, fontWeight: '600'}}>
                  {switchStage || '切换中…'}
                </Text>
              </View>
            ) : (
              <Text style={{color: c.accent, fontSize: 12, fontWeight: '600'}}>设为当前盒子</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, {backgroundColor: c.bg, paddingTop: insets.top + s.md}]}>
      <View style={[styles.header, {paddingHorizontal: s.md, paddingBottom: s.sm}]}>
        <Text style={{color: c.text, fontSize: 18, fontWeight: '700'}}>选择记忆盒子</Text>
        <TouchableOpacity onPress={onClose} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}>
          <Text style={{color: c.accent, fontSize: 15, fontWeight: '600'}}>完成</Text>
        </TouchableOpacity>
      </View>
      <Text style={{color: c.textMuted, fontSize: 12, paddingHorizontal: s.md, marginBottom: s.sm}}>
        云端实例或实体盒子都在这里。点选切换 App 对话指向，「设为当前盒子」会把活跃记忆迁移过去。
      </Text>

      {loading && devices.length === 0 ? (
        <View style={{flex: 1, alignItems: 'center', justifyContent: 'center'}}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : (
        <FlatList
          data={devices}
          keyExtractor={item => item.id || item.subDomain}
          renderItem={renderItem}
          contentContainerStyle={{padding: s.md}}
          refreshing={loading}
          onRefresh={load}
          ListEmptyComponent={
            <Text style={{color: c.textMuted, textAlign: 'center', marginTop: s.xl}}>
              还没有绑定记忆盒子。请先在 SeeMemory Studio 网页端激活或绑定。
            </Text>
          }
        />
      )}
    </View>
  );
}

function Badge({
  text,
  bg,
  color,
  r,
  s,
}: {
  text: string;
  bg: string;
  color: string;
  r: number;
  s: {xs: number};
}) {
  return (
    <View style={{backgroundColor: bg, borderRadius: r, paddingHorizontal: s.xs + 2, paddingVertical: 2}}>
      <Text style={{color, fontSize: 10, fontWeight: '700'}}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  card: {borderWidth: 1},
  cardHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  switchButton: {borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
});
