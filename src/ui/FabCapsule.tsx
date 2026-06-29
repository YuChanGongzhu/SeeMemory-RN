import React from 'react';
import {View, Text, TouchableOpacity, Image, StyleSheet} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Plus} from 'lucide-react-native';
import {colors, shadow} from '../design/tokens';
import {images} from '../design/assets';

/**
 * Home hub floating capsule (prototype App.jsx:2102-2134): dark translucent
 * pill with two entries — "AI 对话" (ip-star icon) and "记一笔" (plus).
 */
export function FabCapsule({onChat, onNote}: {onChat: () => void; onNote: () => void}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, {bottom: insets.bottom + 24}]} pointerEvents="box-none">
      <View style={[styles.capsule, shadow.fab]}>
        <TouchableOpacity activeOpacity={0.75} onPress={onChat} style={[styles.half, {paddingRight: 20, paddingLeft: 6}]}>
          <View style={styles.iconLight}>
            <Image source={images.ipStar} style={{width: 24, height: 24}} resizeMode="contain" />
          </View>
          <Text style={styles.label}>AI 对话</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity activeOpacity={0.75} onPress={onNote} style={[styles.half, {paddingRight: 20, paddingLeft: 14}]}>
          <View style={styles.iconDim}>
            <Plus size={20} color="#FFF" strokeWidth={2.5} />
          </View>
          <Text style={styles.label}>记一笔</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30,30,32,0.95)',
    borderRadius: 40,
    padding: 6,
  },
  half: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderRadius: 34,
  },
  iconLight: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDim: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {color: '#FFF', fontSize: 16, fontWeight: '600'},
  divider: {width: 1, height: 20, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 4},
});
