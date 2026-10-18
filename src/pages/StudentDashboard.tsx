import { Link } from 'react-router-dom';
import { AlertTriangle, Check, Clock, DoorOpen, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { fmtDateTime, fmtTime, waiting } from '../lib/format';
import { OPEN_STATUSES, type ExitRequest } from '../types';
import { Button, Card, CardTitle, CategoryBadge, ErrorState, Notice, PageHeader, PageSkeleton, StatusBadge, KindBadge } from '../components/ui';
import { RequestsTable } from '../components/RequestsTable';

type S = 'done' | 'cur' | 'todo' | 'bad';
function steps(r: ExitRequest): Array<{ label: string; sub: string; s: S }> {
  const inStage = (st: 'PROGRAM_MANAGER' | 'SWO') => (r.approval_status === (st === 'SWO' ? 'PENDING_SWO' : 'PENDING_PROGRAM_MANAGER')) || (r.approval_status === 'NEEDS_CLARIFICATION' && r.clarification_stage === st);
  const rejected = r.approval_status === 'REJECTED';
  return [
    { label: 'Submitted', sub: fmtTime(r.created_at), s: 'done' },
    { label: 'Program Manager', sub: r.pm_approved_at ? `Approved ${fmtTime(r.pm_approved_at)}` : inStage('PROGRAM_MANAGER') ? `Waiting ${waiting(r.stage_entered_at)}` : rejected && !r.pm_approved_at ? 'Rejected' : '—', s: r.pm_approved_at ? 'done' : inStage('PROGRAM_MANAGER') ? 'cur' : rejected && !r.pm_approved_at ? 'bad' : 'todo' },
    { label: 'SWO review', sub: r.approved_at ? `Approved ${fmtTime(r.approved_at)}` : inStage('SWO') ? `Waiting ${waiting(r.stage_entered_at)}` : rejected && r.pm_approved_at ? 'Rejected' : '—', s: r.approved_at ? 'done' : inStage('SWO') ? 'cur' : rejected && r.pm_approved_at ? 'bad' : 'todo' },
    { label: 'Pass issued', sub: r.approved_at ? fmtTime(r.approved_at) : '—', s: r.approved_at ? 'done' : 'todo' },
    { label: r.kind === 'REENTRY' ? 'Entry recorded' : 'Exit recorded', sub: r.movement_status !== 'NONE' ? 'At the gate' : '—', s: r.movement_status !== 'NONE' ? 'done' : r.approved_at ? 'cur' : 'todo' },
  ];
}
const DOT: Record<S, string> = { done: 'bg-ok-solid text-white', cur: 'bg-brand text-white', todo: 'border border-line-strong bg-subtle', bad: 'bg-danger-solid text-white' };

export default function StudentDashboard() {
  const { user } = useAuth();
  const reqs = useAsync(() => api.listRequests(), [], true);
  const notes = useAsync(() => api.listNotifications(), [], true);
  if (reqs.error) return <ErrorState message={reqs.error} onRetry={reqs.reload} />;
  if (!reqs.data) return <PageSkeleton />;
  const rows = reqs.data;
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.approval_status));
  const ready = rows.filter((r) => r.approval_status === 'APPROVED_PASS_ISSUED' && r.movement_status === 'NONE');
  const done = rows.filter((r) => r.kind === 'EXIT' && r.movement_status !== 'NONE');
  const current = open[0] ?? ready[0] ?? null;
  const hasOpenReentry = (id: string) => rows.some((x) => x.related_request_id === id && !['REJECTED', 'CANCELLED'].includes(x.approval_status));
  const late = rows.filter((r) => r.kind === 'EXIT' && r.movement_status === 'EXITED' && r.expected_return && new Date(r.expected_return).getTime() < Date.now() && !hasOpenReentry(r.id));
  const first = user?.full_name.split(' ')[0] ?? '';
  const hour = new Date().getHours();

  const stat = [
    { label: 'Pending', n: open.length, sub: 'Waiting for a decision', Icon: Clock, tone: 'bg-warn-bg text-warn-text' },
    { label: 'Approved', n: ready.length, sub: 'Pass ready to show', Icon: ShieldCheck, tone: 'bg-ok-bg text-ok-text' },
    { label: 'Completed', n: done.length, sub: 'Exits recorded at the gate', Icon: DoorOpen, tone: 'bg-brand-tint text-brand' },
  ];
  return (
    <>
      <PageHeader title={`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}, ${first}`} subtitle="Here is where your exit requests stand today." actions={<Link to="/requests/new"><Button>New exit request</Button></Link>} />
      {late.map((r) => (
        <Notice key={r.id} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} className="mb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>You are past your expected return time for <strong>{r.request_code}</strong>. To enter campus you need a new approval through the same process.</span>
            <Link to={`/requests/${r.id}/reentry`}><Button variant="secondary" className="!py-1.5">Request re-entry approval</Button></Link>
          </div>
        </Notice>
      ))}
      <div className="grid gap-4 md:grid-cols-3">
        {stat.map(({ label, n, sub, Icon, tone }) => (
          <Card key={label} className="flex items-center justify-between"><div><p className="text-[13px] font-medium text-ink-2">{label}</p><p className="text-3xl font-bold">{n}</p><p className="text-xs text-ink-muted">{sub}</p></div><span className={`grid h-11 w-11 place-items-center rounded-[10px] ${tone}`}><Icon className="h-5 w-5" /></span></Card>
        ))}
      </div>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardTitle right={current && <StatusBadge status={current.approval_status} movement={current.movement_status} kind={current.kind} />}>
              <span className="flex flex-wrap items-center gap-2">Current request{current && <><Link to={`/requests/${current.id}`} className="text-[13px] font-medium text-ink-muted hover:text-brand">{current.request_code}</Link><CategoryBadge category={current.category} /><KindBadge kind={current.kind} /></>}</span>
            </CardTitle>
            {current ? (
              <ol className="grid grid-cols-5 gap-1" aria-label="Request progress">
                {steps(current).map((s, i, a) => (
                  <li key={s.label} className="text-center">
                    <div className="flex items-center">
                      <span className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : a[i - 1]!.s === 'done' ? 'bg-ok-solid' : 'bg-line-strong'}`} />
                      <span className={`grid h-7 w-7 place-items-center rounded-full ${DOT[s.s]}`} aria-hidden>{s.s === 'done' ? <Check className="h-3.5 w-3.5" /> : s.s === 'cur' ? <Clock className="h-3.5 w-3.5" /> : null}</span>
                      <span className={`h-0.5 flex-1 ${i === a.length - 1 ? 'bg-transparent' : s.s === 'done' ? 'bg-ok-solid' : 'bg-line-strong'}`} />
                    </div>
                    <p className={`mt-2 text-xs ${s.s === 'cur' ? 'font-semibold' : 'font-medium'} ${s.s === 'todo' ? 'text-ink-muted' : ''}`}>{s.label}</p>
                    <p className={`text-[11px] ${s.s === 'cur' ? 'text-warn-text' : 'text-ink-muted'}`}>{s.sub}</p>
                  </li>
                ))}
              </ol>
            ) : <p className="text-sm text-ink-muted">No active request. Start one when you need to leave campus.</p>}
            {current?.approval_status === 'APPROVED_PASS_ISSUED' && current.movement_status === 'NONE' && <div className="mt-4"><Link to={`/requests/${current.id}/pass`}><Button>Show my pass</Button></Link></div>}
          </Card>
          <Card pad={false}>
            <div className="flex items-center justify-between px-5 py-4"><h2 className="text-base font-semibold">Recent requests</h2><Link to="/requests" className="text-sm font-semibold text-brand hover:underline">View all</Link></div>
            <RequestsTable rows={rows.slice(0, 5)} empty="You have not made any requests yet" />
          </Card>
        </div>
        <Card pad={false} className="self-start">
          <div className="flex items-center justify-between px-5 py-4"><h2 className="text-base font-semibold">Notifications</h2><Link to="/notifications" className="text-sm font-semibold text-brand hover:underline">All</Link></div>
          {(notes.data ?? []).slice(0, 5).map((n) => (
            <Link key={n.id} to={n.request_id ? `/requests/${n.request_id}` : '/notifications'} className="flex gap-3 border-t border-line px-5 py-3.5 hover:bg-page">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-line-strong' : 'bg-brand'}`} aria-label={n.read_at ? 'Read' : 'Unread'} />
              <div><p className={`text-[13px] ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</p><p className="text-xs text-ink-muted">{fmtDateTime(n.created_at)}</p></div>
            </Link>
          ))}
          {notes.data?.length === 0 && <p className="border-t border-line px-5 py-6 text-sm text-ink-muted">Nothing new.</p>}
        </Card>
      </div>
    </>
  );
}
