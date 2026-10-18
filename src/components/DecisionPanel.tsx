import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { errMsg, fmtDateTime, isOverdue, overdueBy, waiting } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import type { ExitRequest, Stage } from '../types';
import { stageLabel } from '../lib/cover';
import { Avatar } from './Avatar';
import { Button, CategoryBadge, ConfirmDialog, Field, KindBadge, Notice } from './ui';

/** Approve / reject / ask for clarification. The server re-validates role, assignment and stage. */
export function DecisionPanel({ request: r, cover, onDone }: { request: ExitRequest; cover?: Stage | null; onDone(): void }) {
  const { user } = useAuth(); const toast = useToast();
  const [comment, setComment] = useState(''); const [commentErr, setCommentErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'APPROVED' | 'REJECTED' | null>(null); const [busy, setBusy] = useState(false);
  const stageRole = r.approval_status === 'PENDING_PROGRAM_MANAGER' ? 'program_manager' : r.approval_status === 'PENDING_SWO' ? 'swo' : null;
  const canAct = (!!user && stageRole === user.role) || !!cover;
  const overdue = canAct && isOverdue(r.stage_due_at);

  async function run(decision: 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED') {
    if (decision === 'CLARIFICATION_REQUESTED' && !comment.trim()) { setCommentErr('Write what you need to know. The student will see this.'); return; }
    setBusy(true);
    try {
      await api.decide(r.id, decision, comment);
      toast('success', decision === 'APPROVED' ? 'Approved.' : decision === 'REJECTED' ? 'Request rejected. The student has been notified.' : 'Clarification requested.');
      setComment(''); setConfirm(null); onDone();
    } catch (e) { toast('error', errMsg(e)); setConfirm(null); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold">{r.request_code}</h2><CategoryBadge category={r.category} /><KindBadge kind={r.kind} />
        <span className="ml-auto text-xs text-ink-muted">Submitted {fmtDateTime(r.created_at)}</span>
      </div>
      <div className="flex items-center gap-3">
        <Avatar name={r.student?.full_name ?? '?'} size={44} />
        <div><p className="font-semibold">{r.student?.full_name ?? 'Student'}</p><p className="text-xs text-ink-muted">{[r.student?.college_id, r.student?.department].filter(Boolean).join(' · ')}</p></div>
      </div>
      <Detail label="Reason">{r.reason}</Detail>
      {r.details && <Detail label="Supporting details">{r.details}</Detail>}
      <div className="grid grid-cols-3 gap-3">
        <Detail label="Destination">{r.destination}</Detail>
        <Detail label={r.kind === 'REENTRY' ? 'Arrives' : 'Leaves'}>{fmtDateTime(r.departure_time)}</Detail>
        {r.expected_return && <Detail label="Returns">{fmtDateTime(r.expected_return)}</Detail>}
      </div>
      {r.kind === 'REENTRY' && <Notice tone="info">This student is outside campus and will arrive after the original return time. Entry needs the same approval as an exit.</Notice>}
      {overdue && r.stage_due_at && (
        <Notice tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>
          {r.category !== 'REGULAR' ? `${r.category === 'CRITICAL' ? 'Critical' : 'Urgent'}: ` : ''}response target passed {overdueBy(r.stage_due_at)} ago. Approval is still required; nothing is approved automatically.
        </Notice>
      )}
      {canAct && cover && (
        <Notice tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>
          You are covering the <strong>{stageLabel(cover)}</strong> stage because that approver is declared absent. Approving needs a written comment, is flagged as cover on the record, and notifies the absent approver and administrators.
        </Notice>
      )}
      {canAct ? (
        <>
          <Field label="Comment" htmlFor="decision-comment" error={commentErr} hint={cover ? 'Required to approve as cover and to request clarification.' : 'Optional for approve and reject. Required to request clarification.'}>
            <textarea id="decision-comment" rows={3} maxLength={1000} className={`input ${commentErr ? 'input-error' : ''}`} value={comment} onChange={(e) => { setComment(e.target.value); setCommentErr(null); }} placeholder="Add a note for the student…" />
          </Field>
          <Button variant="approve" full onClick={() => { if (cover && !comment.trim()) { setCommentErr('Explain why you are approving in place of the absent approver.'); return; } setConfirm('APPROVED'); }} disabled={busy}>{cover ? `Approve as cover for ${stageLabel(cover)}` : 'Approve'}</Button>
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="secondary" onClick={() => void run('CLARIFICATION_REQUESTED')} disabled={busy}>Request clarification</Button>
            <Button variant="reject" onClick={() => setConfirm('REJECTED')} disabled={busy}>Reject</Button>
          </div>
        </>
      ) : (
        <Notice tone="neutral">{stageRole ? 'This request is waiting for a different approver.' : `Status: no action needed (waiting ${waiting(r.stage_entered_at)} in the last stage).`}</Notice>
      )}
      <ConfirmDialog open={confirm !== null} busy={busy} danger={confirm === 'REJECTED'} onClose={() => setConfirm(null)} onConfirm={() => confirm && void run(confirm)}
        title={confirm === 'APPROVED' ? 'Approve this request?' : 'Reject this request?'} confirmLabel={confirm === 'APPROVED' ? 'Approve' : 'Reject'}
        text={confirm === 'APPROVED'
          ? (r.approval_status === 'PENDING_SWO' ? 'This is the final approval. A single-use pass will be issued to the student.' : 'The request moves to the SWO for the second approval.')
          : 'The workflow stops here and the student is notified. This cannot be undone.'} />
    </div>
  );
}
const Detail = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className="text-xs font-medium text-ink-muted">{label}</p><p className="text-sm">{children}</p></div>;
