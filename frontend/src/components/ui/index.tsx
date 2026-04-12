/** Shared UI primitives — literary dark aesthetic, theme-aware via CSS variables. */

import React from 'react';

// ── Button ────────────────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
}
export function Button({ variant = 'ghost', size = 'md', loading, children, disabled, style, ...props }: ButtonProps) {
  const sm = size === 'sm';
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.4em',
    fontFamily: 'var(--font-ui)', fontSize: sm ? '0.75rem' : '0.82rem',
    fontWeight: 400, letterSpacing: '0.02em',
    padding: sm ? '0.3rem 0.8rem' : '0.5rem 1.3rem',
    borderRadius: 'var(--radius)', border: '1px solid',
    cursor: disabled || loading ? 'not-allowed' : 'pointer',
    opacity: disabled || loading ? 0.45 : 1,
    transition: 'all var(--transition)', whiteSpace: 'nowrap',
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-text)', fontWeight: 500 },
    ghost:   { background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' },
    danger:  { background: 'transparent', borderColor: 'transparent', color: '#c06060' },
  };
  return (
    <button {...props} disabled={disabled || loading} style={{ ...base, ...variants[variant], ...style }}>
      {loading ? <Spinner size={13} /> : null}{children}
    </button>
  );
}

// ── Input ─────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> { label?: string; error?: string; }
export function Input({ label, error, id, style, ...props }: InputProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {label && (
        <label htmlFor={id} style={{ fontFamily: 'var(--font-ui)', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
          {label}
        </label>
      )}
      <input id={id} {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e)  => { setFocused(false); props.onBlur?.(e); }}
        style={{
          background: 'var(--surface)', border: `1px solid ${error ? '#c06060' : focused ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          fontSize: '1rem', padding: '0.5rem 0.75rem', outline: 'none',
          transition: 'border-color var(--transition)', width: '100%', ...style,
        }}
      />
      {error && <span style={{ fontSize: '0.72rem', color: '#c06060' }}>{error}</span>}
    </div>
  );
}

// ── Textarea ──────────────────────────────────────────────────────────────────
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { label?: string; }
export function Textarea({ label, id, style, ...props }: TextareaProps) {
  const [focused, setFocused] = React.useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {label && <label htmlFor={id} style={{ fontFamily: 'var(--font-ui)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</label>}
      <textarea id={id} {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        style={{
          background: 'var(--surface)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--font-body)',
          fontSize: '1rem', padding: '0.5rem 0.75rem', outline: 'none', resize: 'vertical', minHeight: 80,
          transition: 'border-color var(--transition)', width: '100%', ...style,
        }}
      />
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> { label?: string; options: { value: string; label: string }[]; }
export function Select({ label, options, id, style, ...props }: SelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {label && <label htmlFor={id} style={{ fontFamily: 'var(--font-ui)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>{label}</label>}
      <select id={id} {...props} style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
        color: 'var(--text)', fontFamily: 'var(--font-ui)', fontSize: '0.9rem',
        padding: '0.5rem 0.75rem', outline: 'none', width: '100%', cursor: 'pointer', ...style,
      }}>
        {options.map(o => <option key={o.value} value={o.value} style={{ background: 'var(--surface2)' }}>{o.label}</option>)}
      </select>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────
interface ModalProps { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: number; }
export function Modal({ open, onClose, title, children, width = 500 }: ModalProps) {
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
        padding: '1.75rem 2rem', width: `min(${width}px, 100%)`, maxHeight: '90vh', overflowY: 'auto',
        animation: 'fadeUp 0.2s ease',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h3 style={{ fontFamily: 'var(--font-body)', fontWeight: 500, fontSize: '1.15rem', fontStyle: 'italic', color: 'var(--text)' }}>
            {title}
          </h3>
          <button onClick={onClose} style={{ color: 'var(--text-muted)', fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1, background: 'none', border: 'none', padding: '0 0.2rem' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
interface ToastProps { message: string; type?: 'info' | 'error' | 'success'; onDismiss: () => void; }
export function Toast({ message, type = 'info', onDismiss }: ToastProps) {
  React.useEffect(() => { const t = setTimeout(onDismiss, 3500); return () => clearTimeout(t); }, [onDismiss]);
  const accent = type === 'error' ? '#c06060' : type === 'success' ? 'var(--accent)' : 'var(--text-muted)';
  return (
    <div onClick={onDismiss} style={{
      position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--surface2)', border: `1px solid ${accent}`,
      borderRadius: 'var(--radius)', padding: '0.65rem 1.5rem',
      fontFamily: 'var(--font-ui)', fontSize: '0.82rem', color: accent,
      zIndex: 2000, animation: 'fadeUp 0.2s ease', cursor: 'pointer',
      maxWidth: '400px', textAlign: 'center',
    }}>
      {message}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 20, color = 'var(--accent)' }: { size?: number; color?: string }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: '1.5px solid transparent', borderTopColor: color,
      borderRadius: '50%', animation: 'spin 0.65s linear infinite', flexShrink: 0,
    }} />
  );
}

// ── Divider ───────────────────────────────────────────────────────────────────
export function Divider({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '0.25rem 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      {label && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-ui)', whiteSpace: 'nowrap' }}>{label}</span>}
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── FormRow (label + actions on same line) ────────────────────────────────────
export function FormActions({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1rem' }}>
      {children}
    </div>
  );
}
