import { createContext, useContext, useState, useCallback } from 'react';

const OfeedContext = createContext(null);

export function OfeedProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [deepLinkPostId, setDeepLinkPostId] = useState(null);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  return (
    <OfeedContext.Provider value={{
      open, setOpen, toggle, deepLinkPostId, setDeepLinkPostId,
    }}
    >
      {children}
    </OfeedContext.Provider>
  );
}

export function useOfeed() {
  return useContext(OfeedContext);
}
