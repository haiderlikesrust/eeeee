import './PageLoadingFallback.css';

/** Shown while lazy route chunks load — matches app chrome so transitions feel less jarring. */
export default function PageLoadingFallback() {
  return (
    <div className="page-loading-fallback" role="status" aria-live="polite" aria-label="Loading page">
      <div className="page-loading-fallback-inner">
        <div className="page-loading-fallback-mark" aria-hidden="true">
          <svg className="page-loading-fallback-logo" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path
              fill="var(--accent)"
              d="M4 2h16v5h-6v15H10V7H4V2z"
            />
          </svg>
        </div>
        <div className="page-loading-fallback-bar" />
        <span className="page-loading-fallback-text">Loading…</span>
      </div>
    </div>
  );
}
