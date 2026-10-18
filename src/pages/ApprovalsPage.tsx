import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { duration, fmtDateTime, isOverdue, overdueBy, waiting } from '../lib/format';
import type { ExitRequest } from '../types';
import { AlertTriangle } from 'lucide-react';
import { Badge, Card, CategoryBadge, EmptyState, ErrorState, KindBadge, Notice, PageHeader, PageSkeleton, Pagination, StatusBadge } from '../components/ui';
import { DecisionPanel } from '../components/DecisionPanel';
import { Link } from 'react-router-dom';
import { coverStage, stageLabel } from '../lib/cover';

const RANK = { CRITICAL: 0, URGENT: 1, REGULAR: 2 } as const;
const PAGE = 10;

export function ApprovalsPage() {
  const { user } = useAuth();
  const d = useAsync(async () => {
    const [reqs, staff, active] = await Promise.all([api.listRequests(), api.listStaff().catch(() => []), api.listActiveAbsences().catch(() => [])]);
    return { reqs, staff, active };
  }, [], true);
  const reqs = { data: d.data?.reqs ?? null, error: d.error, reload: d.reload };
  const staff = d.data?.staff ?? []; const active = d.data?.active ?? [];
  const coverOf = (r: ExitRequest) => (user ? coverStage(r, user, staff, active) : null);
  const [q, setQ] = useState(''); const [status, setStatus] = useState<'PENDING' | 'CLARIFICATION' | 'OPEN'>('PENDING');
  const [urgency, setUrgency] = useState('ALL'); const [date, setDate] = useState('ALL'); const [dept, setDept] = useState('ALL');
  const [sel, setSel] = useState<string | null>(null); const [page, setPage] = useState(1); const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);
  const stageStatus = user?.role === 'swo' ? 'PENDING_SWO' : 'PENDING_PROGRAM_MANAGER';

  const all = reqs.data ?? [];
  const depts = useMemo(() => [...new Set(all.map((r) => r.student?.department).filter((d): d is string => !!d))].sort(), [all]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase(); const now = Date.now();
    return all.filter((r) => {
      if (status === 'PENDING' && r.approval_status !== stageStatus && !coverOf(r)) return false;
      if (status === 'CLARIFICATION' && r.approval_status !== 'NEEDS_CLARIFICATION') return false;
      if (status === 'OPEN' && !['PENDING_PROGRAM_MANAGER', 'PENDING_SWO', 'NEEDS_CLARIFICATION'].includes(r.approval_status)) return false;
      if (urgency !== 'ALL' && r.category !== urgency) return false;
      if (dept !== 'ALL' && r.student?.department !== dept) return false;
      if (date === 'TODAY' && now - new Date(r.created_at).getTime() > 86400000) return false;
      if (date === 'WEEK' && now - new Date(r.created_at).getTime() > 7 * 86400000) return false;
      return !t || r.request_code.toLowerCase().includes(t) || (r.student?.full_name ?? '').toLowerCase().includes(t) || (r.student?.college_id ?? '').toLowerCase().includes(t);
    }).sort((a, b) => RANK[a.category] - RANK[b.category] || a.stage_entered_at.localeCompare(b.stage_entered_at));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, status, urgency, date, dept, stageStatus, staff, active, user]);

  if (reqs.error) return <ErrorState message={reqs.error} onRetry={reqs.reload} />;
  if (!reqs.data) return <PageSkeleton />;
  const pending = all.filter((r) => r.approval_status === stageStatus || coverOf(r)).length;
  const covered = all.filter((r) => coverOf(r));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const cur = Math.min(page, pages);
  const shown = rows.slice((cur - 1) * PAGE, cur * PAGE);
  const selected = all.find((r) => r.id === sel) ?? null;
  const who = user?.role === 'swo' ? 'Requests the Program Manager has already approved.' : 'Requests from your assigned students. Only you (or an authorized backup after escalation) can act on them.';

  return (
    <>
      <PageHeader title="Approvals" subtitle={who} />
      {covered.length > 0 && (
        <Notice tone="warn" className="mb-4" icon={<AlertTriangle className="h-4 w-4" />}>
          <strong>Absence cover is active.</strong> {covered.length} request{covered.length === 1 ? ' is' : 's are'} open to you because the {stageLabel(coverOf(covered[0]!)!)} approver is declared absent. Approving needs a written comment, is flagged on the record, and notifies the absent approver and administrators.
        </Notice>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white">Pending ({pending})</span>
        <Link to="/approvals/history" className="rounded-lg px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-subtle">History</Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" /><input aria-label="Search" className="input w-64 pl-9" placeholder="Search student or request ID" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <select aria-label="Status" className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}><option value="PENDING">Status: Pending</option><option value="CLARIFICATION">Status: Awaiting student</option><option value="OPEN">Status: All open</option></select>
          <select aria-label="Urgency" className="input w-auto" value={urgency} onChange={(e) => { setUrgency(e.target.value); setPage(1); }}><option value="ALL">Urgency: All</option><option value="CRITICAL">Critical</option><option value="URGENT">Urgent</option><option value="REGULAR">Regular</option></select>
          <select aria-label="Date" className="input w-auto" value={date} onChange={(e) => { setDate(e.target.value); setPage(1); }}><option value="ALL">Date: Any</option><option value="TODAY">Last 24 hours</option><option value="WEEK">Last 7 days</option></select>
          <select aria-label="Department" className="input w-auto" value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }}><option value="ALL">Dept: All</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Card pad={false} className="self-start">
          <div className="flex items-center justify-between px-5 py-4"><h2 className="text-base font-semibold">Queue</h2><span className="text-xs text-ink-muted">Critical first, then longest waiting</span></div>
          {shown.length === 0 ? <EmptyState title="Nothing to review" text="New requests will appear here immediately." /> : (
            <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[13px]">
              <thead className="bg-subtle text-xs font-semibold text-ink-muted"><tr><th className="px-5 py-2">Student</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Destination</th><th className="px-3 py-2">Waiting</th></tr></thead>
              <tbody>{shown.map((r) => <Row key={r.id} r={r} cover={!!coverOf(r)} active={sel === r.id} onClick={() => setSel(r.id)} />)}</tbody>
            </table></div>
          )}
          <Pagination page={cur} pages={pages} onPage={setPage} />
        </Card>
        <Card className="self-start">
          {selected ? <DecisionPanel key={selected.id} request={selected} cover={coverOf(selected)} onDone={reqs.reload} /> : <EmptyState title="Select a request" text="Details and the approve, reject and clarification actions appear here." />}
          {selected && <Link to={`/requests/${selected.id}`} className="mt-4 block text-center text-sm font-semibold text-brand hover:underline">Open full timeline</Link>}
        </Card>
      </div>
    </>
  );
}

