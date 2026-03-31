import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { VoiceProvider } from './context/VoiceContext';
import { UnreadProvider } from './context/UnreadContext';
import { NotificationProvider } from './context/NotificationContext';
import { OfeedProvider } from './context/OfeedContext';
import PageLoadingFallback from './components/PageLoadingFallback';
import AnalyticsRouteListener from './analytics/RouteListener';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const InvitePage = lazy(() => import('./pages/InvitePage'));
const AppLayout = lazy(() => import('./pages/AppLayout'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const DeveloperPortalLayout = lazy(() => import('./pages/DeveloperPortalLayout'));
const DeveloperDocsLayout = lazy(() => import('./pages/DeveloperDocsLayout'));
const DeveloperApiDocsPage = lazy(() => import('./pages/DeveloperApiDocsPage'));
const DeveloperBotsDocsPage = lazy(() => import('./pages/DeveloperBotsDocsPage'));
const DeveloperApplicationsPage = lazy(() => import('./pages/DeveloperApplicationsPage'));
const BotBuilderEditorPage = lazy(() => import('./pages/BotBuilderEditorPage'));
const BotMarketplacePage = lazy(() => import('./pages/BotMarketplacePage'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'));
const RoomPage = lazy(() => import('./pages/RoomPage'));
const RoomJoinPage = lazy(() => import('./pages/RoomJoinPage'));
const OpicCloudPage = lazy(() => import('./pages/OpicCloudPage'));

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <PageLoadingFallback />;
  }

  const fallback = <PageLoadingFallback />;

  if (!user) {
    return (
      <Suspense fallback={fallback}>
        <AnalyticsRouteListener />
        <Routes>
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/invite/:code" element={<InvitePage />} />
          <Route path="/changelog" element={<ChangelogPage />} />
          <Route path="/bots" element={<BotMarketplacePage />} />
          <Route path="/developers/*" element={<Navigate to="/login" replace />} />
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
              <AnalyticsRouteListener />
              <Routes>
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/invite/:code" element={<InvitePage />} />
                <Route path="/changelog" element={<ChangelogPage />} />
                <Route path="/bots" element={<BotMarketplacePage />} />
                <Route path="/developers" element={<DeveloperPortalLayout />}>
                  <Route index element={<Navigate to="/developers/docs/api" replace />} />
                  <Route path="docs" element={<DeveloperDocsLayout />}>
                    <Route index element={<Navigate to="/developers/docs/api" replace />} />
                    <Route path="api" element={<DeveloperApiDocsPage />} />
                    <Route path="bots" element={<DeveloperBotsDocsPage />} />
                  </Route>
                  <Route path="apps" element={<DeveloperApplicationsPage />} />
                </Route>
                <Route path="/developer/editor" element={<BotBuilderEditorPage />} />
                <Route path="/developers/editor" element={<BotBuilderEditorPage />} />
                <Route path="/cloud" element={<OpicCloudPage />} />
                <Route path="/rooms/join/:code" element={<RoomJoinPage />} />
                <Route path="/rooms/:roomId" element={<RoomPage />} />
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
