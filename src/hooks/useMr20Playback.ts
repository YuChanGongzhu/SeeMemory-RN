/**
 * useMr20Playback —— 试听已同步到手机的 MR20 录音（本地 MP3）。
 *
 * 复用项目已有、已编译可用的原生播放：RingModule.playAudioFile /
 * stopAudioPlayback —— iOS 用 AVAudioPlayer + AVAudioSession(.playback)，Android 用
 * MediaPlayer（见 ios/RingMemoryApp/RTNRingModule.swift、android RingModule.kt），
 * 两端都吃绝对文件路径。这就是「最常用」的本地音频播放法，无需新增原生模块。
 *
 * 原生不回传播放进度，沿用项目里的 250ms timer 估算（与 useAudioCapture 一致）。
 * 错误**不吞**：toggle 失败会抛出，交由调用方提示（之前静默 catch 是「点了没声音
 * 也没报错」的根因）。
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {RingModule} from '../native/RingModule';
import {RokidModule, isRokidModuleAvailable} from '../native/RokidModule';

const rokidCanPlay =
  isRokidModuleAvailable &&
  typeof (RokidModule as any).playAudioFile === 'function';

/**
 * 播放本地音频：优先 RingModule（app 内置 AVAudioPlayer/MediaPlayer），失败再退
 * RokidModule（其 playAudioFile 同样是 AVAudioPlayer，只 strip file://）。两者都不
 * 行才抛出，避免「点了没声音也不报错」。返回时长（秒）。
 */
async function playNative(path: string): Promise<number> {
  try {
    const r = await RingModule.playAudioFile(path);
    return r?.duration ?? 0;
  } catch (e) {
    if (rokidCanPlay) {
      const r = await RokidModule.playAudioFile(path);
      return r?.duration ?? 0;
    }
    throw e;
  }
}

async function stopNative(): Promise<void> {
  // 不确定上次用了哪个引擎，两个都停一下（各自吞错）。
  await RingModule.stopAudioPlayback().catch(() => undefined);
  if (rokidCanPlay) {
    await RokidModule.stopAudioPlayback().catch(() => undefined);
  }
}

export interface Mr20PlaybackState {
  playingId: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  /** 点同一条 → 停；点别的 → 切换。localPath 为本地绝对路径。失败会 throw。 */
  toggle: (id: string, localPath: string) => Promise<void>;
  stop: () => Promise<void>;
}

export function useMr20Playback(): Mr20PlaybackState {
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
    async (id: string, localPath: string) => {
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
      const d = await playNative(localPath);
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
