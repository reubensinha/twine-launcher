import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { games as gamesApi, saves as savesApi, getToken } from '../api';
import { useAuthStore } from '../store/auth';
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

type Phase = 'loading' | 'landing' | 'playing';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function SaveKeyChips({ data }: { data: Record<string, string> }) {
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.5rem' }}>
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

export function GamePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const gameId = parseInt(id ?? '0', 10);
  const { user } = useAuthStore();

  const [phase, setPhase] = useState<Phase>('loading');
  const [gameInfo, setGameInfo] = useState<{
    session_id: number; game_url: string; game_name: string;
    initial_saves: Record<string, string>; save_updated_at: string | null;
  } | null>(null);
  const [error, setError] = useState('');

  const frameRef      = useRef<HTMLIFrameElement>(null);
  const sessionIdRef  = useRef<number | null>(null);
  const lastSnapRef   = useRef<string>('{}');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSyncingRef  = useRef(false);
  // Holds session info when injection fails so startNewGame can still launch the game
  const pendingInfoRef = useRef<typeof gameInfo>(null);
  // Captures autosave preference at game-start; ref avoids re-triggering the gameInfo effect
  const autosaveEnabledRef = useRef<boolean>(true);
  autosaveEnabledRef.current = user?.autosave_enabled ?? true;
  const [syncState, setSyncState] = useState<'' | 'syncing' | 'saved' | 'restored' | 'error'>('');
  const [restoreError, setRestoreError] = useState<string | null>(null);

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
      const jwt2 = localStorage.getItem('twine_access_token');
      localStorage.clear();
      if (jwt2) localStorage.setItem('twine_access_token', jwt2);
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, []);

  // ── Start session ───────────────────────────────────────────────────────────
  useEffect(() => {
    gamesApi.startSession(gameId)
      .then(info => {
        // Step 2: inject saves synchronously — game must not start if this fails
        const saves = Object.entries(info.initial_saves)
          .filter(([k]) => k !== 'twine_access_token');
        // Evict stale saves from previous sessions — localStorage is a working
        // buffer; the server holds the authoritative copy.
        const jwt = localStorage.getItem('twine_access_token');
        localStorage.clear();
        if (jwt) localStorage.setItem('twine_access_token', jwt);
        if (saves.length > 0) {
          try {
            for (const [k, v] of saves) window.localStorage.setItem(k, v);
          } catch (err) {
            // Injection failed — store info for startNewGame, block game start
            sessionIdRef.current = info.session_id;
            pendingInfoRef.current = info;
            setRestoreError(err instanceof Error ? err.message : String(err));
            return;
          }
        }
        sessionIdRef.current = info.session_id;
        lastSnapRef.current  = JSON.stringify(Object.fromEntries(saves));
        setGameInfo(info);
        setPhase('landing'); // Show landing screen; game starts only after user clicks Start
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
        const jwt3 = localStorage.getItem('twine_access_token');
        localStorage.clear();
        if (jwt3) localStorage.setItem('twine_access_token', jwt3);
      }
    };
  }, [gameId]);

  // ── Sync saves to server ────────────────────────────────────────────────────
  const syncSaves = useCallback(async (force = false) => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      // Read from parent window.localStorage — same bucket as the game iframe (same origin).
      // Avoids SecurityError from crossing the iframe boundary via contentWindow.
      const snap: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)!;
        if (k === 'twine_access_token') continue;
        snap[k] = window.localStorage.getItem(k)!;
      }
      const serialized = JSON.stringify(snap);
      if (!force && serialized === lastSnapRef.current) return;
      setSyncState('syncing');
      await savesApi.sync(gameId, snap);
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

  // ── Start game + polling — only fires when user clicks "Start Game" ──────────
  useEffect(() => {
    if (phase !== 'playing' || !gameInfo || !frameRef.current) return;
    const frame = frameRef.current;

    if (lastSnapRef.current !== '{}') {
      setSyncState('restored');
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSyncState(s => s === 'restored' ? '' : s), 2500);
    }

    frame.src = gameInfo.game_url;
    const interval = autosaveEnabledRef.current
      ? setInterval(() => syncSaves(), POLL_MS)
      : null;
    return () => { if (interval !== null) clearInterval(interval); };
  }, [phase, gameInfo, syncSaves]);

  // ── In-game navigation ──────────────────────────────────────────────────────
  const goBack    = () => frameRef.current?.contentWindow?.history.back();
  const goForward = () => frameRef.current?.contentWindow?.history.forward();

  // ── Start fresh when save injection failed ──────────────────────────────────
  const startNewGame = useCallback(() => {
    lastSnapRef.current = '{}';
    const info = pendingInfoRef.current;
    pendingInfoRef.current = null;
    setRestoreError(null);
    if (info) { setGameInfo(info); setPhase('playing'); }
  }, []);

  // ── Clear saves and launch from landing screen ───────────────────────────────
  const clearAndPlay = useCallback(() => {
    const jwt = localStorage.getItem('twine_access_token');
    localStorage.clear();
    if (jwt) localStorage.setItem('twine_access_token', jwt);
    lastSnapRef.current = '{}';
    setPhase('playing');
  }, []);

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

  if (restoreError !== null) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: '#111', zIndex: 100,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '1.5rem',
      }}>
        <p style={{
          fontFamily: 'monospace', fontSize: 14, color: 'rgba(220,100,100,0.95)',
          textAlign: 'center', maxWidth: 460, lineHeight: 1.6, margin: 0,
        }}>
          Your saves are stored on the server but could not be loaded into this
          browser session.
          {restoreError && (
            <><br /><br />
            <span style={{ color: 'rgba(200,80,80,0.8)', fontSize: 12 }}>
              Error: {restoreError}
            </span></>
          )}
          <br /><br />
          You can return to the library, or start a new game
          (your server-side saves will not be affected unless you play and save again).
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => navigate('/')} style={overlayBtn()}>
            ← Back to Library
          </button>
          <button onClick={startNewGame} style={overlayBtn({ background: 'rgba(160,40,40,0.7)' })}>
            Start New Game
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'loading') {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <Spinner size={28} color="var(--text-muted)" />
      </div>
    );
  }

  if (phase === 'landing' && gameInfo) {
    const hasSaves = Object.keys(gameInfo.initial_saves).length > 0;
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg)', gap: '2rem', padding: '2rem',
      }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>
            Ready to play
          </p>
          <h1 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontWeight: 400, fontSize: '2rem', color: 'var(--text)', margin: 0 }}>
            {gameInfo.game_name}
          </h1>
        </div>

        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: '1.25rem 1.75rem',
          width: '100%', maxWidth: 480,
        }}>
          <p style={{ fontFamily: 'var(--font-ui)', fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.5rem' }}>
            Save data
          </p>
          {hasSaves ? (
            <>
              <p style={{ fontFamily: 'var(--font-ui)', fontSize: '0.82rem', color: 'var(--text)', margin: '0 0 0.5rem' }}>
                Last saved: {gameInfo.save_updated_at
                  ? new Date(gameInfo.save_updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                  : '—'}
              </p>
              <SaveKeyChips data={gameInfo.initial_saves} />
            </>
          ) : (
            <p style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0 }}>
              No previous save — starting fresh.
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => setPhase('playing')}
            style={{
              fontFamily: 'var(--font-ui)', fontSize: '0.85rem', fontWeight: 500,
              background: 'var(--accent)', color: 'var(--accent-text)',
              border: '1px solid var(--accent)', borderRadius: 'var(--radius)',
              padding: '0.55rem 1.75rem', cursor: 'pointer',
              transition: 'opacity var(--transition)',
            }}
          >
            Start Game
          </button>
          {hasSaves && (
            <button
              onClick={clearAndPlay}
              style={{
                fontFamily: 'var(--font-ui)', fontSize: '0.8rem',
                background: 'transparent', color: 'var(--text-muted)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '0.5rem 1.2rem', cursor: 'pointer',
                transition: 'all var(--transition)',
              }}
            >
              Play fresh
            </button>
          )}
          <button
            onClick={() => navigate('/')}
            style={{
              fontFamily: 'var(--font-ui)', fontSize: '0.8rem',
              background: 'transparent', color: 'var(--text-muted)',
              border: 'none', padding: '0.5rem 0.5rem', cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 50 }}>
      <iframe
        ref={frameRef}
        src="about:blank"
        title={gameInfo?.game_name ?? ''}
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
        {syncState === 'restored' && (
          <span style={{
            fontFamily: 'monospace', fontSize: 13, fontWeight: 600,
            color: '#fff', background: 'rgba(30,80,180,0.85)',
            padding: '5px 10px', borderRadius: 5,
            backdropFilter: 'blur(4px)',
          }}>
            ↓ Saves restored
          </span>
        )}
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
