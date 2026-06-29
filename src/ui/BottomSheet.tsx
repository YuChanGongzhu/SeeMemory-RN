import React, {useEffect, useRef} from 'react';
import {Animated, Modal, Pressable, StyleSheet, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, radius, shadow} from '../design/tokens';

/** Bottom sheet: dim backdrop + slide-up rounded panel (prototype .bottom-sheet). */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const ty = useRef(new Animated.Value(400)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(ty, {toValue: 0, duration: 280, useNativeDriver: true}),
        Animated.timing(fade, {toValue: 1, duration: 280, useNativeDriver: true}),
      ]).start();
    } else {
      ty.setValue(400);
      fade.setValue(0);
    }
  }, [visible, ty, fade]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, {opacity: fade}]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          shadow.sheet,
          {paddingBottom: insets.bottom + 24, transform: [{translateY: ty}]},
        ]}>
        <View style={styles.grabber} />
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)'},
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  grabber: {alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 18},
  title: {fontSize: 16, fontWeight: '700', color: colors.textMain, textAlign: 'center', marginBottom: 24},
});
