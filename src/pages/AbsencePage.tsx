import { useState } from 'react';
import { CalendarOff, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { errMsg, fmtDateTime, toLocalInput } from '../lib/format';
import { ROLE_LABEL } from '../types';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, Field, Notice, PageHeader, PageSkeleton } from '../components/ui';

export default function AbsencePage() {
  const { user } = useAuth(); const toast = useToast();
  const data = useAsync(async () => {
    const [mine, active, staff] = await Promise.all([api.listAbsences(), api.listActiveAbsences(), api.listStaff()]);
    return { mine, active, staff };
  }, [], true);
  const [target, setTarget] = useState(''); const [ends, setEnds] = useState(toLocalInput(new Date(Date.now() + 24 * 3600000)));
  const [reason, setReason] = useState(''); const [errs, setErrs] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data || !user) return <PageSkeleton />;
  const isAdmin = user.role === 'admin';
  const { mine, active, staff } = data.data;
  const candidates = staff.filter((s) => s.role === 'program_manager' || s.role === 'swo');
  const who = isAdmin ? target : user.id;
  const myActive = active.find((a) => a.user_id === user.id);
  const counterpart = user.role === 'swo' ? 'Program Managers' : user.role === 'program_manager' ? 'SWO members' : 'the other approver role';

  async function declare() {
    const e: Record<string, string> = {};
    if (!who) e.target = 'Choose who is absent.';
    if (reason.trim().length < 3) e.reason = 'Give a short reason (kept private to you and admins).';
    if (new Date(ends).getTime() <= Date.now()) e.ends = 'Pick a time in the future.';
    else if (new Date(ends).getTime() > Date.now() + 14 * 86400000) e.ends = 'An absence can last at most 14 days.';
    setErrs(e); if (Object.keys(e).length) return;
    setBusy(true);
    try { await api.declareAbsence({ user_id: who, ends_at: new Date(ends).toISOString(), reason }); toast('success', 'Absence declared. Cover is now possible, with the safeguards below.'); setReason(''); data.reload(); }
    catch (err) { toast('error', errMsg(err)); } finally { setBusy(false); }
  }
  async function end(id: string) {
    try { await api.endAbsence(id); toast('success', 'Absence ended. Cover has stopped.'); data.reload(); } catch (err) { toast('error', errMsg(err)); }
  }
  const nowMs = Date.now();
  const state = (a: (typeof mine)[number]) => (a.ended_at ? 'Ended' : new Date(a.ends_at).getTime() <= nowMs ? 'Expired' : 'Active');

  return (
    <>
      <PageHeader title="Absence cover" subtitle="When an approver is unavailable, the other approver role can step in. It is explicit, time-limited, and always visible." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>{isAdmin ? 'Declare an absence for an approver' : 'Declare my absence'}</CardTitle>
            {myActive && !isAdmin ? (
              <Notice tone="warn" icon={<CalendarOff className="h-4 w-4" />}>You are marked absent until <strong>{fmtDateTime(myActive.ends_at)}</strong>. End it below when you are back.</Notice>
            ) : (
              <div className="space-y-4">
                {isAdmin && (
                  <Field label="Who is absent?" htmlFor="ab-who" error={errs.target}>
                    <select id="ab-who" className="input" value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose a Program Manager or SWO member</option>{candidates.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({ROLE_LABEL[s.role]})</option>)}</select>
                  </Field>
                )}
                <Field label="Absent until" htmlFor="ab-end" error={errs.ends} hint="At most 14 days. You can end it earlier."><input id="ab-end" type="datetime-local" className={`input ${errs.ends ? 'input-error' : ''}`} value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
                <Field label="Reason" htmlFor="ab-reason" error={errs.reason} hint="Only you and administrators can read this."><input id="ab-reason" maxLength={300} className={`input ${errs.reason ? 'input-error' : ''}`} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
                <div className="flex justify-end"><Button loading={busy} onClick={() => void declare()}>Declare absence</Button></div>
              </div>
            )}
          </Card>
          <Card pad={false}>
            <div className="px-5 py-4"><h2 className="text-base font-semibold">{isAdmin ? 'All absences' : 'My absences'}</h2></div>
            {mine.length === 0 ? <EmptyState title="No absences recorded" /> : (
              <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-[13px]">
                <thead className="bg-subtle text-xs font-semibold text-ink-muted"><tr><th className="px-5 py-2">Who</th><th className="px-3 py-2">From</th><th className="px-3 py-2">Until</th><th className="px-3 py-2">Reason</th><th className="px-3 py-2">State</th><th className="px-5 py-2" /></tr></thead>
                <tbody>{mine.map((a) => { const s = state(a); return (
                  <tr key={a.id} className="border-t border-line"><td className="px-5 py-3 font-medium">{a.full_name}<div className="text-xs font-normal text-ink-muted">{ROLE_LABEL[a.role]}</div></td>
                    <td className="px-3 py-3">{fmtDateTime(a.starts_at)}</td><td className="px-3 py-3">{fmtDateTime(a.ends_at)}</td><td className="px-3 py-3 text-ink-2">{a.reason ?? '—'}</td>
                    <td className="px-3 py-3"><Badge tone={s === 'Active' ? 'warn' : 'neutral'}>{s}</Badge></td>
                    <td className="px-5 py-3 text-right">{s === 'Active' && <Button variant="ghost" className="!py-1.5" onClick={() => void end(a.id)}>End now</Button>}</td></tr>); })}</tbody>
              </table></div>
            )}
          </Card>
        </div>
        <div className="space-y-4 self-start">
          <Card>
            <CardTitle>Absent right now</CardTitle>
            {active.length === 0 ? <p className="text-sm text-ink-muted">Nobody. All approvers are available, so no one can be covered.</p> : (
              <ul className="space-y-2.5 text-sm">{active.map((a) => <li key={a.id} className="flex items-center justify-between gap-3"><span><span className="font-medium">{a.full_name}</span><span className="block text-xs text-ink-muted">{ROLE_LABEL[a.role]} · back {fmtDateTime(a.ends_at)}</span></span><Badge tone="warn">Absent</Badge></li>)}</ul>
            )}
          </Card>
          <Notice tone="info" icon={<ShieldCheck className="h-4 w-4" />}>
            <p className="mb-1.5 font-semibold">How cover works</p>
            <ul className="list-disc space-y-1 pl-4 font-normal">
              <li>If <strong>every SWO member</strong> is absent, a Program Manager can act at the SWO stage.</li>
              <li>If a student&rsquo;s <strong>own Program Manager</strong> is absent, an SWO member can act at the Program Manager stage.</li>
              <li>The same rules apply to <strong>late re-entry</strong> requests.</li>
              <li>Approving as cover needs a written comment, is flagged on the record, and notifies the absent approver and administrators.</li>
              <li>You can never approve your own request, and cover ends automatically at the time you set{user.role !== 'admin' ? ` (${counterpart} are told when you are absent)` : ''}.</li>
            </ul>
          </Notice>
        </div>
      </div>
    </>
  );
}
