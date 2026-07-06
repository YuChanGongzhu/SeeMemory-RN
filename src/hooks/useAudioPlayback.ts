/**
 * useAudioPlayback —— 通用单路音频播放控制器（本地文件或远程 http(s) URL 均可）。
 *
 * 播放走通用的 AudioPlayerModule（iOS AVAudioPlayer/AVPlayer，Android MediaPlayer），
 * 与具体硬件设备无关。任何需要「同一时刻只播一条、点同一条停、点别的切」的地方都可复用
 * （MR20 录音试听、记忆详情时间流、记忆对话里的语音卡片等）。
 *
 * 原生不回传播放进度，沿用 250ms timer 估算。
 * 错误**不吞**：toggle 失败会抛出，交由调用方提示。
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {AudioPlayerModule} from '../native/AudioPlayerModule';

async function playNative(source: string): Promise<number> {
  const r = await AudioPlayerModule.playAudioFile(source);
  return r?.duration ?? 0;
}

async function stopNative(): Promise<void> {
  await AudioPlayerModule.stopAudioPlayback().catch(() => undefined);
}

export interface AudioPlaybackState {
  playingId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /** 点同一条 → 停；点别的 → 切换。source 为本地绝对路径或远程 URL。失败会 throw。 */
  toggle: (id: string, source: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useAudioPlayback(): AudioPlaybackState {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const reset = useCallback(() => {
    clearTimer();
    setPlayingId(null);
    setCurrentTime(0);
    setDuration(0);
  }, []);

  const stop = useCallback(async () => {
    reset();
    await stopNative();
  }, [reset]);

  const toggle = useCallback(
    async (id: string, source: string) => {
      // 再点正在播的 → 停。
      if (playingId === id) {
        await stop();
        return;
      }
      // 切到别的 → 先停旧的。
      if (playingId) {
        await stop();
      }
      // 原生播放：失败（文件不存在 / 无法解码 / 模块异常）会抛出，交调用方提示。
      const d = await playNative(source);
      setPlayingId(id);
      setDuration(d);
      setCurrentTime(0);
      const startedAt = Date.now();
      clearTimer();
      timerRef.current = setInterval(() => {
        const next = (Date.now() - startedAt) / 1000;
        if (d > 0 && next >= d) {
          reset(); // 自然播放结束（音频已停）
        } else {
          setCurrentTime(next);
        }
      }, 250);
    },
    [playingId, stop, reset],
  );

  // 卸载时停掉播放。
  useEffect(() => {
    return () => {
      clearTimer();
      stopNative();
    };
  }, []);

  return {
    playingId,
    isPlaying: playingId !== null,
    currentTime,
    duration,
    toggle,
    stop,
  };
}
