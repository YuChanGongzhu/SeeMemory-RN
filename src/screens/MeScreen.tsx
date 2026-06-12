import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../theme/index';
import {GlassesIcon, RingIcon, ServerIcon, LockIcon, StarIcon, GridIcon, FamilyIcon} from '../components/Icons';
import {FadeUpView} from '../components/Animated';
import {NasPage} from '../components/NasPage';

type Device = {
  id: string;
  name: string;
  model: string;
  icon: React.ReactNode;
  connected: boolean;
  stats: string;
  battery: string;
  batteryColor: string;
  iconBg: string;
};

const mockDevices: Device[] = [
  {
    id: 'glasses',
    name: '拾光眼镜',
    model: 'Vision A1',
    icon: <GlassesIcon size={22} color="#3F8A82" />,
    connected: true,
    stats: '今天 23 帧',
    battery: '68%',
    batteryColor: '#7FA868',
    iconBg: '#DCEAE6',
  },
  {
    id: 'ring',
    name: '拾光戒指',
    model: 'Halo R1',
    icon: <RingIcon size={22} color="#7FA868" />,
    connected: true,
    stats: '今天收藏 5',
    battery: '84%',
    batteryColor: '#7FA868',
    iconBg: '#E8EEDD',
  },
];

export function MeScreen() {
  const {theme, themeMode, setThemeMode} = useTheme();
  const insets = useSafeAreaInsets();
  const s = theme.spacing;
  const r = theme.radius;

  const [autoRecord, setAutoRecord] = useState(true);
  const [heartRateMark, setHeartRateMark] = useState(true);
  const [nasOpen, setNasOpen] = useState(false);

  const handleThemeChange = () => {
    Alert.alert(
      '切换主题',
      '选择应用主题风格',
      [
        {text: '赛博霓虹', onPress: () => setThemeMode('neon')},
        {text: '日落暖阳', onPress: () => setThemeMode('warm')},
        {text: '拾光', onPress: () => setThemeMode('shiguang')},
        {text: '取消', style: 'cancel'},
      ],
    );
  };

  return (
    <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        style={localStyles.scrollView}
        contentContainerStyle={{paddingBottom: 100}}
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeUpView>
          <View style={[localStyles.header, {
            paddingTop: insets.top + s.md + 10,
            paddingHorizontal: s.lg,
            marginBottom: s.md,
          }]}>
            <View style={localStyles.profileRow}>
              <View style={[localStyles.avatar, {
                backgroundColor: 'linear-gradient(135deg, #A9CBB0, #3F8A82)',
              }]}>
                <Text style={{fontSize: 24, color: '#FFFFFF'}}>春</Text>
              </View>
              <View style={{flex: 1}}>
                <Text style={[localStyles.profileName, {color: theme.colors.text}]}>
                  春水初生
                </Text>
                <Text style={[localStyles.profileId, {color: theme.colors.textMuted, fontFamily: theme.fonts.mono}]}>
                  拾光号 7507888057
                </Text>
              </View>
              <TouchableOpacity style={[localStyles.settingsBtn, {
                borderColor: theme.colors.border,
                backgroundColor: theme.colors.bgCard,
              }]}>
                <GridIcon size={18} color="#7C8474" />
              </TouchableOpacity>
            </View>
          </View>
        </FadeUpView>

        {/* Devices Section */}
        <FadeUpView delay={100}>
          <View style={[localStyles.sectionTitleRow, {marginHorizontal: s.lg}]}>
            <Text style={[localStyles.sectionTitle, {color: theme.colors.textSecondary}]}>
              我的设备
            </Text>
          </View>
        </FadeUpView>

        <FadeUpView delay={150} style={[localStyles.devicesRow, {marginHorizontal: s.lg}]}>
          {mockDevices.map((device) => (
            <View key={device.id} style={[localStyles.deviceCard, {
              backgroundColor: theme.colors.bgCard,
              borderColor: theme.colors.border,
              borderRadius: r.lg,
              padding: s.sm + 7,
              flex: 1,
            }]}>
              <View style={localStyles.deviceHeader}>
                <View style={[localStyles.deviceIconWrap, {backgroundColor: device.iconBg}]}>
                  {device.icon}
                </View>
                <View style={[localStyles.deviceStatusDot, {
                  backgroundColor: device.connected ? '#7FA868' : '#9AA095',
                }]} />
              </View>
              <Text style={[localStyles.deviceName, {color: theme.colors.text}]}>
                {device.name}
              </Text>
              <Text style={[localStyles.deviceModel, {color: theme.colors.textMuted}]}>
                {device.model}
              </Text>
              <View style={[localStyles.deviceStatsRow, {
                borderTopColor: theme.colors.border,
                marginTop: 12,
                paddingTop: 11,
              }]}>
                <Text style={[localStyles.deviceStats, {color: theme.colors.textSecondary}]}>
                  {device.stats}
                </Text>
                <Text style={[localStyles.deviceBattery, {color: device.batteryColor}]}>
                  {device.battery}
                </Text>
              </View>
            </View>
          ))}
        </FadeUpView>

        {/* NAS Section */}
        <FadeUpView delay={200}>
          <TouchableOpacity
            style={[localStyles.nasCard, {
              backgroundColor: theme.colors.bgCard,
              borderColor: theme.colors.border,
              borderRadius: r.lg,
              padding: s.lg,
              marginHorizontal: s.lg,
              marginTop: s.md,
            }]}
            activeOpacity={0.7}
            onPress={() => setNasOpen(true)}>
            <View style={localStyles.nasHeader}>
              <View style={[localStyles.nasIconWrap, {backgroundColor: '#2F3A33'}]}>
                <ServerIcon size={24} color="#A9CBB0" />
              </View>
              <View style={{flex: 1}}>
                <Text style={[localStyles.nasTitle, {color: theme.colors.text}]}>
                  家庭记忆库 · NAS
                </Text>
                <Text style={[localStyles.nasModel, {color: theme.colors.textMuted}]}>
                  拾光 N2 · 局域网直连 已连接
                </Text>
              </View>
              <View style={[localStyles.nasStatusBadge, {backgroundColor: theme.colors.accent + '18'}]}>
                <Text style={[localStyles.nasStatusText, {color: theme.colors.accent}]}>
                  在线
                </Text>
              </View>
            </View>

            {/* Storage bar */}
            <View style={[localStyles.storageBar, {backgroundColor: theme.colors.bgSecondary}]}>
              <View style={[localStyles.storageFill, {
                width: '52%',
                backgroundColor: theme.colors.accent,
              }]} />
            </View>

            <View style={localStyles.storageInfo}>
              <Text style={[localStyles.storageUsed, {color: theme.colors.textSecondary}]}>
                已用 2.1 TB / 4 TB
              </Text>
              <Text style={[localStyles.storageAction, {color: theme.colors.accent}]}>
                今日已备份 23 段 · 管理 ›
              </Text>
            </View>
          </TouchableOpacity>
        </FadeUpView>

        {/* Settings List */}
        <FadeUpView delay={250}>
          <View style={[localStyles.settingsList, {
            backgroundColor: theme.colors.bgCard,
            borderColor: theme.colors.border,
            borderRadius: r.lg,
            marginHorizontal: s.lg,
            marginTop: s.md,
            paddingVertical: 6,
            paddingHorizontal: s.md,
          }]}>
            <View style={[localStyles.settingRow, {borderBottomColor: theme.colors.border}]}>
              <View style={{flex: 1}}>
                <Text style={[localStyles.settingTitle, {color: theme.colors.text}]}>
                  无感记录
                </Text>
                <Text style={[localStyles.settingDesc, {color: theme.colors.textMuted}]}>
                  眼镜自动留存值得记住的画面
                </Text>
              </View>
              <Switch
                value={autoRecord}
                onValueChange={setAutoRecord}
                trackColor={{false: '#D5D2C2', true: theme.colors.accent}}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={[localStyles.settingRow, {borderBottomColor: theme.colors.border}]}>
              <View style={{flex: 1}}>
                <Text style={[localStyles.settingTitle, {color: theme.colors.text}]}>
                  心率与心情标记
                </Text>
                <Text style={[localStyles.settingDesc, {color: theme.colors.textMuted}]}>
                  戒指为每个此刻附上当时的状态
                </Text>
              </View>
              <Switch
                value={heartRateMark}
                onValueChange={setHeartRateMark}
                trackColor={{false: '#D5D2C2', true: theme.colors.accent}}
                thumbColor="#FFFFFF"
              />
            </View>
          </View>
        </FadeUpView>

        {/* Invite family */}
        <FadeUpView delay={300}>
          <TouchableOpacity
            style={[localStyles.inviteCard, {
              backgroundColor: '#E8EEDD',
              borderColor: '#D8E2C9',
              borderRadius: r.lg,
              padding: s.sm + 7,
              marginHorizontal: s.lg,
              marginTop: s.md,
              flexDirection: 'row',
              alignItems: 'center',
            }]}
            activeOpacity={0.7}>
            <FamilyIcon size={26} color="#3F8A82" />
            <View style={{flex: 1, marginLeft: 13}}>
              <Text style={[localStyles.inviteTitle, {color: theme.colors.text}]}>
                邀请家人一起拾光
              </Text>
              <Text style={[localStyles.inviteDesc, {color: theme.colors.textSecondary}]}>
                碰一碰，把记忆汇进同一个记忆库
              </Text>
            </View>
            <Text style={[localStyles.inviteArrow, {color: theme.colors.accent}]}>›</Text>
          </TouchableOpacity>
        </FadeUpView>

        {/* More settings */}
        <FadeUpView delay={350}>
          <View style={[localStyles.moreSettings, {
            backgroundColor: theme.colors.bgCard,
            borderColor: theme.colors.border,
            borderRadius: r.lg,
            marginHorizontal: s.lg,
            marginTop: s.md,
            paddingVertical: 4,
            paddingHorizontal: s.md,
          }]}>
            <TouchableOpacity style={[localStyles.moreRow, {borderBottomColor: theme.colors.border}]}>
              <LockIcon size={19} color="#7C8474" />
              <Text style={[localStyles.moreText, {color: theme.colors.text, flex: 1}]}>
                隐私与同步
              </Text>
              <Text style={[localStyles.moreArrow, {color: theme.colors.textMuted}]}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={localStyles.moreRow}>
              <StarIcon size={19} color="#7C8474" />
              <Text style={[localStyles.moreText, {color: theme.colors.text, flex: 1}]}>
                AI 授权管理
              </Text>
              <Text style={[localStyles.moreMeta, {color: theme.colors.textMuted}]}>
                阿里云百炼 · Qwen
              </Text>
            </TouchableOpacity>
          </View>
        </FadeUpView>

        {/* Theme switcher (for demo) */}
        <FadeUpView delay={400}>
          <TouchableOpacity
            style={[localStyles.themeSwitcher, {
              marginHorizontal: s.lg,
              marginTop: s.md,
            }]}
            onPress={handleThemeChange}>
            <Text style={[localStyles.themeSwitcherText, {color: theme.colors.accent}]}>
              当前主题: {theme.name} (点击切换)
            </Text>
          </TouchableOpacity>
        </FadeUpView>
      </ScrollView>

      <NasPage visible={nasOpen} onClose={() => setNasOpen(false)} />
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  scrollView: {flex: 1},
  header: {},
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileName: {
    fontSize: 21,
    fontWeight: '700',
  },
  profileId: {
    fontSize: 12,
    marginTop: 3,
  },
  settingsBtn: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 8,
  },
  sectionTitleRow: {
    marginBottom: 11,
    marginHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  devicesRow: {
    flexDirection: 'row',
    gap: 11,
    marginBottom: 11,
  },
  deviceCard: {
    borderWidth: 1,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 11,
  },
  deviceIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deviceStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  deviceName: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  deviceModel: {
    fontSize: 11,
    marginTop: 1,
  },
  deviceStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
  },
  deviceStats: {
    fontSize: 11.5,
  },
  deviceBattery: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  nasCard: {
    borderWidth: 1,
  },
  nasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  nasIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nasTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  nasModel: {
    fontSize: 11.5,
    marginTop: 2,
  },
  nasStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  nasStatusText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  storageBar: {
    height: 8,
    borderRadius: 5,
    marginTop: 18,
    overflow: 'hidden',
  },
  storageFill: {
    height: '100%',
    borderRadius: 5,
  },
  storageInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  storageUsed: {
    fontSize: 11.5,
  },
  storageAction: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  settingsList: {
    borderWidth: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  settingTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  settingDesc: {
    fontSize: 11.5,
    marginTop: 2,
  },
  inviteCard: {
    borderWidth: 1,
  },
  inviteTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  inviteDesc: {
    fontSize: 11.5,
    marginTop: 2,
  },
  inviteArrow: {
    fontSize: 18,
  },
  moreSettings: {
    borderWidth: 1,
  },
  moreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  moreText: {
    fontSize: 14,
  },
  moreArrow: {
    fontSize: 17,
  },
  moreMeta: {
    fontSize: 11,
  },
  themeSwitcher: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  themeSwitcherText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
