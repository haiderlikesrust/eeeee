import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { VoiceProvider } from './context/VoiceContext';
import { UnreadProvider } from './context/UnreadContext';
import { NotificationProvider } from './context/NotificationContext';
import { OfeedProvider } from './context/OfeedContext';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const InvitePage = lazy(() => import('./pages/InvitePage'));
const AppLayout = lazy(() => import('./pages/AppLayout'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const DeveloperPortalPage = lazy(() => import('./pages/DeveloperPortalPage'));
const BotBuilderEditorPage = lazy(() => import('./pages/BotBuilderEditorPage'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'));

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    );
  }

  const fallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text-muted)' }}>
      Loading...
    </div>
  );

  if (!user) {
    return (
      <Suspense fallback={fallback}>
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="/developers" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <WebSocketProvider>
      <VoiceProvider>
        <UnreadProvider>
          <NotificationProvider>
            <OfeedProvider>
            <Suspense fallback={fallback}>
              <Routes>
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/invite/:code" element={<InvitePage />} />
                <Route path="/changelog" element={<ChangelogPage />} />
                <Route path="/developers" element={<DeveloperPortalPage />} />
                <Route path="/developer/editor" element={<BotBuilderEditorPage />} />
                <Route path="/developers/editor" element={<BotBuilderEditorPage />} />
                <Route path="/channels/*" element={<AppLayout />} />
                <Route path="*" element={<Navigate to="/channels/@me" replace />} />
              </Routes>
            </Suspense>
            </OfeedProvider>
          </NotificationProvider>
        </UnreadProvider>
      </VoiceProvider>
    </WebSocketProvider>
  );
}
