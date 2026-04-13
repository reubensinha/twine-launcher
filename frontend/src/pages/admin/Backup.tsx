import { useRef, useState } from 'react';
import { backup as backupApi } from '../../api';
import { Button, Toast } from '../../components/ui';
import type { BackupImportResult } from '../../types';

export function BackupPage() {
  const [exporting,    setExporting]    = useState<'full' | 'saves-only' | null>(null);
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState<BackupImportResult | null>(null);
  const [toast,        setToast]        = useState<{ msg: string; type: 'info' | 'error' | 'success' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = async (scope: 'full' | 'saves-only') => {
    setExporting(scope);
    try {
      const saved = await backupApi.export(scope);
      if (saved) setToast({ msg: 'Backup saved.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Export failed', type: 'error' });
    } finally { setExporting(null); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportResult(null);
    try {
      const result = await backupApi.import(file);
      setImportResult(result);
      setToast({ msg: 'Backup imported.', type: 'success' });
    } catch (err: unknown) {
      setToast({ msg: err instanceof Error ? err.message : 'Import failed', type: 'error' });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const Section = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '2rem', marginBottom: '2rem' }}>
      <h3 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.1rem', fontWeight: 400, marginBottom: '0.3rem' }}>{title}</h3>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>{description}</p>
      {children}
    </div>
  );

  return (
    <div style={{ padding: '2.5rem', maxWidth: 700, margin: '0 auto' }}>
      <div style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Backup & Restore</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.2rem', lineHeight: 1.6 }}>
          Export your library and save data to migrate between installations or back up your progress.
        </p>
      </div>

      <Section title="Export" description="Download a backup zip. A full backup includes game files and metadata; saves-only includes only save data.">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="primary" loading={exporting === 'full'} onClick={() => handleExport('full')}>
            ↓ Full backup
          </Button>
          <Button loading={exporting === 'saves-only'} onClick={() => handleExport('saves-only')}>
            ↓ Saves only
          </Button>
        </div>
      </Section>

      <Section title="Import" description="Restore from a backup zip. Saves are matched by username and game name. Existing saves will be overwritten.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input ref={fileRef} type="file" accept=".zip" onChange={handleImport} disabled={importing} style={{ display: 'none' }} id="backup-file" />
          <Button loading={importing} onClick={() => fileRef.current?.click()}>↑ Select backup file…</Button>
          {importResult && (
            <div style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '1rem 1.25rem', fontSize: '0.82rem', lineHeight: 1.8,
            }}>
              <div style={{ color: 'var(--accent)', marginBottom: '0.25rem' }}>Import complete</div>
              <div style={{ color: 'var(--text-muted)' }}>Saves restored: {importResult.saves_restored}</div>
              <div style={{ color: 'var(--text-muted)' }}>Games restored: {importResult.games_restored}</div>
              {importResult.errors.length > 0 && (
                <div style={{ marginTop: '0.75rem' }}>
                  <div style={{ color: 'var(--text-muted)', marginBottom: '0.3rem' }}>Warnings:</div>
                  {importResult.errors.map((err, i) => (
                    <div key={i} style={{ color: 'var(--text-muted)', paddingLeft: '1rem', fontSize: '0.78rem' }}>· {err}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

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

      {toast && <Toast message={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
