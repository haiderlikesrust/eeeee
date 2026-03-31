import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { post } from '../api';

const SETTINGS_KEY = 'onboarding_v1_state';
const LOCAL_JUST_REGISTERED = 'opic.onboarding.justRegistered';

const OnboardingContext = createContext(null);

const DEFAULT_STATE = { completed: false, skipped: false, step: 0, version: 1 };

export function OnboardingProvider({ children, servers, dms }) {
  const [state, setState] = useState(null);
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const persistRef = useRef(null);
  const heuristicTimerRef = useRef(null);

  const persist = useCallback(async (next) => {
    try {
      await post('/sync/settings/set', { [SETTINGS_KEY]: JSON.stringify(next) });
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await post('/sync/settings/fetch', { keys: [SETTINGS_KEY] });
        const raw = res?.[SETTINGS_KEY];
        if (!cancelled) {
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              setState(parsed);
              const justRegistered = localStorage.getItem(LOCAL_JUST_REGISTERED) === '1';
              if (justRegistered && !parsed.completed && !parsed.skipped) {
                setActive(true);
              }
            } catch {
              setState({ ...DEFAULT_STATE });
            }
          } else {
            setState(null);
          }
        }
      } catch {
        if (!cancelled) setState(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (loading) return;
    clearTimeout(heuristicTimerRef.current);
    const justRegistered = localStorage.getItem(LOCAL_JUST_REGISTERED) === '1';
    if (justRegistered && (!state || (!state.completed && !state.skipped))) {
      setActive(true);
      localStorage.removeItem(LOCAL_JUST_REGISTERED);
      return;
    }
    if (state && (state.completed || state.skipped)) {
      setActive(false);
      localStorage.removeItem(LOCAL_JUST_REGISTERED);
      return;
    }
    if (!state && !justRegistered) {
      // Delay heuristic to avoid false-positive when servers/dms haven't loaded yet
      heuristicTimerRef.current = setTimeout(() => {
        const noServers = !servers || servers.length === 0;
        const noDms = !dms || dms.length === 0;
        if (noServers && noDms) {
          setActive(true);
        }
      }, 1500);
    }
    return () => clearTimeout(heuristicTimerRef.current);
  }, [loading, state, servers, dms]);

  const currentStep = state?.step ?? 0;

  const setStep = useCallback((step) => {
    setState((prev) => {
      const next = { ...(prev || DEFAULT_STATE), step };
      clearTimeout(persistRef.current);
      persistRef.current = setTimeout(() => persist(next), 300);
      return next;
    });
  }, [persist]);

  const next = useCallback(() => {
    setState((prev) => {
      const next = { ...(prev || DEFAULT_STATE), step: (prev?.step ?? 0) + 1 };
      clearTimeout(persistRef.current);
      persistRef.current = setTimeout(() => persist(next), 300);
      return next;
    });
  }, [persist]);

  const prev = useCallback(() => {
    setState((prev) => {
      const s = Math.max(0, (prev?.step ?? 0) - 1);
      const next = { ...(prev || DEFAULT_STATE), step: s };
      clearTimeout(persistRef.current);
      persistRef.current = setTimeout(() => persist(next), 300);
      return next;
    });
  }, [persist]);

  const skip = useCallback(() => {
    const next = { completed: false, skipped: true, step: 0, version: 1 };
    setState(next);
    setActive(false);
    localStorage.removeItem(LOCAL_JUST_REGISTERED);
    persist(next);
  }, [persist]);

  const complete = useCallback(() => {
    const next = { completed: true, skipped: false, step: 0, version: 1 };
    setState(next);
    setActive(false);
    localStorage.removeItem(LOCAL_JUST_REGISTERED);
    persist(next);
  }, [persist]);

  const startTour = useCallback(() => {
    const next = { ...DEFAULT_STATE, step: 0 };
    setState(next);
    setActive(true);
    persist(next);
  }, [persist]);

  return (
    <OnboardingContext.Provider value={{
      active,
      loading,
      currentStep,
      setStep,
      next,
      prev,
      skip,
      complete,
      startTour,
    }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}

export { LOCAL_JUST_REGISTERED };