function Row({ r, active, cover, onClick }: { r: ExitRequest; active: boolean; cover?: boolean; onClick(): void }) {
  const clar = r.approval_status === 'NEEDS_CLARIFICATION'; const late = !clar && isOverdue(r.stage_due_at);
  return (
    <tr tabIndex={0} aria-selected={active} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className={`cursor-pointer border-t border-line hover:bg-page ${active ? 'bg-brand-tint' : ''} ${r.category === 'CRITICAL' ? 'shadow-[inset_4px_0_0_#B91C1C]' : r.category === 'URGENT' ? 'shadow-[inset_4px_0_0_#B45309]' : ''}`}>
      <td className="px-5 py-3"><p className="font-medium">{r.student?.full_name}</p><p className="text-xs text-ink-muted">{[r.student?.college_id, r.student?.department].filter(Boolean).join(' · ')}</p></td>
      <td className="px-3 py-3"><div className="flex flex-wrap gap-1.5"><CategoryBadge category={r.category} /><KindBadge kind={r.kind} />{cover && <Badge tone="warn">Cover</Badge>}</div></td>
      <td className="px-3 py-3">{r.destination}</td>
      <td className="px-3 py-3">
        {clar ? <Badge tone="info">Awaiting student</Badge> : (
          <span className={`inline-flex items-center gap-1.5 ${late ? 'font-semibold text-danger-text' : r.category === 'URGENT' ? 'font-semibold text-warn-text' : ''}`}>
            {(late || r.category !== 'REGULAR') && <span className={`h-2 w-2 rounded-full ${late ? 'bg-danger-solid' : 'bg-warn-solid'}`} aria-hidden />}
            {waiting(r.stage_entered_at)}{late && r.stage_due_at ? ` · overdue ${overdueBy(r.stage_due_at)}` : ''}
          </span>
        )}
      </td>
    </tr>
  );
}

