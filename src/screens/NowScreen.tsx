import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import type {Theme} from '../theme/index';
import {GlassesIcon, RingIcon, MicIcon} from '../components/Icons';
import {DevicesOverlay} from '../components/DevicesOverlay';
import {NasPage} from '../components/NasPage';
import {AnimatedOrb, ShimmerEffect, FadeUpView} from '../components/Animated';
import {CapturePanel} from '../components/CapturePanel';
import {MomentDetail} from '../components/MomentDetail';
import {SummaryDetail} from '../components/SummaryDetail';
import {DiaryPage} from '../components/DiaryPage';

const {width: SCREEN_WIDTH} = Dimensions.get('window');

type Moment = {
  id: string;
  time: string;
  source: 'glasses' | 'ring' | 'voice';
  sourceLabel: string;
  title: string;
  desc: string;
  place?: string;
  bio?: string;
  hasImg?: boolean;
  imgLabel?: string;
  hue: number;
  emotion: {label: string; color: string};
  isSummary?: boolean;
  sid?: string;
};

const mockMoments: Moment[] = [
  {
    id: 'm1', time: '19:05', source: 'glasses', sourceLabel: '眼镜',
    title: '厨房升起的热气', desc: '灶上那锅汤咕嘟着，雾气糊了镜片，你停下来笑了一下。',
    place: '家 · 厨房', bio: '心率 74 · 安定', hasImg: true, imgLabel: 'POV · 19:05', hue: 30,
    emotion: {label: '安定', color: '#7FA868'},
  },
  {
    id: 'm2', time: '16:42', source: 'ring', sourceLabel: '戒指',
    title: '一键收藏的此刻', desc: '你双击了戒指，把这一分钟留了下来。心率从忙乱里慢慢松了下来。',
    place: '公司 · 工位', bio: '心率 72 · 松弛', hasImg: false, hue: 150,
    emotion: {label: '松弛 · ♥ 72', color: '#7FA868'},
  },
  {
    id: 'm3', time: '13:30', source: 'glasses', sourceLabel: '眼镜',
    title: '6神在啃彩色玉米', desc: '毛茸茸的灰身子，白鼻子白爪尖，连耳朵都垂得认真。这一帧值得留着。',
    place: '阳台', bio: '心率 70 · 治愈', hasImg: true, imgLabel: 'POV · 13:30', hue: 96,
    emotion: {label: '治愈', color: '#3F8A82'},
  },
  {
    id: 'm4', time: '10:00', source: 'voice', sourceLabel: '录音',
    title: '产品评审会', desc: '1 小时 02 分 · 已自动生成纪要，提炼出 3 条待办、2 个决定。',
    hasImg: false, hue: 42, emotion: {label: '专注', color: '#7C92A6'},
    isSummary: true, sid: 's1',
  },
  {
    id: 'm5', time: '08:15', source: 'glasses', sourceLabel: '眼镜',
    title: '晨跑的河堤', desc: '雾还没散，光是斜的，风里带点凉。和去年今天同一条河堤。',
    place: '滨河绿道', bio: '心率 128 · 清醒', hasImg: true, imgLabel: 'POV · 08:15', hue: 196,
    emotion: {label: '清醒', color: '#7C92A6'},
  },
];

const mockSummaries = [
  {
    id: 's1', title: '产品评审会', time: '今天 10:00', dur: '1h02m',
    abstract: '围绕"常态化录音"的产品定位展开：主打低门槛、强陪伴。麦克风与按键布局以单手操作为先，首版以功能可用优先于外观。',
    topics: [
      {h: '产品定位', b: '低门槛 + 强陪伴，命名强化"记忆"心智，作为可佩戴端记忆入口。'},
      {h: '硬件路径', b: '内核先行；外观采用低成本外采 + 内部喷绘，先验证语音采集与按键。'},
      {h: '人机交互', b: '按键集中单侧、正面无按键，符合办公轻声与隐私场景。'},
    ],
    timeline: [
      {t: '16:28', b: '讨论麦克风安装位置：正面 vs 顶部'},
      {t: '16:40', b: '确认按键布局：全部集中单侧，取消高频键'},
      {t: '16:54', b: '确定产品策略，进行内核验证'},
      {t: '17:21', b: '明确首版定位：功能可用 > 外观美度'},
    ],
    todos: [
      {t: '确认麦克风灵敏度并筛选最优方案', who: '硬件工程师', time: '6-08'},
      {t: '3D 打印验证按键布局与触感', who: '设计师', time: '6-08'},
      {t: '安排首版启动会', who: '组织者', time: '6-08'},
    ],
  },
];

