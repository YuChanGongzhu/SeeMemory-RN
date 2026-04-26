import React, {useEffect, useMemo, useState} from 'react';
import {View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Platform, Share, Linking} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useNavigation} from '@react-navigation/native';
import {useRingScanner} from '../hooks/useRingScanner';
import {useAudioCapture} from '../hooks/useAudioCapture';
import {DeviceCard} from '../components/DeviceCard';
import type {RingDebugLog, RingDevice, AudioSegment} from '../types';
import {useMemoryRecall} from '../hooks/useMemoryRecall';
import {isRingModuleAvailable, ringEventEmitter} from '../native/RingModule';
import {ChatComposerDraftStore} from '../storage/ChatComposerDraftStore';
import {transcribeAudioFile} from '../services/api';
import {useTheme} from './ThemeProvider';

export function DevicesScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [logs, setLogs] = useState<RingDebugLog[]>([]);
  const [uploadingPath, setUploadingPath] = useState<string | null>(null);
  const [chatUploadingPath, setChatUploadingPath] = useState<string | null>(null);
  const [uploadedDebugMap, setUploadedDebugMap] = useState<Record<string, {status: number; message: string; objectUrl?: string; presignedUrl?: string}>>({});

  const s = theme.spacing;
  const r = theme.radius;

  if (!isRingModuleAvailable) {
    return (
      <View style={[localStyles.disabledContainer, {paddingTop: insets.top + 24, backgroundColor: theme.colors.bg, padding: s.lg}]}>
        <Text style={[localStyles.disabledTitle, {color: theme.colors.text}]}>
          {'智能戒指模块已暂时移除'}
        </Text>
        <Text style={[localStyles.disabledText, {color: theme.colors.textSecondary, fontSize: 14, lineHeight: 22, marginTop: s.sm}]}>
          {theme.mode === 'warm' ? '当前构建已去掉 BCLSDK 相关引入，用于先验证其余功能。' : '当前构建暂时关闭了戒指模块，先用于验证其余功能。'}
        </Text>
      </View>
    );
  }

  const {
    isScanning, devices, currentDevice, isConnected,
    requestPermissions, startScan, stopScan, connectDevice, disconnectDevice,
  } = useRingScanner();

  const {
    isCapturing, captureMode, isPlaying, playbackCurrentTime, playbackDuration,
    currentPlayingPath, segments, startCaptureADPCM, startCapturePCM,
    stopCapture, denoiseSegment, playSegment, stopPlayback, clearSegments,
  } = useAudioCapture();

  const {uploadSegment} = useMemoryRecall();

  useEffect(() => { requestPermissions(); }, [requestPermissions]);

  useEffect(() => {
    const subscriptions = [
      ringEventEmitter.addListener('onDebugLog', (entry: RingDebugLog) => {
        if (!entry?.message) return;
        setLogs(prev => [entry, ...prev].slice(0, 80));
      }),
      ringEventEmitter.addListener('onError', (message: string) => {
        setLogs(prev => [{timestamp: Date.now(), message: `错误: ${message}`}, ...prev].slice(0, 80));
      }),
    ];
    return () => { subscriptions.forEach(sub => sub.remove()); };
  }, []);

  const denoisedBySource = useMemo(() => {
    const map = new Map<string, string>();
    segments.forEach(segment => {
      if (segment.isDenoised && segment.sourceFilePath) map.set(segment.sourceFilePath, segment.filePath);
    });
    return map;
  }, [segments]);

  const handleScan = async () => {
    if (isScanning) {
      setLogs(prev => [{timestamp: Date.now(), message: '[USER] Stop scan'}, ...prev].slice(0, 80));
      await stopScan();
    } else {
      setLogs(prev => [{timestamp: Date.now(), message: '[USER] Start scan'}, ...prev].slice(0, 80));
      await startScan();
    }
  };

  const handleConnect = async (device: RingDevice) => {
    const success = await connectDevice(device.id);
    if (!success) Alert.alert('Connection Failed', 'Unable to connect to device');
  };

  const handleDisconnect = async () => {
    await stopCapture();
    await disconnectDevice();
  };

  const formatTime = (ts: number) => new Date(ts).toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
  const formatDuration = (seconds: number) => { const safe = Math.max(0, Math.round(seconds)); return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`; };
  const formatBytes = (bytes: number) => { if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; };

  const shareSegment = async (filePath: string) => {
    try {
      const fileUrl = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      const payload = Platform.OS === 'android' ? {title: 'Share Audio', message: `Audio: ${fileUrl}`} : {title: 'Share Audio', url: fileUrl};
      await Share.share(payload);
    } catch (error) { Alert.alert('Share Failed', 'Unable to share audio'); }
  };

  const openRemoteUrl = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) { Alert.alert('Cannot Open', 'URL not supported'); return; }
      await Linking.openURL(url);
    } catch (error) { Alert.alert('Open Failed', 'Unable to open URL'); }
  };

  const shareText = async (text: string, title: string) => {
    try { await Share.share({title, message: text}); } catch (error) {}
  };

  const handleDebugUpload = async (segment: AudioSegment) => {
    if (uploadingPath || chatUploadingPath) return;
    setUploadingPath(segment.filePath);
    try {
      const uploadResponse = await uploadSegment(segment);
      setUploadedDebugMap(prev => ({...prev, [segment.filePath]: {status: uploadResponse.status, message: uploadResponse.message, objectUrl: uploadResponse.result?.objectUrl, presignedUrl: uploadResponse.result?.presignedUrl}}));
      setLogs(prev => [{timestamp: Date.now(), message: `[COS] Upload success: ${segment.filePath}`}, ...prev].slice(0, 80));
      Alert.alert('Upload Success', 'COS debug upload completed');
    } catch (error: any) {
      setLogs(prev => [{timestamp: Date.now(), message: `[COS] Upload failed: ${error?.message || 'Unknown'}`}, ...prev].slice(0, 80));
      Alert.alert('Upload Failed', error?.message || 'Please try again');
    } finally { setUploadingPath(null); }
  };

  const handleSendToChat = async (segment: AudioSegment) => {
    if (uploadingPath || chatUploadingPath) return;
    setChatUploadingPath(segment.filePath);
    try {
      setLogs(prev => [{timestamp: Date.now(), message: `[CHAT] Starting parallel upload + ASR`}, ...prev].slice(0, 80));
      const [uploadResponse, transcript] = await Promise.all([uploadSegment(segment), transcribeAudioFile(segment.filePath)]);
      const objectUrl = uploadResponse.result?.objectUrl?.trim();
      if (!objectUrl) throw new Error('Upload succeeded but no objectUrl returned');
      await ChatComposerDraftStore.save({text: transcript, mediaUrl: objectUrl, mediaKind: 'audio', source: 'device-audio', createdAt: Date.now()});
      setLogs(prev => [{timestamp: Date.now(), message: `[CHAT] Done. Redirecting...`}, ...prev].slice(0, 80));
      navigation.navigate('Memory');
    } catch (error: any) {
      setLogs(prev => [{timestamp: Date.now(), message: `[CHAT] Failed: ${error?.message || 'Unknown'}`}, ...prev].slice(0, 80));
      Alert.alert('Send Failed', error?.message || 'Please try again');
    } finally { setChatUploadingPath(null); }
  };

  const renderDevice = ({item}: {item: RingDevice}) => (
    <DeviceCard device={item} isConnected={item.isConnected || currentDevice?.id === item.id} onPress={() => handleConnect(item)} onConnect={() => handleConnect(item)} onDisconnect={handleDisconnect} />
  );

  return (
    <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
      {/* Header */}
      <View style={[localStyles.header, {paddingTop: insets.top + s.md, paddingHorizontal: s.md, paddingBottom: s.sm, borderBottomColor: theme.colors.border, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}]}>
        <View>
          {theme.mode === 'neon' && <Text style={[localStyles.title, {color: theme.colors.accent, fontSize: 16, fontWeight: '700', letterSpacing: 2}]}>设备中心</Text>}
          {theme.mode === 'warm' && <Text style={[localStyles.title, {color: theme.colors.text, fontSize: 20, fontWeight: '700'}]}>🌿 设备中心</Text>}
                    {theme.mode === 'neon' && <Text style={{color: theme.colors.textSecondary, fontSize: 10, marginTop: 2}}>// 戒指设备管理</Text>}
          {theme.mode === 'warm' && <Text style={{color: theme.colors.textSecondary, fontSize: 12, marginTop: 2}}>正在寻找你的戒指...</Text>}
                  </View>
        <TouchableOpacity
          style={{
            backgroundColor: theme.mode === 'warm' ? theme.colors.buttonPrimary : 'rgba(0, 245, 255, 0.15)',
            borderWidth: theme.mode === 'warm' ? 0 : 0,
            borderColor: undefined,
            paddingHorizontal: s.sm + 6,
            paddingVertical: s.sm,
            borderRadius: r.sm,
          }}
          onPress={handleScan}>
          <Text style={{color: theme.mode === 'warm' ? '#FFF' : theme.colors.accent, fontSize: 12, fontWeight: '600', textTransform: 'none' as const}}>
            {isScanning ? '⏹' : '扫描'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Scanning Indicator */}
      {isScanning && (
        <View style={[localStyles.scanningIndicator, {backgroundColor: theme.colors.bgCard, padding: s.sm, alignItems: 'center'}]}>
          {theme.mode === 'neon' && <Text style={{color: theme.colors.accent, fontSize: 12}}>◎ 扫描中...</Text>}
          {theme.mode === 'warm' && <Text style={{color: theme.colors.accent, fontSize: 12}}>🌾 扫描中...</Text>}
                  </View>
      )}

      <FlatList
        data={devices}
        renderItem={renderDevice}
        keyExtractor={item => item.id}
        contentContainerStyle={{padding: s.md, paddingBottom: 32}}
        ListEmptyComponent={
          <Text style={{color: theme.colors.textMuted, textAlign: 'center', marginTop: s.xl, fontSize: 13}}>
            {'正在搜索设备...'}
          </Text>
        }
        ListFooterComponent={
          <>
            {isConnected && (
              <View style={[localStyles.captureSection, {backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, marginTop: s.md, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}]}>
                <Text style={[localStyles.sectionTitle, {color: theme.mode === 'neon' ? theme.colors.accent : theme.mode === 'warm' ? theme.colors.text : theme.colors.accent, fontSize: 15, fontWeight: '600', marginBottom: s.sm}]}>
                  {'// 录音控制'}
                </Text>

                {/* Status Info */}
                <View style={[localStyles.captureInfo, {marginBottom: s.sm, flexDirection: 'row', justifyContent: 'space-between'}]}>
                  <Text style={{color: theme.colors.text, fontSize: 13}}>
                    {isCapturing ? `${captureMode.toUpperCase()} 录音中` : '⏸ 已暂停'}
                  </Text>
                  <Text style={{color: theme.colors.textSecondary, fontSize: 12}}>片段: {segments.length}</Text>
                </View>

                {/* Recording Controls */}
                {isCapturing ? (
                  <TouchableOpacity
                    style={{
                      backgroundColor: theme.colors.accentSecondary,
                      borderWidth: 0,
                      borderColor: undefined,
                      paddingVertical: s.sm + 4,
                      borderRadius: theme.mode === 'warm' ? r.pill : r.md,
                      alignItems: 'center',
                    }}
                    onPress={stopCapture}>
                    <Text style={{color: theme.mode === 'warm' ? '#FFF' : theme.colors.buttonPrimaryText, fontSize: 13, fontWeight: '600'}}>
                      {'停止录音'}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{flexDirection: 'row', gap: s.sm}}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: theme.mode === 'warm' ? theme.colors.buttonPrimary : 'rgba(0, 245, 255, 0.15)',
                        borderWidth: theme.mode === 'warm' ? 0 : 0,
                        borderColor: undefined,
                        paddingVertical: s.sm + 2,
                        borderRadius: theme.mode === 'warm' ? r.pill : r.md,
                        alignItems: 'center',
                      }}
                      onPress={startCaptureADPCM}>
                      <Text style={{color: theme.mode === 'warm' ? '#FFF' : theme.colors.accent, fontSize: 12, fontWeight: '600'}}>
                        {'ADPCM'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: theme.colors.bgSecondary,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                        paddingVertical: s.sm + 2,
                        borderRadius: theme.mode === 'warm' ? r.pill : r.md,
                        alignItems: 'center',
                      }}
                      onPress={startCapturePCM}>
                      <Text style={{color: theme.mode === 'warm' ? theme.colors.text : theme.colors.textSecondary, fontSize: 12, fontWeight: '600'}}>
                        {'PCM'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Segments */}
                <View style={[localStyles.sectionHeaderRow, {marginTop: s.md, marginBottom: s.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}]}>
                  <Text style={[localStyles.sectionSubtitle, {color: theme.colors.text, fontSize: 13, fontWeight: '600'}]}>
                    {'// 录音片段'}
                  </Text>
                  {!!segments.length && (
                    <TouchableOpacity onPress={clearSegments}>
                      <Text style={{color: theme.colors.accent, fontSize: 11, fontWeight: '600'}}>
                        {'清空'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {!segments.length ? (
                  <Text style={{color: theme.colors.textMuted, fontSize: 12}}>
                    {'录音会保存在本机'}
                  </Text>
                ) : (
                  <View style={{gap: s.sm}}>
                    {segments.map(segment => (
                      <View key={`${segment.timestamp}-${segment.filePath}`} style={{backgroundColor: theme.colors.bgSecondary, borderRadius: r.md, padding: s.sm + 4, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}}>
                        <View style={{marginBottom: s.sm}}>
                          <Text style={{color: theme.colors.text, fontSize: 12, fontWeight: '600'}}>{formatTime(segment.timestamp)}</Text>
                          <Text style={{color: theme.colors.textSecondary, fontSize: 11, marginTop: 2}}>
                            {segment.isDenoised ? 'Denoised' : 'Raw'} · {formatDuration(segment.duration)} · {formatBytes(segment.size)}
                          </Text>
                        </View>

                        {/* Playback Progress */}
                        {isPlaying && currentPlayingPath === segment.filePath && (
                          <View style={{marginBottom: s.sm}}>
                            <View style={{height: 4, borderRadius: 2, backgroundColor: theme.colors.border, overflow: 'hidden'}}>
                              <View style={{height: '100%', width: `${playbackDuration > 0 ? Math.min((playbackCurrentTime / playbackDuration) * 100, 100) : 0}%`, backgroundColor: theme.colors.accent}} />
                            </View>
                            <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 4}}>
                              <Text style={{color: theme.colors.textMuted, fontSize: 10}}>{formatDuration(playbackCurrentTime)}</Text>
                              <Text style={{color: theme.colors.textMuted, fontSize: 10}}>{formatDuration(playbackDuration || segment.duration)}</Text>
                            </View>
                          </View>
                        )}

                        {/* Actions */}
                        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
                          <TouchableOpacity style={{backgroundColor: theme.colors.bgCard, paddingHorizontal: s.sm, paddingVertical: 6, borderRadius: r.sm}} onPress={() => playSegment(segment.filePath)}>
                            <Text style={{color: theme.colors.accent, fontSize: 11, fontWeight: '600'}}>{isPlaying && currentPlayingPath === segment.filePath ? '▶' : '▶'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={{backgroundColor: theme.colors.bgCard, paddingHorizontal: s.sm, paddingVertical: 6, borderRadius: r.sm}} onPress={stopPlayback}>
                            <Text style={{color: theme.colors.textSecondary, fontSize: 11}}>■</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={{backgroundColor: theme.colors.bgCard, paddingHorizontal: s.sm, paddingVertical: 6, borderRadius: r.sm}} onPress={() => shareSegment(segment.filePath)}>
                            <Text style={{color: theme.colors.accent, fontSize: 11}}>↗</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{backgroundColor: theme.mode === 'warm' ? 'rgba(255, 112, 67, 0.2)' : theme.colors.bgCard, paddingHorizontal: s.sm, paddingVertical: 6, borderRadius: r.sm}}
                            disabled={!!uploadingPath || !!chatUploadingPath}
                            onPress={() => handleSendToChat(segment)}>
                            <Text style={{color: theme.mode === 'warm' ? theme.colors.accent : theme.colors.accent, fontSize: 11, fontWeight: '600'}}>
                              {chatUploadingPath === segment.filePath ? '...' : '发到聊天'}
                            </Text>
                          </TouchableOpacity>
                          {!segment.isDenoised && (
                            <TouchableOpacity style={{backgroundColor: theme.colors.bgCard, paddingHorizontal: s.sm, paddingVertical: 6, borderRadius: r.sm}} onPress={() => denoiseSegment(segment.filePath)}>
                              <Text style={{color: theme.colors.accentSecondary, fontSize: 11}}>RN</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* System Log */}
            <View style={{backgroundColor: theme.colors.bgCard, borderRadius: r.lg, padding: s.md, marginTop: s.md, borderWidth: theme.mode === 'neon' ? 1 : 0, borderColor: theme.colors.border}}>
              <Text style={[localStyles.sectionTitle, {color: theme.mode === 'neon' ? theme.colors.accent : theme.mode === 'warm' ? theme.colors.text : theme.colors.accent, fontSize: 13, fontWeight: '600', marginBottom: s.sm}]}>
                {'// 系统日志'}
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
          </>
        }
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  disabledContainer: {flex: 1, justifyContent: 'center'},
  disabledTitle: {fontSize: 20, fontWeight: '600', marginBottom: 12},
  disabledText: {},
  header: {},
  title: {},
  scanningIndicator: {},
  captureSection: {},
  sectionTitle: {},
  captureInfo: {},
  sectionHeaderRow: {},
  sectionSubtitle: {},
});
