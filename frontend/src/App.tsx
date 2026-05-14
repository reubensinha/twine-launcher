import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/auth';
import { useThemeStore } from './store/theme';
import { auth as authApi } from './api';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage }     from './pages/Login';
import { SetupPage }     from './pages/Setup';
import { LibraryPage }   from './pages/Library';
import { GamePage }      from './pages/GamePage';
import { SettingsPage }  from './pages/Settings';
import { ForceChangePasswordPage } from './pages/ForceChangePassword';
import { AdminDashboard } from './pages/admin/Dashboard';
import { UsersPage }      from './pages/admin/Users';
import { BackupPage }     from './pages/admin/Backup';
import { LogsPage }       from './pages/admin/Logs';
import { Spinner }        from './components/ui';

function RequireAuth({ children, adminOnly = false }: { children: JSX.Element; adminOnly?: boolean }) {
  const { user } = useAuthStore();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />;
  if (user.force_password_change && location.pathname !== '/force-change-password') {
    return <Navigate to="/force-change-password" replace />;
  }
  return children;
}

function AppRouter() {
  const { user, hydrate }           = useAuthStore();
  const { fetchActive, fetchBuiltins } = useThemeStore();
  const [booting,       setBooting]       = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Always pre-load builtins (public endpoint, needed for settings page)
      fetchBuiltins();
      try {
        const { setup_required } = await authApi.setupRequired();
        if (setup_required) {
          setSetupRequired(true);
        } else {
          await hydrate();
          // Apply theme after auth is known
          await fetchActive();
        }
      } catch {
        // Server unreachable — stay on login
      } finally {
        setBooting(false);
      }
    };
    init();
  }, [hydrate, fetchActive, fetchBuiltins]);

  if (booting) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '1rem' }}>
        <Spinner size={28} color="var(--text-muted)" />
        <span style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Loading…
        </span>
      </div>
    );
  }

  if (setupRequired) {
    return (
      <Routes>
        <Route path="*" element={<SetupPage onComplete={() => setSetupRequired(false)} />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/force-change-password" element={<RequireAuth><ForceChangePasswordPage /></RequireAuth>} />
      <Route path="/play/:id" element={<RequireAuth><GamePage /></RequireAuth>} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<LibraryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin"        element={<RequireAuth adminOnly><AdminDashboard /></RequireAuth>} />
        <Route path="/admin/users"  element={<RequireAuth adminOnly><UsersPage /></RequireAuth>} />
        <Route path="/admin/logs"   element={<RequireAuth adminOnly><LogsPage /></RequireAuth>} />
        <Route path="/backup"       element={<RequireAuth><BackupPage /></RequireAuth>} />
        <Route path="/admin/backup" element={<Navigate to="/backup" replace />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  );
}
