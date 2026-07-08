import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Alert} from 'react-native';
import {Check} from 'lucide-react-native';
import {colors, radius} from '../design/tokens';
import {BottomSheet} from './BottomSheet';
import {useAuth} from '../auth/AuthContext';
import {useNav} from '../navigation/nav';
import {ENV_META, getApiEnv, setApiEnvInMemory, type ApiEnv} from '../apis/core/env';
import {saveApiEnv} from '../services/storage';

const ENVS: ApiEnv[] = ['prod', 'test'];

/**
 * 后端环境切换面板（隐蔽 dev 入口，见 ProfilePage 连点版本号 7 次触发）。
 * 切换会持久化并强制重新登录——token 是环境相关的，prod token 在 test 无效。
 */
export function EnvSwitchSheet({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const {logout} = useAuth();
  const nav = useNav();
  const current = getApiEnv();

  const choose = (env: ApiEnv) => {
    if (env === current) {
      onClose();
      return;
    }
    const meta = ENV_META[env];
    Alert.alert(
      '切换后端环境',
      `切换到「${meta.label}」(${meta.host}) 需要重新登录，确定？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '切换并重登',
          style: 'destructive',
          onPress: async () => {
            await saveApiEnv(env);
            setApiEnvInMemory(env);
            onClose();
            nav.home();
            await logout();
          },
        },
      ],
    );
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="切换后端环境（开发）">
      <View style={{gap: 10}}>
        {ENVS.map(env => {
          const meta = ENV_META[env];
          const active = env === current;
          return (
            <TouchableOpacity
              key={env}
              activeOpacity={0.8}
              onPress={() => choose(env)}
              style={[styles.row, active && styles.rowActive]}>
              <View style={{flex: 1}}>
                <Text style={styles.label}>{meta.label}</Text>
                <Text style={styles.host}>{meta.host}</Text>
              </View>
              {active ? <Check size={20} color={colors.textMain} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={styles.hint}>切换后当前登录失效，会自动退回登录页重新登录。</Text>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: radius.lg,
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowActive: {borderColor: colors.textMain},
  label: {fontSize: 16, fontWeight: '700', color: colors.textMain},
  host: {fontSize: 12, color: colors.textSub, marginTop: 3},
  hint: {fontSize: 12, color: colors.textSub, textAlign: 'center', marginTop: 16},
});
