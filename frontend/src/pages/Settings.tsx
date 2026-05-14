import { useEffect, useRef, useState, useCallback } from 'react';
import { auth, configApi, themeApi } from '../api';
import { useAuthStore } from '../store/auth';
import { useThemeStore, type BuiltinTheme, type ThemeData } from '../store/theme';
import { Button, Input, Modal, Toggle, Toast } from '../components/ui';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function SettingsPage() {
  const { user, updatePrefs }        = useAuthStore();
  const { builtins, fetchBuiltins, fetchActive, active, source } = useThemeStore();
  const [globalSaving, setGlobalSaving] = useState<string | null>(null);
  const [userSaving,   setUserSaving]   = useState<string | null>(null);
  const [toast, setToast]               = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null);
  const globalFileRef  = useRef<HTMLInputElement>(null);
  const userFileRef    = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === 'admin';

  const [autostart, setAutostart]                             = useState(false);
  const [autostartLoading, setAutostartLoading]               = useState(false);
  const [autosaveSaving, setAutosaveSaving]                   = useState(false);
  const [externalAccess, setExternalAccess]                   = useState(false);
  const [externalAccessLoading, setExternalAccessLoading]     = useState(false);
  const [networkInfo, setNetworkInfo]                         = useState<{ running_port: number; configured_port: number; local_ip: string | null } | null>(null);
  const [editPort, setEditPort]                               = useState('8080');
  const [portSaving, setPortSaving]                           = useState(false);
  const [gamesDirCfg, setGamesDirCfg]                         = useState<{ games_dir: string; default_games_dir?: string } | null>(null);
  const [editGamesDir, setEditGamesDir]                       = useState('');
  const [dirSaving, setDirSaving]                             = useState(false);
  const [pwCurrent, setPwCurrent]                             = useState('');
  const [pwNew, setPwNew]                                     = useState('');
  const [pwSaving, setPwSaving]                               = useState(false);
  const [themeHelpOpen, setThemeHelpOpen]                     = useState(false);

  useEffect(() => { fetchBuiltins(); }, [fetchBuiltins]);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/plugin-autostart').then(({ isEnabled }) =>
      isEnabled().then(setAutostart)
    );
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke<boolean>('get_external_access').then(setExternalAccess);
      invoke<{ running_port: number; configured_port: number; local_ip: string | null }>('get_network_info')
        .then(info => { setNetworkInfo(info); setEditPort(String(info.configured_port)); });
    });
  }, []);

  useEffect(() => {
    if (isTauri) {
      import('@tauri-apps/api/core').then(({ invoke }) =>
        invoke<{ games_dir: string; default_games_dir: string }>('get_games_dir')
          .then(cfg => { setGamesDirCfg(cfg); setEditGamesDir(cfg.games_dir); })
      );
    } else {
      configApi.get().then(cfg => setGamesDirCfg(cfg)).catch(() => {});
    }
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const changePassword = async () => {
    if (pwNew.length < 8) { setToast({ msg: 'New password must be at least 8 characters.', type: 'error' }); return; }
    setPwSaving(true);
    try {
      await auth.changePassword(pwCurrent, pwNew);
      setPwCurrent(''); setPwNew('');
      setToast({ msg: 'Password changed.', type: 'success' });
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed to change password.', type: 'error' });
    } finally { setPwSaving(false); }
  };

  const toggleAutostart = async () => {
    setAutostartLoading(true);
    try {
      const { enable, disable, isEnabled } = await import('@tauri-apps/plugin-autostart');
      if (autostart) await disable(); else await enable();
      setAutostart(await isEnabled());
      setToast({ msg: autostart ? 'Removed from startup.' : 'Will launch on startup.', type: 'success' });
    } catch {
      setToast({ msg: 'Failed to update startup setting.', type: 'error' });
    } finally { setAutostartLoading(false); }
  };

  const toggleExternalAccess = async () => {
    setExternalAccessLoading(true);
    const next = !externalAccess;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_external_access', { allow: next });
      setExternalAccess(next);
      setToast({ msg: 'Saved — quit and relaunch Twine Launcher to apply.', type: 'success' });
    } catch {
      setToast({ msg: 'Failed to update setting.', type: 'error' });
    } finally { setExternalAccessLoading(false); }
  };

  const savePort = async () => {
    const p = parseInt(editPort, 10);
    if (isNaN(p) || p < 1024 || p > 65535) {
      setToast({ msg: 'Port must be a number between 1024 and 65535.', type: 'error' });
      return;
    }
    setPortSaving(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_external_port', { port: p });
      setToast({ msg: 'Port saved — quit and relaunch to apply.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : String(err), type: 'error' });
    } finally { setPortSaving(false); }
  };

  const [dirPickerOpen, setDirPickerOpen] = useState(false);

  const browseGamesDir = () => setDirPickerOpen(true);

  const saveGamesDir = async () => {
    setDirSaving(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_games_dir', { gamesDir: editGamesDir });
      setGamesDirCfg(c => c ? { ...c, games_dir: editGamesDir } : c);
      setToast({ msg: 'Saved — quit and relaunch Twine Launcher to apply.', type: 'success' });
    } catch (err) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed to save', type: 'error' });
    } finally { setDirSaving(false); }
  };

  const toggleAutosave = async () => {
    setAutosaveSaving(true);
    const next = !(user?.autosave_enabled ?? true);
    try {
      await updatePrefs({ autosave_enabled: next });
      setToast({ msg: next ? 'Autosave enabled.' : 'Autosave disabled.', type: 'success' });
    } catch {
      setToast({ msg: 'Failed to update autosave setting.', type: 'error' });
    } finally { setAutosaveSaving(false); }
  };


  const setGlobalBuiltin = async (id: string) => {
    setGlobalSaving(id);
    try {
      await themeApi.setGlobalBuiltin(id);
      await fetchActive();
      setToast({ msg: 'Global theme updated.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed', type: 'error' });
    } finally { setGlobalSaving(null); }
  };

  const resetGlobal = async () => {
    try {
      await themeApi.resetGlobal();
      await fetchActive();
      setToast({ msg: 'Global theme reset to Classic.', type: 'info' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed', type: 'error' });
    }
  };

  const handleGlobalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setGlobalSaving('custom');
    try {
      await themeApi.setGlobalCustom(file);
      await fetchActive();
      setToast({ msg: 'Custom global theme applied.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed', type: 'error' });
    } finally {
      setGlobalSaving(null);
      if (globalFileRef.current) globalFileRef.current.value = '';
    }
  };

  const setUserBuiltin = async (id: string) => {
    setUserSaving(id);
    try {
      await themeApi.setUserBuiltin(id);
      await fetchActive();
      setToast({ msg: 'Your theme updated.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed', type: 'error' });
    } finally { setUserSaving(null); }
  };

  const resetUser = async () => {
    try {
      await themeApi.resetUser();
      await fetchActive();
      setToast({ msg: 'Reverted to default theme.', type: 'info' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed', type: 'error' });
    }
  };

  const handleUserFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setUserSaving('custom');
    try {
      await themeApi.setUserCustom(file);
      await fetchActive();
      setToast({ msg: 'Custom theme applied.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Failed', type: 'error' });
    } finally {
      setUserSaving(null);
      if (userFileRef.current) userFileRef.current.value = '';
    }
  };

  // ── Layout helpers ─────────────────────────────────────────────────────────

  const Section = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '2rem', marginBottom: '2rem' }}>
      <h3 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.1rem', fontWeight: 400, marginBottom: '0.25rem' }}>{title}</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>{description}</p>
      {children}
    </div>
  );

  const CategoryHeader = ({ label }: { label: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '2.5rem 0 1.5rem' }}>
      <span style={{
        fontFamily: 'var(--font-ui)', fontSize: '0.65rem', fontWeight: 600,
        letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)',
        whiteSpace: 'nowrap',
      }}>{label}</span>
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
    </div>
  );

  const ToggleRow = ({ label, description, checked, onChange, disabled }: {
    label: string; description?: string; checked: boolean; onChange: () => void; disabled?: boolean;
  }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <Toggle checked={checked} onChange={() => onChange()} disabled={disabled} />
      <div>
        <span style={{ fontSize: '0.82rem', color: 'var(--text)' }}>{label}</span>
        {description && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{description}</span>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '2.5rem', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Settings</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
          Signed in as <span style={{ color: 'var(--text)' }}>{user?.username}</span>
          {isAdmin && <span style={{ color: 'var(--text-muted)' }}> · admin</span>}
        </p>
      </div>

      {/* ── ACCOUNT ──────────────────────────────────────────────────────────── */}
      <CategoryHeader label="Account" />

      <Section title="Change password" description="Update your account password. Requires your current password.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 360 }}>
          <Input
            type="password"
            label="Current password"
            placeholder="Current password"
            value={pwCurrent}
            onChange={e => setPwCurrent(e.target.value)}
            autoComplete="current-password"
          />
          <Input
            type="password"
            label="New password"
            placeholder="New password (8+ characters)"
            value={pwNew}
            onChange={e => setPwNew(e.target.value)}
            autoComplete="new-password"
          />
          <div>
            <Button size="sm" loading={pwSaving} onClick={changePassword}>Change password</Button>
          </div>
        </div>
      </Section>

      {/* ── APP ──────────────────────────────────────────────────────────────── */}
      {isTauri && <CategoryHeader label="App" />}

      {isTauri && (
        <Section
          title="Launch on startup"
          description="Start Twine Launcher automatically when you log in to Windows. The library will be ready in the tray without needing to launch it manually."
        >
          <ToggleRow
            label="Launch on startup"
            description={autostart ? 'Starts automatically with Windows' : undefined}
            checked={autostart}
            onChange={toggleAutostart}
            disabled={autostartLoading}
          />
        </Section>
      )}

      {isTauri && isAdmin && (
        <Section
          title="Allow external access"
          description="When enabled, the backend accepts connections from other devices on your local network. Disabled by default — only enable on trusted networks. Changes take effect after quitting and relaunching."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <ToggleRow
              label="External access"
              description={externalAccess ? 'Other devices on your network can connect' : 'Only accessible from this computer'}
              checked={externalAccess}
              onChange={toggleExternalAccess}
              disabled={externalAccessLoading}
            />
            {externalAccess && networkInfo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingLeft: '3.15rem' }}>
                {networkInfo.local_ip && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Connect from:{' '}
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text)' }}>
                      http://{networkInfo.local_ip}:{networkInfo.running_port}
                    </code>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Port:</span>
                  <input
                    value={editPort}
                    onChange={e => setEditPort(e.target.value)}
                    style={{
                      width: '5.5rem', background: 'var(--surface2)', color: 'var(--text)',
                      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                      padding: '0.35rem 0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                    }}
                  />
                  <Button size="sm" loading={portSaving} onClick={savePort}>Save</Button>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Takes effect on next launch</span>
                </div>
                {networkInfo.running_port !== networkInfo.configured_port && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                    Port {networkInfo.configured_port} was in use at startup — running on {networkInfo.running_port} this session. Update the port to a free one and relaunch.
                  </p>
                )}
              </div>
            )}
          </div>
        </Section>
      )}

      {isTauri && isAdmin && gamesDirCfg && (
        <Section
          title="Games directory"
          description="Where Twine Launcher looks for your HTML game files. Changes take effect after quitting and relaunching."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                value={editGamesDir}
                onChange={e => setEditGamesDir(e.target.value)}
                style={{
                  flex: 1, boxSizing: 'border-box',
                  background: 'var(--surface2)', color: 'var(--text)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  padding: '0.45rem 0.65rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
                }}
              />
              <Button size="sm" variant="ghost" onClick={browseGamesDir}>Browse…</Button>
            </div>
            <div>
              <Button size="sm" loading={dirSaving} onClick={saveGamesDir}>Save</Button>
            </div>
          </div>
        </Section>
      )}

      <DirectoryPicker
        open={dirPickerOpen}
        initialPath={editGamesDir}
        onSelect={(p: string) => { setEditGamesDir(p); setDirPickerOpen(false); }}
        onClose={() => setDirPickerOpen(false)}
      />

      {!isTauri && isAdmin && gamesDirCfg && (
        <Section
          title="Games directory"
          description="The folder containing Twine HTML game files (set via TWINE_GAMES_DIR in docker-compose.yml)."
        >
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {gamesDirCfg.games_dir}
          </code>
        </Section>
      )}

      {/* ── GAMEPLAY ─────────────────────────────────────────────────────────── */}
      <CategoryHeader label="Gameplay" />

      <Section
        title="Autosave"
        description="When enabled, your progress is automatically saved to the server every 3 seconds while you play. When disabled, use the ↑ Save button in the game view to save manually."
      >
        <ToggleRow
          label="Autosave"
          description={(user?.autosave_enabled ?? true)
            ? 'Saves automatically every 3 seconds'
            : 'Manual save only — use ↑ Save in the game view'}
          checked={user?.autosave_enabled ?? true}
          onChange={toggleAutosave}
          disabled={autosaveSaving}
        />
      </Section>

      {/* ── APPEARANCE ───────────────────────────────────────────────────────── */}
      <CategoryHeader label="Appearance" />

      <Section title="My theme" description="Your personal theme overrides the global default. Only you see it.">
        <ThemePicker
          builtins={builtins}
          saving={userSaving}
          onSelectBuiltin={setUserBuiltin}
          onUploadCustom={() => userFileRef.current?.click()}
          onReset={source === 'user' ? resetUser : undefined}
          fileRef={userFileRef}
          onFileChange={handleUserFile}
          currentSource={source}
          currentTheme={active}
          scope="user"
        />
      </Section>

      {isAdmin && (
        <Section title="Global default theme" description="Sets the default for all users who haven't chosen their own. Applies to new users immediately.">
          <ThemePicker
            builtins={builtins}
            saving={globalSaving}
            onSelectBuiltin={setGlobalBuiltin}
            onUploadCustom={() => globalFileRef.current?.click()}
            onReset={resetGlobal}
            fileRef={globalFileRef}
            onFileChange={handleGlobalFile}
            currentSource={source}
            currentTheme={active}
            scope="global"
          />
        </Section>
      )}

      <Button size="sm" variant="ghost" style={{ marginBottom: '2rem' }} onClick={() => setThemeHelpOpen(true)}>
        ? Custom theme format
      </Button>

      <Modal open={themeHelpOpen} onClose={() => setThemeHelpOpen(false)} title="Custom theme format" width={520}>
        <pre style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)',
          lineHeight: 1.9, background: 'var(--surface)', padding: '1rem 1.25rem',
          borderRadius: 'var(--radius)', overflow: 'auto',
        }}>{`{
  "name":       "My Theme",
  "bg":         "#000000",   /* page background        */
  "surface":    "#111111",   /* cards, panels          */
  "surface2":   "#1a1a1a",   /* nested surfaces        */
  "border":     "#2a2a2a",   /* lines, dividers        */
  "text":       "#ffffff",   /* primary text           */
  "textMuted":  "#888888",   /* secondary text         */
  "accent":     "#d4a0c0",   /* buttons, highlights    */
  "accentText": "#000000"    /* text on accent colour  */
}`}</pre>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem', lineHeight: 1.6 }}>
          All colour values must be 3 or 6-digit CSS hex colours (e.g. <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>#1a2b3c</code>). The <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>name</code> field is optional.
        </p>
      </Modal>

      {toast && <Toast message={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// ── Theme Picker component ─────────────────────────────────────────────────────

interface ThemePickerProps {
  builtins: BuiltinTheme[];
  saving: string | null;
  onSelectBuiltin: (id: string) => void;
  onUploadCustom: () => void;
  onReset?: () => void;
  fileRef: React.RefObject<HTMLInputElement>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  currentSource: string;
  currentTheme: ThemeData | null;
  scope: 'user' | 'global';
}

function ThemePicker({ builtins, saving, onSelectBuiltin, onUploadCustom, onReset, fileRef, onFileChange, currentSource, currentTheme, scope }: ThemePickerProps) {
  const isActive = (id: string) => scope === 'user' ? currentSource === 'user' && currentTheme?.name === builtins.find(b => b.id === id)?.name : currentSource === 'global' && currentTheme?.name === builtins.find(b => b.id === id)?.name;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {builtins.map(theme => (
          <ThemeSwatch
            key={theme.id}
            theme={theme}
            active={isActive(theme.id)}
            loading={saving === theme.id}
            onClick={() => onSelectBuiltin(theme.id)}
          />
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
        <input ref={fileRef} type="file" accept=".json" onChange={onFileChange} style={{ display: 'none' }} />
        <Button size="sm" loading={saving === 'custom'} onClick={onUploadCustom}>
          ↑ Upload custom theme
        </Button>
        {onReset && (
          <Button size="sm" variant="ghost" onClick={onReset} style={{ color: 'var(--text-muted)' }}>
            Reset to default
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Directory Picker modal ─────────────────────────────────────────────────────

interface DirEntry { name: string; path: string; }
interface DirectoryPickerProps { open: boolean; initialPath: string; onSelect: (path: string) => void; onClose: () => void; }

function DirectoryPicker({ open, initialPath, onSelect, onClose }: DirectoryPickerProps) {
  const [current, setCurrent] = useState('');
  const [dirs, setDirs]       = useState<DirEntry[]>([]);
  const [parent, setParent]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await configApi.browse(path);
      setCurrent(res.current);
      setDirs(res.dirs);
      setParent(res.parent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load directory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) navigate(initialPath); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal open={open} onClose={onClose} title="Select folder" width={520}>
      {/* Path bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <button
          onClick={() => parent && navigate(parent)}
          disabled={!parent || loading}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            color: parent ? 'var(--text)' : 'var(--text-muted)', cursor: parent ? 'pointer' : 'not-allowed',
            padding: '0.3rem 0.6rem', fontFamily: 'var(--font-ui)', fontSize: '0.8rem', flexShrink: 0,
          }}
        >↑ Up</button>
        <code style={{
          flex: 1, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          padding: '0.3rem 0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{current || '…'}</code>
      </div>

      {/* Directory list */}
      <div style={{
        border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        minHeight: 200, maxHeight: 320, overflowY: 'auto', background: 'var(--surface)',
      }}>
        {loading && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading…</div>
        )}
        {error && (
          <div style={{ padding: '1rem', color: '#c06060', fontSize: '0.82rem' }}>{error}</div>
        )}
        {!loading && !error && dirs.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No subfolders</div>
        )}
        {!loading && dirs.map(d => (
          <button key={d.path} onClick={() => navigate(d.path)} style={{
            display: 'block', width: '100%', textAlign: 'left',
            background: 'none', border: 'none', borderBottom: '1px solid var(--border)',
            padding: '0.55rem 0.85rem', cursor: 'pointer', color: 'var(--text)',
            fontFamily: 'var(--font-ui)', fontSize: '0.82rem',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            📁 {d.name}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem' }}>
        <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={() => onSelect(current)} disabled={!current}>
          Select this folder
        </Button>
      </div>
    </Modal>
  );
}

function ThemeSwatch({ theme, active, loading, onClick }: { theme: BuiltinTheme; active: boolean; loading: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: theme.bg,
        border: `1px solid ${active ? theme.accent : hovered ? theme.accent + '80' : theme.border}`,
        borderRadius: 'var(--radius)',
        padding: '0.75rem',
        cursor: loading ? 'wait' : 'pointer',
        textAlign: 'left',
        transition: 'border-color 150ms ease',
        display: 'flex', flexDirection: 'column', gap: '0.3rem',
      }}
    >
      <div style={{ display: 'flex', gap: 3, marginBottom: '0.25rem' }}>
        {[theme.bg, theme.surface, theme.text, theme.accent].map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: '50%', background: c, border: `1px solid ${theme.border}` }} />
        ))}
      </div>
      <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.78rem', color: theme.text, fontWeight: active ? 500 : 400 }}>
        {theme.name}
      </div>
      {theme.description && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.68rem', color: theme.textMuted, lineHeight: 1.4 }}>
          {theme.description}
        </div>
      )}
      {active && (
        <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.65rem', color: theme.accent, marginTop: '0.2rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          ✓ active
        </div>
      )}
    </button>
  );
}
