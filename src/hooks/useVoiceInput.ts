/**
 * useVoiceInput —— 记忆对话语音输入编排：权限 → 手机麦克风录音 → 停止 → 转写。
 * 录音走通用 `AudioRecorderModule`，转写走 `/app/audio/transcriptions`（登录用户 auth_token）。
 * 结果回调同时给出「本地音频路径 + 时长 + 转写文本」：调用方据此发一条可本地回听的语音消息，
 * 并把转写文本发给 agent。
 */
import {useCallback, useRef, useState} from 'react';
import {Platform, PermissionsAndroid} from 'react-native';
import {AudioRecorderModule, isAudioRecorderAvailable} from '../native/AudioRecorderModule';
import {transcribeVoice} from '../apis/requests/audioTranscribe';

export type VoiceInputStatus = 'idle' | 'recording' | 'transcribing';

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: '麦克风权限',
        message: '用于录制语音并转成文字',
        buttonPositive: '允许',
        buttonNegative: '取消',
      },
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }
  // iOS：原生弹系统授权并返回是否授予。
  return AudioRecorderModule.requestPermission();
}

export interface VoiceResult {
  filePath: string;
  durationMs: number;
  text: string;
}

export interface VoiceInput {
  status: VoiceInputStatus;
  error: string | null;
  /** 开始录音（幂等：非 idle 时忽略）。 */
  start: () => Promise<void>;
  /** 停止录音并转写；成功回调 onResult（音频路径 + 时长 + 转写文本）。 */
  stop: () => Promise<void>;
  /** 取消当前录音，丢弃音频（仅录音中有效）。 */
  cancel: () => Promise<void>;
}

export function useVoiceInput(onResult: (result: VoiceResult) => void): VoiceInput {
  const [status, setStatus] = useState<VoiceInputStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false); // 防止 start/stop 并发重入

  const start = useCallback(async () => {
    if (status !== 'idle' || busyRef.current) {
      return;
    }
    setError(null);
    if (!isAudioRecorderAvailable) {
      setError('当前构建不支持录音，请重新构建 App');
      return;
    }
    busyRef.current = true;
    try {
      const ok = await ensureMicPermission();
      if (!ok) {
        setError('未获得麦克风权限');
        return;
      }
      await AudioRecorderModule.startRecording();
      setStatus('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : '录音启动失败');
      setStatus('idle');
    } finally {
      busyRef.current = false;
    }
  }, [status]);

  const stop = useCallback(async () => {
    if (status !== 'recording' || busyRef.current) {
      return;
    }
    busyRef.current = true;
    try {
      const {filePath, durationMs} = await AudioRecorderModule.stopRecording();
      setStatus('transcribing');
      const text = await transcribeVoice({filePath, language: 'zh-CN'});
      if (text) {
        onResult({filePath, durationMs, text});
      } else {
        setError('没有识别到内容');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '转写失败');
    } finally {
      busyRef.current = false;
      setStatus('idle');
    }
  }, [status, onResult]);

  const cancel = useCallback(async () => {
    if (status !== 'recording') {
      return;
    }
    try {
      await AudioRecorderModule.cancelRecording();
    } catch {
      // 取消不关心结果
    }
    busyRef.current = false;
    setStatus('idle');
  }, [status]);

  return {status, error, start, stop, cancel};
}
