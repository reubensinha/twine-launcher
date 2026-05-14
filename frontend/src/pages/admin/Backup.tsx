import { useRef, useState } from 'react';
import { backup as backupApi } from '../../api';
import { useAuthStore } from '../../store/auth';
import { Button, Toast } from '../../components/ui';
import { useToast } from '../../hooks/useToast';
import type { BackupImportResult } from '../../types';

export function BackupPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const [exporting,    setExporting]    = useState<'full' | 'saves-only' | null>(null);
  const [importing,    setImporting]    = useState<'full' | 'saves' | null>(null);
  const [importResult, setImportResult] = useState<BackupImportResult | null>(null);
  const { toast, show: showToast, dismiss: dismissToast } = useToast();
  const fullFileRef  = useRef<HTMLInputElement>(null);
  const savesFileRef = useRef<HTMLInputElement>(null);

  const handleExport = async (scope: 'full' | 'saves-only') => {
    setExporting(scope);
    try {
      const saved = await backupApi.export(scope);
      if (saved) showToast('Backup saved.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally { setExporting(null); }
  };

  const handleImport = async (kind: 'full' | 'saves', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(kind); setImportResult(null);
    try {
      const result = await backupApi.import(file);
      setImportResult(result);
      showToast('Backup imported.', 'success');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Import failed', 'error');
    } finally {
      setImporting(null);
      e.target.value = '';
    }
  };

  const Section = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '2rem', marginBottom: '2rem' }}>
      <h3 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.1rem', fontWeight: 400, marginBottom: '0.3rem' }}>{title}</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>{description}</p>
      {children}
    </div>
  );

  const ImportResult = () => importResult ? (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      padding: '1rem 1.25rem', fontSize: '0.82rem', lineHeight: 1.8, marginTop: '1rem',
    }}>
      <div style={{ color: 'var(--accent)', marginBottom: '0.25rem' }}>Import complete</div>
      <div style={{ color: 'var(--text-muted)' }}>Saves restored: {importResult.saves_restored}</div>
      {isAdmin && <div style={{ color: 'var(--text-muted)' }}>Games restored: {importResult.games_restored}</div>}
      {importResult.errors.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Warnings:</div>
          {importResult.errors.map((err, i) => (
            <div key={i} style={{ color: 'var(--text-muted)', paddingLeft: '1rem', fontSize: '0.78rem' }}>· {err}</div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div style={{ padding: '2.5rem', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Backup & Restore</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem', lineHeight: 1.6 }}>
          Export your save data to migrate between installations or safeguard your progress.
        </p>
      </div>

      {/* ── Admin: full backup ─────────────────────────────────────────────── */}
      {isAdmin && (
        <>
          <Section
            title="Full backup"
            description="Exports the entire library — game files, metadata, and all users' save data. Admins only."
          >
            <Button variant="primary" loading={exporting === 'full'} onClick={() => handleExport('full')}>
              ↓ Download full backup
            </Button>
          </Section>

          <Section
            title="Full restore"
            description="Restores game files, metadata, and all saves from a full backup zip. Existing saves are overwritten; games without matching saves are untouched."
          >
            <input
              ref={fullFileRef} type="file" accept=".zip"
              onChange={e => handleImport('full', e)}
              disabled={importing !== null} style={{ display: 'none' }}
            />
            <Button loading={importing === 'full'} disabled={importing !== null} onClick={() => fullFileRef.current?.click()}>
              ↑ Select full backup…
            </Button>
            <ImportResult />
          </Section>
        </>
      )}

      {/* ── All users: saves backup ────────────────────────────────────────── */}
      <Section
        title="My saves"
        description="Export your save data as a portable zip. Importing restores your saves to their matching games — any game not found in the library is skipped with a warning."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <Button loading={exporting === 'saves-only'} onClick={() => handleExport('saves-only')}>
              ↓ Download saves backup
            </Button>
          </div>
          <div>
            <input
              ref={savesFileRef} type="file" accept=".zip"
              onChange={e => handleImport('saves', e)}
              disabled={importing !== null} style={{ display: 'none' }}
            />
            <Button loading={importing === 'saves'} disabled={importing !== null} onClick={() => savesFileRef.current?.click()}>
              ↑ Restore from saves backup…
            </Button>
          </div>
          {!isAdmin && <ImportResult />}
        </div>
      </Section>

      {/* ── Backup format ──────────────────────────────────────────────────── */}
      <Section title="Backup format" description="Backups are portable zip files with a human-readable layout.">
        <pre style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-muted)',
          lineHeight: 1.8, background: 'var(--surface)', padding: '1rem 1.25rem',
          borderRadius: 'var(--radius)', overflow: 'auto',
        }}>{`twine-launcher-backup/
├── manifest.json          { version, scope, exported_at }
├── saves/
│   └── {username}/
│       └── {game-name}.json
└── games/                 full backup only
    ├── library.json
    └── files/{game}/`}</pre>
      </Section>

      {toast && <Toast message={toast.msg} type={toast.type} onDismiss={dismissToast} />}
    </div>
  );
}
