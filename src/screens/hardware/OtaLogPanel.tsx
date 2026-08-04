/**
 * 【临时调试面板】OTA 过程日志。真机验证 OTA 期间用来看卡在哪一步、导出给固件同事。
 * 收敛后连同 src/services/otaLog.ts 一并删除。
 */
import React, {useEffect, useRef, useState} from 'react';
import {ScrollView, Share, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {
  OtaLogEntry,
  clearOtaLog,
  formatOtaLog,
  formatOtaTime,
  subscribeOtaLog,
} from '../../services/otaLog';

export function OtaLogPanel({dark = false}: {dark?: boolean}) {
  const [list, setList] = useState<OtaLogEntry[]>([]);
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => subscribeOtaLog(setList), []);

  // 追新：升级中日志持续追加，用户关注的是最后一条。
  useEffect(() => {
    if (open && list.length) {
      scrollRef.current?.scrollToEnd({animated: false});
    }
  }, [list, open]);

  const c = dark ? darkColors : lightColors;

  const exportLog = () => {
    const text = formatOtaLog(list);
    if (text) {
      Share.share({message: text}).catch(() => {});
    }
  };

  return (
    <View style={[st.wrap, {borderColor: c.border, backgroundColor: c.bg}]}>
      <View style={st.head}>
        <TouchableOpacity style={st.headMain} onPress={() => setOpen(v => !v)}>
          <Text style={[st.title, {color: c.title}]}>
            调试日志 {list.length ? `(${list.length})` : ''}
          </Text>
          <Text style={[st.toggle, {color: c.sub}]}>{open ? '收起' : '展开'}</Text>
        </TouchableOpacity>
        {open && list.length ? (
          <View style={st.actions}>
            <TouchableOpacity onPress={exportLog}>
              <Text style={[st.action, {color: c.action}]}>导出</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={clearOtaLog}>
              <Text style={[st.action, {color: c.sub}]}>清空</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      {open ? (
        list.length ? (
          <ScrollView ref={scrollRef} style={st.body} nestedScrollEnabled>
            {list.map((e, i) => (
              <Text key={`${e.t}-${i}`} style={st.line}>
                <Text style={[st.time, {color: c.sub}]}>{formatOtaTime(e.t)} </Text>
                <Text
                  style={{
                    color: e.level === 'error' ? c.error : e.level === 'warn' ? c.warn : c.text,
                  }}>
                  {e.msg}
                </Text>
              </Text>
            ))}
          </ScrollView>
        ) : (
          <Text style={[st.empty, {color: c.sub}]}>暂无日志，开始升级后这里会记录每一步</Text>
        )
      ) : null}
    </View>
  );
}

const lightColors = {
  bg: 'rgba(0,0,0,0.02)',
  border: 'rgba(0,0,0,0.08)',
  title: '#1C1C1E',
  sub: '#8E8E93',
  text: '#3A3A3C',
  action: '#007AFF',
  warn: '#B25000',
  error: '#D70015',
};

const darkColors = {
  bg: 'rgba(255,255,255,0.04)',
  border: 'rgba(255,255,255,0.12)',
  title: 'rgba(255,255,255,0.9)',
  sub: 'rgba(255,255,255,0.4)',
  text: 'rgba(255,255,255,0.75)',
  action: '#4C9AFF',
  warn: '#FFB020',
  error: '#FF6B6B',
};

const st = StyleSheet.create({
  wrap: {borderRadius: 12, borderWidth: 1, overflow: 'hidden'},
  head: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10},
  headMain: {flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8},
  title: {fontSize: 13, fontWeight: '600'},
  toggle: {fontSize: 12},
  actions: {flexDirection: 'row', gap: 16},
  action: {fontSize: 12, fontWeight: '500'},
  body: {maxHeight: 220, paddingHorizontal: 12, paddingBottom: 10},
  line: {fontSize: 11, lineHeight: 17, fontFamily: 'Menlo'},
  time: {fontVariant: ['tabular-nums']},
  empty: {fontSize: 12, paddingHorizontal: 12, paddingBottom: 12},
});
