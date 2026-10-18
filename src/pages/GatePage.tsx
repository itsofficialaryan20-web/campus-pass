import { useState, type FormEvent } from 'react';
import { CheckCircle2, Hash, QrCode, ShieldCheck, XCircle, LogIn, LogOut as LogOutIcon } from 'lucide-react';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { errMsg, fmtDateTime, fmtTime } from '../lib/format';
import type { PassState, VerifyResult } from '../types';
import { Badge, Button, Card, CategoryBadge, Notice, PageHeader } from '../components/ui';
import { Avatar } from '../components/Avatar';
import { Scanner } from '../components/Scanner';

const MSG: Record<PassState, string> = {
  VALID: 'OK to record', EXPIRED: 'Do not allow. The pass window has closed.', REVOKED: 'Do not allow. This pass was revoked or cancelled.',
  ALREADY_USED: 'Do not allow. This pass was already used.', NOT_YET_VALID: 'Do not allow yet. The pass window has not started.', INVALID: 'Do not allow. No such pass.',
};
const TITLE: Record<PassState, string> = { VALID: 'VALID', EXPIRED: 'EXPIRED', REVOKED: 'REVOKED', ALREADY_USED: 'ALREADY USED', NOT_YET_VALID: 'NOT YET VALID', INVALID: 'INVALID' };

