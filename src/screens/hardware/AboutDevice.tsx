/**
 * 关于设备 —— 型号/系统版本/WiFi 模块版本/蓝牙地址来自真实 status（WF 读 WiFi 版本）；
 * 设备名仅本机生效（本地存储）。底部协议/隐私/帮助入口。
 */
import React, {useState} from 'react';
import {Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Edit2} from 'lucide-react-native';
import {SubHeader, Card, MenuRow, InfoRow, IosAlert, ModalInput, HW} from './parts';
import {PRIVACY_POLICY_URL} from '../../config/legal';
import {useMr20} from '../../hooks/useMr20';

export function AboutDevice({
  onBack,
  deviceName,
  onRename,
  onHelp,
}: {
  onBack: () => void;
  deviceName: string;
  onRename: (name: string) => void;
  onHelp: () => void;
}) {
  const {status} = useMr20();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const save = () => {
    const v = draft.trim();
    if (v) {
      onRename(v);
    }
    setEditOpen(false);
  };

  return (
    <View style={st.root}>
      <SubHeader title="关于设备" onBack={onBack} />
      <ScrollView contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
        <TouchableOpacity
          activeOpacity={0.7}
          style={st.nameRow}
          onPress={() => {
            setDraft(deviceName);
            setEditOpen(true);
          }}>
          <Text style={st.name}>{deviceName}</Text>
          <Edit2 size={18} color={HW.textSub} />
        </TouchableOpacity>

        <Card style={{marginBottom: 16}}>
          <InfoRow label="设备型号" value="MR20 记忆粒" />
          <InfoRow label="系统版本" value={status.firmware || 'V1.0'} />
          <InfoRow label="WiFi 模块版本" value={status.wifiVersion || '—'} />
          <InfoRow label="蓝牙地址" value={status.mac || '—'} last />
        </Card>

        <Card>
          <MenuRow label="隐私政策" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />
          <MenuRow label="帮助与反馈" onPress={onHelp} last />
        </Card>
      </ScrollView>

      <IosAlert
        visible={editOpen}
        onClose={() => setEditOpen(false)}
        title="修改设备名称"
        message="此名称仅在本手机生效，用于区分多台设备。"
        buttons={[
          {text: '取消', onPress: () => setEditOpen(false)},
          {text: '保存', bold: true, onPress: save},
        ]}>
        <View style={{width: '100%', marginTop: 12}}>
          <ModalInput value={draft} onChangeText={setDraft} placeholder="请输入设备名称" maxLength={20} />
        </View>
      </IosAlert>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20},
  nameRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, marginBottom: 8},
  name: {fontSize: 24, fontWeight: '700', color: HW.textMain},
});
