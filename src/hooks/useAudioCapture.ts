import {useEffect, useState, useCallback} from 'react';
import type {AudioSegment, CaptureMode} from '../types';
import {RingModule, ringEventEmitter} from '../native/RingModule';

export interface UseAudioCaptureReturn {
  isCapturing: boolean;
  captureMode: CaptureMode;
  isPlaying: boolean;
  currentPlayingPath: string | null;
  segments: AudioSegment[];
  startCaptureADPCM: () => Promise<void>;
  startCapturePCM: () => Promise<void>;
  stopCapture: () => Promise<void>;
  playSegment: (filePath: string) => Promise<void>;
  stopPlayback: () => Promise<void>;
  clearSegments: () => void;
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('adpcm');
  const [isPlaying, setIsPlaying] = useState(false);
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
      setSegments(prev => [segment, ...prev]);
    });

    return () => subscription.remove();
  }, []);

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

  const playSegment = useCallback(async (filePath: string) => {
    try {
      const result = await RingModule.playAudioFile(filePath);
      if (result?.started === false) {
        throw new Error('Audio player did not start');
      }
      setIsPlaying(true);
      setCurrentPlayingPath(filePath);
    } catch (error) {
      setIsPlaying(false);
      setCurrentPlayingPath(null);
      console.error('[AudioCapture] Failed to play audio:', error);
    }
  }, []);

  const stopPlayback = useCallback(async () => {
    try {
      await RingModule.stopAudioPlayback();
      setIsPlaying(false);
      setCurrentPlayingPath(null);
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
    currentPlayingPath,
    segments,
    startCaptureADPCM,
    startCapturePCM,
    stopCapture,
    playSegment,
    stopPlayback,
    clearSegments,
  };
}
