import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { errMsg, fmtDateTime, fromLocalInput, toLocalInput } from '../lib/format';
import { CATEGORY_LABEL, type Category } from '../types';
import { Button, Card, ErrorState, Field, Notice, PageHeader, PageSkeleton } from '../components/ui';

export default function ReentryPage() {
  const { id = '' } = useParams(); const nav = useNavigate(); const toast = useToast();
  const { data, error, reload } = useAsync(() => api.getRequestBundle(id), [id]);
  const [arrival, setArrival] = useState(''); const [reason, setReason] = useState(''); const [category, setCategory] = useState<Category>('REGULAR');
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const x = data.request;
  const minArrival = new Date(Math.max(Date.now(), new Date(x.expected_return ?? Date.now()).getTime()) + 60000);
  const value = arrival || toLocalInput(new Date(minArrival.getTime() + 30 * 60000));
  const blocked = x.kind !== 'EXIT' || x.movement_status !== 'EXITED' ? 'Re-entry approval is only for an exit that was recorded at the gate and has not been completed.' : data.linked ? 'A re-entry request already exists for this exit.' : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (new Date(value).getTime() <= new Date(x.expected_return!).getTime()) er.arrival = 'Pick a time after your original expected return.';
    if (new Date(value).getTime() < Date.now() - 10 * 60000) er.arrival = 'Arrival cannot be in the past.';
    if (reason.trim().length < 3) er.reason = 'Please explain why you will be late.';
    setErrs(er); if (Object.keys(er).length) return;
    setBusy(true);
    try { const r = await api.submitReentry({ exit_request_id: x.id, category, reason, arrival_time: fromLocalInput(value) }); toast('success', `Re-entry request ${r.request_code} submitted.`); nav(`/requests/${r.id}`); }
    catch (err) { toast('error', errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <>
      <Link to={`/requests/${x.id}`} className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"><ArrowLeft className="h-4 w-4" />Back to {x.request_code}</Link>
      <PageHeader title="Request re-entry approval" subtitle="Arriving after your expected return time follows the same approval process as leaving: Program Manager, then SWO." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {blocked ? <Notice tone="warn">{blocked}</Notice> : (
          <form onSubmit={submit} noValidate className="space-y-5 rounded-xl border border-line bg-white p-5 sm:p-7">
            <Field label="When will you arrive?" htmlFor="arrival" error={errs.arrival} hint={`Must be after ${fmtDateTime(x.expected_return)} (your original expected return).`}>
              <input id="arrival" type="datetime-local" min={toLocalInput(minArrival)} className={`input ${errs.arrival ? 'input-error' : ''}`} value={value} onChange={(e) => setArrival(e.target.value)} />
            </Field>
            <Field label="Why will you be late?" htmlFor="why" error={errs.reason}><textarea id="why" rows={3} maxLength={1000} className={`input ${errs.reason ? 'input-error' : ''}`} value={reason} onChange={(e) => { setReason(e.target.value); setErrs((s) => ({ ...s, reason: '' })); }} /></Field>
            <Field label="Priority" htmlFor="cat"><select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>{(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></Field>
            <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" loading={busy}>Submit re-entry request</Button></div>
          </form>
        )}
        <Card className="self-start"><h2 className="mb-3 text-base font-semibold">Your original exit</h2>
          <p className="text-sm font-medium">{x.request_code}</p><p className="text-sm text-ink-2">{x.destination}</p>
          <p className="mt-2 text-xs text-ink-muted">Left {fmtDateTime(x.departure_time)} · expected back {fmtDateTime(x.expected_return)}</p>
          <Notice tone="info" className="mt-4">If you are approved, you get a single-use re-entry pass to show at the gate. Without it, the gate cannot let you in.</Notice></Card>
      </div>
    </>
  );
}
