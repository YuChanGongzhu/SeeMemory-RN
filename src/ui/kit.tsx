import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  StyleProp,
  TextStyle,
  Image,
} from 'react-native';
import {colors, radius, shadow, type as T} from '../design/tokens';

/** Round icon button — prototype's 38–40px gray circle. */
export function IconButton({
  children,
  onPress,
  size = 40,
  bg = colors.bgSecondary,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  size?: number;
  bg?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      style={[
        {width: size, height: size, borderRadius: size / 2, backgroundColor: bg},
        styles.center,
        style,
      ]}>
      {children}
    </TouchableOpacity>
  );
}

/** White rounded card with the prototype's subtle border + layered shadow. */
export function Card({
  children,
  style,
  onPress,
  padding = 18,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padding?: number;
}) {
  const content = (
    <View
      style={[
        {
          backgroundColor: colors.bg,
          borderRadius: radius.card,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: 'rgba(0,0,0,0.04)',
          padding,
        },
        shadow.card,
        style,
      ]}>
      {children}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

/** Pill tag. variant 'solid' = black/white (mem-tag); 'soft' = gray (ai-badge). */
export function Tag({
  label,
  variant = 'solid',
  style,
}: {
  label: string;
  variant?: 'solid' | 'soft';
  style?: StyleProp<ViewStyle>;
}) {
  const solid = variant === 'solid';
  return (
    <View
      style={[
        {
          backgroundColor: solid ? colors.primary : colors.bgSecondary,
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: radius.pill,
          alignSelf: 'flex-start',
        },
        style,
      ]}>
      <Text style={{...(T.tag as TextStyle), color: solid ? colors.onDark : colors.textSub}}>{label}</Text>
    </View>
  );
}

/** Thin progress bar (算力 black / 存储 green / premium yellow). */
export function ProgressBar({
  value,
  total,
  color = colors.primary,
  height = 6,
}: {
  value: number;
  total: number;
  color?: string;
  height?: number;
}) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <View style={{height, borderRadius: height / 2, backgroundColor: colors.border, overflow: 'hidden'}}>
      <View style={{height, width: `${pct}%`, borderRadius: height / 2, backgroundColor: color}} />
    </View>
  );
}

/** Circular avatar; supports image source or initials fallback. */
export function Avatar({
  source,
  size = 48,
  fallback,
}: {
  source?: number | {uri: string};
  size?: number;
  fallback?: string;
}) {
  if (source) {
    return <Image source={source} style={{width: size, height: size, borderRadius: size / 2}} />;
  }
  return (
    <View
      style={[
        {width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bgSecondary},
        styles.center,
      ]}>
      <Text style={{color: colors.textSub, fontWeight: '700', fontSize: size * 0.34}}>
        {(fallback || '我').slice(0, 1)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {alignItems: 'center', justifyContent: 'center'},
});
