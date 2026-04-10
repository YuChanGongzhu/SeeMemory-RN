import {useState, useCallback} from 'react';
import {uploadAudioSegment} from '../services/api';
import type {AudioSegment} from '../types';

export interface UploadDebugData {
  objectUrl?: string;
  presignedUrl?: string;
  duration?: number;
  timestamp?: number;
  fileExtension?: string;
  scene?: number;
}

export interface UploadDebugResponse {
  status: number;
  message: string;
  result: UploadDebugData | null;
}

interface MemoryItem {
  id: string;
  content: string;
  timestamp: number;
  audioUrl?: string;
}

interface UseMemoryRecallReturn {
  memories: MemoryItem[];
  isLoading: boolean;
  error: string | null;
  recall: (query: string) => Promise<void>;
  uploadSegment: (segment: AudioSegment) => Promise<UploadDebugResponse>;
}

export function useMemoryRecall(): UseMemoryRecallReturn {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 上传音频片段
  const uploadSegment = useCallback(async (segment: AudioSegment) => {
    const result = await uploadAudioSegment(
      undefined,
      segment.filePath,
      segment.duration,
      segment.timestamp
    );

    console.log('[MemoryRecall] Upload result:', result);
    return result;
  }, []);

  // 召回记忆
  const recall = useCallback(async (query: string) => {
    setIsLoading(true);
    setError(null);

    try {
      // TODO: 替换为真实的 AI 召回 API
      // 这里是占位实现
      await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));

      const mockResult: MemoryItem[] = [
        {
          id: '1',
          content: `根据您的提问"${query}"，找到以下相关记忆：上周三和老张开会讨论了项目延期的事情，老张说这个项目需要延期到下个月...`,
          timestamp: Date.now() - 86400000 * 3,
        },
      ];

      setMemories(mockResult);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    memories,
    isLoading,
    error,
    recall,
    uploadSegment,
  };
}
