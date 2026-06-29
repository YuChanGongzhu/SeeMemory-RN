import React from 'react';
import Svg, {Path, Circle, Rect, G} from 'react-native-svg';

type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

// 眼镜图标
export function GlassesIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="6.6" cy="14" r="3.3" />
      <Circle cx="17.4" cy="14" r="3.3" />
      <Path d="M9.9 14c.9-1 3.3-1 4.2 0" />
      <Path d="M3.5 11.6 5 9.4M20.5 11.6 19 9.4" />
    </Svg>
  );
}

// 戒指图标
export function RingIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="13.6" r="5.4" />
      <Path d="M9.7 8.4 10.4 4h3.2l.7 4.4" />
    </Svg>
  );
}

// 麦克风图标
export function MicIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="9" y="3" width="6" height="11" rx="3" />
      <Path d="M5 11a7 7 0 0 0 14 0" />
      <Path d="M12 18v3" />
    </Svg>
  );
}

// 相机图标
export function CameraIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 8.6A1.8 1.8 0 0 1 5.8 6.8H8L9 5.1h6l1 1.7h2.2A1.8 1.8 0 0 1 20 8.6V17a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17z" />
      <Circle cx="12" cy="12.6" r="3.1" />
    </Svg>
  );
}

// 太阳图标 (此刻)
export function SunIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 2.6v2.1M12 19.3v2.1M4.8 4.8 6.3 6.3M17.7 17.7l1.5 1.5M2.6 12h2.1M19.3 12h2.1M4.8 19.2 6.3 17.7M17.7 6.3l1.5-1.5" />
      <Circle cx="12" cy="12" r="3.6" />
    </Svg>
  );
}

// 对话图标
export function ChatIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 17.5 4 21l3.6-1.2A8.5 8 0 1 0 4 12a7.8 7.8 0 0 0 1 3.5z" />
      <Circle cx="9" cy="12" r="0.4" fill={color} />
      <Circle cx="12" cy="12" r="0.4" fill={color} />
      <Circle cx="15" cy="12" r="0.4" fill={color} />
    </Svg>
  );
}

// 记忆图标 (时钟)
export function MemoryIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="8.4" />
      <Path d="M12 7.4V12l3.2 2" />
    </Svg>
  );
}

// 我的图标
export function UserIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="8" r="3.5" />
      <Path d="M5.6 19.4a6.4 6.4 0 0 1 12.8 0" />
    </Svg>
  );
}

// 加号图标
export function PlusIcon({size = 18, color = 'currentColor', strokeWidth = 2.3}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

// 返回箭头
export function BackIcon({size = 20, color = '#28302C', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M14.5 5.5 8 12l6.5 6.5" />
    </Svg>
  );
}

// 星星图标 (线索)
export function StarIcon({size = 18, color = '#3F8A82', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 4l1.5 4.3L18 10l-4.5 1.7L12 16l-1.5-4.3L6 10l4.5-1.7z" />
    </Svg>
  );
}

// 时钟图标 (去年今天)
export function ClockIcon({size = 22, color = '#7FA868', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="12" cy="12" r="8" />
      <Path d="M12 8v4.2l3 1.8" />
    </Svg>
  );
}

// 定位图标
export function LocationIcon({size = 13, color = '#7C8474', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 21c4-4.5 6-7.6 6-10.5a6 6 0 0 0-12 0C6 13.4 8 16.5 12 21z" />
      <Circle cx="12" cy="10.5" r="2.2" />
    </Svg>
  );
}

// 心率图标
export function HeartIcon({size = 13, color = '#C2803C', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 20s-7-4.3-7-9.2A3.7 3.7 0 0 1 12 7a3.7 3.7 0 0 1 7 3.6C19 15.7 12 20 12 20Z" />
    </Svg>
  );
}

// NAS 服务器图标
export function ServerIcon({size = 24, color = '#A9CBB0', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="4" y="5" width="16" height="6" rx="2" />
      <Rect x="4" y="13" width="16" height="6" rx="2" />
      <Circle cx="8" cy="8" r="1" />
      <Circle cx="8" cy="16" r="1" />
    </Svg>
  );
}

// 锁图标
export function LockIcon({size = 19, color = '#7C8474', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="5" y="10.2" width="14" height="8.8" rx="2.2" />
      <Path d="M8 10.2V7.6a4 4 0 0 1 8 0v2.6" />
    </Svg>
  );
}

// 编辑图标
export function EditIcon({size = 18, color = '#28302C', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 19l1.2-4.2L16 5l3 3-9.8 9.8z" />
      <Path d="M14 7l3 3" />
    </Svg>
  );
}

// 网格图标
export function GridIcon({size = 18, color = '#7C8474', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="4" y="4" width="6" height="6" rx="1" />
      <Rect x="14" y="4" width="6" height="6" rx="1" />
      <Rect x="4" y="14" width="6" height="6" rx="1" />
      <Path d="M14 14h3v3M20 14v6M14 20h3" />
    </Svg>
  );
}

// 家人图标
export function FamilyIcon({size = 26, color = '#3F8A82', strokeWidth = 1.6}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Circle cx="8" cy="8.5" r="2.6" />
      <Circle cx="16" cy="8.5" r="2.6" />
      <Path d="M3.5 18a4.5 4.5 0 0 1 9 0M11.5 18a4.5 4.5 0 0 1 9 0" />
    </Svg>
  );
}

