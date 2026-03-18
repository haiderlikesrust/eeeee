import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import './ToastContext.css';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((message, type = 'info', duration = 3200) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => {
      const next = [...prev, { id, message, type }];
      return next.slice(-5);
    });
    window.setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const api = useMemo(() => ({
    pushToast,
    success: (message, duration) => pushToast(message, 'success', duration),
    error: (message, duration) => pushToast(message, 'error', duration),
    info: (message, duration) => pushToast(message, 'info', duration),
  }), [pushToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast-item ${toast.type}`}>
            <span className="toast-item-text">{toast.message}</span>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => removeToast(toast.id)}
              aria-label="Close notification"
              title="Close"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
