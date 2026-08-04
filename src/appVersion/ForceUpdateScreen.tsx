import React from 'react';
import {Linking, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {RefreshCw} from 'lucide-react-native';

/**
 * 强制更新全屏拦截：不用 Modal（避免硬件返回键能关掉），由 AppVersionGate 整棵子树替换渲染。
 * 无返回/关闭按钮，只有一个跳转更新的入口。
 */
export function ForceUpdateScreen({
  latestVersionName,
  releaseNotes,
  updateUrl,
}: {
  latestVersionName: string | null;
  releaseNotes: string | null;
  updateUrl: string | null;
}) {
  return (
    <View style={st.root}>
      <View style={st.orb}>
        <RefreshCw size={36} color="#fff" />
      </View>
      <Text style={st.title}>需要更新</Text>
      <Text style={st.sub}>
        {latestVersionName ? `新版本 ${latestVersionName} 已发布，` : ''}
        {releaseNotes || '请更新到最新版本后继续使用'}
      </Text>
      <TouchableOpacity
        style={st.btn}
        disabled={!updateUrl}
        onPress={() => updateUrl && Linking.openURL(updateUrl)}>
        <Text style={st.btnText}>立即更新</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', padding: 40},
  orb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {fontSize: 20, fontWeight: '600', color: '#fff'},
  sub: {fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', marginTop: 12},
  btn: {
    marginTop: 32,
    alignSelf: 'stretch',
    height: 50,
    borderRadius: 16,
    backgroundColor: '#0A84FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {color: '#fff', fontSize: 16, fontWeight: '500'},
});
