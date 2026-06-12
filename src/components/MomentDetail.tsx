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
import {BackIcon, LocationIcon, HeartIcon, ClockIcon} from './Icons';
import {AnimatedOrb, FadeUpView} from './Animated';

type Moment = {
  id: string;
  time: string;
  sourceLabel: string;
  title: string;
  desc: string;
  place?: string;
  bio?: string;
  hasImg?: boolean;
  imgLabel?: string;
  hue: number;
};

type MomentDetailProps = {
  visible: boolean;
  moment: Moment | null;
  onClose: () => void;
  onReplay: () => void;
};

export function MomentDetail({visible, moment, onClose, onReplay}: MomentDetailProps) {
  const {theme} = useTheme();
  const insets = useSafeAreaInsets();
  const [visibility, setVisibility] = useState<'private' | 'family' | 'public'>('private');
  const s = theme.spacing;
  const r = theme.radius;

  if (!moment) return null;

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
          <Text style={[localStyles.headerText, {color: '#9AA095'}]}>
            {moment.sourceLabel} · {moment.time}
          </Text>
          <View style={{width: 38}} />
        </View>

        <ScrollView contentContainerStyle={[localStyles.content, {paddingHorizontal: s.lg, paddingBottom: 30}]}>
          <FadeUpView>
            {/* Image placeholder */}
            {moment.hasImg && (
              <View style={[localStyles.imageThumb, {
                backgroundColor: `hsl(${moment.hue}, 26%, 84%)`,
                borderRadius: r.xl + 2,
                marginBottom: 18,
              }]}>
                <Text style={[localStyles.thumbLabel, {color: `hsl(${moment.hue}, 24%, 35%)`}]}>
                  {moment.imgLabel}
                </Text>
              </View>
            )}

            {/* Title */}
            <Text style={[localStyles.title, {color: '#28302C'}]}>
              {moment.title}
            </Text>

            {/* Tags */}
            <View style={localStyles.tags}>
              {moment.place && (
                <View style={[localStyles.tag, {backgroundColor: '#FFFFFF', borderColor: '#E6E1D2'}]}>
                  <LocationIcon size={13} color="#7C8474" />
                  <Text style={[localStyles.tagText, {color: '#6B7363'}]}>{moment.place}</Text>
                </View>
              )}
              {moment.bio && (
                <View style={[localStyles.tag, {backgroundColor: '#F2E6D4', borderColor: '#E7D5BC'}]}>
                  <HeartIcon size={13} color="#C2803C" />
                  <Text style={[localStyles.tagTextBold, {color: '#C2803C'}]}>{moment.bio}</Text>
                </View>
              )}
            </View>

            {/* AI description */}
            <View style={[localStyles.aiCard, {
              backgroundColor: '#FFFFFF',
              borderColor: '#EAE5D7',
              borderRadius: r.lg,
              padding: 15,
            }]}>
              <AnimatedOrb size={30} colors={['#F7E0AB', '#E3A94F']} />
              <View style={{flex: 1, marginLeft: 0}}>
                <Text style={[localStyles.aiLabel, {color: '#C2803C'}]}>光 看到的</Text>
                <Text style={[localStyles.aiDesc, {color: '#3F473F'}]}>{moment.desc}</Text>
              </View>
            </View>

            {/* Visibility */}
            <Text style={[localStyles.visibilityLabel, {color: '#9AA095'}]}>谁能看到这一刻</Text>
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
                    {v === 'private' ? '仅自己' : v === 'family' ? '家人' : '公开'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Action buttons */}
            <View style={localStyles.actionRow}>
              <TouchableOpacity
                style={[localStyles.replayBtn, {backgroundColor: '#E8EEDD', borderColor: '#D8E2C9'}]}
                onPress={onReplay}>
                <ClockIcon size={18} color="#7FA868" />
                <Text style={[localStyles.replayBtnText, {color: '#4C6B3E'}]}>回到当时</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[localStyles.addBtn, {backgroundColor: theme.colors.accent}]}
                onPress={onClose}>
                <Text style={[localStyles.addBtnText, {color: '#FFFFFF'}]}>加入今日印记</Text>
              </TouchableOpacity>
            </View>
          </FadeUpView>
        </ScrollView>
      </View>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  headerText: {
    fontSize: 13,
  },
  content: {
    paddingTop: 10,
  },
  imageThumb: {
    height: 210,
    justifyContent: 'flex-end',
    padding: 11,
  },
  thumbLabel: {
    fontSize: 10,
    fontFamily: 'ui-monospace',
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    alignSelf: 'flex-start',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  tags: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 13,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: {
    fontSize: 11.5,
  },
  tagTextBold: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  aiCard: {
    flexDirection: 'row',
    gap: 11,
    marginBottom: 16,
  },
  aiLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
  },
  aiDesc: {
    fontSize: 14,
    lineHeight: 23,
  },
  visibilityLabel: {
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 2,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
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
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  replayBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  replayBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  addBtn: {
    flex: 1,
    borderRadius: 18,
    padding: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#3F8A82',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
