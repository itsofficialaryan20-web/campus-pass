import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { errMsg, fmtDateTime, fmtTime } from '../lib/format';
import type { PassView } from '../types';
import { Badge, Button, Card, ErrorState, Notice, PageSkeleton } from '../components/ui';

const MESSAGE: Record<string, string> = {
  REVOKED: 'This pass was revoked or the request was cancelled. It will not work at the gate.',
  EXPIRED: 'This pass has expired. Contact your Program Manager if you still need to leave or enter.',
  ALREADY_USED: 'This pass was already used at the gate. A pass works once.',
};
export default function PassPage() {
  const { id = '' } = useParams();
  const bundle = useAsync(() => api.getRequestBundle(id), [id], true);
  const [view, setView] = useState<PassView | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setView(await api.getMyPass(id)); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (bundle.error || err) return <ErrorState message={(bundle.error ?? err)!} onRetry={() => { bundle.reload(); void load(); }} />;
  if (!bundle.data || !view) return <PageSkeleton />;
  const r = bundle.data.request; const usable = !!view.qr_payload;
  return (
    <div className="mx-auto max-w-md">
      <div className="mb-4 flex items-center gap-3">
        <Link to={`/requests/${id}`} aria-label="Back to request" className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-subtle"><ArrowLeft className="h-4 w-4" /></Link>
        <h1 className="text-lg font-bold">{r.kind === 'REENTRY' ? 'Re-entry pass' : 'Exit pass'}</h1>
        <span className="ml-auto"><Badge tone={usable ? 'ok' : 'danger'}>{usable ? (view.state === 'NOT_YET_VALID' ? 'Not yet valid' : 'Valid') : view.state.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</Badge></span>
      </div>
      <Card className="flex flex-col items-center gap-3.5 !p-5">
        {usable ? (
          <>
            <div className="rounded-xl border border-line-strong bg-white p-3.5"><QRCodeSVG value={view.qr_payload!} size={232} level="M" marginSize={0} aria-label="Pass QR code" role="img" /></div>
            <p className="text-xs text-ink-muted">Manual code (if scanning fails)</p>
            <p className="select-all text-2xl font-bold tracking-[0.12em]" aria-label={`Manual code ${view.short_code}`}>{view.short_code}</p>
          </>
        ) : <Notice tone="danger" className="w-full">{MESSAGE[view.state] ?? 'This pass cannot be used right now.'}</Notice>}
        <dl className="mt-1 w-full space-y-2.5 border-t border-line pt-4 text-[13px]">
          {[['Student', `${r.student?.full_name ?? ''}${r.student?.college_id ? ` · ${r.student.college_id}` : ''}`], ['Destination', r.destination], ['Valid', `${fmtTime(view.valid_from)} – ${fmtTime(view.valid_until)} (${fmtDateTime(view.valid_until)})`], ['Request', r.request_code]].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4"><dt className="text-ink-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
          ))}
        </dl>
      </Card>
      {usable && <Button variant="secondary" full className="mt-4" loading={busy} onClick={() => void load()}><RefreshCw className="h-4 w-4" />Refresh code</Button>}
      <Notice tone="neutral" icon={<ShieldCheck className="h-4 w-4" />} className="mt-4">Single use. A new code is issued each time you open this page, so old screenshots stop working. It becomes invalid once the gate records it. If you will arrive after your expected return time, you need a new approval to enter.</Notice>
    </div>
  );
}
