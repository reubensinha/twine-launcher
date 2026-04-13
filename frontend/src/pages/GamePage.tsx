import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { games as gamesApi, sessions as sessionsApi, getToken } from '../api';
import { Spinner } from '../components/ui';

const POLL_MS = 3000;

export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const gameId = parseInt(id ?? '0', 10);

  const [gameInfo, setGameInfo] = useState<{
    session_id: number; game_url: string; game_name: string;
    initial_saves: Record<string, string>;
  } | null>(null);
  const [error, setError] = useState('');

  const frameRef     = useRef<HTMLIFrameElement>(null);
  const sessionIdRef = useRef<number | null>(null);
  const lastSnapRef  = useRef<string>('{}');
  const [syncState, setSyncState] = useState<'' | 'syncing' | 'error'>('');

  // ── Start session ───────────────────────────────────────────────────────────
  useEffect(() => {
    gamesApi.startSession(gameId)
      .then(info => {
        sessionIdRef.current = info.session_id;
        lastSnapRef.current  = JSON.stringify(info.initial_saves);
        setGameInfo(info);
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to start game'));

    return () => {
      if (sessionIdRef.current !== null) {
        // keepalive so the request completes even if the component is unmounting
        const token = getToken();
        fetch(`/api/v1/sessions/${sessionIdRef.current}`, {
          method: 'DELETE',
          keepalive: true,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        sessionIdRef.current = null;
      }
    };
  }, [gameId]);

  // ── Inject saves → navigate iframe → start polling ─────────────────────────
  useEffect(() => {
    if (!gameInfo || !frameRef.current) return;
    const frame = frameRef.current;

    const onFirstLoad = () => {
      try {
        const iLS = frame.contentWindow!.localStorage;
        for (const [k, v] of Object.entries(gameInfo.initial_saves)) {
          iLS.setItem(k, v);
        }
      } catch { /* cross-origin guard — shouldn't happen (same origin) */ }
      frame.src = gameInfo.game_url;
    };
    frame.addEventListener('load', onFirstLoad, { once: true });
    frame.src = 'about:blank';

    const interval = setInterval(async () => {
      try {
        const iLS = frame.contentWindow?.localStorage;
        if (!iLS) return;
        const snap: Record<string, string> = {};
        for (let i = 0; i < iLS.length; i++) {
          const k = iLS.key(i)!;
          snap[k] = iLS.getItem(k)!;
        }
        const serialized = JSON.stringify(snap);
        if (serialized === lastSnapRef.current) return;
        setSyncState('syncing');
        const token = getToken();
        const res = await fetch(`/api/v1/saves/${gameId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ data: snap }),
        });
        if (!res.ok) throw new Error(res.statusText);
        lastSnapRef.current = serialized;
        setSyncState('');
      } catch {
        setSyncState('error');
      }
    }, POLL_MS);

    return () => {
      clearInterval(interval);
      frame.removeEventListener('load', onFirstLoad);
    };
  }, [gameInfo, gameId]);

  // ── Render ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1rem',
        background: 'var(--bg)', color: 'var(--text)',
      }}>
        <p style={{ color: 'var(--danger, #c0392b)', fontFamily: 'var(--font-ui)' }}>{error}</p>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.5rem 1rem', cursor: 'pointer', color: 'var(--text)', fontFamily: 'var(--font-ui)' }}
        >
          ← Back to Library
        </button>
      </div>
    );
  }

  if (!gameInfo) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <Spinner size={28} color="var(--text-muted)" />
      </div>
    );
  }

  const syncLabel: Record<typeof syncState, string> = {
    '': '●', syncing: '↑ saving', error: '✕ sync error',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 50 }}>
      <iframe
        ref={frameRef}
        src="about:blank"
        title={gameInfo.game_name}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />

      {/* Back button — top-left overlay */}
      <button
        onClick={() => navigate('/')}
        title="Back to Library"
        style={{
          position: 'fixed', top: 10, left: 10, zIndex: 51,
          background: 'rgba(0,0,0,0.55)', color: 'rgba(255,255,255,0.75)',
          border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6,
          padding: '4px 10px', cursor: 'pointer',
          fontFamily: 'monospace', fontSize: 12,
          backdropFilter: 'blur(4px)',
          transition: 'opacity 0.2s',
        }}
      >
        ← Library
      </button>

      {/* Sync indicator — bottom-right */}
      <div style={{
        position: 'fixed', bottom: 12, right: 16, zIndex: 51,
        fontFamily: 'monospace', fontSize: 11, pointerEvents: 'none',
        color: syncState === 'syncing' ? 'rgba(120,220,120,0.7)'
             : syncState === 'error'   ? 'rgba(220,80,80,0.7)'
             : 'rgba(255,255,255,0.25)',
        transition: 'color 0.4s',
      }}>
        {syncLabel[syncState]}
      </div>
    </div>
  );
}
