import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { STATUS_LABEL, type ApprovalStatus } from '../types';
import { Card, ErrorState, PageHeader, PageSkeleton, Pagination } from '../components/ui';
import { RequestsTable } from '../components/RequestsTable';

const PAGE = 10;
export default function MyRequestsPage() {
  const { data, error, reload } = useAsync(() => api.listRequests(), [], true);
  const [q, setQ] = useState(''); const [status, setStatus] = useState<'ALL' | ApprovalStatus>('ALL'); const [asc, setAsc] = useState(false); const [page, setPage] = useState(1);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = (data ?? []).filter((r) => (status === 'ALL' || r.approval_status === status) && (!t || r.request_code.toLowerCase().includes(t) || r.destination.toLowerCase().includes(t) || r.reason.toLowerCase().includes(t)));
    return l.sort((a, b) => (asc ? 1 : -1) * a.created_at.localeCompare(b.created_at));
  }, [data, q, status, asc]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const cur = Math.min(page, pages);
  return (
    <>
      <PageHeader title="My requests" subtitle="Every request you have made, including rejections, cancellations and re-entry requests." />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 p-4">
          <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" /><input aria-label="Search requests" className="input pl-9" placeholder="Search by ID, destination or reason" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <select aria-label="Filter by status" className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value as 'ALL' | ApprovalStatus); setPage(1); }}>
            <option value="ALL">All statuses</option>{(Object.keys(STATUS_LABEL) as ApprovalStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <button className="rounded-lg border border-line-strong px-3 text-sm font-medium hover:bg-subtle" onClick={() => setAsc((a) => !a)}>{asc ? 'Oldest first' : 'Newest first'}</button>
        </div>
        <RequestsTable rows={rows.slice((cur - 1) * PAGE, cur * PAGE)} empty="No requests match your filters" />
        <Pagination page={cur} pages={pages} onPage={setPage} />
      </Card>
    </>
  );
}
