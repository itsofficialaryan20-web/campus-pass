import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CheckCircle2, XCircle, X } from 'lucide-react';

type Kind = 'success' | 'error';
interface Toast { id: number; kind: Kind; text: string }
const Ctx = createContext<{ toast(kind: Kind, text: string): void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = (id: number) => setItems((l) => l.filter((t) => t.id !== id));
  const toast = useCallback((kind: Kind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l, { id, kind, text }]);
    setTimeout(() => dismiss(id), kind === 'error' ? 8000 : 4500);
  }, []);
  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg ${t.kind === 'error' ? 'bg-danger-bg text-danger-text' : 'bg-navy text-white'}`}>
            {t.kind === 'error' ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export function useToast() { const c = useContext(Ctx); if (!c) throw new Error('useToast outside ToastProvider'); return c.toast; }
