import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Check, Info } from 'lucide-react';
import { api } from '../lib/api';
import { errMsg, fromLocalInput, toLocalInput } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { CATEGORY_LABEL, type Category } from '../types';
import { Button, Card, CardTitle, Field, Notice, PageHeader } from '../components/ui';

const OPTIONS: Array<[Category, string]> = [['REGULAR', 'Normal sequential approval.'], ['URGENT', 'Priority queue with a visible response deadline.'], ['CRITICAL', 'Alerts designated authorities and security.']];

export default function NewRequestPage() {
  const nav = useNavigate(); const toast = useToast();
  const soon = new Date(Date.now() + 30 * 60000);
  const [f, setF] = useState({ category: 'REGULAR' as Category, reason: '', destination: '', dep: toLocalInput(soon), ret: toLocalInput(new Date(soon.getTime() + 3 * 3600000)), details: '' });
  const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((s) => ({ ...s, [k]: v })); setErrs((e) => ({ ...e, [k]: '' })); };

  function validate() {
    const e: Record<string, string> = {};
    if (f.reason.trim().length < 3) e.reason = 'Tell your approvers why you need to leave (at least 3 characters).';
    if (f.destination.trim().length < 2) e.destination = 'Enter where you are going.';
    if (!f.dep) e.dep = 'Choose a departure time.';
    else if (new Date(f.dep).getTime() < Date.now() - 10 * 60000) e.dep = 'Departure cannot be in the past.';
    if (!f.ret) e.ret = 'Choose an expected return time.';
    else if (f.dep && new Date(f.ret) <= new Date(f.dep)) e.ret = 'Return must be after departure.';
    setErrs(e); return Object.keys(e).length === 0;
  }
  async function submit(ev: FormEvent) {
    ev.preventDefault(); if (!validate()) return;
    setBusy(true);
    try {
      const r = await api.submitRequest({ category: f.category, reason: f.reason, destination: f.destination, departure_time: fromLocalInput(f.dep), expected_return: fromLocalInput(f.ret), details: f.details });
      toast('success', `Request ${r.request_code} submitted.`); nav(`/requests/${r.id}`);
    } catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="New exit request" subtitle="Your request goes to your Program Manager first, then to the SWO. A pass is issued only after both approve." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <form onSubmit={submit} noValidate className="space-y-5 rounded-xl border border-line bg-white p-5 sm:p-7">
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-ink-2">Request type</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {OPTIONS.map(([k, d]) => (
                <label key={k} className="cursor-pointer">
                  <input type="radio" name="category" value={k} checked={f.category === k} onChange={() => set('category', k)} className="peer sr-only" />
                  <span className="block h-full rounded-[10px] border border-line-strong p-3.5 peer-checked:border-2 peer-checked:border-brand peer-checked:bg-brand-tint peer-focus-visible:ring-2 peer-focus-visible:ring-brand">
                    <span className="flex items-center justify-between text-sm font-semibold">{CATEGORY_LABEL[k]}{f.category === k && <Check className="h-4 w-4 text-brand" />}</span>
                    <span className="mt-1 block text-xs text-ink-2">{d}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Reason for leaving campus" htmlFor="reason" error={errs.reason}><textarea id="reason" rows={3} maxLength={1000} className={`input ${errs.reason ? 'input-error' : ''}`} value={f.reason} onChange={(e) => set('reason', e.target.value)} /></Field>
          <Field label="Destination" htmlFor="dest" error={errs.destination}><input id="dest" maxLength={200} className={`input ${errs.destination ? 'input-error' : ''}`} value={f.destination} onChange={(e) => set('destination', e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Intended departure" htmlFor="dep" error={errs.dep}><input id="dep" type="datetime-local" className={`input ${errs.dep ? 'input-error' : ''}`} value={f.dep} onChange={(e) => set('dep', e.target.value)} /></Field>
            <Field label="Expected return" htmlFor="ret" error={errs.ret}><input id="ret" type="datetime-local" className={`input ${errs.ret ? 'input-error' : ''}`} value={f.ret} onChange={(e) => set('ret', e.target.value)} /></Field>
          </div>
          <Field label="Supporting details (optional)" htmlFor="details" hint="Visible to your approvers only. Security staff never see the reason or details. Avoid sensitive medical information.">
            <textarea id="details" rows={2} maxLength={2000} className="input" value={f.details} onChange={(e) => set('details', e.target.value)} />
          </Field>
          <div className="flex justify-end gap-3"><Button type="button" variant="secondary" onClick={() => nav(-1)}>Cancel</Button><Button type="submit" loading={busy}>Submit request</Button></div>
        </form>
        <div className="space-y-4 self-start">
          <Card><CardTitle>Approval path</CardTitle>
            <ol className="space-y-3">{[['Program Manager', 'Assigned to you by the administrator'], ['Student Welfare Organization', 'Reviews after the Program Manager approves'], ['Security gate', 'Scans your QR pass; your exit is logged']].map(([t, s], i) => (
              <li key={t} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-semibold text-brand">{i + 1}</span><div><p className="text-sm font-semibold">{t}</p><p className="text-xs text-ink-2">{s}</p></div></li>))}</ol>
          </Card>
          <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>Critical Emergency alerts designated authorities and security immediately. It still needs authorized approval and is audited. Nothing is approved automatically when a timer runs out.</Notice>
          <Notice tone="info" icon={<Info className="h-4 w-4" />}><strong>Arriving late?</strong> If you reach campus after your expected return time, you need a new approval (the same process) to enter.</Notice>
        </div>
      </div>
    </>
  );
}
