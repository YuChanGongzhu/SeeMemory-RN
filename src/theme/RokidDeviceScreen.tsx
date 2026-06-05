import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Image} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {RingModule} from '../native/RingModule';
import {
  ROKID_DEFAULTS,
  RokidModule,
  createDefaultRokidCustomView,
  isRokidModuleAvailable,
  rokidEventEmitter,
  type RokidAuthState,
  type RokidMediaResult,
} from '../native/RokidModule';
import {useTheme} from './ThemeProvider';
import {formatTime, formatDate, formatDuration, formatBytes} from './deviceFormat';

const toFileUri = (filePath: string) => filePath.startsWith('file://') ? filePath : `file://${filePath}`;
const upsertMediaByPath = (items: RokidMediaResult[], media: RokidMediaResult) => {
  if (!media?.filePath) return items;
  return [media, ...items.filter(item => item.filePath !== media.filePath)].slice(0, 60);
};
const mergeMediaByPath = (...groups: RokidMediaResult[][]) => {
  const map = new Map<string, RokidMediaResult>();
  groups.flat().forEach(item => {
    if (!item?.filePath) return;
    map.set(item.filePath, item);
  });
  return Array.from(map.values())
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, 60);
};
const ROKID_RECORDINGS_STORAGE_KEY = 'rokid_recordings_v1';
const ROKID_PHOTOS_STORAGE_KEY = 'rokid_photos_v1';

const resolveSavedRokidMedia = async (items: RokidMediaResult[]) => {
  if (typeof (RokidModule as any).resolveMediaPath !== 'function') {
    return items.filter(item => item?.filePath).slice(0, 60);
  }

  const resolved = await Promise.all(items.map(async item => {
    if (!item?.filePath) return null;
    const filePath = await RokidModule.resolveMediaPath(item.filePath);
    return filePath ? {...item, filePath} : null;
  }));
  return resolved.filter(Boolean).slice(0, 60) as RokidMediaResult[];
};

