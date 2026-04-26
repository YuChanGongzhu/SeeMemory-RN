import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import type {RingDevice} from '../types';
import {useTheme} from '../theme/ThemeProvider';

interface Props {
  device: RingDevice;
  isConnected: boolean;
  onPress: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function DeviceCard({device, isConnected, onPress, onConnect, onDisconnect}: Props) {
  const {theme} = useTheme();
  const s = theme.spacing;
  const r = theme.radius;

  const getDeviceIcon = () => {
    if (theme.mode === 'neon') return '◎';
    return '📱';
  };

  return (
    <TouchableOpacity
      style={{
        backgroundColor: theme.colors.bgCard,
        borderRadius: r.lg,
        padding: s.md,
        marginBottom: s.sm,
        borderWidth: theme.mode === 'neon' ? 1 : 0,
        borderColor: theme.colors.border,
        ...(theme.mode === 'neon' ? {backdropFilter: 'blur(10px)'} : {}),
        ...theme.shadows.card,
      }}
      onPress={onPress}>
      <View style={{flexDirection: 'row', alignItems: 'center'}}>
        <Text style={{fontSize: 22, marginRight: s.sm + 4}}>{getDeviceIcon()}</Text>
        <View style={{flex: 1}}>
          <Text style={{color: theme.colors.text, fontSize: 15, fontWeight: '600'}}>{device.name}</Text>
          <Text style={{color: isConnected ? theme.colors.success : theme.colors.textMuted, fontSize: 12, marginTop: 2}}>
            {isConnected
              ? ('🌿 已连接')
              : ('未连接')}
          </Text>
        </View>
        <View style={{alignItems: 'flex-end'}}>
          <Text style={{color: theme.colors.text, fontSize: 12}}>{device.batteryLevel}%</Text>
          <View style={{width: 36, height: 5, backgroundColor: theme.colors.border, borderRadius: 2.5, marginTop: 4, overflow: 'hidden'}}>
            <View style={{
              height: '100%',
              width: `${device.batteryLevel}%`,
              backgroundColor: device.batteryLevel > 50 ? theme.colors.success : device.batteryLevel > 20 ? theme.colors.warning : theme.colors.error,
              borderRadius: 2.5,
            }} />
          </View>
        </View>
      </View>

      {!isConnected && (
        <TouchableOpacity
          style={{
            marginTop: s.sm + 4,
            backgroundColor: theme.colors.accent,
            borderWidth: 0,
            borderColor: undefined,
            paddingVertical: s.sm + 2,
            borderRadius: theme.mode === 'warm' ? r.pill : r.md,
            alignItems: 'center',
          }}
          onPress={onConnect}>
          <Text style={{color: '#FFF', fontSize: 13, fontWeight: '600', textTransform: 'none' as const}}>
            {'🤝 连接设备'}
          </Text>
        </TouchableOpacity>
      )}

      {isConnected && (
        <View style={{marginTop: s.sm + 4, paddingTop: s.sm + 4, borderTopWidth: 1, borderTopColor: theme.colors.border}}>
          <TouchableOpacity
            style={{
              backgroundColor: theme.colors.bgSecondary,
              paddingVertical: s.sm + 2,
              borderRadius: theme.mode === 'warm' ? r.pill : r.md,
              alignItems: 'center',
              borderWidth: 0,
              borderColor: theme.colors.border,
            }}
            onPress={onDisconnect}>
            <Text style={{color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600'}}>
              {'断开连接'}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}