// 发送图标
export function SendIcon({size = 18, color = 'currentColor', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M22 2L11 13" />
      <Path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </Svg>
  );
}

// 上箭头发送图标（对话框发送按钮）
export function UpArrowIcon({size = 19, color = 'currentColor', strokeWidth = 2}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 19V5M6 11l6-6 6 6" />
    </Svg>
  );
}

// 标签图标（线索标记）
export function TagIcon({size = 14, color = '#7C8474', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20.5 13 13 20.5a2 2 0 0 1-2.8 0L3.5 13.8A2 2 0 0 1 3 12.4V5a2 2 0 0 1 2-2h7.4a2 2 0 0 1 1.4.6l6.7 6.6a2 2 0 0 1 0 2.8Z" />
      <Circle cx="7.5" cy="7.5" r="1.3" />
    </Svg>
  );
}

// 排序图标（双向箭头）
export function SortIcon({size = 15, color = '#3F8A82', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M7 4v16M7 20l-3-3M7 20l3-3M17 4V20M17 4l-3 3M17 4l3 3" />
    </Svg>
  );
}

// 播放图标（实心三角）
export function PlayIcon({size = 12, color = '#fff'}: {size?: number; color?: string}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8 5.4 18.5 12 8 18.6Z" fill={color} />
    </Svg>
  );
}

// 铃铛图标（提醒）
export function BellIcon({size = 14, color = '#6B7363', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5z" />
      <Path d="M10 20a2 2 0 0 0 4 0" />
    </Svg>
  );
}

// 对勾图标（完成状态）
export function CheckIcon({size = 13, color = '#fff', strokeWidth = 2.5}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M5 12l5 5L20 7" />
    </Svg>
  );
}

// 首页图标
export function HomeIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 10.5 12 4l8 6.5V19a1.4 1.4 0 0 1-1.4 1.4H5.4A1.4 1.4 0 0 1 4 19z" />
      <Path d="M9.5 20.4v-6h5v6" />
    </Svg>
  );
}

// 记忆粒图标（芯片/颗粒）
export function GrainIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="7" y="7" width="10" height="10" rx="2.4" />
      <Path d="M10 3.5V6M14 3.5V6M10 18v2.5M14 18v2.5M3.5 10H6M3.5 14H6M18 10h2.5M18 14h2.5" />
    </Svg>
  );
}

// 沉淀图标（层叠）
export function ArchiveIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M12 3.5 20.5 8 12 12.5 3.5 8z" />
      <Path d="M3.5 12 12 16.5 20.5 12M3.5 16 12 20.5 20.5 16" />
    </Svg>
  );
}

// 待办图标（清单）
export function TodoIcon({size = 18, color = 'currentColor', strokeWidth = 1.7}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6h11M9 12h11M9 18h11" />
      <Path d="M4 5.6 5 6.6 6.8 4.8M4 11.6 5 12.6 6.8 10.8M4 17.6 5 18.6 6.8 16.8" />
    </Svg>
  );
}

// 抽屉菜单图标
export function MenuIcon({size = 22, color = 'currentColor', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 7h16M4 12h16M4 17h11" />
    </Svg>
  );
}

// 关闭图标
export function CloseIcon({size = 22, color = 'currentColor', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

// 右箭头（列表项）
export function ChevronRightIcon({size = 18, color = 'currentColor', strokeWidth = 1.8}: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 6l6 6-6 6" />
    </Svg>
  );
}
