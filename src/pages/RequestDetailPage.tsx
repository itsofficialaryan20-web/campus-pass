import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, QrCode } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { errMsg, fmtDateTime } from '../lib/format';
import { Button, Card, CardTitle, CategoryBadge, ConfirmDialog, ErrorState, Field, KindBadge, Modal, Notice, PageSkeleton, StatusBadge } from '../components/ui';
import { Timeline, buildEvents } from '../components/Timeline';
import { DecisionPanel } from '../components/DecisionPanel';
import { coverStage } from '../lib/cover';

export default function RequestDetailPage() {
  const { id = '' } = useParams(); const { user } = useAuth(); const toast = useToast(); const nav = useNavigate();
  const { data, error, reload } = useAsync(async () => {
    const [bundle, staff, active] = await Promise.all([api.getRequestBundle(id), api.listStaff().catch(() => []), api.listActiveAbsences().catch(() => [])]);
    return { bundle, staff, active };
  }, [id], true);
  const [cancelOpen, setCancelOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(''); const [replyErr, setReplyErr] = useState<string | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false); const [reason, setReason] = useState('');

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data || !user) return <PageSkeleton />;
  const { bundle: b, staff, active } = data; const r = b.request;
  const nameOf = (uid: string) => staff.find((s) => s.id === uid)?.full_name ?? (uid === user.id ? user.full_name : 'Approver');
  const mine = r.student_id === user.id;
  const staffRole = user.role === 'program_manager' || user.role === 'swo';
  const passUsable = !!b.pass && !b.pass.revoked_at && r.approval_status === 'APPROVED_PASS_ISSUED' && r.movement_status === 'NONE';
  const canCancel = mine && (['PENDING_PROGRAM_MANAGER', 'PENDING_SWO', 'NEEDS_CLARIFICATION', 'APPROVED_PASS_ISSUED'].includes(r.approval_status)) && r.movement_status === 'NONE';
  const canReentry = mine && r.kind === 'EXIT' && r.movement_status === 'EXITED' && !b.linked;
  const pmDone = !!r.pm_approved_at; const swoDone = !!r.approved_at;

  async function act(fn: () => Promise<void>, ok: string) {
    setBusy(true);
    try { await fn(); toast('success', ok); reload(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); setCancelOpen(false); setRevokeOpen(false); }
  }
  const sendReply = () => { if (!reply.trim()) { setReplyErr('Write your answer first.'); return; } void act(async () => { await api.respondClarification(r.id, reply); setReply(''); }, 'Your answer was sent.'); };

  return (
    <>
      <button onClick={() => nav(-1)} className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"><ArrowLeft className="h-4 w-4" />Back</button>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{r.request_code}</h1><CategoryBadge category={r.category} /><KindBadge kind={r.kind} /><StatusBadge status={r.approval_status} movement={r.movement_status} kind={r.kind} />
        <span className="ml-auto text-[13px] text-ink-muted">Submitted {fmtDateTime(r.created_at)}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <CardTitle>{r.kind === 'REENTRY' ? 'Re-entry details' : 'Request details'}</CardTitle>
            {!mine && r.student && <p className="mb-4 text-sm"><span className="font-semibold">{r.student.full_name}</span> <span className="text-ink-muted">· {[r.student.college_id, r.student.department].filter(Boolean).join(' · ')}</span></p>}
            <dl className="grid gap-4 sm:grid-cols-3">
              <div><dt className="text-xs font-medium text-ink-muted">Destination</dt><dd className="text-sm">{r.destination}</dd></div>
              <div><dt className="text-xs font-medium text-ink-muted">{r.kind === 'REENTRY' ? 'Arriving' : 'Intended departure'}</dt><dd className="text-sm">{fmtDateTime(r.departure_time)}</dd></div>
              {r.expected_return && <div><dt className="text-xs font-medium text-ink-muted">Expected return</dt><dd className="text-sm">{fmtDateTime(r.expected_return)}</dd></div>}
            </dl>
            <div className="mt-4"><dt className="text-xs font-medium text-ink-muted">Reason</dt><dd className="text-sm">{r.reason}</dd></div>
            {r.details && <div className="mt-3"><dt className="text-xs font-medium text-ink-muted">Supporting details</dt><dd className="text-sm">{r.details}</dd></div>}
            {b.linked && <p className="mt-4 text-sm text-ink-2">{r.kind === 'REENTRY' ? 'Follows exit' : 'Re-entry request'}: <Link className="font-semibold text-brand hover:underline" to={`/requests/${b.linked.id}`}>{b.linked.request_code}</Link> <StatusBadge status={b.linked.approval_status} movement={b.linked.movement_status} kind={b.linked.kind} /></p>}
          </Card>
          {mine && r.approval_status === 'NEEDS_CLARIFICATION' && (
            <Card className="border-info-text/30">
              <CardTitle>Your approver needs more information</CardTitle>
              <Field label="Your answer" htmlFor="reply" error={replyErr}><textarea id="reply" rows={3} maxLength={1000} className={`input ${replyErr ? 'input-error' : ''}`} value={reply} onChange={(e) => { setReply(e.target.value); setReplyErr(null); }} /></Field>
              <div className="mt-3 flex justify-end"><Button onClick={sendReply} loading={busy}>Send answer</Button></div>
            </Card>
          )}
          <Card><CardTitle>Approval timeline</CardTitle><Timeline events={buildEvents(b, nameOf)} /></Card>
        </div>
        <div className="space-y-4 self-start">
          {staffRole && ['PENDING_PROGRAM_MANAGER', 'PENDING_SWO'].includes(r.approval_status) && <Card><DecisionPanel request={r} cover={coverStage(r, user, staff, active)} onDone={reload} /></Card>}
          <Card>
            <CardTitle>Approval progress</CardTitle>
            <div className="space-y-2.5 text-sm">
              {[['Program Manager', pmDone, r.approval_status === 'REJECTED' && !pmDone], ['SWO', swoDone, r.approval_status === 'REJECTED' && pmDone]].map(([n, d, rej]) => (
                <div key={n as string} className="flex items-center justify-between"><span className="font-medium">{n as string}</span><span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${d ? 'bg-ok-bg text-ok-text' : rej ? 'bg-danger-bg text-danger-text' : 'bg-warn-bg text-warn-text'}`}>{d ? 'Approved' : rej ? 'Rejected' : 'Pending'}</span></div>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-muted">{(pmDone ? 1 : 0) + (swoDone ? 1 : 0)} of 2 approvals complete. Both are required before a pass exists.</p>
          </Card>
          <Card>
            <CardTitle>{r.kind === 'REENTRY' ? 'Re-entry pass' : 'Exit pass'}</CardTitle>
            {b.pass ? (
              <div className="space-y-3 text-sm">
                <p className="text-ink-2">Valid {fmtDateTime(b.pass.valid_from)} to {fmtDateTime(b.pass.valid_until)}.</p>
                {b.pass.revoked_at && <Notice tone="danger">Revoked{b.pass.revoke_reason ? `: ${b.pass.revoke_reason}` : '.'}</Notice>}
                {b.pass.used_at && <Notice tone="neutral">Used at the gate on {fmtDateTime(b.pass.used_at)}. A pass works once.</Notice>}
                {mine && passUsable && <Link to={`/requests/${r.id}/pass`}><Button full><QrCode className="h-4 w-4" />Show my pass</Button></Link>}
                {(user.role === 'admin' || user.role === 'swo') && passUsable && <Button variant="reject" full onClick={() => setRevokeOpen(true)}>Revoke pass</Button>}
              </div>
            ) : (
              <div className="rounded-[10px] bg-subtle p-6 text-center"><Lock className="mx-auto h-7 w-7 text-ink-muted" /><p className="mt-2 text-sm font-semibold">Pass not issued yet</p><p className="text-xs text-ink-muted">The QR pass appears here after the SWO approves.</p></div>
            )}
          </Card>
          {canReentry && (
            <Card><CardTitle>Arriving late?</CardTitle><p className="mb-3 text-sm text-ink-2">Your exit was recorded. If you will reach campus after your expected return time, you need a new approval before the gate will let you in.</p><Link to={`/requests/${r.id}/reentry`}><Button variant="secondary" full>Request re-entry approval</Button></Link></Card>
          )}
          {canCancel && <Card><CardTitle>Actions</CardTitle><Button variant="reject" full onClick={() => setCancelOpen(true)}>Cancel request</Button><p className="mt-2 text-xs text-ink-muted">You can cancel until the pass is used at the gate.</p></Card>}
        </div>
      </div>
      <ConfirmDialog open={cancelOpen} busy={busy} danger title="Cancel this request?" text="The request stops here and any pass is revoked immediately." confirmLabel="Cancel request" onClose={() => setCancelOpen(false)} onConfirm={() => void act(() => api.cancelRequest(r.id), 'Request cancelled.')} />
      <Modal open={revokeOpen} title="Revoke this pass?" onClose={() => setRevokeOpen(false)} footer={<><Button variant="secondary" onClick={() => setRevokeOpen(false)}>Keep pass</Button><Button variant="reject" loading={busy} disabled={!reason.trim()} onClick={() => void act(() => api.revokePass(r.id, reason), 'Pass revoked.')}>Revoke</Button></>}>
        <Field label="Reason (the student will see this)" htmlFor="revoke"><textarea id="revoke" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
