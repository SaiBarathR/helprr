'use client';

import { createContext, useContext } from 'react';

const WidgetVisibilityContext = createContext(true);

export function WidgetVisibilityProvider({
  active,
  children,
}: {
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <WidgetVisibilityContext.Provider value={active}>
      {children}
    </WidgetVisibilityContext.Provider>
  );
}

export function useWidgetVisibility(): boolean {
  return useContext(WidgetVisibilityContext);
}
