import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { Button, Input, Toast } from '../components/ui';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const { fetchActive } = useThemeStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      await fetchActive();
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Incorrect username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', background: 'var(--bg)',
    }}>
      <div className="fade-up" style={{ width: 'min(360px, 100%)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '2rem', fontWeight: 400, color: 'var(--text)', marginBottom: '0.3rem' }}>
            Twine Launcher
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sign in to your library</p>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
          <Input label="Username" id="username" autoFocus autoComplete="username"
            value={username} onChange={e => setUsername(e.target.value)} required />
          <Input label="Password" id="password" type="password" autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          <Button type="submit" variant="primary" loading={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
            Sign In
          </Button>
        </form>
      </div>
      {error && <Toast message={error} type="error" onDismiss={() => setError('')} />}
    </div>
  );
}
