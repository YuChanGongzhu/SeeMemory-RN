jest.mock('../src/apis/core/request', () => ({
  baseRequest: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../src/apis/core/session', () => ({
  getAuthToken: jest.fn(() => 'token'),
  handleUnauthorized: jest.fn(),
}));

jest.mock('../src/apis/core/env', () => ({
  getBaseApiUrl: jest.fn(() => 'https://example.test/api'),
}));

jest.mock('react-native-sse', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    removeAllEventListeners: jest.fn(),
    close: jest.fn(),
  })),
}));

import {baseRequest} from '../src/apis/core/request';
import {getPresignedUrl} from '../src/services/api';
import {transcribeVoice} from '../src/apis/requests/audioTranscribe';
import {saveMemory} from '../src/apis/requests/memory';
import {createMemorySummary} from '../src/apis/requests/summaries';
import {streamChat} from '../src/services/hermesChat';
import {
  AiConsentRequiredError,
  setAiConsentGranted,
} from '../src/privacy/consentRuntime';

const mockBaseRequest = baseRequest as jest.Mock;

describe('protected service boundaries', () => {
  beforeEach(() => {
    setAiConsentGranted(false);
    mockBaseRequest.mockClear();
  });

  afterAll(() => setAiConsentGranted(false));

  test('blocks cloud upload before requesting a presigned URL', async () => {
    await expect(getPresignedUrl('mp3', 4)).rejects.toBeInstanceOf(
      AiConsentRequiredError,
    );
    expect(mockBaseRequest).not.toHaveBeenCalled();
  });

  test('blocks transcription before reading auth or calling fetch', async () => {
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network should not run'));
    await expect(
      transcribeVoice({filePath: '/tmp/voice.m4a'}),
    ).rejects.toBeInstanceOf(AiConsentRequiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  test('blocks memory save and AI summary before baseRequest', () => {
    expect(() => saveMemory('private note')).toThrow(AiConsentRequiredError);
    expect(() =>
      createMemorySummary({
        summary_type: 'time',
        period_type: 'daily',
        start_time: '2026-07-22',
        end_time: '2026-07-22',
      }),
    ).toThrow(AiConsentRequiredError);
    expect(mockBaseRequest).not.toHaveBeenCalled();
  });

  test('blocks chat before opening an event stream', () => {
    expect(() =>
      streamChat({
        messages: [{role: 'user', content: 'private'}],
        onDelta: jest.fn(),
        onDone: jest.fn(),
        onError: jest.fn(),
      }),
    ).toThrow(AiConsentRequiredError);
  });
});
