import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth as authApi } from '../api';
import { useAuthStore } from '../store/auth';
import { Button, Input } from '../components/ui';

export function ForceChangePasswordPage() {
  const navigate = useNavigate();
  const { hydrate } = useAuthStore();
  const [newPw, setNewPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < 8) { setError('Password must be at least 8 characters.'); return; }
    setSaving(true);
    setError(null);
    try {
      await authApi.changePassword('', newPw);
      await hydrate();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', background: 'var(--bg)',
    }}>
      <div className="fade-up" style={{ width: 'min(380px, 100%)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400, color: 'var(--text)', marginBottom: '0.4rem' }}>
            Set a new password
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>
            Your password has been reset by an admin. Please choose a new password to continue.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
          padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem',
        }}>
          <Input
            label="New password"
            id="new-password"
            type="password"
            autoFocus
            autoComplete="new-password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            required
          />
          {error && (
            <p style={{ color: '#c06060', fontSize: '0.82rem', margin: 0 }}>{error}</p>
          )}
          <Button type="submit" variant="primary" loading={saving} style={{ width: '100%', justifyContent: 'center', marginTop: '0.25rem' }}>
            Set password
          </Button>
        </form>
      </div>
    </div>
  );
}
