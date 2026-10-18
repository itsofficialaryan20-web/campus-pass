import { Link } from 'react-router-dom';
import type { ExitRequest } from '../types';
import { fmtDateTime } from '../lib/format';
import { CategoryBadge, EmptyState, KindBadge, StatusBadge } from './ui';

export function RequestsTable({ rows, showStudent, empty }: { rows: ExitRequest[]; showStudent?: boolean; empty?: string }) {
  if (!rows.length) return <EmptyState title={empty ?? 'No requests yet'} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="bg-subtle text-xs font-semibold text-ink-muted">
          <tr><th className="px-5 py-2">Request</th>{showStudent && <th className="px-3 py-2">Student</th>}<th className="px-3 py-2">Destination</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-5 py-2">Submitted</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line hover:bg-page">
              <td className="px-5 py-3"><Link to={`/requests/${r.id}`} className="font-medium text-brand hover:underline">{r.request_code}</Link></td>
              {showStudent && <td className="px-3 py-3">{r.student?.full_name ?? '—'}<div className="text-xs text-ink-muted">{r.student?.college_id}</div></td>}
              <td className="px-3 py-3">{r.destination}</td>
              <td className="px-3 py-3"><div className="flex gap-1.5"><CategoryBadge category={r.category} /><KindBadge kind={r.kind} /></div></td>
              <td className="px-3 py-3"><StatusBadge status={r.approval_status} movement={r.movement_status} kind={r.kind} /></td>
              <td className="px-5 py-3 text-ink-2">{fmtDateTime(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
