import { useEffect, useRef, useState } from 'react';
import { themeApi } from '../api';
import { useAuthStore } from '../store/auth';
import { useThemeStore, type BuiltinTheme, type ThemeData } from '../store/theme';
import { Button, Toast } from '../components/ui';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function SettingsPage() {
  const { user, updatePrefs }        = useAuthStore();
  const { builtins, fetchBuiltins, fetchActive, active, source } = useThemeStore();
  const [globalSaving, setGlobalSaving] = useState<string | null>(null);
  const [userSaving,   setUserSaving]   = useState<string | null>(null);
  const [toast, setToast]               = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null);
  const globalFileRef = useRef<HTMLInputElement>(null);
  const userFileRef   = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === 'admin';

  const [autostart, setAutostart]           = useState(false);
  const [autostartLoading, setAutostartLoading] = useState(false);
  const [autosaveSaving, setAutosaveSaving] = useState(false);

  useEffect(() => { fetchBuiltins(); }, [fetchBuiltins]);

  useEffect(() => {
    if (!isTauri) return;
    import('@tauri-apps/plugin-autostart').then(({ isEnabled }) =>
      isEnabled().then(setAutostart)
    );
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

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

  const Section = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '2rem', marginBottom: '2rem' }}>
      <h3 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.1rem', fontWeight: 400, marginBottom: '0.25rem' }}>{title}</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>{description}</p>
      {children}
    </div>
  );

  return (
    <div style={{ padding: '2.5rem', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Settings</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem' }}>
          Signed in as <span style={{ color: 'var(--text)' }}>{user?.username}</span>
          {isAdmin && <span style={{ color: 'var(--text-muted)' }}> · admin</span>}
        </p>
      </div>

      {/* ── App Startup (desktop only) ───────────────────────────────────── */}
      {isTauri && (
        <Section
          title="App startup"
          description="Start Twine Launcher automatically when you log in to Windows. The library will be ready in the tray without needing to launch it manually."
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Button size="sm" loading={autostartLoading} onClick={toggleAutostart}>
              {autostart ? '✓ Launch on startup' : 'Launch on startup'}
            </Button>
            {autostart && (
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                Enabled — will start with Windows
              </span>
            )}
          </div>
        </Section>
      )}

      {/* ── Autosave ──────────────────────────────────────────────────────── */}
      <Section
        title="Autosave"
        description="When enabled, your progress is automatically saved to the server every 3 seconds while you play. When disabled, use the ↑ Save button in the game view to save manually."
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Button size="sm" loading={autosaveSaving} onClick={toggleAutosave}>
            {(user?.autosave_enabled ?? true) ? '✓ Autosave on' : 'Autosave off'}
          </Button>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {(user?.autosave_enabled ?? true)
              ? 'Saves automatically every 3 seconds'
              : 'Manual save only — use ↑ Save in the game view'}
          </span>
        </div>
      </Section>

      {/* ── My Theme ──────────────────────────────────────────────────────── */}
      <Section
        title="My theme"
        description="Your personal theme overrides the global default. Only you see it."
      >
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

      {/* ── Global Theme (admin only) ─────────────────────────────────────── */}
      {isAdmin && (
        <Section
          title="Global default theme"
          description="Sets the default for all users who haven't chosen their own. Applies to new users immediately."
        >
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

      {/* ── Custom theme format ────────────────────────────────────────────── */}
      <Section title="Custom theme format" description="Upload a .json file to apply a custom colour scheme.">
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
      </Section>

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
      {/* Built-in swatches */}
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

      {/* Actions row */}
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
      {/* Mini colour bar */}
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
