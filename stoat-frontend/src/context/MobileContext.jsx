import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const MOBILE_BREAKPOINT = 768;
const MobileCtx = createContext(null);

export function MobileProvider({ children }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  const [mobileOverlay, setMobileOverlay] = useState(null);
  const location = useLocation();

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = (e) => {
      setIsMobile(e.matches);
      if (!e.matches) setMobileOverlay(null);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    setMobileOverlay(null);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOverlay) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileOverlay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOverlay]);

  const closeMobileOverlay = useCallback(() => setMobileOverlay(null), []);
  const openChannelSidebar = useCallback(() => setMobileOverlay('channelSidebar'), []);
  const openMemberSidebar = useCallback(() => setMobileOverlay('memberSidebar'), []);

  return (
    <MobileCtx.Provider value={{
      isMobile,
      mobileOverlay,
      setMobileOverlay,
      closeMobileOverlay,
      openChannelSidebar,
      openMemberSidebar,
    }}>
      {children}
    </MobileCtx.Provider>
  );
}

export function useMobile() {
  return useContext(MobileCtx) || {};
}
