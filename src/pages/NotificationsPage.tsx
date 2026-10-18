import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import { api } from '../lib/api';
import { errMsg, fmtDateTime } from '../lib/format';
import { Button, Card, EmptyState, ErrorState, PageHeader, PageSkeleton } from '../components/ui';

export default function NotificationsPage() {
  const { data, error, reload } = useAsync(() => api.listNotifications(), [], true);
  const toast = useToast(); const [busy, setBusy] = useState(false);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const unread = data.filter((n) => !n.read_at).length;
  async function markAll() { setBusy(true); try { await api.markNotificationsRead(); reload(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); } }
  return (
    <>
      <PageHeader title="Notifications" subtitle={unread ? `${unread} unread` : 'You are all caught up.'} actions={<Button variant="secondary" disabled={!unread} loading={busy} onClick={() => void markAll()}>Mark all read</Button>} />
      <Card pad={false}>
        {data.length === 0 ? <EmptyState title="No notifications yet" text="Decisions, clarification requests and pass updates will show up here." /> : (
          <ul>{data.map((n) => (
            <li key={n.id} className="border-t border-line first:border-t-0">
              <Link to={n.request_id ? `/requests/${n.request_id}` : '#'} className="flex gap-3 px-5 py-4 hover:bg-page">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read_at ? 'bg-line-strong' : 'bg-brand'}`} aria-label={n.read_at ? 'Read' : 'Unread'} />
                <div className="min-w-0"><p className={`text-sm ${n.read_at ? '' : 'font-semibold'}`}>{n.title}</p>{n.body && <p className="text-[13px] text-ink-2">{n.body}</p>}<p className="mt-0.5 text-xs text-ink-muted">{fmtDateTime(n.created_at)}</p></div>
              </Link>
            </li>))}</ul>
        )}
      </Card>
    </>
  );
}
