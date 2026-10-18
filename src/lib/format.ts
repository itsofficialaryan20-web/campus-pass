export const fmtDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'under 1 min';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export const waiting = (sinceIso: string, now = Date.now()) => duration(now - new Date(sinceIso).getTime());
export const isOverdue = (dueIso: string | null, now = Date.now()) => !!dueIso && new Date(dueIso).getTime() < now;
export const overdueBy = (dueIso: string, now = Date.now()) => duration(now - new Date(dueIso).getTime());

/** <input type="datetime-local"> value <-> ISO string */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => new Date(v).toISOString();
export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : 'Something went wrong');
