import { useState, useCallback } from 'react';

type ToastType = 'info' | 'error' | 'success';

interface ToastState {
  msg: string;
  type: ToastType;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const show    = useCallback((msg: string, type: ToastType) => setToast({ msg, type }), []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}
