import React, {createContext, useContext, useState} from 'react';

interface CaptureContextType {
  captureOpen: boolean;
  openCapture: () => void;
  closeCapture: () => void;
}

const CaptureContext = createContext<CaptureContextType>({
  captureOpen: false,
  openCapture: () => {},
  closeCapture: () => {},
});

export function CaptureProvider({children}: {children: React.ReactNode}) {
  const [captureOpen, setCaptureOpen] = useState(false);
  return (
    <CaptureContext.Provider
      value={{
        captureOpen,
        openCapture: () => setCaptureOpen(true),
        closeCapture: () => setCaptureOpen(false),
      }}>
      {children}
    </CaptureContext.Provider>
  );
}

export const useCapturePanel = () => useContext(CaptureContext);
