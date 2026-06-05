// Module-level session singleton so the fetch helpers can read the current
// auth token / device context synchronously without prop-drilling. Mirrors
// see-mem-studio-web's session.ts + device-context.ts.

export interface DeviceContext {
  subDomain: string;
  deviceToken: string;
}

let authToken: string | null = null;
let deviceContext: DeviceContext | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setDeviceContext(context: DeviceContext | null): void {
  deviceContext = context;
}

export function getDeviceContext(): DeviceContext | null {
  return deviceContext;
}

export function clearSession(): void {
  authToken = null;
  deviceContext = null;
}

// AuthContext registers its logout handler here so a 401 from any request can
// drive the app back to the login gate.
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function handleUnauthorized(): void {
  onUnauthorized?.();
}
