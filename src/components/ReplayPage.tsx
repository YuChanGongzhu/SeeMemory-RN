import React from 'react';
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
import {BackIcon} from './Icons';
import {AnimatedOrb, FadeUpView} from './Animated';

type Day = {
  id: string;
  date: string;
  rel: string;
  title: string;
  season: string;
  hue: number;
};

type ReplayPageProps = {
  visible: boolean;
  day: Day | null;
  onClose: () => void;
};

const mockChat = [
  {role: 'ai' as const, text: '那天午饭吃得格外香，胃里踏实，心也跟着落定了一些。'},
  {role: 'user' as const, text: '这是我的兔子，你看得到吗', hasImage: true},
  {role: 'ai' as const, text: '看得见呢——毛茸茸的灰身子，白鼻子白爪尖，正低头啃那根彩玉米，连耳朵都垂得认真。'},
];

export function ReplayPage({visible, day, onClose}: ReplayPageProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const s = theme.spacing;
  const r = theme.radius;

  if (!day) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[localStyles.container, {backgroundColor: '#13170F'}]}>
        {/* Header */}
        <View style={[localStyles.header, {
          paddingTop: insets.top + 4,
          paddingHorizontal: 18,
        }]}>
          <TouchableOpacity
            style={[localStyles.closeBtn, {
              borderColor: 'rgba(255,255,255,0.15)',
              backgroundColor: 'rgba(255,255,255,0.06)',
            }]}
            onPress={onClose}>
            <Text style={{color: '#EFEAD9', fontSize: 18}}>✕</Text>
          </TouchableOpacity>
          <Text style={[localStyles.headerTitle, {color: '#D8CFB6'}]}>记忆银行</Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView contentContainerStyle={[localStyles.content, {paddingHorizontal: s.lg, paddingBottom: 36}]}>
          <FadeUpView>
            {/* Thumbnail */}
            <View style={[localStyles.thumb, {
              backgroundColor: `hsl(${day.hue}, 20%, 28%)`,
              borderRadius: r.xl + 2,
              height: 230,
              justifyContent: 'flex-end',
              padding: 11,
            }]}>
              <Text style={[localStyles.thumbLabel, {color: 'rgba(255,255,255,0.85)', backgroundColor: 'rgba(0,0,0,0.32)'}]}>
                {day.rel} · {day.date}
              </Text>
            </View>

            {/* Date */}
            <Text style={[localStyles.dateText, {color: '#A39A7E'}]}>
              回到 {day.date} 那一天
            </Text>
            <Text style={[localStyles.dayTitle, {color: '#EFEAD9'}]}>
              {day.title}
            </Text>

            {/* Chat messages */}
            {mockChat.map((msg, i) => (
              <View key={i} style={[
                localStyles.chatRow,
                msg.role === 'user' && {justifyContent: 'flex-end'}
              ]}>
                {msg.role === 'ai' && (
                  <AnimatedOrb size={30} colors={['#F7E0AB', '#E3A94F']} glowColor="rgba(227, 169, 79, 0.4)" />
                )}
                <View style={[
                  localStyles.chatBubble,
                  msg.role === 'ai' ? {
                    backgroundColor: 'rgba(255,255,255,0.06)',
                    borderColor: 'rgba(255,255,255,0.08)',
                    borderRadius: `${r.lg}px ${r.lg}px ${r.lg}px 5px`,
                  } : {
                    backgroundColor: 'rgba(63,138,130,0.2)',
                    borderColor: 'rgba(63,138,130,0.3)',
                    borderRadius: `${r.lg}px ${r.lg}px 5px ${r.lg}px`,
                  }
                ]}>
                  <Text style={[localStyles.chatText, {
                    color: msg.role === 'ai' ? '#DDD6C5' : '#E6EBDF',
                  }]}>
                    {msg.text}
                  </Text>
                </View>
              </View>
            ))}

            {/* Footer */}
            <Text style={[localStyles.footerText, {color: '#A39A7E'}]}>
              这一天，已经成为你的一部分。
            </Text>

            {/* Play button */}
            <TouchableOpacity style={[localStyles.playBtn, {
              borderColor: 'rgba(255,255,255,0.16)',
              backgroundColor: 'rgba(255,255,255,0.06)',
            }]}>
              <Text style={{color: '#EFEAD9', fontSize: 16}}>▶</Text>
              <Text style={[localStyles.playBtnText, {color: '#EFEAD9'}]}>
                让"光"为这一天朗读
              </Text>
            </TouchableOpacity>
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
  closeBtn: {
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
    letterSpacing: 1,
  },
  content: {paddingTop: 10},
  thumb: {
    overflow: 'hidden',
  },
  thumbLabel: {
    fontSize: 10,
    fontFamily: 'ui-monospace',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  dateText: {
    fontSize: 13,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 4,
  },
  dayTitle: {
    fontSize: 23,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 24,
  },
  chatRow: {
    flexDirection: 'row',
    gap: 11,
    marginBottom: 16,
    alignItems: 'flex-end',
  },
  chatBubble: {
    maxWidth: '80%',
    borderWidth: 1,
    padding: 13,
    paddingLeft: 15,
    paddingRight: 15,
  },
  chatText: {
    fontSize: 13.5,
    lineHeight: 22,
  },
  footerText: {
    fontSize: 15,
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 22,
  },
  playBtn: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  playBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
