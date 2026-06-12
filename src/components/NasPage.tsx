import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  StyleSheet,
  Modal,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {BackIcon, ServerIcon} from './Icons';
import {FadeUpView} from './Animated';

type NasPageProps = {
  visible: boolean;
  onClose: () => void;
};

export function NasPage({visible, onClose}: NasPageProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [autoBackup, setAutoBackup] = useState(true);
  const [localOnly, setLocalOnly] = useState(true);
  const [e2e, setE2e] = useState(true);
  const s = theme.spacing;
  const r = theme.radius;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[localStyles.container, {backgroundColor: '#F3F1E9'}]}>
        {/* Header */}
        <View style={[localStyles.header, {
          paddingTop: insets.top + 4,
          paddingHorizontal: 18,
        }]}>
          <TouchableOpacity
            style={[localStyles.backBtn, {
              backgroundColor: '#FFFFFF',
              borderColor: '#E6E1D2',
            }]}
            onPress={onClose}>
            <BackIcon size={20} color="#28302C" />
          </TouchableOpacity>
          <Text style={[localStyles.headerTitle, {color: '#28302C'}]}>记忆库 · NAS</Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView contentContainerStyle={[localStyles.content, {paddingHorizontal: s.lg, paddingBottom: 30}]}>
          <FadeUpView>
            {/* NAS Card */}
            <View style={[localStyles.nasCard, {
              backgroundColor: '#2F3A33',
              borderRadius: r.xl,
              padding: 20,
            }]}>
              <View style={localStyles.nasHeader}>
                <View style={[localStyles.nasIconWrap, {backgroundColor: 'rgba(169, 203, 176, 0.18)'}]}>
                  <ServerIcon size={26} color="#A9CBB0" />
                </View>
                <View style={{flex: 1}}>
                  <Text style={[localStyles.nasTitle, {color: '#EFEAD9'}]}>家庭记忆库</Text>
                  <Text style={[localStyles.nasModel, {color: '#A9B0A1', fontFamily: theme.fonts.mono}]}>
                    拾光 N2 · 192.168.1.36
                  </Text>
                </View>
                <View style={[localStyles.nasStatusBadge, {backgroundColor: '#A9CBB0'}]}>
                  <Text style={[localStyles.nasStatusText, {color: '#13170F'}]}>局域网直连</Text>
                </View>
              </View>

              {/* Storage bar */}
              <View style={[localStyles.storageBar, {backgroundColor: 'rgba(255,255,255,0.12)'}]}>
                <View style={[localStyles.storageFill, {width: '52%'}]} />
              </View>
              <View style={localStyles.storageInfo}>
                <Text style={[localStyles.storageText, {color: '#C3C8BB'}]}>已用 2.1 TB</Text>
                <Text style={[localStyles.storageText, {color: '#C3C8BB'}]}>共 4 TB</Text>
              </View>

              {/* Stats */}
              <View style={localStyles.statsRow}>
                <View style={[localStyles.statItem, {backgroundColor: 'rgba(255,255,255,0.06)'}]}>
                  <Text style={[localStyles.statLabel, {color: '#A9B0A1'}]}>照片</Text>
                  <Text style={[localStyles.statValue, {color: '#EFEAD9'}]}>12,480</Text>
                </View>
                <View style={[localStyles.statItem, {backgroundColor: 'rgba(255,255,255,0.06)'}]}>
                  <Text style={[localStyles.statLabel, {color: '#A9B0A1'}]}>视频</Text>
                  <Text style={[localStyles.statValue, {color: '#EFEAD9'}]}>1,206</Text>
                </View>
                <View style={[localStyles.statItem, {backgroundColor: 'rgba(255,255,255,0.06)'}]}>
                  <Text style={[localStyles.statLabel, {color: '#A9B0A1'}]}>录音</Text>
                  <Text style={[localStyles.statValue, {color: '#EFEAD9'}]}>834</Text>
                </View>
              </View>
            </View>

            {/* Privacy tip */}
            <View style={[localStyles.tipCard, {
              backgroundColor: '#E8EEDD',
              borderColor: '#D8E2C9',
              borderRadius: r.md + 2,
              padding: 13,
              paddingLeft: 15,
              marginTop: 16,
              marginBottom: 16,
            }]}>
              <Text style={[localStyles.tipText, {color: '#3C4B36'}]}>
                原始的照片、视频、录音都存在你自己的 NAS 里；云端只保留索引和摘要。
              </Text>
            </View>

            {/* Settings */}
            <View style={[localStyles.settingsCard, {
              backgroundColor: '#FFFFFF',
              borderColor: '#EAE5D7',
              borderRadius: r.lg,
              paddingVertical: 6,
              paddingHorizontal: 16,
            }]}>
              <View style={[localStyles.settingRow, {borderBottomColor: '#F0EDE2'}]}>
                <View style={{flex: 1}}>
                  <Text style={[localStyles.settingTitle, {color: '#28302C'}]}>自动备份</Text>
                  <Text style={[localStyles.settingDesc, {color: '#9AA095'}]}>眼镜 / 戒指 / 手机的记忆自动入库</Text>
                </View>
                <Switch value={autoBackup} onValueChange={setAutoBackup} trackColor={{false: '#D5D2C2', true: '#3F8A82'}} thumbColor="#FFFFFF" />
              </View>
              <View style={[localStyles.settingRow, {borderBottomColor: '#F0EDE2'}]}>
                <View style={{flex: 1}}>
                  <Text style={[localStyles.settingTitle, {color: '#28302C'}]}>仅家庭网络上传</Text>
                  <Text style={[localStyles.settingDesc, {color: '#9AA095'}]}>外出时缓存，回家自动同步</Text>
                </View>
                <Switch value={localOnly} onValueChange={setLocalOnly} trackColor={{false: '#D5D2C2', true: '#3F8A82'}} thumbColor="#FFFFFF" />
              </View>
              <View style={localStyles.settingRow}>
                <View style={{flex: 1}}>
                  <Text style={[localStyles.settingTitle, {color: '#28302C'}]}>端到端加密</Text>
                  <Text style={[localStyles.settingDesc, {color: '#9AA095'}]}>只有你和家人能解开这些记忆</Text>
                </View>
                <Switch value={e2e} onValueChange={setE2e} trackColor={{false: '#D5D2C2', true: '#3F8A82'}} thumbColor="#FFFFFF" />
              </View>
            </View>

            {/* Family access */}
            <View style={[localStyles.familyCard, {
              backgroundColor: '#FFFFFF',
              borderColor: '#EAE5D7',
              borderRadius: r.lg,
              padding: 15,
              marginTop: 16,
            }]}>
              <View style={localStyles.familyHeader}>
                <View>
                  <Text style={[localStyles.familyTitle, {color: '#28302C'}]}>家庭成员访问</Text>
                  <Text style={[localStyles.familyDesc, {color: '#9AA095'}]}>3 人可读写 · 1 人只读</Text>
                </View>
                <View style={localStyles.avatarRow}>
                  <View style={[localStyles.avatar, {backgroundColor: '#A9CBB0'}]} />
                  <View style={[localStyles.avatar, {backgroundColor: '#F0C98B', marginLeft: -10}]} />
                  <View style={[localStyles.avatar, {backgroundColor: '#B6C9D6', marginLeft: -10}]} />
                  <View style={[localStyles.avatar, {backgroundColor: '#EEF0E8', marginLeft: -10}]}>
                    <Text style={{color: '#3F8A82', fontSize: 15, fontWeight: '700'}}>+</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Unbind button */}
            <TouchableOpacity style={[localStyles.unbindBtn, {
              borderColor: '#E7D2CB',
              borderRadius: r.lg,
              marginTop: 16,
            }]}>
              <Text style={[localStyles.unbindText, {color: '#C0584A'}]}>解绑此设备</Text>
            </TouchableOpacity>
          </FadeUpView>
        </ScrollView>
      </View>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {paddingTop: 10},
  nasCard: {},
  nasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  nasIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nasTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  nasModel: {
    fontSize: 11.5,
    marginTop: 2,
  },
  nasStatusBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  nasStatusText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  storageBar: {
    height: 9,
    borderRadius: 6,
    marginTop: 18,
    overflow: 'hidden',
  },
  storageFill: {
    height: '100%',
    borderRadius: 6,
    backgroundColor: '#A9CBB0',
  },
  storageInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 9,
  },
  storageText: {
    fontSize: 11.5,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  statItem: {
    flex: 1,
    borderRadius: 12,
    padding: 10,
  },
  statLabel: {
    fontSize: 10.5,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 3,
  },
  tipCard: {
    borderWidth: 1,
  },
  tipText: {
    fontSize: 12.5,
    lineHeight: 20,
  },
  settingsCard: {
    borderWidth: 1,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
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
  familyCard: {
    borderWidth: 1,
  },
  familyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  familyTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  familyDesc: {
    fontSize: 11.5,
    marginTop: 2,
  },
  avatarRow: {
    flexDirection: 'row',
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unbindBtn: {
    borderWidth: 1,
    padding: 15,
    alignItems: 'center',
  },
  unbindText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
