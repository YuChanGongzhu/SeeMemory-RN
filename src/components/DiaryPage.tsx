import React, {useState} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme/ThemeProvider';
import {BackIcon, EditIcon} from './Icons';
import {FadeUpView} from './Animated';

type DiaryStyle = '温柔' | '简洁' | '诗意';

const diaryContent: Record<DiaryStyle, string> = {
  '温柔': `清晨的河堤雾还没散，光是斜的，风里带点凉——和去年今天站在同一处，那时还要更冷一些。

白天忙得脚不沾地，下午戒指轻轻一震，提醒你停下来：心率松了，是终于喘了口气的样子。傍晚回到家，灶上那锅汤咕嘟着，热气糊了镜片，你没忍住笑了一下。6神今天照旧专心干饭，连耳朵都垂得认真。

都是些没空记、又舍不得忘的小事。把它们留在这里，几年后翻回来，你会谢谢今天的自己。`,
  '简洁': `晨跑、开会、做饭、看猫。普通的一天，但有些瞬间值得留存。`,
  '诗意': `雾散之前的河堤，汤沸之后的厨房，猫垂耳啃玉米的午后——生活总在这些缝隙里，轻轻闪光。`,
};

type DiaryPageProps = {
  visible: boolean;
  onClose: () => void;
};

export function DiaryPage({visible, onClose}: DiaryPageProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [style, setStyle] = useState<DiaryStyle>('温柔');
  const [visibility, setVisibility] = useState<'private' | 'family' | 'public'>('private');
  const s = theme.spacing;
  const r = theme.radius;

  const styles: {key: DiaryStyle; label: string}[] = [
    {key: '温柔', label: '温柔'},
    {key: '简洁', label: '简洁'},
    {key: '诗意', label: '诗意'},
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[localStyles.container, {backgroundColor: '#F3F1E9'}]}>
        {/* Header */}
        <View style={[localStyles.header, {
          paddingTop: insets.top + 4,
          paddingHorizontal: 18,
        }]}>
          <TouchableOpacity
            style={[localStyles.backBtn, {
              backgroundColor: '#FFFFFF',
              borderColor: '#E6E1D2',
            }]}
            onPress={onClose}>
            <BackIcon size={20} color="#28302C" />
          </TouchableOpacity>
          <Text style={[localStyles.headerTitle, {color: '#28302C'}]}>今日印记</Text>
          <TouchableOpacity
            style={[localStyles.editBtn, {
              backgroundColor: '#FFFFFF',
              borderColor: '#E6E1D2',
            }]}>
            <EditIcon size={18} color="#28302C" />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={[localStyles.content, {paddingHorizontal: s.lg, paddingBottom: 30}]}>
          <FadeUpView>
            {/* Date */}
            <View style={localStyles.dateRow}>
              <Text style={[localStyles.dayNumber, {color: '#28302C'}]}>12</Text>
              <View>
                <Text style={[localStyles.dateText, {color: '#9AA095'}]}>6月 · 周五 · 夏</Text>
                <Text style={[localStyles.weatherText, {color: '#A7AC9E'}]}>多云转晴 · 8,420 步</Text>
              </View>
            </View>

            {/* Style chips */}
            <View style={localStyles.styleRow}>
              {styles.map((s) => (
                <TouchableOpacity
                  key={s.key}
                  style={[localStyles.styleChip, {
                    backgroundColor: style === s.key ? '#DCEAE6' : '#FFFFFF',
                    borderColor: style === s.key ? '#C9DDD7' : '#E6E1D2',
                    borderWidth: 1,
                  }]}
                  onPress={() => setStyle(s.key)}>
                  <Text style={[localStyles.styleChipText, {
                    color: style === s.key ? '#3F8A82' : '#6B7363',
                    fontWeight: style === s.key ? '700' : '500',
                  }]}>
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Thumbnails */}
            <View style={localStyles.thumbRow}>
              <View style={[localStyles.thumb, {backgroundColor: 'hsl(96, 26%, 84%)', borderRadius: r.sm + 4}]} />
              <View style={[localStyles.thumb, {backgroundColor: 'hsl(30, 26%, 83%)', borderRadius: r.sm + 4}]} />
              <View style={[localStyles.thumb, {backgroundColor: 'hsl(150, 24%, 81%)', borderRadius: r.sm + 4}]} />
            </View>

            {/* Diary content */}
            <Text style={[localStyles.diaryContent, {color: '#2F271F', lineHeight: 32}]}>
              {diaryContent[style]}
            </Text>

            {/* Visibility */}
            <View style={localStyles.visibilityRow}>
              {(['private', 'family', 'public'] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  style={[localStyles.visibilityBtn, {
                    backgroundColor: visibility === v ? '#3F8A82' : '#FFFFFF',
                    borderColor: visibility === v ? '#3F8A82' : '#E6E1D2',
                  }]}
                  onPress={() => setVisibility(v)}>
                  <Text style={[localStyles.visibilityText, {
                    color: visibility === v ? '#FFFFFF' : '#6B7363',
                    fontWeight: visibility === v ? '700' : '500',
                  }]}>
                    {v === 'private' ? '仅自己可见' : v === 'family' ? '家人可见' : '公开'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </FadeUpView>
        </ScrollView>
      </View>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  container: {flex: 1},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtn: {
    width: 38,
    height: 38,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {paddingTop: 10},
  dateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
    marginBottom: 16,
  },
  dayNumber: {
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 40,
  },
  dateText: {
    fontSize: 13,
  },
  weatherText: {
    fontSize: 12,
  },
  styleRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 18,
  },
  styleChip: {
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 7,
  },
  styleChipText: {
    fontSize: 12.5,
  },
  thumbRow: {
    flexDirection: 'row',
    gap: 9,
    marginBottom: 18,
  },
  thumb: {
    flex: 1,
    height: 120,
  },
  diaryContent: {
    fontSize: 16,
    letterSpacing: 0.3,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 24,
  },
  visibilityBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  visibilityText: {
    fontSize: 13,
  },
});
