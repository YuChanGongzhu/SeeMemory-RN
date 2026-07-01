/**
 * 时间校准 —— 「一键校准」走真实 BLE syncTime()；设备当前时间无读取接口，
 * 用模拟串展示（校准成功后对齐到手机时间），手机时间为真实实时。
 */
import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Loader2} from 'lucide-react-native';
import {SubHeader, HW} from './parts';
import {useMr20} from '../../hooks/useMr20';

function fmtNow(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${p(d.getMonth() + 1)}月${p(d.getDate())}日 ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function TimeSync({onBack}: {onBack: () => void}) {
  const {syncTime} = useMr20();
  const [phoneTime, setPhoneTime] = useState(fmtNow(new Date()));
  // 设备时间初值用一个明显偏差的模拟串，校准后对齐手机时间。
  const [deviceTime, setDeviceTime] = useState('2023年08月12日 09:15:30');
  const [calibrating, setCalibrating] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    tick.current = setInterval(() => setPhoneTime(fmtNow(new Date())), 1000);
    return () => {
      if (tick.current) {
        clearInterval(tick.current);
      }
    };
  }, []);

  const calibrate = async () => {
    setCalibrating(true);
    try {
      await syncTime();
      setDeviceTime(fmtNow(new Date()));
      Alert.alert('时间校准成功');
    } catch (e) {
      Alert.alert('校准失败', String((e as Error)?.message || e));
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <View style={st.root}>
      <SubHeader title="时间校准" onBack={onBack} />
      <View style={st.body}>
        <View style={st.display}>
          <Text style={st.cap}>设备当前时间</Text>
          <Text style={st.deviceTime}>{deviceTime}</Text>
          <Text style={st.phoneTime}>手机当前时间: {phoneTime}</Text>
        </View>

        <TouchableOpacity
          activeOpacity={0.85}
          disabled={calibrating}
          onPress={calibrate}
          style={[st.btn, {backgroundColor: calibrating ? HW.textTertiary : HW.textMain}]}>
          {calibrating ? (
            <>
              <Loader2 size={20} color="#fff" />
              <ActivityIndicator color="#fff" />
              <Text style={st.btnText}>正在校准...</Text>
            </>
          ) : (
            <Text style={st.btnText}>一键校准时间</Text>
          )}
        </TouchableOpacity>

        <Text style={st.tip}>建议每月校准一次，保证录音时间准确</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: HW.pageBg},
  body: {padding: 20},
  display: {alignItems: 'center', paddingVertical: 32, gap: 8},
  cap: {fontSize: 14, fontWeight: '500', color: HW.textSub},
  deviceTime: {fontSize: 24, fontWeight: '700', color: HW.textMain, fontVariant: ['tabular-nums']},
  phoneTime: {fontSize: 13, color: HW.textSub, marginTop: 8, fontVariant: ['tabular-nums']},
  btn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 16},
  btnText: {color: '#fff', fontSize: 16, fontWeight: '600'},
  tip: {fontSize: 12, color: HW.textSub, textAlign: 'center', marginTop: 16},
});
