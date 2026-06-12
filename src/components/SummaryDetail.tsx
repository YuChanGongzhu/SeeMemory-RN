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

type Summary = {
  id: string;
  title: string;
  time: string;
  dur: string;
  abstract: string;
  topics: {h: string; b: string}[];
  timeline: {t: string; b: string}[];
  todos: {t: string; who: string; time: string}[];
};

type SummaryDetailProps = {
  visible: boolean;
  summary: Summary | null;
  onClose: () => void;
};

export function SummaryDetail({visible, summary, onClose}: SummaryDetailProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const s = theme.spacing;
  const r = theme.radius;

  if (!summary) return null;

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
          <Text style={[localStyles.headerTitle, {color: '#28302C'}]}>记忆纪要</Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView contentContainerStyle={[localStyles.content, {paddingHorizontal: s.lg, paddingBottom: 30}]}>
          <FadeUpView>
            {/* Title */}
            <Text style={[localStyles.title, {color: '#28302C'}]}>{summary.title}</Text>
            <Text style={[localStyles.timeInfo, {color: '#9AA095', fontFamily: theme.fonts.mono}]}>
              {summary.time} · {summary.dur}
            </Text>

            {/* AI Abstract */}
            <View style={[localStyles.abstractCard, {
              backgroundColor: '#E8EEDD',
              borderColor: '#D8E2C9',
              borderRadius: r.lg,
              padding: 16,
            }]}>
              <Text style={[localStyles.abstractLabel, {color: '#3F8A82'}]}>AI 摘要</Text>
              <Text style={[localStyles.abstractText, {color: '#2F3A33'}]}>{summary.abstract}</Text>
            </View>

            {/* Topics */}
            <Text style={[localStyles.sectionTitle, {color: '#28302C'}]}>主题归纳</Text>
            {summary.topics.map((topic, i) => (
              <View key={i} style={[localStyles.topicCard, {
                backgroundColor: '#FFFFFF',
                borderColor: '#EAE5D7',
                borderRadius: r.md + 2,
                padding: 14,
              }]}>
                <Text style={[localStyles.topicTitle, {color: '#28302C'}]}>{topic.h}</Text>
                <Text style={[localStyles.topicDesc, {color: '#6B7363'}]}>{topic.b}</Text>
              </View>
            ))}

            {/* Timeline */}
            <Text style={[localStyles.sectionTitle, {color: '#28302C', marginTop: 22}]}>时间线</Text>
            <View style={[localStyles.timelineCard, {
              backgroundColor: '#FFFFFF',
              borderColor: '#EAE5D7',
              borderRadius: r.lg + 2,
              padding: 6,
              paddingLeft: 16,
              paddingRight: 16,
            }]}>
              {summary.timeline.map((item, i) => (
                <View key={i} style={[localStyles.timelineItem, {
                  borderBottomColor: '#F2EEE3',
                  borderBottomWidth: i < summary.timeline.length - 1 ? 1 : 0,
                }]}>
                  <Text style={[localStyles.timelineTime, {color: '#3F8A82', fontFamily: theme.fonts.mono}]}>
                    {item.t}
                  </Text>
                  <Text style={[localStyles.timelineText, {color: '#3F473F'}]}>{item.b}</Text>
                </View>
              ))}
            </View>

            {/* Todos */}
            <Text style={[localStyles.sectionTitle, {color: '#28302C', marginTop: 22}]}>待办建议</Text>
            {summary.todos.map((todo, i) => (
              <View key={i} style={[localStyles.todoItem, {
                backgroundColor: '#FFFFFF',
                borderColor: '#EAE5D7',
                borderRadius: r.md + 2,
                padding: 13,
                paddingLeft: 14,
              }]}>
                <View style={[localStyles.todoCheckbox, {borderColor: '#D5D2C2'}]} />
                <View style={{flex: 1}}>
                  <Text style={[localStyles.todoText, {color: '#28302C'}]}>{todo.t}</Text>
                  <Text style={[localStyles.todoMeta, {color: '#9AA095'}]}>
                    {todo.who} · {todo.time}
                  </Text>
                </View>
              </View>
            ))}

            {/* Ask about memory */}
            <View style={[localStyles.askCard, {backgroundColor: '#E7E8DD', borderRadius: r.lg + 2}]}>
              <AnimatedOrb size={28} colors={['#F7E0AB', '#E3A94F']} />
              <Text style={[localStyles.askText, {color: '#6B7363'}]}>问问这段记忆里的任何细节……</Text>
              <Text style={[localStyles.askArrow, {color: '#3F8A82'}]}>↑</Text>
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
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {paddingTop: 10},
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  timeInfo: {
    fontSize: 12,
    marginTop: 9,
    marginBottom: 18,
  },
  abstractCard: {
    borderWidth: 1,
    marginBottom: 20,
  },
  abstractLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 7,
  },
  abstractText: {
    fontSize: 13.5,
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 11,
  },
  topicCard: {
    borderWidth: 1,
    marginBottom: 9,
  },
  topicTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  topicDesc: {
    fontSize: 12.5,
    lineHeight: 20,
    marginTop: 5,
  },
  timelineCard: {
    borderWidth: 1,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 13,
    paddingVertical: 12,
  },
  timelineTime: {
    fontSize: 12.5,
    fontWeight: '700',
    width: 46,
  },
  timelineText: {
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  todoItem: {
    flexDirection: 'row',
    borderWidth: 1,
    marginBottom: 9,
    alignItems: 'flex-start',
  },
  todoCheckbox: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    marginRight: 12,
    marginTop: 1,
  },
  todoText: {
    fontSize: 13.5,
    fontWeight: '600',
    lineHeight: 19,
  },
  todoMeta: {
    fontSize: 11.5,
    marginTop: 5,
  },
  askCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    padding: 13,
    paddingLeft: 15,
  },
  askText: {
    fontSize: 13,
    flex: 1,
  },
  askArrow: {
    fontSize: 18,
  },
});
