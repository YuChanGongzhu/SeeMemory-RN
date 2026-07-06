import React, {useEffect, useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, BackHandler} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {RokidModule, isRokidModuleAvailable, rokidEventEmitter, type RokidAuthState} from '../native/RokidModule';
import {RokidDeviceScreen} from './RokidDeviceScreen';
import {useTheme} from './ThemeProvider';

type DeviceMode = 'home' | 'rokid';

export function DevicesScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<DeviceMode>('home');

  // Rokid 实时状态（SDK 支持：getAuthState / getSavedMedia + 授权/媒体事件）
  const [rokidAuthorized, setRokidAuthorized] = useState(false);
  const [rokidCounts, setRokidCounts] = useState({recordings: 0, photos: 0});

  const s = theme.spacing;
  const r = theme.radius;

  // 仅在入口页查询并订阅各设备的实时状态（进入详情页时由详情页自己维护）
  useEffect(() => {
    if (mode !== 'home') return;
    let cancelled = false;

    const refreshRokidCounts = () => {
      RokidModule.getSavedMedia()
        .then(m => { if (!cancelled) setRokidCounts({recordings: m.recordings?.length || 0, photos: m.photos?.length || 0}); })
        .catch(() => {});
    };

    if (isRokidModuleAvailable) {
      RokidModule.getAuthState().then(st => { if (!cancelled) setRokidAuthorized(Boolean(st?.isAuthenticated)); }).catch(() => {});
      refreshRokidCounts();
    }

    const subs = [
      rokidEventEmitter.addListener('onRokidAuthStateChanged', (st: RokidAuthState) => {
        setRokidAuthorized(Boolean(st?.isAuthenticated));
      }),
      rokidEventEmitter.addListener('onRokidAudioSegmentReady', refreshRokidCounts),
      rokidEventEmitter.addListener('onRokidPhotoReady', refreshRokidCounts),
    ];

    return () => { cancelled = true; subs.forEach(sub => sub.remove()); };
  }, [mode]);

  // Android 硬件返回键：在详情页时返回入口页，而不是退出 App
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (mode !== 'home') {
        setMode('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [mode]);

  if (mode === 'rokid') {
    return <RokidDeviceScreen onBack={() => setMode('home')} />;
  }

  // Rokid 卡片状态文案
  const rokidStatusText = !isRokidModuleAvailable
    ? '当前包未包含 Rokid 模块'
    : `${rokidAuthorized ? '已授权' : '未授权'} · 录音 ${rokidCounts.recordings} · 照片 ${rokidCounts.photos}`;

  const renderCard = (opts: {
    icon: string;
    title: string;
    features: string;
    statusText: string;
    statusOk: boolean;
    onPress: () => void;
  }) => (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={opts.onPress}
      style={{
        backgroundColor: theme.colors.bgCard,
        borderRadius: r.lg,
        padding: s.md + 2,
        marginBottom: s.md,
        borderWidth: theme.mode === 'neon' ? 1 : 0,
        borderColor: theme.colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: s.md,
      }}>
      <View style={{width: 52, height: 52, borderRadius: r.md, backgroundColor: theme.colors.bgSecondary, alignItems: 'center', justifyContent: 'center'}}>
        <Text style={{fontSize: 26}}>{opts.icon}</Text>
      </View>
      <View style={{flex: 1}}>
        <Text style={{color: theme.colors.text, fontSize: 16, fontWeight: '700'}}>{opts.title}</Text>
        <Text style={{color: theme.colors.textSecondary, fontSize: 12, marginTop: 4}}>{opts.features}</Text>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8}}>
          <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: opts.statusOk ? theme.colors.success : theme.colors.textMuted}} />
          <Text style={{color: opts.statusOk ? theme.colors.text : theme.colors.textMuted, fontSize: 11}}>{opts.statusText}</Text>
        </View>
      </View>
      <Text style={{color: theme.colors.textMuted, fontSize: 22, fontWeight: '600'}}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
      <View style={{paddingTop: insets.top + s.md, paddingHorizontal: s.md, paddingBottom: s.sm, borderBottomColor: theme.colors.border, borderBottomWidth: 1}}>
        {theme.mode === 'warm'
          ? <Text style={{color: theme.colors.text, fontSize: 20, fontWeight: '700'}}>🌿 设备中心</Text>
          : <Text style={{color: theme.mode === 'neon' ? theme.colors.accent : theme.colors.text, fontSize: 16, fontWeight: '700', letterSpacing: theme.mode === 'neon' ? 2 : 0}}>设备中心</Text>}
        <Text style={{color: theme.colors.textSecondary, fontSize: 12, marginTop: 2}}>选择要管理的设备类型</Text>
      </View>

      <View style={{padding: s.md}}>
        {renderCard({
          icon: '👓',
          title: 'Rokid 眼镜',
          features: '授权 · 打开画面 · 录音 · 拍照',
          statusText: rokidStatusText,
          statusOk: isRokidModuleAvailable && rokidAuthorized,
          onPress: () => setMode('rokid'),
        })}

        <Text style={{color: theme.colors.textMuted, fontSize: 11, lineHeight: 18, marginTop: s.sm, paddingHorizontal: 4}}>
          Rokid 眼镜是记忆采集硬件。选择进入连接、录音与素材管理。
        </Text>
      </View>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
});
