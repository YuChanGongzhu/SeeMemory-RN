import React, {useState} from 'react';
import {View, Text, ScrollView, TouchableOpacity, StyleSheet, Switch} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from './ThemeProvider';
import type {ThemeMode} from './index';

type AIPersonality = 'rational' | 'enthusiastic' | 'professional';

export function SettingsScreen() {
  const {theme, themeMode, setThemeMode, toggleTheme} = useTheme();
  const insets = useSafeAreaInsets();
  const [aiPersonality, setAiPersonality] = useState<AIPersonality>('professional');
  const [autoSync, setAutoSync] = useState(true);
  const [cloudSync, setCloudSync] = useState(false);

  const s = theme.spacing;
  const r = theme.radius;

  const personalityOptions: {key: AIPersonality; label: string; warmIcon: string; neonIcon: string}[] = [
    {key: 'rational', label: '理性冷静', warmIcon: '🧊', neonIcon: '◈'},
    {key: 'enthusiastic', label: '热情洋溢', warmIcon: '🔥', neonIcon: '◉'},
    {key: 'professional', label: '专业顾问', warmIcon: '🎭', neonIcon: '◆'},
  ];

  const themeOptions: {mode: ThemeMode; label: string; warmIcon: string; neonIcon: string}[] = [
    {mode: 'neon', label: '未来科技', warmIcon: '🚀', neonIcon: '◈'},
    {mode: 'warm', label: '温暖生活', warmIcon: '🌅', neonIcon: '◎'},
  ];

  const getIcon = (option: typeof personalityOptions[0]) => {
    return theme.mode === 'warm' ? option.warmIcon : option.neonIcon;
  };

  const getThemeIcon = (option: typeof themeOptions[0]) => {
    return theme.mode === 'warm' ? option.warmIcon : option.neonIcon;
  };

  return (
    <ScrollView style={[localStyles.container, {backgroundColor: theme.colors.bg, flex: 1}]} contentContainerStyle={{paddingBottom: s.xxl}}>
      {/* Header */}
      <View style={[localStyles.header, {paddingTop: insets.top + s.md, paddingHorizontal: s.md, paddingBottom: s.sm, borderBottomColor: theme.colors.border, borderBottomWidth: 1}]}>
        {theme.mode === 'neon' && <Text style={{color: theme.colors.accent, fontSize: 16, fontWeight: '700', letterSpacing: 2}}>// 设置中心</Text>}
        {theme.mode === 'warm' && <Text style={{color: theme.colors.text, fontSize: 22, fontWeight: '700'}}>🌻 设置中心</Text>}
      </View>

      {/* Theme Selector */}
      <View style={[localStyles.section, {padding: s.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
        <Text style={[localStyles.sectionTitle, {color: theme.mode === 'warm' ? theme.colors.textMuted : theme.colors.accent, fontSize: 11, marginBottom: s.sm}]}>
          {theme.mode === 'warm' ? '🎨 主题切换' : '// 主题模式'}
        </Text>
        <View style={{flexDirection: 'row', gap: s.sm}}>
          {themeOptions.map(option => (
            <TouchableOpacity
              key={option.mode}
              style={{
                flex: 1,
                backgroundColor: themeMode === option.mode
                  ? (theme.mode === 'neon' ? 'rgba(0, 245, 255, 0.15)' : 'rgba(255, 112, 67, 0.15)')
                  : theme.colors.bgSecondary,
                borderRadius: r.md,
                borderWidth: 1,
                borderColor: themeMode === option.mode ? theme.colors.accent : theme.colors.border,
                paddingVertical: s.sm + 2,
                alignItems: 'center',
              }}
              onPress={() => setThemeMode(option.mode)}>
              <Text style={{
                fontSize: theme.mode === 'neon' ? 22 : 18,
                fontWeight: '700',
                color: themeMode === option.mode ? theme.colors.accent : theme.mode === 'neon' ? theme.colors.textSecondary : theme.colors.text,
              }}>
                {getThemeIcon(option)}
              </Text>
              <Text style={{
                color: themeMode === option.mode ? theme.colors.accent : theme.mode === 'neon' ? theme.colors.text : theme.colors.textSecondary,
                fontSize: 13,
                fontWeight: themeMode === option.mode ? '700' : '600',
                marginTop: 4,
              }}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Account Section */}
      <View style={[localStyles.section, {padding: s.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
        <Text style={[localStyles.sectionTitle, {color: theme.mode === 'warm' ? theme.colors.textMuted : theme.colors.accent, fontSize: 11, marginBottom: s.sm, }]}>
          {theme.mode === 'warm' ? '👤 个人信息' : '// 账户'}
        </Text>

        <TouchableOpacity style={[localStyles.item, {paddingVertical: s.sm + 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
          <Text style={[localStyles.itemText, {color: theme.colors.text}]}>
            {'账户管理'}
          </Text>
          <Text style={[localStyles.itemArrow, {color: theme.colors.textMuted}]}>→</Text>
        </TouchableOpacity>

        <View style={[localStyles.item, {paddingVertical: s.sm + 4, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
          <Text style={[localStyles.itemText, {color: theme.colors.text}]}>
            {'云端同步'}
          </Text>
          <Switch value={cloudSync} onValueChange={setCloudSync} trackColor={{false: theme.colors.border, true: theme.colors.accent}} thumbColor="#FFF" />
        </View>

        <TouchableOpacity style={[localStyles.item, {paddingVertical: s.sm + 4}]}>
          <Text style={[localStyles.itemText, {color: theme.colors.text}]}>
            {'隐私设置'}
          </Text>
          <Text style={[localStyles.itemArrow, {color: theme.colors.textMuted}]}>→</Text>
        </TouchableOpacity>
      </View>

      {/* AI Config Section */}
      <View style={[localStyles.section, {padding: s.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
        <Text style={[localStyles.sectionTitle, {color: theme.mode === 'warm' ? theme.colors.textMuted : theme.colors.accent, fontSize: 11, marginBottom: s.sm, }]}>
          {theme.mode === 'warm' ? '🧠 AI 配置' : '// AI 配置'}
        </Text>

        <Text style={[localStyles.itemText, {color: theme.colors.text, marginBottom: s.sm}]}>
          {'AI 人格设定'}
        </Text>

        <View style={[localStyles.personalityOptions, {gap: s.sm}]}>
          {personalityOptions.map(option => (
            <TouchableOpacity
              key={option.key}
              style={{
                flex: 1,
                backgroundColor: aiPersonality === option.key
                  ? (theme.mode === 'neon' ? 'rgba(0, 245, 255, 0.15)' : theme.mode === 'warm' ? 'rgba(255, 112, 67, 0.15)' : 'rgba(201, 169, 98, 0.15)')
                  : theme.colors.bgSecondary,
                borderRadius: r.md,
                borderWidth: 1,
                borderColor: aiPersonality === option.key ? theme.colors.accent : theme.colors.border,
                paddingVertical: s.sm + 4,
                alignItems: 'center',
              }}
              onPress={() => setAiPersonality(option.key)}>
              <Text style={{
                fontSize: 20,
                color: aiPersonality === option.key ? theme.colors.accent : theme.mode === 'neon' ? theme.colors.text : theme.colors.textSecondary,
              }}>
                {getIcon(option)}
              </Text>
              <Text style={{
                color: aiPersonality === option.key ? theme.colors.accent : theme.mode === 'neon' ? theme.colors.text : theme.colors.textSecondary,
                fontSize: 12,
                fontWeight: aiPersonality === option.key ? '700' : '600',
                marginTop: 4,
              }}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Storage Section */}
      <View style={[localStyles.section, {padding: s.md, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
        <Text style={[localStyles.sectionTitle, {color: theme.mode === 'warm' ? theme.colors.textMuted : theme.colors.accent, fontSize: 11, marginBottom: s.sm, }]}>
          {theme.mode === 'warm' ? '🌾 存储空间' : '// 存储'}
        </Text>

        <View style={[localStyles.item, {paddingVertical: s.sm + 2}]}>
          <Text style={[localStyles.itemText, {color: theme.colors.text}]}>
            {'本地缓存'}
          </Text>
          <Text style={[localStyles.itemValue, {color: theme.colors.textSecondary}]}>1.2GB</Text>
        </View>

        {/* Storage Bar */}
        <View style={{marginVertical: s.sm}}>
          <View style={{height: 6, backgroundColor: theme.colors.border, borderRadius: 3, overflow: 'hidden'}}>
            <View style={{height: '100%', width: '12%', backgroundColor: theme.colors.accent, borderRadius: 3}} />
          </View>
          <Text style={{color: theme.colors.textMuted, fontSize: 11, marginTop: 4}}>
            1.2GB / 10GB
          </Text>
        </View>

        <View style={{flexDirection: 'row', gap: s.sm, marginTop: s.sm}}>
          <TouchableOpacity style={{
            flex: 1,
            backgroundColor: theme.colors.bgSecondary,
                        paddingVertical: s.sm + 2,
            borderRadius: r.sm,
            alignItems: 'center',
          }}>
            <Text style={{color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'none' as const}}>
              {'清除缓存'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={{
            flex: 1,
            backgroundColor: theme.colors.bgSecondary,
                        paddingVertical: s.sm + 2,
            borderRadius: r.sm,
            alignItems: 'center',
          }}>
            <Text style={{color: theme.colors.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'none' as const}}>
              {'导出数据'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* About Section */}
      <View style={[localStyles.section, {padding: s.md}]}>
        <Text style={[localStyles.sectionTitle, {color: theme.mode === 'warm' ? theme.colors.textMuted : theme.colors.accent, fontSize: 11, marginBottom: s.sm, }]}>
          {theme.mode === 'warm' ? 'ℹ️ 关于' : '// 关于'}
        </Text>

        <View style={[localStyles.item, {paddingVertical: s.sm + 2, borderBottomWidth: 1, borderBottomColor: theme.colors.border}]}>
          <Text style={[localStyles.itemText, {color: theme.colors.text}]}>
            {'版本信息'}
          </Text>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: s.sm}}>
            <Text style={[localStyles.itemValue, {color: theme.colors.textSecondary}]}>v0.1.0</Text>
            <TouchableOpacity style={{
              backgroundColor: theme.mode === 'neon' ? 'rgba(0, 245, 255, 0.15)' : theme.mode === 'warm' ? 'rgba(255, 112, 67, 0.15)' : theme.colors.bgSecondary,
              paddingHorizontal: s.sm,
              paddingVertical: 4,
              borderRadius: r.sm,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}>
              <Text style={{color: theme.colors.accent, fontSize: 11, fontWeight: '600'}}>
                {'检查更新'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={[localStyles.item, {paddingVertical: s.sm + 4}]}>
          <Text style={[localStyles.itemText, {color: theme.colors.text}]}>
            {'SDK 协议文档'}
          </Text>
          <Text style={[localStyles.itemArrow, {color: theme.colors.textMuted}]}>→</Text>
        </TouchableOpacity>
      </View>

      {/* Theme Name Footer */}
      <View style={{alignItems: 'center', paddingVertical: s.lg}}>
        <Text style={{color: theme.colors.textMuted, fontSize: 11}}>
          {theme.mode === 'neon' ? '◈ 未来科技主题' : theme.mode === 'warm' ? '🌅 温暖生活主题' : '◆ 经典主题'}
        </Text>
      </View>
    </ScrollView>
  );
}

const localStyles = StyleSheet.create({
  container: {},
  header: {},
  section: {},
  sectionTitle: {},
  item: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  itemText: {fontSize: 14},
  itemValue: {fontSize: 14},
  itemArrow: {fontSize: 16},
  personalityOptions: {flexDirection: 'row'},
});
