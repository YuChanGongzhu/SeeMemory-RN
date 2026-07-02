/**
 * 记忆粒设备子页共享构件 —— 忠实还原 app-prototype 的 iOS 风样式。
 * 头部 / 设置行 / 信息行 / 开关 / iOS 居中弹窗（提示 + 输入）。
 */
import React, {useEffect, useRef} from 'react';
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ChevronLeft, ChevronRight} from 'lucide-react-native';

/** 设备页内部子页（原型用 activeSubPage 状态机切页，非独立路由）。 */
export type HwSubPage =
  | 'main'
  | 'settings'
  | 'wifi'
  | 'deviceFiles'
  | 'time'
  | 'recordMode'
  | 'ota'
  | 'about'
  | 'help';

// 原型专用色（多为 iOS 系统色，tokens 未全部收录，按原型 inline 值落实）
export const HW = {
  pageBg: '#F9F9FB',
  card: '#FFFFFF',
  textMain: '#1A1A1A',
  textSub: '#8E8E93',
  textTertiary: '#C7C7CC',
  textBody: '#636366',
  blue: '#0A84FF',
  green: '#34C759',
  red: '#FF3B30',
  fill: '#F2F2F7',
  divider: 'rgba(0,0,0,0.05)',
  cardBorder: 'rgba(0,0,0,0.03)',
  modalDivider: 'rgba(60,60,67,0.36)',
  inputFill: 'rgba(118,118,128,0.12)',
} as const;

/** 子页顶部栏：返回 + 居中标题 +（可选）右侧动作。磨砂底近似为半透明实色。 */
export function SubHeader({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[hs.header, {paddingTop: insets.top + 10}]}>
      <TouchableOpacity onPress={onBack} hitSlop={{top: 10, bottom: 10, left: 10, right: 10}} style={hs.back}>
        <ChevronLeft size={26} color={HW.textMain} />
      </TouchableOpacity>
      <Text style={hs.title} numberOfLines={1}>{title}</Text>
      <View style={hs.right}>{right ?? <View style={{width: 26}} />}</View>
    </View>
  );
}

/** 白卡容器（圆角 20 + 细边）。 */
export function Card({children, style}: {children: React.ReactNode; style?: object}) {
  return <View style={[hs.cardBox, style]}>{children}</View>;
}

/** 可点击的设置/菜单行：左图标 + 标题 +（可选右侧内容）+ 箭头。 */
export function MenuRow({
  icon,
  label,
  value,
  onPress,
  last,
  dotColor,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  onPress?: () => void;
  last?: boolean;
  dotColor?: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.6 : 1}
      onPress={onPress}
      style={[hs.row, !last && hs.rowBorder]}>
      {icon ? <View style={hs.rowIcon}>{icon}</View> : null}
      <Text style={hs.rowLabel}>{label}</Text>
      <View style={hs.rowRight}>
        {typeof value === 'string' ? <Text style={hs.rowValue}>{value}</Text> : value}
        {dotColor ? <View style={[hs.dot, {backgroundColor: dotColor}]} /> : null}
        {onPress ? <ChevronRight size={20} color={HW.textTertiary} /> : null}
      </View>
    </TouchableOpacity>
  );
}

/** 纯信息行（左标签 + 右值，无箭头）。 */
export function InfoRow({label, value, last}: {label: string; value: string; last?: boolean}) {
  return (
    <View style={[hs.row, !last && hs.rowBorder]}>
      <Text style={hs.rowLabel}>{label}</Text>
      <Text style={hs.rowValue}>{value}</Text>
    </View>
  );
}

/** iOS 开关（受控）。 */
export function Toggle({on, onToggle, disabled}: {on: boolean; onToggle: () => void; disabled?: boolean}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled}
      onPress={onToggle}
      style={[hs.toggle, {backgroundColor: on ? HW.green : '#E5E5EA', opacity: disabled ? 0.6 : 1}]}>
      <View style={[hs.knob, {left: on ? 22 : 2}]} />
    </TouchableOpacity>
  );
}

