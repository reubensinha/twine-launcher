import { useEffect, useState, useCallback } from 'react';
import { games as gamesApi } from '../api';
import { useAuthStore } from '../store/auth';
import { Button, Modal, Input, Toast, Spinner } from '../components/ui';

// ── File-name helpers ─────────────────────────────────────────────────────────

function nameFromZip(filename: string): string {
  return filename.replace(/\.zip$/i, '').replace(/[-_]/g, ' ');
}
function nameFromFolder(files: FileList): string {
  const first = files[0]?.webkitRelativePath ?? '';
  return first.split('/')[0].replace(/[-_]/g, ' ');
}
import type { Game } from '../types';

export function LibraryPage() {
  const { user }   = useAuthStore();
  const isAdmin    = user?.role === 'admin';
  const [gameList, setGameList] = useState<Game[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [addOpen,  setAddOpen]  = useState(false);
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

  const handleAdd = async (name: string, description: string, zipFile?: File, folderFiles?: File[], folderPaths?: string[]) => {
    setSaving(true);
    try {
      await gamesApi.upload({ name, description: description || undefined, zipFile, folderFiles, folderPaths });
      setToast({ msg: `"${name}" added.`, type: 'success' });
      setAddOpen(false);
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

      <AddGameModal
        open={addOpen}
        saving={saving}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAdd}
      />

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
      {game.format && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {game.format}
        </div>
      )}
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

// ── Add Game Modal ────────────────────────────────────────────────────────────

type UploadMode = 'zip' | 'folder';

function AddGameModal({ open, saving, onClose, onSubmit }: {
  open: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (name: string, description: string, zipFile?: File, folderFiles?: File[], folderPaths?: string[]) => void;
}) {
  const [mode, setMode]               = useState<UploadMode>('zip');
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [zipFile, setZipFile]         = useState<File | null>(null);
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [folderPaths, setFolderPaths] = useState<string[]>([]);
  const [fileLabel, setFileLabel]     = useState('');

  const reset = () => {
    setMode('zip'); setName(''); setDescription('');
    setZipFile(null); setFolderFiles([]); setFolderPaths([]); setFileLabel('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setZipFile(f);
    if (f) {
      setFileLabel(f.name);
      if (!name) setName(nameFromZip(f.name));
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const autoName = nameFromFolder(list);
    const prefix = list[0].webkitRelativePath.split('/')[0] + '/';
    const files = Array.from(list);
    const paths = files.map(f =>
      f.webkitRelativePath.startsWith(prefix)
        ? f.webkitRelativePath.slice(prefix.length)
        : f.webkitRelativePath
    );
    setFolderFiles(files);
    setFolderPaths(paths);
    setFileLabel(`${list.length} file${list.length !== 1 ? 's' : ''} selected`);
    if (!name) setName(autoName);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'zip' && zipFile) {
      onSubmit(name, description, zipFile);
    } else if (mode === 'folder' && folderFiles.length > 0) {
      onSubmit(name, description, undefined, folderFiles, folderPaths);
    }
  };

  const canSubmit = name.trim() !== '' && (mode === 'zip' ? zipFile !== null : folderFiles.length > 0);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, padding: '0.5rem', cursor: 'pointer', border: 'none', borderRadius: 'var(--radius)',
    fontFamily: 'var(--font-ui)', fontSize: '0.82rem',
    background: active ? 'var(--accent)' : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    transition: 'background var(--transition), color var(--transition)',
  });

  return (
    <Modal open={open} onClose={handleClose} title="Add a game">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: '0.25rem', padding: '0.25rem', background: 'var(--surface)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <button type="button" style={tabStyle(mode === 'zip')} onClick={() => { setMode('zip'); setFileLabel(''); setZipFile(null); }}>
            Zip file
          </button>
          <button type="button" style={tabStyle(mode === 'folder')} onClick={() => { setMode('folder'); setFileLabel(''); setFolderFiles([]); setFolderPaths([]); }}>
            Game folder
          </button>
        </div>

        {/* File picker */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-ui)', color: 'var(--text-muted)' }}>
            {mode === 'zip' ? 'Zip archive' : 'Game folder'}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{
              flex: 1, padding: '0.5rem 0.75rem', background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              fontSize: '0.85rem', color: fileLabel ? 'var(--text)' : 'var(--text-muted)',
              fontFamily: 'var(--font-ui)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {fileLabel || (mode === 'zip' ? 'No file chosen' : 'No folder chosen')}
            </span>
            <div style={{ position: 'relative' }}>
              <Button type="button" size="sm">Browse…</Button>
              <input
                type="file"
                accept={mode === 'zip' ? '.zip' : undefined}
                // @ts-expect-error webkitdirectory is not in TS types but works in all modern browsers
                webkitdirectory={mode === 'folder' ? '' : undefined}
                multiple={mode === 'folder'}
                onChange={mode === 'zip' ? handleZipChange : handleFolderChange}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
              />
            </div>
          </div>
        </label>

        <Input label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="My Twine Game" required autoFocus />
        <Input label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional short description" />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem' }}>
          <Button type="button" onClick={handleClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>Add game</Button>
        </div>
      </form>
    </Modal>
  );
}
