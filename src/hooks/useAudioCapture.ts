import {useEffect, useState, useCallback} from 'react';
import type {AudioSegment, CaptureMode} from '../types';
import {RingModule, ringEventEmitter} from '../native/RingModule';

export interface UseAudioCaptureReturn {
  isCapturing: boolean;
  captureMode: CaptureMode;
  isPlaying: boolean;
  playbackCurrentTime: number;
  playbackDuration: number;
  currentPlayingPath: string | null;
  segments: AudioSegment[];
  startCaptureADPCM: () => Promise<void>;
  startCapturePCM: () => Promise<void>;
  stopCapture: () => Promise<void>;
  denoiseSegment: (filePath: string) => Promise<AudioSegment | null>;
  playSegment: (filePath: string) => Promise<void>;
  stopPlayback: () => Promise<void>;
  clearSegments: () => void;
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('adpcm');
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackCurrentTime, setPlaybackCurrentTime] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(0);
  const [currentPlayingPath, setCurrentPlayingPath] = useState<string | null>(null);
  const [segments, setSegments] = useState<AudioSegment[]>([]);

  useEffect(() => {
    RingModule.getSavedAudioSegments()
      .then(savedSegments => {
        setSegments(savedSegments);
      })
      .catch(error => {
        console.error('[AudioCapture] Failed to load saved segments:', error);
      });

    const subscription = ringEventEmitter.addListener('onAudioSegmentReady', (segment: AudioSegment) => {
      console.log('[AudioCapture] New segment:', segment);
      setSegments(prev => {
        const withoutDup = prev.filter(item => item.filePath !== segment.filePath);
        return [segment, ...withoutDup];
      });
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isPlaying || playbackDuration <= 0) {
      return;
    }
    const timer = setInterval(() => {
      setPlaybackCurrentTime(prev => {
        const next = Math.min(prev + 0.25, playbackDuration);
        if (next >= playbackDuration) {
          setIsPlaying(false);
          setCurrentPlayingPath(null);
        }
        return next;
      });
    }, 250);

    return () => clearInterval(timer);
  }, [isPlaying, playbackDuration]);

  const startCaptureADPCM = useCallback(async () => {
    try {
      await RingModule.startCapture();
      setCaptureMode('adpcm');
      setIsCapturing(true);
    } catch (error) {
      console.error('[AudioCapture] Failed to start ADPCM:', error);
    }
  }, []);

  const startCapturePCM = useCallback(async () => {
    try {
      await RingModule.startCapturePCM();
      setCaptureMode('pcm');
      setIsCapturing(true);
    } catch (error) {
      console.error('[AudioCapture] Failed to start PCM:', error);
    }
  }, []);

  const stopCapture = useCallback(async () => {
    try {
      await RingModule.stopCapture();
      setIsCapturing(false);
    } catch (error) {
      console.error('[AudioCapture] Failed to stop:', error);
    }
  }, []);

  const denoiseSegment = useCallback(async (filePath: string) => {
    try {
      const result = await RingModule.denoiseAudioFile(filePath);
      setSegments(prev => {
        const withoutDup = prev.filter(item => item.filePath !== result.filePath);
        return [result, ...withoutDup];
      });
      return result;
    } catch (error) {
      console.error('[AudioCapture] Failed to denoise audio:', error);
      return null;
    }
  }, []);

  const playSegment = useCallback(async (filePath: string) => {
    try {
      const result = await RingModule.playAudioFile(filePath);
      if (result?.started === false) {
        throw new Error('Audio player did not start');
      }
      setPlaybackCurrentTime(0);
      setPlaybackDuration(result?.duration ?? 0);
      setIsPlaying(true);
      setCurrentPlayingPath(filePath);
    } catch (error) {
      setIsPlaying(false);
      setCurrentPlayingPath(null);
      setPlaybackCurrentTime(0);
      setPlaybackDuration(0);
      console.error('[AudioCapture] Failed to play audio:', error);
    }
  }, []);

  const stopPlayback = useCallback(async () => {
    try {
      await RingModule.stopAudioPlayback();
      setIsPlaying(false);
      setCurrentPlayingPath(null);
      setPlaybackCurrentTime(0);
      setPlaybackDuration(0);
    } catch (error) {
      console.error('[AudioCapture] Failed to stop playback:', error);
    }
  }, []);

  const clearSegments = useCallback(() => {
    setSegments([]);
  }, []);

  return {
    isCapturing,
    captureMode,
    isPlaying,
    playbackCurrentTime,
    playbackDuration,
    currentPlayingPath,
    segments,
    startCaptureADPCM,
    startCapturePCM,
    stopCapture,
    denoiseSegment,
    playSegment,
    stopPlayback,
    clearSegments,
  };
}