interface AlertButton {
  text: string;
  onPress?: () => void;
  danger?: boolean;
  bold?: boolean;
}

/** iOS 居中弹窗（标题 + 说明 + 两按钮 + 可选自定义内容/图标）。 */
export function IosAlert({
  visible,
  onClose,
  title,
  message,
  buttons,
  titleColor,
  icon,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message?: string;
  buttons: AlertButton[];
  titleColor?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const scale = useRef(new Animated.Value(0.9)).current;
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scale, {toValue: 1, useNativeDriver: true, friction: 8, tension: 120}),
        Animated.timing(fade, {toValue: 1, duration: 160, useNativeDriver: true}),
      ]).start();
    } else {
      scale.setValue(0.9);
      fade.setValue(0);
    }
  }, [visible, scale, fade]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={hs.modalWrap}>
        <Animated.View style={[StyleSheet.absoluteFill, hs.backdrop, {opacity: fade}]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View style={[hs.alertCard, {opacity: fade, transform: [{scale}]}]}>
          <View style={hs.alertBody}>
            {icon ? <View style={{marginBottom: 4}}>{icon}</View> : null}
            <Text style={[hs.alertTitle, titleColor ? {color: titleColor} : null]}>{title}</Text>
            {message ? <Text style={hs.alertMsg}>{message}</Text> : null}
            {children}
          </View>
          <View style={hs.alertBtnRow}>
            {buttons.map((b, i) => (
              <TouchableOpacity
                key={b.text}
                style={[hs.alertBtn, i < buttons.length - 1 && hs.alertBtnBorder]}
                onPress={() => {
                  b.onPress?.();
                }}>
                <Text
                  style={[
                    hs.alertBtnText,
                    b.bold && {fontWeight: '600'},
                    b.danger && {color: HW.red},
                  ]}>
                  {b.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/** 弹窗内输入框（用于改 WiFi / 设备名）。 */
export function ModalInput(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={HW.textSub}
      {...props}
      style={[hs.modalInput, props.style]}
    />
  );
}

const hs = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 14,
    backgroundColor: 'rgba(249,249,251,0.95)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HW.divider,
  },
  back: {width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: -8},
  title: {flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: HW.textMain},
  right: {minWidth: 36, alignItems: 'flex-end'},
  cardBox: {backgroundColor: HW.card, borderRadius: 20, paddingHorizontal: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: HW.cardBorder},
  row: {flexDirection: 'row', alignItems: 'center', paddingVertical: 16, minHeight: 56},
  rowBorder: {borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HW.divider},
  rowIcon: {width: 30, alignItems: 'center', marginRight: 6},
  rowLabel: {flex: 1, fontSize: 16, color: HW.textMain},
  rowRight: {flexDirection: 'row', alignItems: 'center', gap: 8},
  rowValue: {fontSize: 15, color: HW.textSub},
  dot: {width: 8, height: 8, borderRadius: 4},
  toggle: {width: 44, height: 24, borderRadius: 12, justifyContent: 'center'},
  knob: {position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 2, elevation: 2},
  modalWrap: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  backdrop: {backgroundColor: 'rgba(0,0,0,0.4)'},
  alertCard: {width: 280, backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 14, overflow: 'hidden'},
  alertBody: {paddingHorizontal: 16, paddingTop: 20, paddingBottom: 16, alignItems: 'center'},
  alertTitle: {fontSize: 17, fontWeight: '600', color: '#000', textAlign: 'center'},
  alertMsg: {fontSize: 13, color: '#3A3A3C', textAlign: 'center', marginTop: 6, lineHeight: 18},
  alertBtnRow: {flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HW.modalDivider},
  alertBtn: {flex: 1, paddingVertical: 11, alignItems: 'center', justifyContent: 'center'},
  alertBtnBorder: {borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: HW.modalDivider},
  alertBtnText: {fontSize: 17, color: HW.blue},
  modalInput: {width: '100%', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: HW.inputFill, borderRadius: 8, fontSize: 15, color: '#000'},
});

export {hs as hwStyles};
