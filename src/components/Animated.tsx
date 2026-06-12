import React, {useEffect} from 'react';
import {View, StyleSheet} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  interpolate,
  Easing,
  withSequence,
  FadeIn,
  FadeInUp,
  ZoomIn,
} from 'react-native-reanimated';

// ========== 光球脉动动画 ==========
type OrbProps = {
  size?: number;
  colors?: [string, string];
  glowColor?: string;
  style?: any;
};

export function AnimatedOrb({size = 42, colors = ['#F7E0AB', '#E3A94F'], glowColor = 'rgba(242, 204, 131, 0.75)', style}: OrbProps) {
  const scale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.34);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.05, {duration: 1900, easing: Easing.inOut(Easing.ease)}),
      -1,
      true,
    );
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0, {duration: 1900, easing: Easing.inOut(Easing.ease)}),
        withTiming(0.34, {duration: 1900, easing: Easing.inOut(Easing.ease)}),
      ),
      -1,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{scale: scale.value}],
    shadowOpacity: glowOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        localStyles.orb,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          shadowColor: glowColor,
        },
        animatedStyle,
        style,
      ]}>
      <View
        style={[
          localStyles.orbInner,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors[0],
          },
        ]}
      />
    </Animated.View>
  );
}

// ========== 微光扫描动画 ==========
type ShimmerProps = {
  style?: any;
};

export function ShimmerEffect({style}: ShimmerProps) {
  const translateX = useSharedValue(-200);

  useEffect(() => {
    translateX.value = withRepeat(
      withTiming(400, {duration: 3600, easing: Easing.linear}),
      -1,
      false,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{translateX: translateX.value}],
  }));

  return (
    <Animated.View style={[localStyles.shimmerContainer, style]}>
      <Animated.View style={[localStyles.shimmer, animatedStyle]} />
    </Animated.View>
  );
}

// ========== 上滑淡入动画 ==========
type FadeUpProps = {
  children: React.ReactNode;
  delay?: number;
  style?: any;
};

export function FadeUpView({children, delay = 0, style}: FadeUpProps) {
  return (
    <Animated.View
      entering={FadeInUp.delay(delay).duration(400).easing(Easing.out(Easing.ease))}
      style={style}>
      {children}
    </Animated.View>
  );
}

// ========== 气泡弹入动画 ==========
type BubbleInProps = {
  children: React.ReactNode;
  delay?: number;
  style?: any;
};

export function BubbleInView({children, delay = 0, style}: BubbleInProps) {
  return (
    <Animated.View
      entering={FadeInUp.delay(delay).duration(300).easing(Easing.out(Easing.ease))}
      style={style}>
      {children}
    </Animated.View>
  );
}

// ========== 录音波形动画 ==========
type WaveformProps = {
  barCount?: number;
  color?: string;
  height?: number;
  style?: any;
};

export function AnimatedWaveform({barCount = 28, color = '#3F8A82', height = 44, style}: WaveformProps) {
  return (
    <View style={[localStyles.waveform, {height}, style]}>
      {Array.from({length: barCount}).map((_, i) => (
        <WaveBar key={i} index={i} color={color} />
      ))}
    </View>
  );
}

function WaveBar({index, color}: {index: number; color: string}) {
  const height = useSharedValue(8);
  const baseHeight = 8 + Math.abs(Math.sin(index * 1.3)) * 30 + (index % 3) * 4;

  useEffect(() => {
    height.value = withRepeat(
      withSequence(
        withTiming(baseHeight, {
          duration: 700 + (index % 5) * 120,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(8, {
          duration: 700 + (index % 5) * 120,
          easing: Easing.inOut(Easing.ease),
        }),
      ),
      -1,
      false,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return (
    <Animated.View
      style={[
        localStyles.waveBar,
        {backgroundColor: color, width: 3, borderRadius: 3},
        animatedStyle,
      ]}
    />
  );
}

// ========== 录制点闪烁 ==========
type RecDotProps = {
  size?: number;
  color?: string;
  style?: any;
};

export function RecDot({size = 9, color = '#3F8A82', style}: RecDotProps) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(0.2, {duration: 1100, easing: Easing.inOut(Easing.ease)}),
      -1,
      true,
    );
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

const localStyles = StyleSheet.create({
  orb: {
    shadowOffset: {width: 0, height: 6},
    shadowRadius: 16,
    elevation: 8,
  },
  orbInner: {},
  shimmerContainer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    borderRadius: 24,
  },
  shimmer: {
    width: 180,
    height: '100%',
    backgroundColor: 'linear-gradient(110deg, transparent 30%, rgba(214, 231, 210, 0.5) 50%, transparent 70%)',
    opacity: 0.5,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  waveBar: {},
});
