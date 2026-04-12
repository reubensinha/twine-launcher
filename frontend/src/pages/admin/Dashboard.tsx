import { useEffect, useState, useCallback } from 'react';
import { sessions as sessionsApi } from '../../api';
import { Button, Toast, Spinner } from '../../components/ui';
import type { GameSession } from '../../types';

export function AdminDashboard() {
  const [sessionList, setSessionList] = useState<GameSession[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [toast,    setToast]    = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSessionList(await sessionsApi.list()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [load]);

  const handleClose = async (s: GameSession) => {
    if (!confirm(`Force-close "${s.game_name}"?\nAny unsaved progress may be lost.`)) return;
    try {
      await sessionsApi.close(s.id);
      setToast({ msg: `Session for "${s.game_name}" closed.`, type: 'success' });
      load();
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed to close session', type: 'error' });
    }
  };

  const elapsed = (startedAt: string) => {
    const s = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
    if (s < 60)   return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  return (
    <div style={{ padding: '2.5rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Active Sessions</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
          Games currently open in browser tabs. Refreshes every 10 seconds.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><Spinner size={24} /></div>
      ) : sessionList.length === 0 ? (
        <div style={{ padding: '3rem 2rem', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)', fontStyle: 'italic', fontFamily: 'var(--font-body)', fontSize: '1rem' }}>
          No games are currently open.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Game', 'User', 'Duration', 'Started', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontFamily: 'var(--font-ui)', fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessionList.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.9rem 0.75rem', fontFamily: 'var(--font-body)', fontSize: '0.95rem' }}>{s.game_name}</td>
                <td style={{ padding: '0.9rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontSize: '0.8rem' }}>{s.username}</td>
                <td style={{ padding: '0.9rem 0.75rem', color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>{elapsed(s.started_at)}</td>
                <td style={{ padding: '0.9rem 0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{new Date(s.started_at).toLocaleTimeString()}</td>
                <td style={{ padding: '0.9rem 0.75rem', textAlign: 'right' }}>
                  <Button variant="danger" size="sm" onClick={() => handleClose(s)}>Force close</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
