import React, { useEffect, useState } from 'react';
import { saves as savesApi, SaveSummary } from '../api';
import { useAuthStore } from '../store/auth';
import { Spinner } from '../components/ui';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function SaveKeyChips({ data }: { data: Record<string, string> }) {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    return <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No save data</span>;
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
      {keys.map(k => (
        <span key={k} style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
          color: 'var(--text-muted)', background: 'var(--surface2)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          padding: '0.15rem 0.5rem', whiteSpace: 'nowrap',
        }}>
          {k} <span style={{ opacity: 0.6 }}>({formatBytes(data[k]?.length ?? 0)})</span>
        </span>
      ))}
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
}

export function SavesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [items, setItems] = useState<SaveSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    savesApi.all()
      .then(setItems)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load saves'))
      .finally(() => setLoading(false));
  }, []);

  // Group by game_id, preserving first-seen game_name
  const games = React.useMemo(() => {
    const map = new Map<number, { game_name: string; saves: SaveSummary[] }>();
    for (const item of items) {
      if (!map.has(item.game_id)) map.set(item.game_id, { game_name: item.game_name, saves: [] });
      map.get(item.game_id)!.saves.push(item);
    }
    return [...map.entries()].sort((a, b) => a[1].game_name.localeCompare(b[1].game_name));
  }, [items]);

  const toggle = (id: number) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '2.5rem 2rem' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Saves</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
          {isAdmin ? 'All users\' save data, grouped by game.' : 'Your save data, grouped by game.'}
        </p>
      </div>

      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <Spinner size={24} color="var(--text-muted)" />
        </div>
      )}

      {error && (
        <p style={{ color: '#c06060', fontFamily: 'var(--font-ui)', fontSize: '0.85rem' }}>{error}</p>
      )}

      {!loading && !error && games.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', fontStyle: 'italic', fontSize: '0.85rem' }}>
          No saves found.
        </p>
      )}

      {!loading && games.map(([gameId, { game_name, saves: gameSaves }]) => {
        const isOpen = expanded.has(gameId);
        return (
          <div key={gameId} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            marginBottom: '0.6rem', overflow: 'hidden',
          }}>
            {/* Game header row */}
            <button
              onClick={() => toggle(gameId)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: '1rem',
                padding: '0.75rem 1.1rem',
                background: isOpen ? 'var(--surface2)' : 'var(--surface)',
                border: 'none', cursor: 'pointer',
                transition: 'background var(--transition)',
                textAlign: 'left',
              }}
            >
              <span style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1rem', color: 'var(--text)' }}>
                {game_name}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  {gameSaves.length} {gameSaves.length === 1 ? 'save' : 'saves'}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--transition)' }}>▾</span>
              </span>
            </button>

            {/* Save rows */}
            {isOpen && (
              <div>
                {/* Column header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: isAdmin ? '140px 180px 1fr' : '180px 1fr',
                  gap: '1rem', padding: '0.4rem 1.1rem',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}>
                  {isAdmin && <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>User</span>}
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Last saved</span>
                  <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Save data</span>
                </div>
                {gameSaves.map(s => (
                  <div key={s.user_id} style={{
                    display: 'grid',
                    gridTemplateColumns: isAdmin ? '140px 180px 1fr' : '180px 1fr',
                    gap: '1rem', padding: '0.65rem 1.1rem',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--surface)',
                    alignItems: 'start',
                  }}>
                    {isAdmin && (
                      <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.8rem', color: 'var(--text)' }}>
                        {s.username}
                      </span>
                    )}
                    <span style={{ fontFamily: 'var(--font-ui)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {formatDate(s.updated_at)}
                    </span>
                    <SaveKeyChips data={s.data} />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
