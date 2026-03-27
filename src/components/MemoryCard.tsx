import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';

interface Props {
  content: string;
  timestamp: number;
  onPlay: () => void;
  onViewOriginal: () => void;
  onShare: () => void;
}

export function MemoryCard({content, timestamp, onPlay, onViewOriginal, onShare}: Props) {
  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.icon}>📍</Text>
        <Text style={styles.timestamp}>{formatDate(timestamp)}</Text>
      </View>
      <Text style={styles.content}>{content}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.btn} onPress={onPlay}>
          <Text style={styles.btnText}>▶️ 播放</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onViewOriginal}>
          <Text style={styles.btnText}>📋 原文</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={onShare}>
          <Text style={styles.btnText}>📤 分享</Text>
        </TouchableOpacity>
      </View>
    </View>
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
    marginBottom: 8,
  },
  icon: {
    fontSize: 14,
    marginRight: 6,
  },
  timestamp: {
    color: '#888',
    fontSize: 12,
  },
  content: {
    color: '#E5E5E5',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  actions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 12,
  },
  btn: {
    marginRight: 16,
  },
  btnText: {
    color: '#00D4AA',
    fontSize: 12,
  },
});
