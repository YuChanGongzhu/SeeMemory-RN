import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';

/**
 * 开发期协议调试面板：展示 Mr20Client 收发的原始 GJJY 帧。
 * 用于在真机上敲定协议未写明的分帧/粘包细节。
 */
export function Mr20DebugLog({logs}: {logs: string[]}) {
  const {theme} = useTheme();
  const c = theme.colors;
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.toggle, {borderColor: c.border}]}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.7}>
        <Text style={[styles.toggleText, {color: c.textMuted}]}>
          协议调试日志 ({logs.length}) {open ? '▾' : '▸'}
        </Text>
      </TouchableOpacity>
      {open ? (
        <ScrollView
          style={[styles.box, {backgroundColor: '#11140F', borderColor: c.border}]}
          nestedScrollEnabled>
          {logs.length === 0 ? (
            <Text style={styles.empty}>暂无收发记录</Text>
          ) : (
            logs.map((line, i) => (
              <Text
                key={i}
                style={[
                  styles.line,
                  {color: line.startsWith('=>') ? '#7FD0C6' : '#C9D2C5'},
                ]}>
                {line}
              </Text>
            ))
          )}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginTop: 16},
  toggle: {borderWidth: 1, borderRadius: 12, paddingVertical: 9, alignItems: 'center'},
  toggleText: {fontSize: 12, fontWeight: '600'},
  box: {
    maxHeight: 220,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
  },
  empty: {color: '#6B7363', fontSize: 12},
  line: {
    fontSize: 10.5,
    fontFamily: 'Menlo',
    lineHeight: 15,
  },
});
