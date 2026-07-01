/** 设备设置 —— 子页入口菜单：WiFi管理 / 时间校准 / 录音模式 / 系统更新 / 关于设备。 */
import React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Clock, Cloud, Info, Mic, Wifi} from 'lucide-react-native';
import {SubHeader, Card, MenuRow, HW, type HwSubPage} from './parts';
import {useMr20} from '../../hooks/useMr20';

export function DeviceSettings({
  onBack,
  onNavigate,
}: {
  onBack: () => void;
  onNavigate: (sub: HwSubPage) => void;
}) {
  const {status} = useMr20();
  const modeLabel = status.recMode === 'call' ? '通话模式' : '对话模式';

  return (
    <View style={st.root}>
      <SubHeader title="设备设置" onBack={onBack} />
      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <Card>
          <MenuRow
            icon={<Wifi size={20} color={HW.textMain} />}
            label="WiFi 管理"
            onPress={() => onNavigate('wifi')}
          />
          <MenuRow
            icon={<Clock size={20} color={HW.textMain} />}
            label="时间校准"
            onPress={() => onNavigate('time')}
          />
          <MenuRow
            icon={<Mic size={20} color={HW.textMain} />}
            label="录音模式说明"
            value={modeLabel}
            onPress={() => onNavigate('recordMode')}
          />
          <MenuRow
            icon={<Cloud size={20} color={HW.textMain} />}
            label="系统更新"
            value={status.firmware || 'V1.0'}
            onPress={() => onNavigate('ota')}
          />
          <MenuRow
            icon={<Info size={20} color={HW.textMain} />}
            label="关于设备"
            onPress={() => onNavigate('about')}
            last
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20},
});
