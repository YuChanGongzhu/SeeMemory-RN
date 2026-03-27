import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import type {RingDevice} from '../types';

interface Props {
  device: RingDevice;
  isConnected: boolean;
  onPress: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function DeviceCard({device, isConnected, onPress, onConnect, onDisconnect}: Props) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.header}>
        <Text style={styles.icon}>📱</Text>
        <View style={styles.info}>
          <Text style={styles.name}>{device.name}</Text>
          <Text style={styles.status}>
            {isConnected ? '已连接' : '未连接'}
          </Text>
        </View>
        <View style={styles.battery}>
          <Text style={styles.batteryText}>{device.batteryLevel}%</Text>
          <View style={styles.batteryBar}>
            <View style={[styles.batteryFill, {width: `${device.batteryLevel}%`}]} />
          </View>
        </View>
      </View>

      {isConnected && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.btnDisconnect} onPress={onDisconnect}>
            <Text style={styles.btnText}>断开连接</Text>
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    fontSize: 24,
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  name: {
    color: '#E5E5E5',
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  battery: {
    alignItems: 'flex-end',
  },
  batteryText: {
    color: '#E5E5E5',
    fontSize: 12,
  },
  batteryBar: {
    width: 40,
    height: 6,
    backgroundColor: '#333',
    borderRadius: 3,
    marginTop: 4,
    overflow: 'hidden',
  },
  batteryFill: {
    height: '100%',
    backgroundColor: '#00D4AA',
  },
  actions: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  btnDisconnect: {
    backgroundColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  btnText: {
    color: '#E5E5E5',
    fontSize: 14,
  },
});
