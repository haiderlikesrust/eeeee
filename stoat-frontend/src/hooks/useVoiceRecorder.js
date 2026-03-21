import { useState, useRef, useCallback } from 'react';
import { pickVoiceMimeType } from '../utils/voiceMessage';

/**
 * @returns {{ phase: 'idle'|'recording'|'error', error: string|null, seconds: number, start: () => Promise<void>, cancel: () => void, stop: () => Promise<Blob|null>, clearError: () => void }}
 */
export function useVoiceRecorder() {
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState(null);
  const [seconds, setSeconds] = useState(0);

  const recRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const tickRef = useRef(null);
  const discardRef = useRef(false);

  const cleanupStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    const rec = recRef.current;
    if (!rec || rec.state === 'inactive') {
      cleanupStream();
      setPhase('idle');
      setSeconds(0);
      discardRef.current = false;
      return;
    }
    rec.onstop = () => {
      chunksRef.current = [];
      cleanupStream();
      setPhase('idle');
      setSeconds(0);
      discardRef.current = false;
    };
    try {
      rec.stop();
    } catch {
      cleanupStream();
      setPhase('idle');
      setSeconds(0);
      discardRef.current = false;
    }
  }, [cleanupStream]);

  const start = useCallback(async () => {
    if (recRef.current?.state === 'recording') return;
    setError(null);
    discardRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Voice messages are not supported in this browser.');
      setPhase('error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickVoiceMimeType();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      rec.start(200);
      recRef.current = rec;
      setSeconds(0);
      setPhase('recording');
      const started = Date.now();
      tickRef.current = setInterval(() => {
        setSeconds(Math.floor((Date.now() - started) / 1000));
      }, 400);
    } catch (e) {
      cleanupStream();
      setError(e?.message || 'Could not access microphone.');
      setPhase('error');
    }
  }, [cleanupStream]);

  const stop = useCallback(() => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec || rec.state === 'inactive') {
        cleanupStream();
        setPhase('idle');
        setSeconds(0);
        resolve(null);
        return;
      }
      const shouldDiscard = discardRef.current;
      rec.onstop = () => {
        cleanupStream();
        setPhase('idle');
        setSeconds(0);
        if (shouldDiscard) {
          resolve(null);
          return;
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        resolve(blob.size >= 32 ? blob : null);
      };
      try {
        rec.stop();
      } catch {
        cleanupStream();
        setPhase('idle');
        setSeconds(0);
        resolve(null);
      }
    });
  }, [cleanupStream]);

  return { phase, error, seconds, start, cancel, stop, clearError };
}