export function RokidDeviceScreen({onBack}: {onBack: () => void}) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<{timestamp: number; message: string}[]>([]);
  const [rokidAuthState, setRokidAuthState] = useState<RokidAuthState>({status: 'notAuthenticated', isAuthenticated: false});
  const [rokidBusy, setRokidBusy] = useState<string | null>(null);
  const [rokidCustomViewOpen, setRokidCustomViewOpen] = useState(false);
  const [rokidRecording, setRokidRecording] = useState(false);
  const [rokidRecordings, setRokidRecordings] = useState<RokidMediaResult[]>([]);
  const [rokidPhotos, setRokidPhotos] = useState<RokidMediaResult[]>([]);
  const [rokidMediaHydrated, setRokidMediaHydrated] = useState(false);
  const [rokidWaveforms, setRokidWaveforms] = useState<Record<string, number[]>>({});
  const [rokidPlayingPath, setRokidPlayingPath] = useState<string | null>(null);
  const [rokidPlaybackCurrentTime, setRokidPlaybackCurrentTime] = useState(0);
  const [rokidPlaybackDuration, setRokidPlaybackDuration] = useState(0);

  const s = theme.spacing;
  const r = theme.radius;

  const loadRokidWaveform = useCallback(async (filePath: string) => {
    if (typeof (RokidModule as any).getAudioWaveform !== 'function') {
      setRokidWaveforms(prev => ({...prev, [filePath]: []}));
      return [];
    }

    try {
      const waveform = await RokidModule.getAudioWaveform(filePath, 36);
      const nextWaveform = Array.isArray(waveform) ? waveform : [];
      setRokidWaveforms(prev => ({...prev, [filePath]: nextWaveform}));
      return nextWaveform;
    } catch {
      setRokidWaveforms(prev => ({...prev, [filePath]: []}));
      return [];
    }
  }, []);

  useEffect(() => {
    if (!isRokidModuleAvailable) {
      return;
    }

    RokidModule.getAuthState()
      .then(setRokidAuthState)
      .catch(() => {});

    const subscriptions = [
      rokidEventEmitter.addListener('onRokidAuthStateChanged', (state: RokidAuthState) => {
        setRokidAuthState(state);
        setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] Auth: ${state.status}`}, ...prev].slice(0, 80));
      }),
      rokidEventEmitter.addListener('onRokidAuthEvent', (event: {event?: string}) => {
        setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] Event: ${event?.event || 'unknown'}`}, ...prev].slice(0, 80));
      }),
      rokidEventEmitter.addListener('onRokidCustomViewRunning', (event: {isRunning?: boolean}) => {
        setRokidCustomViewOpen(Boolean(event?.isRunning));
      }),
      rokidEventEmitter.addListener('onRokidAudioSegmentReady', (media: RokidMediaResult) => {
        setRokidRecording(false);
        setRokidRecordings(prev => upsertMediaByPath(prev, media));
        loadRokidWaveform(media.filePath);
        setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] Audio saved: ${media.filePath}`}, ...prev].slice(0, 80));
      }),
      rokidEventEmitter.addListener('onRokidPhotoReady', (media: RokidMediaResult) => {
        setRokidPhotos(prev => upsertMediaByPath(prev, media));
        setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] Photo saved: ${media.filePath}`}, ...prev].slice(0, 80));
      }),
      rokidEventEmitter.addListener('onRokidError', (event: {message?: string; event?: string}) => {
        setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] Error: ${event?.message || event?.event || 'unknown'}`}, ...prev].slice(0, 80));
      }),
    ];

    return () => { subscriptions.forEach(sub => sub.remove()); };
  }, [loadRokidWaveform]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(ROKID_RECORDINGS_STORAGE_KEY),
      AsyncStorage.getItem(ROKID_PHOTOS_STORAGE_KEY),
    ])
      .then(([recordingsJson, photosJson]) => {
        if (cancelled) return;
        const savedRecordings = recordingsJson ? JSON.parse(recordingsJson) : [];
        const savedPhotos = photosJson ? JSON.parse(photosJson) : [];
        return Promise.all([
          Array.isArray(savedRecordings) ? resolveSavedRokidMedia(savedRecordings) : [],
          Array.isArray(savedPhotos) ? resolveSavedRokidMedia(savedPhotos) : [],
          RokidModule.getSavedMedia().catch(() => ({recordings: [], photos: []})),
        ]);
      })
      .then(result => {
        if (cancelled || !result) return;
        const [savedRecordings, savedPhotos, scannedMedia] = result;
        const recordings = mergeMediaByPath(scannedMedia.recordings || [], savedRecordings);
        const photos = mergeMediaByPath(scannedMedia.photos || [], savedPhotos);
        setRokidRecordings(recordings);
        setRokidPhotos(photos);
        recordings.forEach(item => {
          if (item.filePath) loadRokidWaveform(item.filePath);
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRokidMediaHydrated(true);
      });
    return () => { cancelled = true; };
  }, [loadRokidWaveform]);

  useEffect(() => {
    if (!rokidMediaHydrated) return;
    AsyncStorage.setItem(ROKID_RECORDINGS_STORAGE_KEY, JSON.stringify(rokidRecordings)).catch(() => {});
  }, [rokidMediaHydrated, rokidRecordings]);

  useEffect(() => {
    if (!rokidMediaHydrated) return;
    AsyncStorage.setItem(ROKID_PHOTOS_STORAGE_KEY, JSON.stringify(rokidPhotos)).catch(() => {});
  }, [rokidMediaHydrated, rokidPhotos]);

  useEffect(() => {
    if (!rokidPlayingPath || rokidPlaybackDuration <= 0) {
      return;
    }

    const startedAt = Date.now();
    const timer = setInterval(() => {
      const next = Math.min((Date.now() - startedAt) / 1000, rokidPlaybackDuration);
      setRokidPlaybackCurrentTime(next);
      if (next >= rokidPlaybackDuration) {
        setRokidPlayingPath(null);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [rokidPlayingPath, rokidPlaybackDuration]);

  const runRokidAction = async (label: string, action: () => Promise<void>) => {
    if (!isRokidModuleAvailable) {
      Alert.alert('Rokid 不可用', '当前构建没有加载 Rokid 原生模块，请重新安装真机包');
      return;
    }

    setRokidBusy(label);
    try {
      await action();
    } catch (error: any) {
      const message = error?.message || '操作失败';
      setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] ${label} failed: ${message}`}, ...prev].slice(0, 80));
      Alert.alert('Rokid 操作失败', message);
    } finally {
      setRokidBusy(null);
    }
  };

  const handleRokidAuthorize = () => runRokidAction('authorize', async () => {
    await RokidModule.initializeClient('customView', ROKID_DEFAULTS.customAppDisplayName, ROKID_DEFAULTS.customAppPageName);
    const installed = await RokidModule.isRokidAppInstalled();
    if (!installed) {
      Alert.alert('请先安装 Rokid App', '手机上需要安装并登录 Rokid AI App，同时眼镜要先在 Rokid App 中连接');
      return;
    }
    const result = await RokidModule.authenticate(ROKID_DEFAULTS.scopes, ROKID_DEFAULTS.appName);
    const nextState = await RokidModule.getAuthState();
    setRokidAuthState(nextState);
    setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] Authorized: ${result.sessionId || 'ok'}`}, ...prev].slice(0, 80));
  });

  const handleRokidOpenView = () => runRokidAction('open customView', async () => {
    await RokidModule.initializeClient('customView', ROKID_DEFAULTS.customAppDisplayName, ROKID_DEFAULTS.customAppPageName);
    await RokidModule.openCustomView(createDefaultRokidCustomView('SeeMemory 已连接'));
    setRokidCustomViewOpen(true);
    setLogs(prev => [{timestamp: Date.now(), message: '[ROKID] CustomView running: ok'}, ...prev].slice(0, 80));
  });

  const handleRokidCloseView = () => runRokidAction('close customView', async () => {
    await RokidModule.closeCustomView(createDefaultRokidCustomView('SeeMemory 已连接'));
    setRokidCustomViewOpen(false);
  });

  const handleRokidOpenApp = () => runRokidAction('open customApp', async () => {
    await RokidModule.initializeClient('customApp', ROKID_DEFAULTS.customAppDisplayName, ROKID_DEFAULTS.customAppPageName);
    const app = await RokidModule.queryCustomApp();
    setLogs(prev => [{timestamp: Date.now(), message: `[ROKID] CustomApp installed: ${app.installed ? 'yes' : 'no'} (${app.packageName})`}, ...prev].slice(0, 80));
    if (!app.installed) {
      throw new Error('眼镜端未安装 Rokid 示例 CustomApp。需要先把 com.rokid.cxrswithcxrl 安装到眼镜端，才能打开眼镜 App。');
    }
    const result = await RokidModule.openCustomApp(ROKID_DEFAULTS.customAppActivityName, '');
    if (!result.success) {
      throw new Error('眼镜端 CustomApp 启动失败');
    }
    setLogs(prev => [{timestamp: Date.now(), message: '[ROKID] CustomApp opened: ok'}, ...prev].slice(0, 80));
  });

  const handleRokidToggleRecord = () => runRokidAction(rokidRecording ? 'stop record' : 'start record', async () => {
    if (rokidRecording) {
      const media = await RokidModule.stopRecord(ROKID_DEFAULTS.recordType);
      setRokidRecordings(prev => upsertMediaByPath(prev, media));
      await loadRokidWaveform(media.filePath);
      setRokidRecording(false);
    } else {
      await RokidModule.startRecord(ROKID_DEFAULTS.recordType);
      setRokidRecording(true);
    }
  });

  const handleRokidTakePhoto = () => runRokidAction('take photo', async () => {
    const media = await RokidModule.takePhoto(1024, 768, 80);
    setRokidPhotos(prev => upsertMediaByPath(prev, media));
  });

  const handleRokidTogglePlayback = (media: RokidMediaResult) => runRokidAction(rokidPlayingPath === media.filePath ? 'stop audio playback' : 'play audio', async () => {
    if (!media?.filePath) {
      return;
    }
    if (rokidPlayingPath === media.filePath) {
      if (typeof (RokidModule as any).stopAudioPlayback === 'function') {
        await RokidModule.stopAudioPlayback();
      } else {
        await RingModule.stopAudioPlayback();
      }
      setRokidPlayingPath(null);
      setRokidPlaybackCurrentTime(0);
      setRokidPlaybackDuration(0);
    } else {
      if (rokidPlayingPath && typeof (RokidModule as any).stopAudioPlayback === 'function') {
        await RokidModule.stopAudioPlayback();
      }
      setRokidPlaybackCurrentTime(0);
      setRokidPlaybackDuration(media.duration || 0);
      let playbackResult: {duration?: number} | undefined;
      if (typeof (RokidModule as any).playAudioFile === 'function') {
        playbackResult = await RokidModule.playAudioFile(media.filePath);
      } else {
        playbackResult = await RingModule.playAudioFile(media.filePath);
      }
      setRokidPlaybackDuration(playbackResult?.duration || media.duration || 0);
      setRokidPlayingPath(media.filePath);
      if (!rokidWaveforms[media.filePath]?.length) {
        await loadRokidWaveform(media.filePath);
      }
    }
  });

  const rokidPhotosByDate = useMemo(() => {
    const groups = new Map<string, RokidMediaResult[]>();
    rokidPhotos.forEach(photo => {
      const date = formatDate(photo.timestamp || Date.now());
      groups.set(date, [...(groups.get(date) || []), photo]);
    });
    return Array.from(groups.entries()).map(([date, photos]) => ({date, photos}));
  }, [rokidPhotos]);

  const renderRokidRecording = (recording: RokidMediaResult) => {
    const isActive = rokidPlayingPath === recording.filePath;
    const duration = isActive ? (rokidPlaybackDuration || recording.duration || 0) : (recording.duration || 0);
    const currentTime = isActive ? rokidPlaybackCurrentTime : 0;
    const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;
    const waveform = rokidWaveforms[recording.filePath] || Array.from({length: 36}, () => 0.08);

    return (
      <View key={`${recording.timestamp}-${recording.filePath}`} style={{backgroundColor: theme.colors.bgSecondary, borderRadius: r.md, padding: s.sm + 4, borderWidth: 1, borderColor: theme.colors.border}}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: s.sm}}>
          <View style={{flex: 1}}>
            <Text style={{color: theme.colors.text, fontSize: 13, fontWeight: '700'}}>{formatTime(recording.timestamp || Date.now())}</Text>
            <Text style={{color: theme.colors.textSecondary, fontSize: 11, marginTop: 3}}>
              录音 · {isActive ? `${formatDuration(currentTime)} / ${formatDuration(duration)}` : formatDuration(duration)} · {formatBytes(recording.size || 0)}
            </Text>
          </View>
          <TouchableOpacity
            disabled={!!rokidBusy}
            style={{backgroundColor: isActive ? theme.colors.accentSecondary : theme.colors.bgCard, paddingHorizontal: s.sm, paddingVertical: 7, borderRadius: r.sm, borderWidth: isActive ? 0 : 1, borderColor: theme.colors.border}}
            onPress={() => handleRokidTogglePlayback(recording)}>
            <Text style={{color: isActive ? '#FFF' : theme.colors.accent, fontSize: 11, fontWeight: '700'}}>
              {isActive ? '停止' : '播放'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{marginTop: s.sm}}>
          <View style={{height: 4, borderRadius: 2, backgroundColor: theme.colors.border, overflow: 'hidden'}}>
            <View style={{height: '100%', width: `${progress}%`, backgroundColor: theme.colors.accent}} />
          </View>
          <View style={{height: 38, flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: s.sm}}>
            {waveform.map((value, index) => (
              <View
                key={`${recording.filePath}-${index}-${value}`}
                style={{
                  flex: 1,
                  height: Math.max(4, Math.round(36 * Math.max(value, 0.06))),
                  borderRadius: 2,
                  backgroundColor: isActive ? theme.colors.accentSecondary : theme.colors.accent,
                  opacity: value > 0 ? 0.95 : 0.35,
                }}
              />
            ))}
          </View>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 4}}>
            <Text style={{color: theme.colors.textMuted, fontSize: 10}}>{formatDuration(currentTime)}</Text>
            <Text style={{color: theme.colors.textMuted, fontSize: 10}}>{formatDuration(duration)}</Text>
          </View>
        </View>

        <Text selectable numberOfLines={1} style={{color: theme.colors.textMuted, fontSize: 10, marginTop: s.sm}}>
          {recording.filePath}
        </Text>
      </View>
    );
  };

  return (
    <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
      {/* Header with back */}
      <View style={[localStyles.header, {paddingTop: insets.top + s.md, paddingHorizontal: s.md, paddingBottom: s.sm, borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}]}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: s.sm}}>
          <TouchableOpacity onPress={onBack} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}} style={{paddingRight: s.sm}}>
            <Text style={{color: theme.colors.accent, fontSize: 22, fontWeight: '600', lineHeight: 24}}>‹</Text>
          </TouchableOpacity>
          <View>
            <Text style={{color: theme.colors.text, fontSize: 17, fontWeight: '700'}}>👓 Rokid 眼镜</Text>
            <Text style={{color: theme.colors.textSecondary, fontSize: 11, marginTop: 2}}>
              {isRokidModuleAvailable ? `授权状态: ${rokidAuthState.status}` : '当前包未包含 Rokid 原生模块'}
            </Text>
          </View>
        </View>
        <View style={{width: 10, height: 10, borderRadius: 5, backgroundColor: rokidAuthState.isAuthenticated ? theme.colors.success : theme.colors.textMuted}} />
      </View>

      <ScrollView contentContainerStyle={{padding: s.md, paddingBottom: 32}}>
        {/* Actions */}
        <View style={{backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, marginBottom: s.md, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}}>
          <Text style={{color: theme.colors.text, fontSize: 13, fontWeight: '700', marginBottom: s.sm}}>眼镜操作</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
            <TouchableOpacity
              disabled={!!rokidBusy}
              style={{backgroundColor: theme.colors.buttonPrimary, paddingHorizontal: s.sm + 4, paddingVertical: s.sm, borderRadius: r.sm}}
              onPress={handleRokidAuthorize}>
              <Text style={{color: theme.colors.buttonPrimaryText, fontSize: 12, fontWeight: '700'}}>
                {rokidBusy === 'authorize' ? '授权中...' : '授权'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!rokidBusy}
              style={{backgroundColor: theme.colors.bgSecondary, paddingHorizontal: s.sm + 4, paddingVertical: s.sm, borderRadius: r.sm, borderWidth: 1, borderColor: theme.colors.border}}
              onPress={rokidCustomViewOpen ? handleRokidCloseView : handleRokidOpenView}>
              <Text style={{color: theme.colors.accent, fontSize: 12, fontWeight: '700'}}>
                {rokidCustomViewOpen ? '关闭画面' : '打开画面'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!rokidBusy}
              style={{backgroundColor: theme.colors.bgSecondary, paddingHorizontal: s.sm + 4, paddingVertical: s.sm, borderRadius: r.sm, borderWidth: 1, borderColor: theme.colors.border}}
              onPress={handleRokidOpenApp}>
              <Text style={{color: theme.colors.accent, fontSize: 12, fontWeight: '700'}}>打开眼镜 App</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!rokidBusy}
              style={{backgroundColor: rokidRecording ? theme.colors.accentSecondary : theme.colors.bgSecondary, paddingHorizontal: s.sm + 4, paddingVertical: s.sm, borderRadius: r.sm, borderWidth: rokidRecording ? 0 : 1, borderColor: theme.colors.border}}
              onPress={handleRokidToggleRecord}>
              <Text style={{color: rokidRecording ? '#FFF' : theme.colors.accent, fontSize: 12, fontWeight: '700'}}>
                {rokidRecording ? '停止录音' : '眼镜录音'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!!rokidBusy}
              style={{backgroundColor: theme.colors.bgSecondary, paddingHorizontal: s.sm + 4, paddingVertical: s.sm, borderRadius: r.sm, borderWidth: 1, borderColor: theme.colors.border}}
              onPress={handleRokidTakePhoto}>
              <Text style={{color: theme.colors.accent, fontSize: 12, fontWeight: '700'}}>拍照</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recordings */}
        <View style={{backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, marginBottom: s.md, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.sm}}>
            <Text style={{color: theme.colors.text, fontSize: 13, fontWeight: '700'}}>Rokid 录音库</Text>
            <Text style={{color: theme.colors.textMuted, fontSize: 11}}>{rokidRecordings.length} 条</Text>
          </View>
          {!rokidRecordings.length ? (
            <Text style={{color: theme.colors.textMuted, fontSize: 12, lineHeight: 18}}>暂无 Rokid 录音</Text>
          ) : (
            <View style={{gap: s.sm}}>
              {rokidRecordings.map(renderRokidRecording)}
            </View>
          )}
        </View>

        {/* Photos */}
        <View style={{backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, marginBottom: s.md, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: s.sm}}>
            <Text style={{color: theme.colors.text, fontSize: 13, fontWeight: '700'}}>Rokid 照片库</Text>
            <Text style={{color: theme.colors.textMuted, fontSize: 11}}>{rokidPhotos.length} 张</Text>
          </View>
          {!rokidPhotos.length ? (
            <Text style={{color: theme.colors.textMuted, fontSize: 12, lineHeight: 18}}>暂无 Rokid 照片</Text>
          ) : (
            <View style={{gap: s.sm}}>
              {rokidPhotosByDate.map(group => (
                <View key={group.date}>
                  <Text style={{color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8}}>{group.date}</Text>
                  <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
                    {group.photos.map(photo => (
                      <View key={`${photo.timestamp}-${photo.filePath}`} style={{width: '31%', aspectRatio: 1, borderRadius: r.sm, overflow: 'hidden', backgroundColor: theme.colors.bgSecondary, borderWidth: 1, borderColor: theme.colors.border}}>
                        <Image source={{uri: toFileUri(photo.filePath)}} style={{width: '100%', height: '100%'}} resizeMode="cover" />
                        <View style={{position: 'absolute', left: 6, bottom: 5, right: 6}}>
                          <Text numberOfLines={1} style={{color: '#FFF', fontSize: 10, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: {width: 0, height: 1}, textShadowRadius: 2}}>
                            {new Date(photo.timestamp || Date.now()).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'})}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* System Log */}
        <View style={{backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}}>
          <Text style={{color: theme.mode === 'neon' ? theme.colors.accent : theme.mode === 'warm' ? theme.colors.text : theme.colors.accent, fontSize: 13, fontWeight: '600', marginBottom: s.sm}}>
            {'// Rokid 日志'}
          </Text>
          {!logs.length ? (
            <Text style={{color: theme.colors.textMuted, fontSize: 12}}>{'日志将显示在这里'}</Text>
          ) : (
            logs.slice(0, 20).map((log, idx) => (
              <View key={`${log.timestamp}-${log.message}-${idx}`} style={{paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border}}>
                <Text style={{color: theme.colors.textMuted, fontSize: 10}}>{formatTime(log.timestamp)}</Text>
                <Text style={{color: theme.colors.textSecondary, fontSize: 12, lineHeight: 17}}>{log.message}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  header: {},
});
