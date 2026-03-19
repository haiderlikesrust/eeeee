import React from 'react';

/**
 * Catches uncaught errors in the tree and shows a fallback UI instead of a blank screen.
 * Wraps the root app so any component error is handled with retry/reload options.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (typeof window !== 'undefined' && window.console) {
      console.error('ErrorBoundary caught:', error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: 24,
            color: 'var(--text-normal, #fff)',
            backgroundColor: 'var(--background-primary, #1a1a1a)',
            fontFamily: 'var(--font-primary), system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: 'var(--text-muted, #888)', marginBottom: 24, maxWidth: 420 }}>
            An unexpected error occurred. You can try again or reload the page.
          </p>
          {this.state.error?.message && (
            <pre style={{ fontSize: 11, textAlign: 'left', maxWidth: '100%', overflow: 'auto', color: 'var(--text-muted, #888)', marginBottom: 16 }}>
              {this.state.error.message}
            </pre>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={this.handleRetry}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--brand, #5865f2)',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: '1px solid var(--text-muted, #888)',
                background: 'transparent',
                color: 'var(--text-normal, #fff)',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
