import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { games as gamesApi, getToken } from '../api';
import { Spinner } from '../components/ui';

const POLL_MS = 3000;

// Shared style for the overlay control buttons
const overlayBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
  background: 'rgba(0,0,0,0.55)',
  color: 'rgba(255,255,255,0.8)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 5,
  padding: '4px 9px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 13,
  lineHeight: 1,
  backdropFilter: 'blur(4px)',
  userSelect: 'none',
  ...extra,
});

export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const gameId = parseInt(id ?? '0', 10);

  const [gameInfo, setGameInfo] = useState<{
    session_id: number; game_url: string; game_name: string;
    initial_saves: Record<string, string>;
  } | null>(null);
  const [error, setError] = useState('');

  const frameRef      = useRef<HTMLIFrameElement>(null);
  const sessionIdRef  = useRef<number | null>(null);
  const lastSnapRef   = useRef<string>('{}');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncingRef  = useRef(false);
  const [syncState, setSyncState] = useState<'' | 'syncing' | 'saved' | 'error'>('');

  // ── Delete session on full page unload (window close) ──────────────────────
  useEffect(() => {
    const handlePageHide = () => {
      const sid = sessionIdRef.current;
      if (sid === null) return;
      sessionIdRef.current = null; // prevent double-DELETE with cleanup effect
      const token = getToken();
      fetch(`/api/v1/sessions/${sid}`, {
        method: 'DELETE',
        keepalive: true,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

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

  // ── Sync saves to server ────────────────────────────────────────────────────
  const syncSaves = useCallback(async (force = false) => {
    if (isSyncingRef.current) return;
    const frame = frameRef.current;
    if (!frame) return;
    isSyncingRef.current = true;
    try {
      const iLS = frame.contentWindow?.localStorage;
      if (!iLS) return;
      const snap: Record<string, string> = {};
      for (let i = 0; i < iLS.length; i++) {
        const k = iLS.key(i)!;
        snap[k] = iLS.getItem(k)!;
      }
      const serialized = JSON.stringify(snap);
      if (!force && serialized === lastSnapRef.current) return;
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
      setSyncState('saved');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSyncState(s => s === 'saved' ? '' : s), 2500);
    } catch {
      setSyncState('error');
    } finally {
      isSyncingRef.current = false;
    }
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
      } catch { /* same-origin guard */ }
      frame.src = gameInfo.game_url;
    };
    frame.addEventListener('load', onFirstLoad, { once: true });
    frame.src = 'about:blank';

    const interval = setInterval(() => syncSaves(), POLL_MS);
    return () => {
      clearInterval(interval);
      frame.removeEventListener('load', onFirstLoad);
    };
  }, [gameInfo, syncSaves]);

  // ── In-game navigation ──────────────────────────────────────────────────────
  const goBack    = () => frameRef.current?.contentWindow?.history.back();
  const goForward = () => frameRef.current?.contentWindow?.history.forward();

  // ── Render ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1rem',
        background: 'var(--bg)', color: 'var(--text)',
      }}>
        <p style={{ color: 'var(--danger, #c0392b)', fontFamily: 'var(--font-ui)' }}>{error}</p>
        <button onClick={() => navigate('/')} style={overlayBtn()}>← Back to Library</button>
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

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 50 }}>
      <iframe
        ref={frameRef}
        src="about:blank"
        title={gameInfo.game_name}
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
      />

      {/* Top-left control bar */}
      <div style={{
        position: 'fixed', top: 10, left: 10, zIndex: 51,
        display: 'flex', gap: 4, alignItems: 'center',
      }}>
        <button onClick={() => navigate('/')} title="Back to Library" style={overlayBtn()}>
          ← Lib
        </button>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.2)', margin: '0 2px' }} />
        <button onClick={goBack} title="Go back in game" style={overlayBtn()}>
          ‹
        </button>
        <button onClick={goForward} title="Go forward in game" style={overlayBtn()}>
          ›
        </button>
      </div>

      {/* Bottom-right: manual save + sync indicator */}
      <div style={{
        position: 'fixed', bottom: 12, right: 14, zIndex: 51,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        {syncState === 'error' && (
          <span style={{
            fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
            color: '#fff', background: 'rgba(190,50,50,0.85)',
            padding: '5px 10px', borderRadius: 5,
            backdropFilter: 'blur(4px)',
          }}>
            ✕ Save failed
          </span>
        )}
        {syncState === 'syncing' && (
          <span style={{
            fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
            color: '#fff', background: 'rgba(30,110,30,0.85)',
            padding: '5px 10px', borderRadius: 5,
            backdropFilter: 'blur(4px)',
          }}>
            ↑ Saving…
          </span>
        )}
        {syncState === 'saved' && (
          <span style={{
            fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
            color: '#fff', background: 'rgba(30,130,30,0.85)',
            padding: '5px 10px', borderRadius: 5,
            backdropFilter: 'blur(4px)',
          }}>
            ✓ Saved
          </span>
        )}
        <button
          onClick={() => syncSaves(true)}
          title="Save now"
          disabled={syncState === 'syncing'}
          style={overlayBtn({ opacity: syncState === 'syncing' ? 0.5 : 1 })}
        >
          ↑ Save
        </button>
      </div>
    </div>
  );
}
