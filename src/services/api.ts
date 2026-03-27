const API_BASE = 'https://ali.bravechip.cn/api/';

interface TokenResponse {
  token: string;
}

interface UploadResponse {
  status: number;
  message: string;
  result: any;
}

export async function createToken(apiKey: string, username: string): Promise<string> {
  const response = await fetch(`${API_BASE}app/createTokenForThirdPartCompany`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({apiKey, username}),
  });

  const data: TokenResponse = await response.json();
  return data.token;
}

export async function uploadAudioSegment(
  token: string,
  filePath: string,
  duration: number,
  timestamp: number
): Promise<UploadResponse> {
  const formData = new FormData();

  formData.append('file', {
    uri: filePath,
    type: 'audio/wav',
    name: `audio_${timestamp}.wav`,
  } as any);

  formData.append('duration', duration.toString());
  formData.append('timestamp', timestamp.toString());

  const response = await fetch(`${API_BASE}app/uploadHistory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  });

  return response.json();
}

export async function getLatestHistory(token: string): Promise<any> {
  const response = await fetch(`${API_BASE}app/loadUserLatestHistory`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  return response.json();
}
