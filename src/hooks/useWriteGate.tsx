import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import {useAuth} from '../auth/AuthContext';

interface LoginPromptApi {
  visible: boolean;
  show: () => void;
  hide: () => void;
}

const LoginPromptContext = createContext<LoginPromptApi>({visible: false, show: () => {}, hide: () => {}});

/**
 * Holds the "login required" prompt state. A guest who triggers a write action
 * is shown the login overlay (mirrors prototype `requestWriteAction`); once the
 * real login lands (isGuest flips false) the prompt auto-closes.
 */
export function LoginPromptProvider({children}: {children: React.ReactNode}) {
  const [visible, setVisible] = useState(false);
  const {isGuest, authToken} = useAuth();

  useEffect(() => {
    if (visible && authToken && !isGuest) setVisible(false);
  }, [visible, authToken, isGuest]);

  return (
    <LoginPromptContext.Provider value={{visible, show: () => setVisible(true), hide: () => setVisible(false)}}>
      {children}
    </LoginPromptContext.Provider>
  );
}

export const useLoginPrompt = () => useContext(LoginPromptContext);

/**
 * Returns a gate(action) wrapper: guests are sent to login first; logged-in
 * users run the action immediately.
 */
export function useWriteGate() {
  const {isGuest} = useAuth();
  const {show} = useLoginPrompt();
  return useCallback(
    (action: () => void) => {
      if (isGuest) {
        show();
        return;
      }
      action();
    },
    [isGuest, show],
  );
}
