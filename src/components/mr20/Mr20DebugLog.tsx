import React, {useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity, ScrollView} from 'react-native';

/**
 * 开发期协议调试面板：展示 Mr20Client 收发的原始 GJJY 帧。
 * 用于在真机上敲定协议未写明的分帧/粘包细节。
 * 注意：不依赖 ThemeProvider（硬件页子树未套 ThemeProvider），颜色写死。
 */
/**
 * 把 `Mr20Client.log()` 加的 `[17:09:23.412 +1.24s]` 前缀拆出来单独调暗。
 *
 * 拆而不是直接整行上色，是因为方向色（`=>` 发出 / `<=` 收到）判的是**正文开头**——
 * 前缀一加，`startsWith('=>')` 就永远为 false，所有行会退成同一个颜色。
 * 而且时间戳每行都占 22 个字符，和正文同色的话会把真正要看的帧内容淹掉。
 */
export function splitStamp(line: string): {stamp: string; body: string} {
  const m = /^(\[\d{2}:\d{2}:\d{2}\.\d{3} \+[\d.]+s\])\s(.*)$/s.exec(line);
  return m ? {stamp: m[1], body: m[2]} : {stamp: '', body: line};
}

export function Mr20DebugLog({logs}: {logs: string[]}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={[styles.toggle, {borderColor: '#E5E5EA'}]}
        onPress={() => setOpen(o => !o)}
        activeOpacity={0.7}>
        <Text style={[styles.toggleText, {color: '#8E8E93'}]}>
          协议调试日志 ({logs.length}) {open ? '▾' : '▸'}
        </Text>
      </TouchableOpacity>
      {open ? (
        <ScrollView
          style={[styles.box, {backgroundColor: '#11140F', borderColor: '#E5E5EA'}]}
          nestedScrollEnabled>
          {logs.length === 0 ? (
            <Text style={styles.empty}>暂无收发记录</Text>
          ) : (
            logs.map((line, i) => {
              const {stamp, body} = splitStamp(line);
              return (
                <Text key={i} style={styles.line}>
                  {stamp ? <Text style={styles.stamp}>{stamp} </Text> : null}
                  <Text style={{color: body.startsWith('=>') ? '#7FD0C6' : '#C9D2C5'}}>
                    {body}
                  </Text>
                </Text>
              );
            })
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
  stamp: {color: '#5F6B5C'},
});
