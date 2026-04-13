import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useThemeStore } from '../store/theme';
import { Button, Input, Toast } from '../components/ui';

export function SetupPage({ onComplete }: { onComplete?: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const { setup }         = useAuthStore();
  const { fetchActive }   = useThemeStore();
  const navigate          = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 6)  { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await setup(username, password);
      await fetchActive();
      onComplete?.();
      navigate('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', background: 'var(--bg)',
    }}>
      <div className="fade-up" style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
            First run
          </p>
          <h1 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.9rem', fontWeight: 400 }}>
            Create your account
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.5rem', lineHeight: 1.6 }}>
            This will be your admin account. You can add other users and change settings afterwards.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
          <Input label="Username" id="username" autoFocus value={username} onChange={e => setUsername(e.target.value)} required />
          <Input label="Password" id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          <Input label="Confirm password" id="confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required />
          <Button type="submit" variant="primary" loading={loading} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
            Create account
          </Button>
        </form>
      </div>
      {error && <Toast message={error} type="error" onDismiss={() => setError('')} />}
    </div>
  );
}
