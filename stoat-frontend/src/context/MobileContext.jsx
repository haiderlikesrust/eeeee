import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const MOBILE_BREAKPOINT = 768;
const MobileCtx = createContext(null);

function getInitialMobile() {
  if (typeof window === 'undefined') return false;
  try {
    return window.innerWidth <= MOBILE_BREAKPOINT;
  } catch {
    return false;
  }
}

function isInteractiveTarget(el) {
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('input, textarea, select, button, a, [contenteditable="true"], [contenteditable=""], .messages-list');
}

export function MobileProvider({ children }) {
  const [isMobile, setIsMobile] = useState(getInitialMobile);
  const [mobileOverlay, setMobileOverlay] = useState(null);
  const location = useLocation();

  useEffect(() => {
    if (typeof window === 'undefined') return;
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

  useEffect(() => {
    if (!isMobile || typeof window === 'undefined') return;
    const EDGE = 24;
    const SWIPE_THRESHOLD = 72;
    const MAX_VERTICAL_DRIFT = 48;
    const MAX_DURATION_MS = 550;
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let edge = '';
    let blocked = false;

    const onStart = (e) => {
      const touch = e.touches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startAt = Date.now();
      blocked = isInteractiveTarget(e.target);
      if (startX <= EDGE) edge = 'left';
      else if (startX >= window.innerWidth - EDGE) edge = 'right';
      else edge = '';
    };

    const onEnd = (e) => {
      if (blocked || !edge) return;
      const touch = e.changedTouches?.[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const dt = Date.now() - startAt;
      if (dt > MAX_DURATION_MS || Math.abs(dy) > MAX_VERTICAL_DRIFT) return;
      if (edge === 'left' && dx > SWIPE_THRESHOLD) {
        setMobileOverlay('channelSidebar');
      } else if (
        edge === 'right'
        && dx < -SWIPE_THRESHOLD
        && location.pathname.startsWith('/channels/')
        && !location.pathname.startsWith('/channels/@me')
      ) {
        setMobileOverlay('memberSidebar');
      }
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isMobile, location.pathname]);

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
