import {useEffect, useState, useCallback} from 'react';
import type {AudioSegment} from '../types';
import {RingModule, ringEventEmitter} from '../native/RingModule';

export interface UseAudioCaptureReturn {
  isCapturing: boolean;
  isPlaying: boolean;
  currentPlayingPath: string | null;
  segments: AudioSegment[];
  startCapture: () => Promise<void>;
  stopCapture: () => Promise<void>;
  playSegment: (filePath: string) => Promise<void>;
  stopPlayback: () => Promise<void>;
  clearSegments: () => void;
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [isCapturing, setIsCapturing] = useState(false);
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

  const startCapture = useCallback(async () => {
    try {
      await RingModule.startCapture();
      setIsCapturing(true);
    } catch (error) {
      console.error('[AudioCapture] Failed to start:', error);
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
    isPlaying,
    currentPlayingPath,
    segments,
    startCapture,
    stopCapture,
    playSegment,
    stopPlayback,
    clearSegments,
  };
}
