import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useWebSocket } from './hooks/useWebSocket';
import LoadingSpinner from './components/LoadingSpinner';
import LoginPage from './pages/LoginPage';
import EmbedPlayerPage from './pages/EmbedPlayerPage';
import DashboardPage from './pages/DashboardPage';
import ChannelsPage from './pages/ChannelsPage';
import ChannelDetailPage from './pages/ChannelDetailPage';
import ChannelOutputsPage from './pages/ChannelOutputsPage';
import PlaylistsPage from './pages/PlaylistsPage';
import TranscodingPage from './pages/TranscodingPage';
import TokensPage from './pages/TokensPage';
import OverlaysPage from './pages/OverlaysPage';
import MonitoringPage from './pages/MonitoringPage';
import BrandProfilesPage from './pages/BrandProfilesPage';
import ProcessingPage from './pages/ProcessingPage';
import BenchmarkPage from './pages/BenchmarkPage';
import BlueprintsPage from './pages/BlueprintsPage';
import SettingsPage from './pages/SettingsPage';
import InstallPage from './pages/InstallPage';

function AuthenticatedApp() {
  useWebSocket();

  return (
    <Routes>
      <Route path="/dashboard" element={<Navigate to="/" replace />} />
      <Route path="/" element={<DashboardPage />} />
      <Route path="/channels" element={<ChannelsPage />} />
      <Route path="/channels/:id" element={<ChannelDetailPage />} />
      <Route path="/channels/:id/outputs" element={<ChannelOutputsPage />} />
      <Route path="/playlists" element={<PlaylistsPage />} />
      <Route path="/transcoding" element={<TranscodingPage />} />
      <Route path="/tokens" element={<TokensPage />} />
      <Route path="/overlays" element={<OverlaysPage />} />
      <Route path="/monitoring" element={<MonitoringPage />} />
      <Route path="/brand-profiles" element={<BrandProfilesPage />} />
      <Route path="/processing" element={<ProcessingPage />} />
      <Route path="/benchmark" element={<BenchmarkPage />} />
      <Route path="/blueprints" element={<BlueprintsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/install" element={<InstallPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function AppShell() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/embed/:slug" element={<EmbedPlayerPage />} />
      <Route path="/*" element={<AppShell />} />
    </Routes>
  );
}
