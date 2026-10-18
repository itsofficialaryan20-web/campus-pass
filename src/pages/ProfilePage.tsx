import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { api } from '../lib/api';
import { errMsg } from '../lib/format';
import { ROLE_LABEL } from '../types';
import { Button, Card, CardTitle, ErrorState, Field, Notice, PageHeader } from '../components/ui';

export default function ProfilePage() {
  const { user, refresh } = useAuth(); const toast = useToast();
  const prefs = useAsync(() => api.getPrefs(), []);
  const staff = useAsync(() => api.listStaff().catch(() => []), []);
  const [name, setName] = useState(user?.full_name ?? ''); const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<boolean | null>(null); const [sms, setSms] = useState<boolean | null>(null);
  if (!user) return null;
  if (prefs.error) return <ErrorState message={prefs.error} onRetry={prefs.reload} />;
  const manager = staff.data?.find((s) => s.id === user.assigned_manager_id);
  const e = email ?? prefs.data?.email_opt_in ?? false; const s = sms ?? prefs.data?.sms_opt_in ?? false;
  async function save() {
    setBusy(true);
    try { if (name.trim() !== user!.full_name) await api.updateMyName(name); await api.setPrefs({ email_opt_in: e, sms_opt_in: s }); await refresh(); toast('success', 'Profile saved.'); }
    catch (err) { toast('error', errMsg(err)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Profile & notification settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Your details</CardTitle>
          <div className="space-y-4">
            <Field label="Full name" htmlFor="pname"><input id="pname" className="input" value={name} maxLength={120} onChange={(ev) => setName(ev.target.value)} /></Field>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-ink-muted">Role</dt><dd className="font-medium">{ROLE_LABEL[user.role]}</dd></div>
              <div><dt className="text-xs text-ink-muted">College ID</dt><dd className="font-medium">{user.college_id ?? '—'}</dd></div>
              <div><dt className="text-xs text-ink-muted">Department</dt><dd className="font-medium">{user.department ?? '—'}</dd></div>
              {user.role === 'student' && <div><dt className="text-xs text-ink-muted">Program Manager</dt><dd className="font-medium">{manager?.full_name ?? '—'}</dd></div>}
            </dl>
            <Notice tone="neutral">Role, department and manager are set by your administrator and cannot be changed here.</Notice>
          </div>
        </Card>
        <Card>
          <CardTitle>Notifications</CardTitle>
          <div className="space-y-3">
            <label className="flex items-center justify-between rounded-lg border border-line p-3 text-sm"><span><span className="font-medium">In-app notifications</span><span className="block text-xs text-ink-muted">Always on. Required for approval decisions.</span></span><input type="checkbox" checked disabled aria-label="In-app notifications (always on)" className="h-4 w-4" /></label>
            <label className="flex items-center justify-between rounded-lg border border-line p-3 text-sm"><span className="font-medium">Email</span><input type="checkbox" checked={e} onChange={(ev) => setEmail(ev.target.checked)} className="h-4 w-4" /></label>
            <label className="flex items-center justify-between rounded-lg border border-line p-3 text-sm"><span className="font-medium">SMS</span><input type="checkbox" checked={s} onChange={(ev) => setSms(ev.target.checked)} className="h-4 w-4" /></label>
            <Notice tone="warn">Email and SMS delivery are not configured in this build. Your choice is saved, but only in-app notifications are delivered until an administrator sets up a provider.</Notice>
          </div>
        </Card>
      </div>
      <div className="mt-6 flex justify-end"><Button onClick={() => void save()} loading={busy}>Save changes</Button></div>
    </>
  );
}
