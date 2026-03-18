import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { VoiceProvider } from './context/VoiceContext';
import { UnreadProvider } from './context/UnreadContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AppLayout from './pages/AppLayout';
import AdminPage from './pages/AdminPage';
import DeveloperPortalPage from './pages/DeveloperPortalPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/developers" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <WebSocketProvider>
      <VoiceProvider>
        <UnreadProvider>
          <Routes>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/developers" element={<DeveloperPortalPage />} />
            <Route path="/channels/*" element={<AppLayout />} />
            <Route path="*" element={<Navigate to="/channels/@me" replace />} />
          </Routes>
        </UnreadProvider>
      </VoiceProvider>
    </WebSocketProvider>
  );
}
