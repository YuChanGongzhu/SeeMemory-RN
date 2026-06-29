import React, {createContext, useContext, useState} from 'react';

interface AppDrawerContextType {
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const AppDrawerContext = createContext<AppDrawerContextType>({
  drawerOpen: false,
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function AppDrawerProvider({children}: {children: React.ReactNode}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <AppDrawerContext.Provider
      value={{
        drawerOpen,
        openDrawer: () => setDrawerOpen(true),
        closeDrawer: () => setDrawerOpen(false),
      }}>
      {children}
    </AppDrawerContext.Provider>
  );
}

export const useAppDrawer = () => useContext(AppDrawerContext);
