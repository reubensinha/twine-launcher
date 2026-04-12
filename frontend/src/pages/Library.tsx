import { useEffect, useState, useCallback } from 'react';
import { games as gamesApi } from '../api';
import { useAuthStore } from '../store/auth';
import { Button, Modal, Input, Select, Toast, Spinner } from '../components/ui';
import type { Game, GameCreate } from '../types';

const FORMATS = ['SugarCube', 'Harlowe', 'Chapbook', 'Snowman', 'Other'].map(f => ({ value: f, label: f }));

const EMPTY_FORM: GameCreate = { name: '', format: 'SugarCube', file_path: '' };

export function LibraryPage() {
  const { user }   = useAuthStore();
  const isAdmin    = user?.role === 'admin';
  const [gameList, setGameList] = useState<Game[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [addOpen,  setAddOpen]  = useState(false);
  const [form,     setForm]     = useState<GameCreate>(EMPTY_FORM);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setGameList(await gamesApi.list()); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePlay = (game: Game) => {
    // The /play endpoint itself enforces single-instance and returns 409 if already open.
    // We open in a new tab; if the tab open fails due to 409, the wrapper page will show the error.
    window.open(gamesApi.playUrl(game.id), '_blank', 'noopener');
  };

  const handleDelete = async (game: Game) => {
    if (!confirm(`Remove "${game.name}" from the library?\nThis also deletes all save data for this game.`)) return;
    try {
      await gamesApi.delete(game.id);
      setToast({ msg: `"${game.name}" removed.`, type: 'info' });
      load();
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Remove failed', type: 'error' });
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await gamesApi.create(form);
      setToast({ msg: `"${form.name}" added.`, type: 'success' });
      setAddOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed to add game', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '2.5rem 2.5rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontWeight: 400, fontSize: '1.7rem' }}>
            Your Library
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
            {gameList.length === 0 ? 'No games yet' : `${gameList.length} ${gameList.length === 1 ? 'game' : 'games'}`}
          </p>
        </div>
        {isAdmin && (
          <Button variant="primary" onClick={() => setAddOpen(true)}>+ Add game</Button>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '5rem' }}><Spinner size={28} /></div>
      ) : gameList.length === 0 ? (
        <EmptyState isAdmin={isAdmin} onAdd={() => setAddOpen(true)} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1px', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {gameList.map((game, i) => (
            <GameCard key={game.id} game={game} index={i} isAdmin={isAdmin} onPlay={() => handlePlay(game)} onDelete={() => handleDelete(game)} />
          ))}
        </div>
      )}

      {/* Add modal */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a game">
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Input label="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="My Twine Game" required autoFocus />
          <Select label="Format" value={form.format} onChange={e => setForm({ ...form, format: e.target.value })} options={FORMATS} />
          <Input label="File path" value={form.file_path} onChange={e => setForm({ ...form, file_path: e.target.value })} placeholder="my-game/index.html" required />
          <Input label="Description" value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value || undefined })} placeholder="Optional short description" />
          <Input label="Cover image URL" value={form.cover_image ?? ''} onChange={e => setForm({ ...form, cover_image: e.target.value || undefined })} placeholder="/static/games/my-game/cover.jpg" />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
            <Button type="button" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" loading={saving}>Add game</Button>
          </div>
        </form>
      </Modal>

      {toast && <Toast message={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function EmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <div style={{
      padding: '5rem 2rem', textAlign: 'center', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)',
    }}>
      <p style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.1rem', marginBottom: '1rem' }}>
        No games in your library yet.
      </p>
      {isAdmin && <Button variant="primary" onClick={onAdd}>Add your first game</Button>}
    </div>
  );
}

function GameCard({ game, index, isAdmin, onPlay, onDelete }: {
  game: Game; index: number; isAdmin: boolean; onPlay: () => void; onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="fade-up"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        animationDelay: `${index * 0.035}s`,
        background: hovered ? 'var(--surface)' : 'var(--bg)',
        transition: 'background var(--transition)',
        padding: '1.4rem 1.6rem',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
        cursor: 'default',
      }}
    >
      {/* Cover image if present */}
      {game.cover_image && (
        <img src={game.cover_image} alt={game.name}
          style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 'var(--radius)', marginBottom: '0.3rem' }} />
      )}

      <div style={{ fontFamily: 'var(--font-body)', fontSize: '1.05rem', fontWeight: 500, color: 'var(--text)', lineHeight: 1.3 }}>
        {game.name}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {game.format}
      </div>
      {game.description && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.5, flex: 1, marginTop: '0.1rem' }}>
          {game.description}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
        <Button variant="primary" size="sm" onClick={onPlay}>Play</Button>
        {isAdmin && <Button variant="danger" size="sm" onClick={onDelete}>Remove</Button>}
      </div>
    </div>
  );
}
