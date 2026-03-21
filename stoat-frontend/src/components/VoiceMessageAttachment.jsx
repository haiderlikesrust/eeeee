import { useState, useRef, useEffect, useCallback } from 'react';
import { resolveFileUrl } from '../utils/avatarUrl';
import './VoiceMessages.css';

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  );
}

/** Recorded WebM often has NaN/Infinity duration until buffered; seekable.end is more reliable. */
function readDuration(a) {
  if (!a) return null;
  const d = a.duration;
  if (Number.isFinite(d) && d > 0 && d !== Number.POSITIVE_INFINITY) return d;
  try {
    if (a.seekable?.length > 0) {
      const end = a.seekable.end(a.seekable.length - 1);
      if (Number.isFinite(end) && end > 0) return end;
    }
  } catch {
    /* seekable can throw while not ready */
  }
  return null;
}

function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function VoiceMessageAttachment({ attachment, className = '' }) {
  const url = resolveFileUrl(attachment);
  const audioRef = useRef(null);
  const progressRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(null);
  const [current, setCurrent] = useState(0);

  const syncFromAudio = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    setCurrent(a.currentTime || 0);
    const d = readDuration(a);
    if (d != null) setDuration(d);
  }, []);

  useEffect(() => {
    setDuration(null);
    setCurrent(0);
    setPlaying(false);

    const a = audioRef.current;
    if (!a || !url) return undefined;

    let rafId = 0;

    const stopRaf = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const loop = () => {
      syncFromAudio();
      rafId = requestAnimationFrame(loop);
    };

    const onPlay = () => {
      setPlaying(true);
      stopRaf();
      rafId = requestAnimationFrame(loop);
    };

    const onPause = () => {
      setPlaying(false);
      stopRaf();
      syncFromAudio();
    };

    const onEnded = () => {
      setPlaying(false);
      stopRaf();
      setCurrent(0);
      if (a) a.currentTime = 0;
      syncFromAudio();
    };

    const onSync = () => syncFromAudio();

    a.addEventListener('loadedmetadata', onSync);
    a.addEventListener('durationchange', onSync);
    a.addEventListener('progress', onSync);
    a.addEventListener('loadeddata', onSync);
    a.addEventListener('canplay', onSync);
    a.addEventListener('timeupdate', onSync);
    a.addEventListener('play', onPlay);
    a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded);

    syncFromAudio();

    return () => {
      stopRaf();
      a.removeEventListener('loadedmetadata', onSync);
      a.removeEventListener('durationchange', onSync);
      a.removeEventListener('progress', onSync);
      a.removeEventListener('loadeddata', onSync);
      a.removeEventListener('canplay', onSync);
      a.removeEventListener('timeupdate', onSync);
      a.removeEventListener('play', onPlay);
      a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded);
    };
  }, [url, syncFromAudio]);

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !url) return;
    if (!a.paused) a.pause();
    else void a.play().catch(() => {});
  };

  const dur = duration;
  const pct = dur != null && dur > 0 ? Math.min(100, Math.max(0, (current / dur) * 100)) : null;

  const onProgressPointer = (e) => {
    const a = audioRef.current;
    const bar = progressRef.current;
    if (!a || !bar || dur == null || dur <= 0) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = (e.clientX ?? (e.touches && e.touches[0]?.clientX)) - rect.left;
    const p = Math.max(0, Math.min(1, x / rect.width));
    a.currentTime = p * dur;
    setCurrent(a.currentTime);
  };

  const showIndeterminate = playing && (dur == null || dur <= 0);

  return (
    <div className={`msg-voice-attachment ${className}`.trim()}>
      {url ? <audio ref={audioRef} src={url} preload="auto" playsInline /> : null}
      <button
        type="button"
        className="msg-voice-play"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="msg-voice-meta">
        <span className="msg-voice-label">Voice message</span>
        <span className="msg-voice-time">
          {dur != null && dur > 0 ? `${formatTime(current)} / ${formatTime(dur)}` : formatTime(current)}
        </span>
      </div>
      <div
        ref={progressRef}
        className={`msg-voice-progress${showIndeterminate ? ' msg-voice-progress--indeterminate' : ''}${dur != null && dur > 0 ? ' msg-voice-progress--seekable' : ''}`}
        role={dur != null && dur > 0 ? 'slider' : undefined}
        tabIndex={dur != null && dur > 0 ? 0 : undefined}
        aria-valuemin={dur != null && dur > 0 ? 0 : undefined}
        aria-valuemax={dur != null && dur > 0 ? 100 : undefined}
        aria-valuenow={pct != null ? Math.round(pct) : undefined}
        onClick={(e) => onProgressPointer(e)}
        onKeyDown={(e) => {
          if (dur == null || dur <= 0) return;
          const a = audioRef.current;
          if (!a) return;
          const step = Math.max(1, dur * 0.05);
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            a.currentTime = Math.min(dur, a.currentTime + step);
            syncFromAudio();
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            a.currentTime = Math.max(0, a.currentTime - step);
            syncFromAudio();
          }
        }}
      >
        {pct != null ? (
          <div className="msg-voice-progress-fill" style={{ width: `${pct}%` }} />
        ) : null}
      </div>
    </div>
  );
}
