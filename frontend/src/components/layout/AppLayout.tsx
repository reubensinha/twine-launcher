import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  const linkStyle = (isActive: boolean): React.CSSProperties => ({
    fontFamily: 'var(--font-ui)', fontSize: '0.8rem', fontWeight: isActive ? 500 : 400,
    color: isActive ? 'var(--text)' : 'var(--text-muted)',
    transition: 'color var(--transition)',
    textDecoration: 'none', padding: '0.2rem 0',
    borderBottom: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: '2rem',
        padding: '0 2rem', height: 50, flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)',
      }}>
        {/* Wordmark */}
        <NavLink to="/" style={{ fontFamily: 'var(--font-body)', fontSize: '1rem', fontStyle: 'italic', fontWeight: 500, color: 'var(--text)', letterSpacing: '0.01em' }}>
          Twine Launcher
        </NavLink>

        <nav style={{ display: 'flex', gap: '1.5rem', flex: 1, alignItems: 'center' }}>
          <NavLink to="/" end style={({ isActive }) => linkStyle(isActive)}>Library</NavLink>
          <NavLink to="/backup" style={({ isActive }) => linkStyle(isActive)}>Backup</NavLink>
          {user?.role === 'admin' && (
            <>
              <NavLink to="/admin"       style={({ isActive }) => linkStyle(isActive)}>Sessions</NavLink>
              <NavLink to="/admin/users" style={({ isActive }) => linkStyle(isActive)}>Users</NavLink>
            </>
          )}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
          <NavLink to="/settings" style={({ isActive }) => ({ ...linkStyle(isActive), fontSize: '0.75rem', color: isActive ? 'var(--text)' : 'var(--text-muted)' })}>
            {user?.username}{user?.role === 'admin' ? ' ·' : ''}
          </NavLink>
          <button onClick={handleLogout} style={{
            fontFamily: 'var(--font-ui)', fontSize: '0.72rem', color: 'var(--text-muted)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: '0.22rem 0.65rem', cursor: 'pointer', background: 'none',
            transition: 'all var(--transition)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#c06060'; e.currentTarget.style.borderColor = '#c06060'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border)'; }}>
            sign out
          </button>
        </div>
      </header>

      <main style={{ flex: 1, overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
