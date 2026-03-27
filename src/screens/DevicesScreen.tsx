import React, {useEffect, useRef, useState} from 'react';
import {View, Text, FlatList, TouchableOpacity, StyleSheet, Alert} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useRingScanner} from '../hooks/useRingScanner';
import {useAudioCapture} from '../hooks/useAudioCapture';
import {DeviceCard} from '../components/DeviceCard';
import type {RingDebugLog, RingDevice} from '../types';
import {useMemoryRecall} from '../hooks/useMemoryRecall';
import {isRingModuleAvailable, ringEventEmitter} from '../native/RingModule';

export function DevicesScreen() {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<RingDebugLog[]>([]);
  const hasHydratedSegments = useRef(false);

  if (!isRingModuleAvailable) {
    return (
      <View style={[styles.disabledContainer, {paddingTop: insets.top + 24}]}>
        <Text style={styles.title}>设备中心</Text>
        <Text style={styles.disabledTitle}>智能戒指模块已暂时移除</Text>
        <Text style={styles.disabledText}>
          当前构建已去掉 BCLSDK 相关引入，用于先验证其余功能。供应商提供可编译的 Swift 版本 SDK 后，再恢复设备扫描、连接和录音能力。
        </Text>
      </View>
    );
  }

  const {
    isScanning,
    devices,
    currentDevice,
    isConnected,
    requestPermissions,
    startScan,
    stopScan,
    connectDevice,
    disconnectDevice,
  } = useRingScanner();

  const {
    isCapturing,
    isPlaying,
    currentPlayingPath,
    segments,
    startCapture,
    stopCapture,
    playSegment,
    stopPlayback,
    clearSegments,
  } = useAudioCapture();
  const {uploadSegment} = useMemoryRecall();

  useEffect(() => {
    const latest = segments[segments.length - 1];
    if (!latest) {
      return;
    }
    if (!hasHydratedSegments.current) {
      hasHydratedSegments.current = true;
      return;
    }
    uploadSegment(latest);
  }, [segments, uploadSegment]);

  useEffect(() => {
    requestPermissions();
  }, [requestPermissions]);

  useEffect(() => {
    const subscriptions = [
      ringEventEmitter.addListener('onDebugLog', (entry: RingDebugLog) => {
        if (!entry?.message) {
          return;
        }
        setLogs(prev => [entry, ...prev].slice(0, 80));
      }),
      ringEventEmitter.addListener('onError', (message: string) => {
        setLogs(prev => [{timestamp: Date.now(), message: `错误: ${message}`}, ...prev].slice(0, 80));
      }),
    ];

    return () => {
      subscriptions.forEach(sub => sub.remove());
    };
  }, []);

  const handleScan = async () => {
    if (isScanning) {
      setLogs(prev => [{timestamp: Date.now(), message: '点击停止扫描'}, ...prev].slice(0, 80));
      await stopScan();
    } else {
      setLogs(prev => [{timestamp: Date.now(), message: '点击开始扫描'}, ...prev].slice(0, 80));
      await startScan();
    }
  };

  const handleConnect = async (device: RingDevice) => {
    const success = await connectDevice(device.id);
    if (!success) {
      Alert.alert('连接失败', '无法连接到设备');
    }
  };

  const handleDisconnect = async () => {
    await stopCapture();
    await disconnectDevice();
  };

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  const formatDuration = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const mins = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderDevice = ({item}: {item: RingDevice}) => (
    <DeviceCard
      device={item}
      isConnected={item.isConnected || currentDevice?.id === item.id}
      onPress={() => handleConnect(item)}
      onConnect={() => handleConnect(item)}
      onDisconnect={handleDisconnect}
    />
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={styles.title}>设备中心</Text>
        <TouchableOpacity style={styles.scanBtn} onPress={handleScan}>
          <Text style={styles.scanBtnText}>
            {isScanning ? '停止扫描' : '扫描设备'}
          </Text>
        </TouchableOpacity>
      </View>

      {isScanning && (
        <View style={styles.scanningIndicator}>
          <Text style={styles.scanningText}>扫描中...</Text>
        </View>
      )}

      <FlatList
        data={devices}
        renderItem={renderDevice}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {isScanning ? '正在搜索设备...' : '点击"扫描设备"开始搜索'}
          </Text>
        }
        ListFooterComponent={
          <>
            {isConnected && (
              <View style={styles.captureSection}>
                <Text style={styles.sectionTitle}>录音控制</Text>
                <View style={styles.captureInfo}>
                  <Text style={styles.captureStatus}>
                    {isCapturing ? '录音中' : '已暂停'}
                  </Text>
                  <Text style={styles.segmentCount}>
                    已录制: {segments.length} 个片段
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.captureBtn, isCapturing && styles.captureBtnActive]}
                  onPress={isCapturing ? stopCapture : startCapture}>
                  <Text style={[styles.captureBtnText, isCapturing && styles.captureBtnTextActive]}>
                    {isCapturing ? '停止录音' : '开始录音'}
                  </Text>
                </TouchableOpacity>

                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionSubtitle}>本地录音</Text>
                  {!!segments.length && (
                    <TouchableOpacity onPress={clearSegments}>
                      <Text style={styles.clearText}>清空列表</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {!segments.length ? (
                  <Text style={styles.emptySubtext}>
                    录音会保存在本机 `Documents/ringmemoryapp/audio`
                  </Text>
                ) : (
                  <View style={styles.recordingList}>
                    {segments.map(segment => (
                      <View key={`${segment.timestamp}-${segment.filePath}`} style={styles.recordingItem}>
                        <View style={styles.recordingMeta}>
                          <Text style={styles.recordingTitle}>{formatTime(segment.timestamp)}</Text>
                          <Text style={styles.recordingStats}>
                            时长 {formatDuration(segment.duration)} · 大小 {formatBytes(segment.size)}
                          </Text>
                          <Text style={styles.recordingPath} numberOfLines={1}>
                            {segment.filePath}
                          </Text>
                        </View>
                        <View style={styles.recordingActions}>
                          <TouchableOpacity style={styles.secondaryBtn} onPress={() => playSegment(segment.filePath)}>
                            <Text style={styles.secondaryBtnText}>
                              {isPlaying && currentPlayingPath === segment.filePath ? '播放中' : '播放'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.secondaryBtn} onPress={stopPlayback}>
                            <Text style={styles.secondaryBtnText}>停止</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            <View style={styles.logSection}>
              <Text style={styles.sectionTitle}>运行日志</Text>
              {!logs.length ? (
                <Text style={styles.emptySubtext}>
                  扫描、连接、录音的关键日志会显示在这里
                </Text>
              ) : (
                logs.slice(0, 20).map(log => (
                  <View key={`${log.timestamp}-${log.message}`} style={styles.logItem}>
                    <Text style={styles.logTime}>{formatTime(log.timestamp)}</Text>
                    <Text style={styles.logMessage}>{log.message}</Text>
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  disabledContainer: {
    flex: 1,
    backgroundColor: '#0D0D0D',
    padding: 24,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  title: {
    color: '#E5E5E5',
    fontSize: 20,
    fontWeight: '600',
  },
  disabledTitle: {
    color: '#E5E5E5',
    fontSize: 22,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 12,
  },
  disabledText: {
    color: '#888',
    fontSize: 15,
    lineHeight: 22,
  },
  scanBtn: {
    backgroundColor: '#00D4AA',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  scanBtnText: {
    color: '#0D0D0D',
    fontSize: 14,
    fontWeight: '600',
  },
  scanningIndicator: {
    backgroundColor: '#1A1A1A',
    padding: 8,
    alignItems: 'center',
  },
  scanningText: {
    color: '#00D4AA',
    fontSize: 12,
  },
  list: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 40,
  },
  captureSection: {
    backgroundColor: '#1A1A1A',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  sectionTitle: {
    color: '#E5E5E5',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  captureInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  captureStatus: {
    color: '#E5E5E5',
    fontSize: 14,
  },
  segmentCount: {
    color: '#888',
    fontSize: 14,
  },
  captureBtn: {
    backgroundColor: '#333',
    paddingVertical: 12,
    borderRadius: 4,
    alignItems: 'center',
  },
  captureBtnActive: {
    backgroundColor: '#00D4AA',
  },
  captureBtnText: {
    color: '#E5E5E5',
    fontSize: 14,
    fontWeight: '600',
  },
  captureBtnTextActive: {
    color: '#0D0D0D',
  },
  sectionHeaderRow: {
    marginTop: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionSubtitle: {
    color: '#E5E5E5',
    fontSize: 14,
    fontWeight: '600',
  },
  clearText: {
    color: '#00D4AA',
    fontSize: 12,
    fontWeight: '600',
  },
  emptySubtext: {
    color: '#666',
    fontSize: 12,
    lineHeight: 18,
  },
  recordingList: {
    gap: 8,
  },
  recordingItem: {
    backgroundColor: '#121212',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: '#262626',
  },
  recordingMeta: {
    marginBottom: 10,
  },
  recordingTitle: {
    color: '#E5E5E5',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  recordingStats: {
    color: '#9D9D9D',
    fontSize: 11,
    marginBottom: 4,
  },
  recordingPath: {
    color: '#7E7E7E',
    fontSize: 11,
  },
  recordingActions: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    backgroundColor: '#232323',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 4,
  },
  secondaryBtnText: {
    color: '#00D4AA',
    fontSize: 12,
    fontWeight: '600',
  },
  logSection: {
    marginTop: 16,
    backgroundColor: '#111111',
    borderRadius: 6,
    padding: 16,
    borderWidth: 1,
    borderColor: '#232323',
  },
  logItem: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#262626',
  },
  logTime: {
    color: '#7E7E7E',
    fontSize: 11,
    marginBottom: 2,
  },
  logMessage: {
    color: '#D5D5D5',
    fontSize: 12,
    lineHeight: 18,
  },
});
