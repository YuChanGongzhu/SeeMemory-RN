let granted = false;

export class AiConsentRequiredError extends Error {
  constructor() {
    super('需要先同意第三方 AI 数据处理');
    this.name = 'AiConsentRequiredError';
  }
}

export function setAiConsentGranted(next: boolean): void {
  granted = next;
}

export function isAiConsentGranted(): boolean {
  return granted;
}

export function assertAiConsentGranted(): void {
  if (!granted) {
    throw new AiConsentRequiredError();
  }
}