export default function GatePage() {
  const toast = useToast();
  const [mode, setMode] = useState<'idle' | 'scan' | 'manual'>('idle');
  const [code, setCode] = useState(''); const [cred, setCred] = useState<string | null>(null); const [res, setRes] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false); const [camErr, setCamErr] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const recent = useAsync(() => api.recentMovements(), [], true);

  async function verify(c: string) {
    setBusy(true); setDone(null); setMode('idle');
    try { setRes(await api.verifyPass(c)); setCred(c); } catch (e) { toast('error', errMsg(e)); setRes(null); } finally { setBusy(false); }
  }
  async function record() {
    if (!cred) return; setBusy(true);
    try {
      const r = await api.recordMovement(cred);
      if (r.ok) { setDone(r.event === 'ENTRY' ? 'Re-entry recorded.' : 'Exit recorded.'); toast('success', r.event === 'ENTRY' ? 'Re-entry recorded.' : 'Exit recorded.'); setRes(null); setCred(null); recent.reload(); }
      else { toast('error', `Not recorded: ${MSG[r.state as PassState] ?? r.state}`); void verify(cred); }
    } catch (e) { toast('error', `Not recorded. ${errMsg(e)}`); } finally { setBusy(false); }
  }
  const submitManual = (e: FormEvent) => { e.preventDefault(); if (code.trim()) void verify(code.trim()); };
  const reset = () => { setRes(null); setCred(null); setDone(null); setCode(''); setCamErr(null); setMode('idle'); };
  const entry = res?.kind === 'REENTRY';

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title="Gate verification" subtitle="Scan the student's QR pass or enter the pass ID. Every check is logged." />
      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => { setMode('scan'); setCamErr(null); setRes(null); setDone(null); }} className={`flex flex-col items-center gap-1.5 rounded-xl p-4 text-sm font-semibold ${mode === 'scan' ? 'bg-brand text-white' : 'bg-brand text-white hover:bg-[#17337a]'}`}><QrCode className="h-7 w-7" />Scan QR</button>
        <button onClick={() => { setMode('manual'); setRes(null); setDone(null); }} className="flex flex-col items-center gap-1.5 rounded-xl border border-line-strong bg-white p-4 text-sm font-semibold hover:bg-subtle"><Hash className="h-7 w-7 text-brand" />Enter pass ID</button>
      </div>

      {mode === 'scan' && (
        <div className="mt-4 space-y-2">
          {camErr ? <Notice tone="warn">{camErr}</Notice> : <Scanner onScan={(t) => void verify(t)} onError={setCamErr} />}
          <Button variant="secondary" full onClick={reset}>Cancel scan</Button>
        </div>
      )}
      {mode === 'manual' && (
        <form onSubmit={submitManual} className="mt-4 flex gap-2">
          <input aria-label="Pass ID" autoFocus className="input flex-1 uppercase tracking-widest" placeholder="XXXXX-XXXXX" value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} />
          <Button type="submit" loading={busy}>Verify</Button>
        </form>
      )}

      {done && <Notice tone="ok" className="mt-4" icon={<CheckCircle2 className="h-4 w-4" />}>{done} Ready for the next student.</Notice>}

      {res && (
        <Card pad={false} className="mt-4 overflow-hidden" >
          <div className={`flex items-center gap-3.5 p-4 ${res.state === 'VALID' ? 'bg-ok-bg text-ok-text' : 'bg-danger-bg text-danger-text'}`} role="status">
            {res.state === 'VALID' ? <CheckCircle2 className="h-11 w-11 shrink-0" /> : <XCircle className="h-11 w-11 shrink-0" />}
            <div><p className="text-3xl font-bold leading-tight">{TITLE[res.state]}</p>
              <p className="text-[13px] font-medium">{res.state === 'VALID' ? `OK to record ${entry ? 're-entry' : 'exit'}` : MSG[res.state]}</p></div>
          </div>
          {res.student && res.exit && (
            <div className="space-y-3 p-4">
              <div className="flex items-center gap-3"><Avatar name={res.student.name} size={48} /><div><p className="text-lg font-semibold">{res.student.name}</p><p className="text-[13px] text-ink-muted">{[res.student.college_id, res.student.department].filter(Boolean).join(' · ')}</p></div></div>
              <dl className="space-y-2 text-sm">
                <Row k="Pass type">{entry ? <Badge tone="info">Re-entry (late arrival)</Badge> : <Badge tone="neutral">Exit</Badge>}</Row>
                {!entry && <Row k="Destination">{res.exit.destination}</Row>}
                <Row k="Priority"><CategoryBadge category={res.exit.category} /></Row>
                {entry && res.exit.original_expected_return && <Row k="Was due back">{fmtDateTime(res.exit.original_expected_return)}</Row>}
                <Row k="Pass valid">{fmtTime(res.valid_from)} – {fmtTime(res.valid_until)}</Row>
                <Row k="Request">{res.request_code}</Row>
              </dl>
            </div>
          )}
          <div className="space-y-2.5 border-t border-line p-4">
            {res.state === 'VALID'
              ? <Button variant="approve" large full loading={busy} onClick={() => void record()}>{entry ? <><LogIn className="h-5 w-5" />Record re-entry</> : <><LogOutIcon className="h-5 w-5" />Record exit</>}</Button>
              : <Button variant="secondary" full onClick={reset}>Scan next pass</Button>}
            {res.state === 'VALID' && <Button variant="secondary" full onClick={reset}>Cancel</Button>}
          </div>
        </Card>
      )}

      <Notice tone="warn" className="mt-4"><strong>No return scan.</strong> Students are not logged back in. A student who arrives after their expected return time needs an approved <em>re-entry</em> pass; scan it like any other pass.</Notice>
      <Notice tone="neutral" icon={<ShieldCheck className="h-4 w-4" />} className="mt-3">Reason and medical details are never shown to security.</Notice>

      <Card pad={false} className="mt-6">
        <div className="px-5 py-4"><h2 className="text-base font-semibold">Recent gate activity</h2></div>
        {(recent.data ?? []).length === 0 ? <p className="border-t border-line px-5 py-6 text-sm text-ink-muted">No movements recorded yet.</p> :
          recent.data!.slice(0, 8).map((m, i) => (
            <div key={i} className="flex items-center gap-3 border-t border-line px-5 py-3 text-[13px]"><Badge tone={m.event_type === 'EXIT' ? 'neutral' : 'info'}>{m.event_type === 'EXIT' ? 'Exit' : 'Entry'}</Badge><span className="font-medium">{m.student_name}</span><span className="text-ink-muted">{m.college_id}</span><span className="ml-auto text-ink-muted">{fmtDateTime(m.event_at)}</span></div>
          ))}
      </Card>
    </div>
  );
}
const Row = ({ k, children }: { k: string; children: React.ReactNode }) => <div className="flex items-center justify-between gap-4"><dt className="text-ink-muted">{k}</dt><dd className="text-right font-medium">{children}</dd></div>;
