import { useEffect, useCallback } from 'react';
import './Lightbox.css';

export default function Lightbox({ src, alt, onClose }) {
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  if (!src) return null;

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">×</button>
      <img
        src={src}
        alt={alt || ''}
        className="lightbox-img"
        onClick={(e) => e.stopPropagation()}
      />
      <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        <a href={src} target="_blank" rel="noopener noreferrer" className="lightbox-btn" title="Open original">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        </a>
        <a href={src} download className="lightbox-btn" title="Download">
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>
        </a>
      </div>
    </div>
  );
}
