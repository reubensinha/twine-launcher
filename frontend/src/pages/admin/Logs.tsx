import { useCallback, useEffect, useRef, useState } from 'react';
import { configApi } from '../../api';
import { Button, Spinner } from '../../components/ui';

interface LogData {
  path: string;
  size_bytes: number;
  lines: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LogsPage() {
  const [data,        setData]        = useState<LogData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [copied,      setCopied]      = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await configApi.logs(500));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  // Scroll to bottom when lines update
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [data?.lines]);

  const handleCopy = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ padding: '2.5rem', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-body)', fontStyle: 'italic', fontSize: '1.7rem', fontWeight: 400 }}>Server Logs</h2>
          {data && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.2rem', fontFamily: 'var(--font-mono)' }}>
              {data.path} · {formatBytes(data.size_bytes)}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Button size="sm" onClick={load}>Refresh</Button>
          <Button
            size="sm"
            variant={autoRefresh ? 'primary' : undefined}
            onClick={() => setAutoRefresh(v => !v)}
          >
            {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh'}
          </Button>
          <Button size="sm" variant={copied ? 'primary' : undefined} onClick={handleCopy} disabled={!data}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}><Spinner size={24} /></div>
      ) : !data || data.lines.length === 0 ? (
        <div style={{
          padding: '3rem 2rem', textAlign: 'center', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)',
          fontStyle: 'italic', fontFamily: 'var(--font-body)', fontSize: '1rem',
        }}>
          No log file found. Logs appear here after the server writes its first entry.
        </div>
      ) : (
        <pre
          ref={preRef}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.75rem', lineHeight: 1.7,
            color: 'var(--text-muted)', background: 'var(--surface)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: '1rem 1.25rem', overflowY: 'auto', maxHeight: 'calc(100vh - 260px)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {data.lines.map((line, i) => {
            const isError   = /\[ERROR\]|\[CRITICAL\]/i.test(line);
            const isWarning = /\[WARNING\]/i.test(line);
            const isSep     = /^={20,}/.test(line.trim());
            const color = isError   ? '#c06060'
                        : isWarning ? '#c8a040'
                        : isSep     ? 'var(--accent)'
                        : undefined;
            return (
              <span key={i} style={color ? { color } : undefined}>
                {line}{'\n'}
              </span>
            );
          })}
        </pre>
      )}
    </div>
  );
}
