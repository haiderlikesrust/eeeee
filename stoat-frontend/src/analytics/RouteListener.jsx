import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageView } from './client';

export default function AnalyticsRouteListener() {
  const loc = useLocation();
  const prev = useRef(null);
  useEffect(() => {
    if (prev.current === loc.pathname) return;
    prev.current = loc.pathname;
    trackPageView(loc.pathname);
  }, [loc.pathname]);
  return null;
}
