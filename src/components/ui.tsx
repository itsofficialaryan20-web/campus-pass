import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { cx } from '../lib/format';
import { CATEGORY_LABEL, STATUS_LABEL, type ApprovalStatus, type Category, type MovementStatus, type RequestKind } from '../types';

type Variant = 'primary' | 'secondary' | 'approve' | 'reject' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-[#17337a]',
  secondary: 'border border-line-strong bg-white text-ink hover:bg-subtle',
  approve: 'bg-ok-solid text-white hover:bg-[#116c36]',
  reject: 'border border-danger-solid bg-white text-danger-text hover:bg-danger-bg',
  ghost: 'text-brand hover:bg-brand-tint',
};
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; loading?: boolean; full?: boolean; large?: boolean }
export function Button({ variant = 'primary', loading, full, large, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        large ? 'py-4' : 'py-2.5', VARIANT[variant], full && 'w-full', className)}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}
    </button>
  );
}

export function Card({ children, className, pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <section className={cx('rounded-xl border border-line bg-white', pad && 'p-5', className)}>{children}</section>;
}
export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-base font-semibold">{children}</h2>{right}</div>;
}

export type Tone = 'warn' | 'ok' | 'danger' | 'info' | 'urgent' | 'neutral' | 'critical';
const TONE: Record<Tone, string> = {
  warn: 'bg-warn-bg text-warn-text', ok: 'bg-ok-bg text-ok-text', danger: 'bg-danger-bg text-danger-text', info: 'bg-info-bg text-info-text',
  urgent: 'bg-urgent-bg text-urgent-text', neutral: 'bg-[#E2E8F0] text-[#334155]', critical: 'bg-danger-solid text-white',
};
export const Badge = ({ tone, children }: { tone: Tone; children: ReactNode }) =>
  <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[tone])}>{children}</span>;

const STATUS_TONE: Record<ApprovalStatus, Tone> = {
  PENDING_PROGRAM_MANAGER: 'warn', PENDING_SWO: 'warn', NEEDS_CLARIFICATION: 'info', APPROVED_PASS_ISSUED: 'ok', REJECTED: 'danger', CANCELLED: 'neutral',
};
export function StatusBadge({ status, movement, kind }: { status: ApprovalStatus; movement?: MovementStatus; kind?: RequestKind }) {
  if (status === 'APPROVED_PASS_ISSUED' && movement === 'EXITED') return <Badge tone="neutral">Exited</Badge>;
  if (status === 'APPROVED_PASS_ISSUED' && movement === 'ENTERED') return <Badge tone="neutral">{kind === 'REENTRY' ? 'Entered' : 'Back on campus'}</Badge>;
  return <Badge tone={STATUS_TONE[status]}>{status === 'APPROVED_PASS_ISSUED' ? 'Pass ready' : STATUS_LABEL[status]}</Badge>;
}
export const CategoryBadge = ({ category }: { category: Category }) =>
  <Badge tone={category === 'CRITICAL' ? 'critical' : category === 'URGENT' ? 'urgent' : 'neutral'}>{category === 'CRITICAL' ? 'Critical' : CATEGORY_LABEL[category]}</Badge>;
export const KindBadge = ({ kind }: { kind: RequestKind }) => kind === 'REENTRY' ? <Badge tone="info">Re-entry</Badge> : null;

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string | null; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p role="alert" className="text-xs font-medium text-danger-text">{error}</p> : hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) { return <div className={cx('animate-pulse rounded-lg bg-subtle', className)} aria-hidden />; }
export function PageSkeleton() {
  return <div className="space-y-4" role="status" aria-label="Loading"><Skeleton className="h-8 w-60" /><div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div><Skeleton className="h-72" /></div>;
}
export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-10 text-sm text-ink-muted" role="status"><Loader2 className="h-4 w-4 animate-spin" />{label}…</div>;
}
export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center gap-2 px-6 py-12 text-center"><Inbox className="h-8 w-8 text-ink-muted" aria-hidden /><p className="font-semibold">{title}</p>{text && <p className="max-w-sm text-sm text-ink-muted">{text}</p>}{action}</div>;
}
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-danger-bg bg-white px-6 py-10 text-center">
      <AlertTriangle className="h-8 w-8 text-danger-solid" aria-hidden /><p className="font-semibold">Could not load this</p>
      <p className="max-w-md text-sm text-ink-muted">{message}</p>{onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}
export function Notice({ tone, icon, children, className }: { tone: 'warn' | 'danger' | 'info' | 'neutral' | 'ok'; icon?: ReactNode; children: ReactNode; className?: string }) {
  const c = { warn: 'bg-warn-bg text-warn-text', danger: 'bg-danger-bg text-danger-text', info: 'bg-info-bg text-info-text', neutral: 'bg-subtle text-ink-2', ok: 'bg-ok-bg text-ok-text' }[tone];
  return <div className={cx('flex items-start gap-2.5 rounded-lg p-3 text-xs font-medium leading-relaxed', c, className)}>{icon && <span className="mt-0.5 shrink-0">{icon}</span>}<div className="flex-1">{children}</div></div>;
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{title}</h1>{subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}</div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
        <h2 className="mb-4 text-lg font-bold">{title}</h2>{children}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
export function ConfirmDialog({ open, title, text, confirmLabel, danger, busy, onConfirm, onClose }:
  { open: boolean; title: string; text: string; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm(): void; onClose(): void }) {
  return (
    <Modal open={open} title={title} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Keep as is</Button><Button variant={danger ? 'reject' : 'primary'} onClick={onConfirm} loading={busy}>{confirmLabel}</Button></>}>
      <p className="text-sm text-ink-2">{text}</p>
    </Modal>
  );
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage(p: number): void }) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm">
      <span className="text-ink-muted">Page {page} of {pages}</span>
      <div className="flex gap-2"><Button variant="secondary" className="!py-1.5" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button><Button variant="secondary" className="!py-1.5" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button></div>
    </div>
  );
}
export const inputCls = 'input';