function getSourceIcon(source: Moment['source'], size = 14) {
  const color = '#7C8474';
  switch (source) {
    case 'glasses': return <GlassesIcon size={size} color={color} />;
    case 'ring': return <RingIcon size={size} color={color} />;
    case 'voice': return <MicIcon size={size} color={color} />;
    default: return <GlassesIcon size={size} color={color} />;
  }
}

function MomentCard({moment, theme, onPress}: {moment: Moment; theme: Theme; onPress: () => void}) {
  const s = theme.spacing;
  const r = theme.radius;

  return (
    <TouchableOpacity
      style={[localStyles.momentCard, {
        backgroundColor: theme.colors.bgCard,
        borderColor: theme.colors.border,
        borderRadius: r.lg,
        padding: s.sm + 5,
        marginBottom: s.sm + 3,
      }]}
      onPress={onPress}
      activeOpacity={0.7}>
      <View style={localStyles.momentLeft}>
        <Text style={[localStyles.momentTime, {color: theme.colors.text, fontFamily: theme.fonts.mono}]}>
          {moment.time}
        </Text>
        <View style={[localStyles.momentIcon, {
          backgroundColor: moment.source === 'glasses' ? '#DCEAE6' : moment.source === 'ring' ? '#E8EEDD' : '#F2E6D4',
        }]}>
          {getSourceIcon(moment.source)}
        </View>
        <Text style={[localStyles.momentSource, {color: moment.source === 'glasses' ? '#3F8A82' : moment.source === 'ring' ? '#7FA868' : '#C2803C'}]}>
          {moment.sourceLabel}
        </Text>
      </View>
      <View style={localStyles.momentContent}>
        <Text style={[localStyles.momentTitle, {color: theme.colors.text}]} numberOfLines={1}>
          {moment.title}
        </Text>
        <Text style={[localStyles.momentDesc, {color: theme.colors.textSecondary}]} numberOfLines={2}>
          {moment.desc}
        </Text>
        <View style={localStyles.emotionRow}>
          <View style={[localStyles.emotionChip, {backgroundColor: theme.colors.bgSecondary}]}>
            <View style={[localStyles.emotionDot, {backgroundColor: moment.emotion.color}]} />
            <Text style={[localStyles.emotionText, {color: theme.colors.textSecondary}]}>
              {moment.emotion.label}
            </Text>
          </View>
          <Text style={[localStyles.momentDeviceLabel, {color: '#A7AC9E'}]}>{moment.sourceLabel}</Text>
        </View>
      </View>
      {moment.hasImg && (
        <View style={[localStyles.momentThumb, {
          backgroundColor: `hsl(${moment.hue}, 26%, 84%)`,
          borderRadius: r.sm + 4,
        }]}>
          <Text style={[localStyles.thumbLabel, {color: `hsl(${moment.hue}, 24%, 35%)`}]}>
            {moment.imgLabel}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function NowScreen() {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();

  // Overlay states
  const [captureOpen, setCaptureOpen] = useState(false);
  const [selectedMoment, setSelectedMoment] = useState<Moment | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<any>(null);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [nasOpen, setNasOpen] = useState(false);

  const s = theme.spacing;
  const r = theme.radius;

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 12) return '早上好';
    if (hour < 18) return '下午好';
    return '晚上好';
  };

  const handleMomentPress = (moment: Moment) => {
    if (moment.isSummary && moment.sid) {
      const summary = mockSummaries.find(s => s.id === moment.sid);
      if (summary) setSelectedSummary(summary);
    } else {
      setSelectedMoment(moment);
    }
  };

  return (
    <View style={[localStyles.container, {backgroundColor: theme.colors.bg}]}>
      <ScrollView
        style={localStyles.scrollView}
        contentContainerStyle={{paddingBottom: 100}}
        showsVerticalScrollIndicator={false}>
        {/* Header */}
        <FadeUpView>
          <View
            style={[localStyles.header, {
              paddingTop: insets.top + s.lg + 10,
              paddingBottom: s.xl + 16,
              paddingHorizontal: s.lg,
              backgroundColor: '#CFE6EA',
              overflow: 'hidden',
            }]}>
            {/* Gradient overlay: blends #CFE6EA → #D9EADE → #E7EFDC */}
            <View style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%', backgroundColor: '#D9EADE', opacity: 0.65, pointerEvents: 'none'}} />
            <View style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', backgroundColor: '#E7EFDC', opacity: 0.7, pointerEvents: 'none'}} />
            <AnimatedOrb
              size={46}
              colors={['#FBE9BE', '#F2CC83']}
              glowColor="rgba(242, 204, 131, 0.75)"
              style={{position: 'absolute', top: 64, right: 30}}
            />
            <View style={localStyles.badgeRow}>
              <View style={[localStyles.seasonBadge, {
                backgroundColor: 'rgba(255,255,255,0.6)',
                borderColor: 'rgba(255,255,255,0.7)',
              }]}>
                <Text style={[localStyles.seasonText, {color: theme.seasons?.summer || theme.colors.accent}]}>夏</Text>
                <Text style={[localStyles.seasonSubtext, {color: theme.colors.textSecondary}]}>仲夏 · 芒种</Text>
              </View>
              <TouchableOpacity style={[localStyles.deviceBadge, {
                backgroundColor: 'rgba(255,255,255,0.62)',
                borderColor: 'rgba(255,255,255,0.72)',
              }]} activeOpacity={0.7} onPress={() => setDevicesOpen(true)}>
                <View style={[localStyles.deviceDot, {backgroundColor: theme.colors.accent}]} />
                <Text style={[localStyles.deviceText, {color: theme.colors.textSecondary}]}>眼镜 · 戒指 · NAS</Text>
                <Text style={{color: '#6E8C7E', fontSize: 13, fontWeight: '700', marginLeft: 2}}>›</Text>
              </TouchableOpacity>
            </View>
            <Text style={[localStyles.greeting, {color: theme.colors.text}]}>{getGreeting()}，春水</Text>
            <Text style={[localStyles.dateInfo, {color: theme.colors.textSecondary}]}>6月12日 · 周五 · 多云转晴 · 28°C</Text>
          </View>
        </FadeUpView>

        {/* Diary Card */}
        <View style={[localStyles.diaryCardWrapper, {paddingHorizontal: s.lg}]}>
          <FadeUpView delay={100}>
            <TouchableOpacity
              style={[localStyles.diaryCard, {
                backgroundColor: theme.colors.bgCard,
                borderColor: theme.colors.border,
                borderRadius: r.xl,
                padding: s.lg,
                overflow: 'hidden',
              }]}
              activeOpacity={0.7}
              onPress={() => setDiaryOpen(true)}>
              <ShimmerEffect />
              <Text style={[localStyles.diaryLabel, {color: theme.colors.accent}]}>今日印记 · 正在生成</Text>
              <Text style={[localStyles.diaryTitle, {color: theme.colors.text}]}>今天已拾起 {mockMoments.length} 个此刻</Text>
              <Text style={[localStyles.diaryDesc, {color: theme.colors.textSecondary}]}>入夜后我会把今天写成一篇日记，{'\n'}挑个风格，或者再添几句都行。</Text>
              <View style={localStyles.diaryThumbs}>
                <View style={[localStyles.diaryThumb, {backgroundColor: 'hsl(96, 26%, 82%)', borderRadius: r.sm + 4}]} />
                <View style={[localStyles.diaryThumb, {backgroundColor: 'hsl(30, 26%, 83%)', borderRadius: r.sm + 4}]} />
                <View style={[localStyles.diaryThumb, {backgroundColor: 'hsl(190, 24%, 81%)', borderRadius: r.sm + 4}]} />
                <View style={localStyles.diaryViewMore}>
                  <Text style={[localStyles.diaryViewMoreText, {color: theme.colors.accent}]}>查看 ›</Text>
                </View>
              </View>
            </TouchableOpacity>
          </FadeUpView>
        </View>

        {/* Capture Prompt */}
        <FadeUpView delay={200} style={{marginHorizontal: s.lg, marginTop: s.md}}>
          <TouchableOpacity
            style={[localStyles.captureCard, {
              backgroundColor: theme.colors.bgCard,
              borderColor: theme.colors.border,
              borderRadius: r.lg + 2,
              padding: s.sm + 5,
              flexDirection: 'row',
              alignItems: 'center',
            }]}
            onPress={() => setCaptureOpen(true)}
            activeOpacity={0.7}>
            <AnimatedOrb size={40} colors={['#F7E0AB', '#E3A94F']} glowColor="rgba(242, 204, 131, 0.34)" />
            <View style={localStyles.captureText}>
              <Text style={[localStyles.captureLabel, {color: theme.gold}]}>光 · 你的记忆伙伴</Text>
              <Text style={[localStyles.captureHint, {color: theme.colors.text}]}>有什么值得记住的小事，跟我说一句？</Text>
            </View>
            <View style={[localStyles.captureBtn, {backgroundColor: theme.colors.bgSecondary}]}>
              <MicIcon size={18} color={theme.colors.accent} />
            </View>
          </TouchableOpacity>
        </FadeUpView>

        {/* Timeline */}
        <FadeUpView delay={300} style={[localStyles.sectionHeader, {marginHorizontal: s.lg, marginTop: s.lg, marginBottom: s.sm + 4}]}>
          <Text style={[localStyles.sectionTitle, {color: theme.colors.text}]}>今天 · 时间线</Text>
          <Text style={[localStyles.sectionCount, {color: theme.colors.textMuted}]}>{mockMoments.length} 个此刻</Text>
        </FadeUpView>

        <View style={{marginHorizontal: s.lg}}>
          {mockMoments.map((moment, index) => (
            <FadeUpView key={moment.id} delay={400 + index * 50}>
              <MomentCard
                moment={moment}
                theme={theme}
                onPress={() => handleMomentPress(moment)}
              />
            </FadeUpView>
          ))}
        </View>

        <Text style={[localStyles.footerHint, {color: theme.colors.textMuted}]}>今天还在继续 · 眼镜与戒指会替你随手拾起</Text>
      </ScrollView>

      {/* Overlays */}
      <CapturePanel visible={captureOpen} onClose={() => setCaptureOpen(false)} />
      <DevicesOverlay visible={devicesOpen} onClose={() => setDevicesOpen(false)} onOpenNas={() => { setDevicesOpen(false); setNasOpen(true); }} />
      <NasPage visible={nasOpen} onClose={() => setNasOpen(false)} />
      <MomentDetail
        visible={!!selectedMoment}
        moment={selectedMoment}
        onClose={() => setSelectedMoment(null)}
        onReplay={() => { setSelectedMoment(null); }}
      />
      <SummaryDetail
        visible={!!selectedSummary}
        summary={selectedSummary}
        onClose={() => setSelectedSummary(null)}
      />
      <DiaryPage visible={diaryOpen} onClose={() => setDiaryOpen(false)} />
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  scrollView: {flex: 1},
  header: {},
  badgeRow: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18},
  seasonBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5},
  seasonText: {fontSize: 13, fontWeight: '700'},
  seasonSubtext: {fontSize: 11, letterSpacing: 1},
  deviceBadge: {flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5},
  deviceDot: {width: 7, height: 7, borderRadius: 4},
  deviceText: {fontSize: 11, fontWeight: '500'},
  greeting: {fontSize: 26, fontWeight: '700'},
  dateInfo: {fontSize: 12.5, marginTop: 4},
  diaryCardWrapper: {marginTop: -26, position: 'relative', zIndex: 10},
  diaryCard: {},
  diaryLabel: {fontSize: 12, fontWeight: '700', letterSpacing: 1},
  diaryTitle: {fontSize: 19, fontWeight: '600', marginTop: 6},
  diaryDesc: {fontSize: 12.5, lineHeight: 20, marginTop: 5},
  diaryThumbs: {flexDirection: 'row', gap: 9, marginTop: 14, alignItems: 'center'},
  diaryThumb: {width: 54, height: 54},
  diaryViewMore: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  diaryViewMoreText: {fontSize: 13, fontWeight: '600'},
  captureCard: {},
  captureText: {flex: 1, marginLeft: 12},
  captureLabel: {fontSize: 11, fontWeight: '700', letterSpacing: 0.5},
  captureHint: {fontSize: 13.5, marginTop: 2},
  captureBtn: {width: 38, height: 38, borderRadius: 20, alignItems: 'center', justifyContent: 'center'},
  sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  sectionTitle: {fontSize: 17, fontWeight: '600'},
  sectionCount: {fontSize: 12},
  momentCard: {flexDirection: 'row', alignItems: 'stretch', borderWidth: 1},
  momentLeft: {width: 46, alignItems: 'center', justifyContent: 'flex-start', gap: 7, marginRight: 13},
  momentTime: {fontSize: 13, fontWeight: '700'},
  momentIcon: {borderRadius: 8, paddingHorizontal: 5, paddingVertical: 4, alignItems: 'center', justifyContent: 'center'},
  momentSource: {fontSize: 9.5},
  momentContent: {flex: 1},
  momentTitle: {fontSize: 14.5, fontWeight: '700'},
  momentDesc: {fontSize: 12.5, lineHeight: 19, marginTop: 4},
  emotionRow: {flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8},
  emotionChip: {flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 3},
  momentDeviceLabel: {fontSize: 10.5},
  emotionDot: {width: 6, height: 6, borderRadius: 3},
  emotionText: {fontSize: 11.5, fontWeight: '500'},
  momentThumb: {width: 70, marginLeft: 13, justifyContent: 'flex-end', padding: 7},
  thumbLabel: {fontSize: 9, fontFamily: 'ui-monospace', letterSpacing: 0.2, backgroundColor: 'rgba(255,255,255,0.62)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, alignSelf: 'flex-start'},
  footerHint: {textAlign: 'center', fontSize: 12, paddingVertical: 16},
});