export function DecisionHistoryPage() {
  const { user } = useAuth();
  const data = useAsync(async () => { const [records, reqs] = await Promise.all([api.listApprovalRecords(), api.listRequests()]); return { records, reqs }; }, [], true);
  const [page, setPage] = useState(1);
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!data.data || !user) return <PageSkeleton />;
  const byId = new Map(data.data.reqs.map((r) => [r.id, r]));
  const mine = data.data.records.filter((x) => x.approver_id === user.id).sort((a, b) => b.decided_at.localeCompare(a.decided_at));
  const pages = Math.max(1, Math.ceil(mine.length / PAGE)); const cur = Math.min(page, pages);
  const tone = { APPROVED: 'ok', REJECTED: 'danger', CLARIFICATION_REQUESTED: 'info' } as const;
  const label = { APPROVED: 'Approved', REJECTED: 'Rejected', CLARIFICATION_REQUESTED: 'Clarification' } as const;
  return (
    <>
      <PageHeader title="Decision history" subtitle="Every decision you have made. Records cannot be edited or deleted." />
      <Card pad={false}>
        {mine.length === 0 ? <EmptyState title="No decisions yet" /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
            <thead className="bg-subtle text-xs font-semibold text-ink-muted"><tr><th className="px-5 py-2">Request</th><th className="px-3 py-2">Student</th><th className="px-3 py-2">Decision</th><th className="px-3 py-2">Your comment</th><th className="px-3 py-2">Responded in</th><th className="px-5 py-2">Decided</th></tr></thead>
            <tbody>{mine.slice((cur - 1) * PAGE, cur * PAGE).map((x) => { const r = byId.get(x.request_id); return (
              <tr key={x.id} className="border-t border-line">
                <td className="px-5 py-3">{r ? <Link to={`/requests/${r.id}`} className="font-medium text-brand hover:underline">{r.request_code}</Link> : '—'}</td>
                <td className="px-3 py-3">{r?.student?.full_name ?? '—'}</td>
                <td className="px-3 py-3"><Badge tone={tone[x.decision]}>{label[x.decision]}</Badge>{x.acted_as_backup && <span className="ml-1.5 text-xs text-ink-muted">as backup</span>}</td>
                <td className="max-w-[260px] truncate px-3 py-3 text-ink-2" title={x.comments ?? ''}>{x.comments ?? '—'}</td>
                <td className="px-3 py-3">{duration(new Date(x.decided_at).getTime() - new Date(x.stage_entered_at).getTime())}</td>
                <td className="px-5 py-3 text-ink-2">{fmtDateTime(x.decided_at)}</td>
              </tr>); })}</tbody>
          </table></div>
        )}
        <Pagination page={cur} pages={pages} onPage={setPage} />
      </Card>
      {data.data.reqs.length > 0 && <p className="mt-3 text-xs text-ink-muted">Current status of a request is shown on its detail page <StatusBadge status="APPROVED_PASS_ISSUED" />.</p>}
    </>
  );
}
