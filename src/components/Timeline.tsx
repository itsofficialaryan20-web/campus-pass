import { Check, Clock, MessageCircle, X, DoorOpen } from 'lucide-react';
import type { ApprovalRecord, RequestBundle } from '../types';
import { duration, fmtDateTime, waiting } from '../lib/format';
import { Badge } from './ui';

export interface TimelineEvent {
  tone: 'done' | 'info' | 'bad' | 'current' | 'todo'; title: string; meta?: string; quote?: string; badge?: string; flag?: string; at?: string;
}

export function buildEvents(b: RequestBundle, nameOf: (id: string) => string): TimelineEvent[] {
  const r = b.request; const ev: TimelineEvent[] = [];
  const kind = r.kind === 'REENTRY' ? 're-entry request' : 'exit request';
  ev.push({ tone: 'done', title: `${r.kind === 'REENTRY' ? 'Re-entry' : 'Exit'} request submitted`, meta: `${r.student?.full_name ?? 'Student'} · ${fmtDateTime(r.created_at)}`, at: r.created_at });
  const stageName = (s: ApprovalRecord['stage']) => (s === 'PROGRAM_MANAGER' ? 'Program Manager' : 'SWO');
  for (const x of b.records) {
    const who = `${nameOf(x.approver_id)}${x.acted_as_backup ? ' (backup approver)' : ''}${x.acted_as_cover ? ` (covering the absent ${stageName(x.stage)})` : ''} · ${fmtDateTime(x.decided_at)}`;
    const flag = x.acted_as_cover ? 'Absence cover' : undefined;
    const took = `Responded in ${duration(new Date(x.decided_at).getTime() - new Date(x.stage_entered_at).getTime())}`;
    if (x.decision === 'APPROVED') ev.push({ tone: 'done', title: `${stageName(x.stage)} approved`, meta: who, quote: x.comments ?? undefined, badge: took, flag, at: x.decided_at });
    else if (x.decision === 'REJECTED') ev.push({ tone: 'bad', title: `Rejected by ${stageName(x.stage)}`, meta: who, quote: x.comments ?? undefined, badge: took, flag, at: x.decided_at });
    else ev.push({ tone: 'info', title: `Clarification requested by ${stageName(x.stage)}`, meta: who, quote: x.comments ?? undefined, flag, at: x.decided_at });
  }
  for (const c of b.clarifications) ev.push({ tone: 'done', title: 'Clarification answered', meta: `${r.student?.full_name ?? 'Student'} · ${fmtDateTime(c.created_at)}`, quote: c.message, at: c.created_at });
  if (r.approved_at) ev.push({ tone: 'done', title: 'Pass issued', meta: fmtDateTime(r.approved_at), at: r.approved_at });
  for (const m of b.movements) ev.push({ tone: 'done', title: m.event_type === 'EXIT' ? 'Exit recorded at the gate' : 'Re-entry recorded at the gate', meta: fmtDateTime(m.event_at), at: m.event_at });
  ev.sort((a, c) => (a.at ?? '').localeCompare(c.at ?? ''));

  const now = Date.now();
  switch (r.approval_status) {
    case 'PENDING_PROGRAM_MANAGER': case 'PENDING_SWO': {
      const who = r.approval_status === 'PENDING_SWO' ? 'SWO' : 'Program Manager';
      const late = r.stage_due_at && new Date(r.stage_due_at).getTime() < now;
      ev.push({ tone: 'current', title: `${who} review in progress`, meta: `Waiting ${waiting(r.stage_entered_at)}${late ? ' · past the response target' : ''}` });
      ev.push({ tone: 'todo', title: 'Pass issued', meta: `After ${r.approval_status === 'PENDING_PROGRAM_MANAGER' ? 'both approvals' : 'SWO approval'}` });
      break;
    }
    case 'NEEDS_CLARIFICATION': ev.push({ tone: 'current', title: 'Waiting for your reply', meta: `Asked by ${r.clarification_stage === 'SWO' ? 'SWO' : 'the Program Manager'}. The approval clock is paused.` }); break;
    case 'APPROVED_PASS_ISSUED': if (r.movement_status === 'NONE') ev.push({ tone: 'todo', title: r.kind === 'REENTRY' ? 'Entry recorded at the gate' : 'Exit recorded at the gate', meta: 'When security scans your pass' }); break;
    case 'CANCELLED': ev.push({ tone: 'bad', title: `This ${kind} was cancelled` }); break;
    default: break;
  }
  return ev;
}

const DOT = { done: 'bg-ok-solid text-white', info: 'bg-info-text text-white', bad: 'bg-danger-solid text-white', current: 'bg-brand text-white', todo: 'border border-line-strong bg-subtle text-ink-muted' } as const;
export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="space-y-0">
      {events.map((e, i) => (
        <li key={i} className="flex gap-3.5">
          <div className="flex flex-col items-center">
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${DOT[e.tone]}`} aria-hidden>
              {e.tone === 'done' ? (e.title.includes('recorded') ? <DoorOpen className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />) : e.tone === 'info' ? <MessageCircle className="h-3 w-3" /> : e.tone === 'bad' ? <X className="h-3.5 w-3.5" /> : e.tone === 'current' ? <Clock className="h-3.5 w-3.5" /> : null}
            </span>
            {i < events.length - 1 && <span className="my-1 w-0.5 flex-1 bg-line-strong" />}
          </div>
          <div className={`min-w-0 flex-1 ${i < events.length - 1 ? 'pb-5' : ''}`}>
            <p className={`text-sm font-semibold ${e.tone === 'todo' ? 'text-ink-muted' : ''}`}>{e.title}</p>
            {e.meta && <p className={`text-xs ${e.tone === 'current' ? 'font-medium text-warn-text' : 'text-ink-muted'}`}>{e.meta}</p>}
            {e.quote && <p className="mt-1.5 rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-2">“{e.quote}”</p>}
            {(e.badge || e.flag) && <div className="mt-1.5 flex flex-wrap gap-1.5">{e.badge && <Badge tone="ok">{e.badge}</Badge>}{e.flag && <Badge tone="warn">{e.flag}</Badge>}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
