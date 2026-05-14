import { useEffect, useState, useCallback } from 'react';
import { users as usersApi } from '../../api';
import { useAuthStore } from '../../store/auth';
import { Button, Modal, Input, Select, Toast, Spinner } from '../../components/ui';
import type { User, UserCreate } from '../../types';

const ROLE_OPTIONS = [{ value: 'player', label: 'Player' }, { value: 'admin', label: 'Admin' }];
const EMPTY: UserCreate = { username: '', password: '', role: 'player' };

export function UsersPage() {
  const { user: self } = useAuthStore();
  const [userList, setUserList] = useState<User[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [createOpen,  setCreateOpen]  = useState(false);
  const [newUser,     setNewUser]     = useState<UserCreate>(EMPTY);
  const [saving,      setSaving]      = useState(false);
  const [resetResult, setResetResult] = useState<{ username: string; temp_password: string } | null>(null);
  const [copied,      setCopied]      = useState(false);
  const [toast,       setToast]       = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setUserList(await usersApi.list()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await usersApi.create(newUser);
      setToast({ msg: `User "${newUser.username}" created.`, type: 'success' });
      setCreateOpen(false);
      setNewUser(EMPTY);
      load();
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Create failed', type: 'error' });
    } finally { setSaving(false); }
  };

  const handleToggle = async (u: User) => {
    try {
      await usersApi.update(u.id, { is_active: !u.is_active });
      load();
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Update failed', type: 'error' });
    }
  };

  const handleReset = async (u: User) => {
    try {
      const { temp_password } = await usersApi.resetPassword(u.id);
      setCopied(false);
      setResetResult({ username: u.username, temp_password });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Reset failed', type: 'error' });
    }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Delete "${u.username}"? This will remove all their save data.`)) return;
    try {
      await usersApi.delete(u.id);
      setToast({ msg: `"${u.username}" deleted.`, type: 'info' });
      load();
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Delete failed', type: 'error' });
    }
  };

  return (
    <div style={{ padding: '2.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Users</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
            {userList.length} {userList.length === 1 ? 'user' : 'users'}
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>+ Add user</Button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><Spinner size={24} /></div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Username', 'Role', 'Status', 'Joined', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontFamily: 'var(--font-ui)', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {userList.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border)', opacity: u.is_active ? 1 : 0.45 }}>
                <td style={{ padding: '0.9rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.95rem' }}>
                  {u.username}
                  {u.id === self?.id && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: '0.5rem', fontFamily: 'var(--font-ui)' }}>(you)</span>}
                </td>
                <td style={{ padding: '0.9rem 0.75rem', color: u.role === 'admin' ? 'var(--accent)' : 'var(--text-muted)', fontSize: '0.78rem', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{u.role}</td>
                <td style={{ padding: '0.9rem 0.75rem', color: u.is_active ? 'var(--text-muted)' : '#c06060', fontSize: '0.78rem', fontFamily: 'var(--font-ui)' }}>{u.is_active ? 'active' : 'inactive'}</td>
                <td style={{ padding: '0.9rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                <td style={{ padding: '0.9rem 0.75rem' }}>
                  {u.id !== self?.id && (
                    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                      <Button size="sm" onClick={() => handleReset(u)}>Reset pw</Button>
                      <Button size="sm" onClick={() => handleToggle(u)} style={{ color: u.is_active ? 'var(--text-muted)' : 'var(--accent)' }}>
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </Button>
                      <Button variant="danger" size="sm" onClick={() => handleDelete(u)}>Delete</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Modal open={!!resetResult} onClose={() => setResetResult(null)} title="Password reset">
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
          Temporary password for <strong style={{ color: 'var(--text)' }}>{resetResult?.username}</strong>.
          Share it with the user — they'll be prompted to set a new password on their next login.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <code style={{
            flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
            padding: '0.5rem 0.75rem', background: 'var(--bg)',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            color: 'var(--text)', letterSpacing: '0.04em',
          }}>
            {resetResult?.temp_password}
          </code>
          <Button size="sm" variant={copied ? 'primary' : 'ghost'} onClick={() => {
            navigator.clipboard.writeText(resetResult!.temp_password);
            setCopied(true);
          }}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Modal>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add a user">
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Input label="Username" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} required autoFocus />
          <Input label="Password" type="password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} required />
          <Select label="Role" value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value as 'admin' | 'player' })} options={ROLE_OPTIONS} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
            <Button type="button" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>Create user</Button>
          </div>
        </form>
      </Modal>

      {toast && <Toast message={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
