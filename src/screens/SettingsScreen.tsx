import React, {useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

type AIPersonality = 'rational' | 'enthusiastic' | 'professional';

export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const [aiPersonality, setAiPersonality] = useState<AIPersonality>('professional');
  const [autoSync, setAutoSync] = useState(true);
  const [cloudSync, setCloudSync] = useState(false);

  const personalityOptions: {key: AIPersonality; label: string; icon: string}[] = [
    {key: 'rational', label: '理性冷静', icon: '🧊'},
    {key: 'enthusiastic', label: '热情洋溢', icon: '🔥'},
    {key: 'professional', label: '专业顾问', icon: '🎭'},
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <Text style={styles.title}>设置</Text>
      </View>

      {/* 个人信息 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>👤 个人信息</Text>
        <TouchableOpacity style={styles.item}>
          <Text style={styles.itemText}>账户管理</Text>
          <Text style={styles.itemArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.item} onPress={() => setCloudSync(!cloudSync)}>
          <Text style={styles.itemText}>云端同步</Text>
          <Switch value={cloudSync} onValueChange={setCloudSync} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.item}>
          <Text style={styles.itemText}>隐私设置</Text>
          <Text style={styles.itemArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* AI 配置 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🧠 AI 配置</Text>
        <View style={styles.item}>
          <Text style={styles.itemText}>AI 人格设定</Text>
        </View>
        <View style={styles.personalityOptions}>
          {personalityOptions.map(option => (
            <TouchableOpacity
              key={option.key}
              style={[
                styles.personalityOption,
                aiPersonality === option.key && styles.personalityOptionSelected,
              ]}
              onPress={() => setAiPersonality(option.key)}>
              <Text style={styles.personalityIcon}>{option.icon}</Text>
              <Text
                style={[
                  styles.personalityLabel,
                  aiPersonality === option.key && styles.personalityLabelSelected,
                ]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 数据管理 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📊 数据管理</Text>
        <View style={styles.item}>
          <Text style={styles.itemText}>本地缓存</Text>
          <Text style={styles.itemValue}>1.2GB</Text>
        </View>
        <TouchableOpacity style={styles.item}>
          <Text style={styles.itemText}>上传记录</Text>
          <Text style={styles.itemArrow}>›</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.item}>
          <Text style={styles.clearText}>清除缓存</Text>
        </TouchableOpacity>
      </View>

      {/* 关于 */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>ℹ️ 关于</Text>
        <View style={styles.item}>
          <Text style={styles.itemText}>版本信息</Text>
          <Text style={styles.itemValue}>v0.1.0</Text>
        </View>
        <TouchableOpacity style={styles.item}>
          <Text style={styles.itemText}>SDK 协议文档</Text>
          <Text style={styles.itemArrow}>›</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D0D0D',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  title: {
    color: '#E5E5E5',
    fontSize: 20,
    fontWeight: '600',
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 12,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  itemText: {
    color: '#E5E5E5',
    fontSize: 14,
  },
  itemValue: {
    color: '#888',
    fontSize: 14,
  },
  itemArrow: {
    color: '#888',
    fontSize: 18,
  },
  clearText: {
    color: '#FF4444',
    fontSize: 14,
  },
  personalityOptions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  personalityOption: {
    flex: 1,
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
    padding: 12,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  personalityOptionSelected: {
    borderColor: '#00D4AA',
    backgroundColor: '#1A1A1A',
  },
  personalityIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  personalityLabel: {
    color: '#888',
    fontSize: 11,
  },
  personalityLabelSelected: {
    color: '#00D4AA',
  },
});
