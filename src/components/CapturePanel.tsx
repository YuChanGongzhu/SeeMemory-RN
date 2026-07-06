import React, {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import {useTheme} from '../theme/ThemeProvider';
import {MicIcon, CameraIcon, GlassesIcon} from './Icons';
import {AnimatedWaveform, RecDot} from './Animated';

type CapturePanelProps = {
  visible: boolean;
  onClose: () => void;
};

export function CapturePanel({visible, onClose}: CapturePanelProps) {
  const {theme} = useTheme();
  const [recording, setRecording] = useState(false);
  const s = theme.spacing;
  const r = theme.radius;

  const handleStartRec = () => setRecording(true);
  const handleFinishRec = () => {
    setRecording(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={localStyles.overlay} onPress={onClose}>
        <Pressable style={[localStyles.sheet, {
          backgroundColor: '#F3F1E9',
          borderTopLeftRadius: 30,
          borderTopRightRadius: 30,
          padding: 14,
          paddingBottom: 30,
        }]} onPress={() => {}}>
          {/* Handle */}
          <View style={[localStyles.handle, {backgroundColor: '#D5D2C2'}]} />

          {recording ? (
            // Recording state
            <View style={localStyles.recordingContainer}>
              <View style={localStyles.recordingHeader}>
                <RecDot size={9} color={theme.colors.accent} />
                <Text style={[localStyles.recordingText, {color: theme.colors.accent}]}>
                  正在聆听…
                </Text>
              </View>
              <AnimatedWaveform barCount={28} color={theme.colors.accent} height={44} />
              <Text style={[localStyles.recordingHint, {color: theme.colors.textSecondary}]}>
                说点什么都行，我会帮你写进今天的印记。
              </Text>
              <TouchableOpacity
                style={[localStyles.finishBtn, {backgroundColor: theme.colors.accent}]}
                onPress={handleFinishRec}>
                <Text style={localStyles.finishBtnText}>完成 · 收进时间线</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Options state
            <View>
              <Text style={[localStyles.sheetTitle, {color: theme.colors.text}]}>
                记录此刻
              </Text>
              <Text style={[localStyles.sheetSubtitle, {color: theme.colors.textMuted}]}>
                挑一种方式，把现在留下来
              </Text>

              {/* Voice record button */}
              <TouchableOpacity
                style={[localStyles.voiceBtn, {
                  backgroundColor: '#E8EEDD',
                  borderColor: '#D8E2C9',
                }]}
                onPress={handleStartRec}>
                <View style={[localStyles.voiceBtnOrb, {backgroundColor: theme.gold}]}>
                  <MicIcon size={22} color="#FFFFFF" />
                </View>
                <View style={{flex: 1}}>
                  <Text style={[localStyles.voiceBtnTitle, {color: theme.colors.text}]}>
                    长按说话
                  </Text>
                  <Text style={[localStyles.voiceBtnDesc, {color: theme.colors.textSecondary}]}>
                    说给"光"听，它会写成日记
                  </Text>
                </View>
              </TouchableOpacity>

              {/* Photo / Glasses buttons */}
              <View style={localStyles.actionRow}>
                <TouchableOpacity
                  style={[localStyles.actionBtn, {
                    backgroundColor: '#FFFFFF',
                    borderColor: theme.colors.border,
                  }]}
                  onPress={onClose}>
                  <CameraIcon size={24} color="#7FA868" />
                  <Text style={[localStyles.actionBtnText, {color: theme.colors.text}]}>
                    拍照 / 录像
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[localStyles.actionBtn, {
                    backgroundColor: '#FFFFFF',
                    borderColor: theme.colors.border,
                  }]}
                  onPress={onClose}>
                  <GlassesIcon size={24} color={theme.colors.accent} />
                  <Text style={[localStyles.actionBtnText, {color: theme.colors.text}]}>
                    从眼镜捕捉
                  </Text>
                  <Text style={[localStyles.actionBtnSubtext, {color: theme.colors.textMuted}]}>
                    取回刚刚 30 秒
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(28, 32, 26, 0.48)',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
  },
  handle: {
    width: 38,
    height: 5,
    borderRadius: 5,
    alignSelf: 'center',
    marginBottom: 16,
  },
  recordingContainer: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  recordingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  recordingText: {
    fontSize: 14,
    fontWeight: '700',
  },
  recordingHint: {
    fontSize: 13,
    lineHeight: 20,
    marginTop: 16,
  },
  finishBtn: {
    width: '100%',
    borderRadius: 18,
    padding: 15,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#3F8A82',
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  finishBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
  },
  sheetSubtitle: {
    fontSize: 12.5,
    textAlign: 'center',
    marginBottom: 18,
  },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 10,
  },
  voiceBtnOrb: {
    width: 46,
    height: 46,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceBtnTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  voiceBtnDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 7,
  },
  actionBtnSubtext: {
    fontSize: 10,
    marginTop: 2,
  },
});
