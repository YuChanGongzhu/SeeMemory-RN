import React, {useState} from 'react';
import {View, StyleSheet} from 'react-native';
import Svg, {Defs, LinearGradient as SvgGradient, Stop, Rect} from 'react-native-svg';

/**
 * Absolute-fill diagonal gradient backdrop (RN has no CSS gradients).
 * Measures its own layout so the gradient covers the full (auto-height)
 * parent — percentage-sized SVG underfills auto-height views. Defaults to the
 * prototype's dark "system card" gradient #1C1C1E → #2C2C2E. Pair with a solid
 * dark `backgroundColor` on the parent as a paint-safe fallback.
 */
export function GradientBg({
  from = '#1C1C1E',
  to = '#2C2C2E',
  radius = 0,
}: {
  from?: string;
  to?: string;
  radius?: number;
}) {
  const [size, setSize] = useState({w: 0, h: 0});
  return (
    <View
      style={StyleSheet.absoluteFill}
      onLayout={e => {
        const {width, height} = e.nativeEvent.layout;
        if (width !== size.w || height !== size.h) setSize({w: width, h: height});
      }}>
      {size.w > 0 && size.h > 0 ? (
        <Svg width={size.w} height={size.h}>
          <Defs>
            <SvgGradient id="grad" x1="0" y1="0" x2={size.w} y2={size.h} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </SvgGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} rx={radius} ry={radius} fill="url(#grad)" />
        </Svg>
      ) : null}
    </View>
  );
}
