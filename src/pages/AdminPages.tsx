import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Plus, Search } from 'lucide-react';
import { useAsync } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { computeStats } from '../lib/stats';
import { duration, errMsg, fmtDateTime } from '../lib/format';
import { ROLE_LABEL, type AccountStatus, type AppSettings, type AuditLog, type EmergencyPolicy, type Profile, type Role, type Stage } from '../types';
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, Field, Modal, Notice, PageHeader, PageSkeleton, Pagination } from '../components/ui';
import { RequestsTable } from '../components/RequestsTable';

const PAGE = 10;
function useAdminData() {
  return useAsync(async () => {
    const [reqs, records, policies, audit] = await Promise.all([api.listRequests(), api.listApprovalRecords(), api.listPolicies(), api.listAudit()]);
    return { reqs, records, policies, audit };
  }, [], true);
}
function StatCard({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return <Card className="!p-[18px]"><p className="text-[13px] font-medium text-ink-2">{label}</p><p className="text-[28px] font-bold leading-9">{value}</p><p className="text-xs text-ink-muted">{sub}</p></Card>;
}
function AuditTable({ rows, pageSize = PAGE }: { rows: AuditLog[]; pageSize?: number }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize)); const cur = Math.min(page, pages);
  if (!rows.length) return <EmptyState title="No audit entries match" />;
  return (
    <>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="bg-subtle text-xs font-semibold text-ink-muted"><tr><th className="px-5 py-2">Time</th><th className="px-3 py-2">Actor</th><th className="px-3 py-2">Action</th><th className="px-5 py-2">Target</th></tr></thead>
        <tbody>{rows.slice((cur - 1) * pageSize, cur * pageSize).map((a) => (
          <tr key={a.id} className="border-t border-line"><td className="whitespace-nowrap px-5 py-2.5 text-ink-2">{fmtDateTime(a.created_at)}</td><td className="px-3 py-2.5">{a.actor_name ?? 'System'}</td>
            <td className="px-3 py-2.5 font-mono text-xs">{a.action}</td><td className="px-5 py-2.5 font-mono text-xs text-ink-muted">{a.target_id ? a.target_id.slice(0, 8) : '—'}</td></tr>))}</tbody>
      </table></div>
      <Pagination page={cur} pages={pages} onPage={setPage} />
    </>
  );
}

export function AdminOverview() {
  const d = useAdminData(); const toast = useToast();
  const abs = useAsync(() => api.listActiveAbsences(), [], true);
  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const s = computeStats(d.data.reqs, d.data.records, d.data.policies);
  const absent = abs.data ?? [];
  const bars: Array<[string, number]> = [['Program Manager', s.pending.pm], ['SWO', s.pending.swo], ['Awaiting clarification', s.pending.clarification], ['Pass issued, not used', s.pending.passReady]];
  const max = Math.max(1, ...bars.map((b) => b[1]));
  async function maintenance() {
    try { const r = await api.demo!.runMaintenance(); toast('success', `Escalation check: ${r.escalated} escalated, ${r.admin_alerts} admin alerts, ${r.passes_expired} expired passes.`); d.reload(); } catch (e) { toast('error', errMsg(e)); }
  }
  return (
    <>
      <PageHeader title="Overview" subtitle={api.mode === 'demo' ? 'Pilot metrics computed from the demo data in this browser.' : 'Pilot metrics computed from live requests and approval records.'}
        actions={api.demo ? <Button variant="secondary" onClick={() => void maintenance()}>Run escalation check (demo)</Button> : undefined} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Requests today" value={s.today} sub="Exit and re-entry" />
        <StatCard label="Avg. approval time" value={s.avgApprovalMs === null ? '—' : duration(s.avgApprovalMs)} sub="Submit to pass issued" />
        <StatCard label="Pending now" value={s.pending.pm + s.pending.swo} sub={`Program Manager ${s.pending.pm} · SWO ${s.pending.swo}`} />
        <StatCard label="Emergency response" value={s.emergencyMedianMs === null ? '—' : duration(s.emergencyMedianMs)} sub={`Median first decision, ${s.emergencyCount} urgent/critical`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_440px]">
        <Card><CardTitle>Pending requests by stage</CardTitle>
          <div className="space-y-3">{bars.map(([l, n]) => (
            <div key={l} className="flex items-center gap-3 text-[13px]"><span className="w-44 shrink-0 text-ink-2">{l}</span><div className="h-4 flex-1 rounded-md bg-subtle"><div className="h-4 rounded-md bg-brand" style={{ width: `${(n / max) * 100}%` }} /></div><span className="w-6 text-right font-semibold">{n}</span></div>))}</div>
        </Card>
        <Card><CardTitle>Needs attention</CardTitle>
          <div className="space-y-2.5">
            {s.categoriesWithoutPolicy.map((c) => <Notice key={c} tone="warn" icon={<AlertTriangle className="h-4 w-4" />}>No emergency policy is enabled for {c === 'URGENT' ? 'Urgent' : 'Critical'} requests, so nothing is escalated for them.</Notice>)}
            {s.overdueNoBackup.map((r) => <Notice key={r.id} tone="danger" icon={<AlertTriangle className="h-4 w-4" />}>{r.request_code} ({r.category.toLowerCase()}) is overdue and no backup approver is configured. It stays pending.</Notice>)}
            {absent.map((a) => <Notice key={a.id} tone="info">{a.full_name} ({ROLE_LABEL[a.role]}) is absent until {fmtDateTime(a.ends_at)}. {a.role === 'swo' ? 'Program Managers can cover the SWO stage if every SWO member is absent.' : 'SWO members can cover the Program Manager stage for their students.'}</Notice>)}
            {s.categoriesWithoutPolicy.length === 0 && s.overdueNoBackup.length === 0 && absent.length === 0 && <p className="text-sm text-ink-muted">Nothing needs attention.</p>}
          </div></Card>
      </div>
      <Card pad={false} className="mt-6"><div className="flex items-center justify-between px-5 py-4"><h2 className="text-base font-semibold">Audit log</h2><span className="text-xs text-ink-muted">Append-only. Cannot be edited or deleted.</span></div><AuditTable rows={d.data.audit.slice(0, 6)} pageSize={6} /></Card>
    </>
  );
}

const csv = (rows: AuditLog[]) => ['time,actor,action,target', ...rows.map((a) => [a.created_at, a.actor_name ?? '', a.action, a.target_id ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
export function AdminReports() {
  const d = useAdminData(); const [q, setQ] = useState('');
  const audit = useMemo(() => (d.data?.audit ?? []).filter((a) => { const t = q.toLowerCase(); return !t || a.action.toLowerCase().includes(t) || (a.actor_name ?? '').toLowerCase().includes(t) || (a.target_id ?? '').includes(t); }), [d.data, q]);
  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const s = computeStats(d.data.reqs, d.data.records, d.data.policies);
  function exportCsv() { const url = URL.createObjectURL(new Blob([csv(audit)], { type: 'text/csv' })); const a = document.createElement('a'); a.href = url; a.download = 'campuspass-audit.csv'; a.click(); URL.revokeObjectURL(url); }
  return (
    <>
      <PageHeader title="Reports & audit" subtitle="Approval delays are measured from the timestamps recorded at each stage." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="All requests" value={d.data.reqs.length} sub={`${s.today} today`} /><StatCard label="Avg. approval time" value={s.avgApprovalMs === null ? '—' : duration(s.avgApprovalMs)} sub="Submit to pass issued" />
        <StatCard label="Overdue now" value={s.overdue.length} sub="Past their response target" /><StatCard label="Median emergency response" value={s.emergencyMedianMs === null ? '—' : duration(s.emergencyMedianMs)} sub={`${s.emergencyCount} urgent/critical`} />
      </div>
      <Card pad={false} className="mt-6"><div className="px-5 py-4"><h2 className="text-base font-semibold">All requests</h2></div><RequestsTable rows={d.data.reqs.slice(0, 15)} showStudent /></Card>
      <Card pad={false} className="mt-6">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4"><h2 className="text-base font-semibold">Audit log</h2>
          <div className="relative ml-auto"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" /><input aria-label="Filter audit log" className="input w-64 pl-9" placeholder="Filter by actor, action or ID" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button variant="secondary" onClick={exportCsv}><Download className="h-4 w-4" />Export CSV</Button></div>
        <AuditTable rows={audit} />
      </Card>
    </>
  );
}

const ROLES: Role[] = ['student', 'program_manager', 'swo', 'security', 'admin'];
const STATUSES: AccountStatus[] = ['PENDING', 'ACTIVE', 'DISABLED'];
export function AdminUsers() {
  const { user: me } = useAuth(); const toast = useToast();
  const { data, error, reload } = useAsync(() => api.listProfiles(), [], false);
  const [q, setQ] = useState(''); const [role, setRole] = useState<'ALL' | Role>('ALL'); const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Profile | null>(null); const [creating, setCreating] = useState(false); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', college_id: '', role: 'student' as Role, department: '', manager: '' });
  const [created, setCreated] = useState<{ email: string; pw?: string } | null>(null);
  const rows = useMemo(() => (data ?? []).filter((p) => (role === 'ALL' || p.role === role) && (!q || `${p.full_name} ${p.college_id ?? ''} ${p.email ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, role]);
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const managers = data.filter((p) => p.role === 'program_manager' && p.status === 'ACTIVE');
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const cur = Math.min(page, pages);
  const tone = { ACTIVE: 'ok', PENDING: 'warn', DISABLED: 'neutral' } as const;

  async function saveEdit() {
    if (!edit) return; setBusy(true);
    try { await api.updateProfile({ id: edit.id, full_name: edit.full_name, role: edit.role, status: edit.status, department: edit.department ?? '', college_id: edit.college_id ?? '', assigned_manager_id: edit.role === 'student' ? edit.assigned_manager_id : null }); toast('success', 'User updated.'); setEdit(null); reload(); }
    catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); }
  }
  async function create() {
    setBusy(true);
    try { const r = await api.createUser({ email: form.email, full_name: form.full_name, college_id: form.college_id, role: form.role, department: form.department, assigned_manager_id: form.role === 'student' && form.manager ? form.manager : null }); setCreated({ email: form.email, pw: r.temporaryPassword }); setCreating(false); reload(); }
    catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Only administrators can create accounts, change roles, or assign students to Program Managers." actions={<Button onClick={() => { setCreating(true); setForm({ email: '', full_name: '', college_id: '', role: 'student', department: '', manager: '' }); }}><Plus className="h-4 w-4" />Add user</Button>} />
      <Card pad={false}>
        <div className="flex flex-wrap gap-3 p-4"><div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" /><input aria-label="Search users" className="input pl-9" placeholder="Search name, ID or email" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
          <select aria-label="Role filter" className="input w-auto" value={role} onChange={(e) => { setRole(e.target.value as 'ALL' | Role); setPage(1); }}><option value="ALL">All roles</option>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]">
          <thead className="bg-subtle text-xs font-semibold text-ink-muted"><tr><th className="px-5 py-2">Name</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Department</th><th className="px-3 py-2">Program Manager</th><th className="px-3 py-2">Status</th><th className="px-5 py-2" /></tr></thead>
          <tbody>{rows.slice((cur - 1) * PAGE, cur * PAGE).map((p) => (
            <tr key={p.id} className="border-t border-line"><td className="px-5 py-3"><p className="font-medium">{p.full_name}</p><p className="text-xs text-ink-muted">{p.college_id ?? p.email ?? '—'}</p></td>
              <td className="px-3 py-3">{ROLE_LABEL[p.role]}</td><td className="px-3 py-3">{p.department ?? '—'}</td><td className="px-3 py-3">{data.find((m) => m.id === p.assigned_manager_id)?.full_name ?? '—'}</td>
              <td className="px-3 py-3"><Badge tone={tone[p.status]}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Badge></td>
              <td className="px-5 py-3 text-right"><Button variant="ghost" className="!py-1.5" onClick={() => setEdit({ ...p })}>Edit</Button></td></tr>))}</tbody>
        </table></div>
        <Pagination page={cur} pages={pages} onPage={setPage} />
      </Card>

      <Modal open={!!edit} title={`Edit ${edit?.full_name ?? ''}`} onClose={() => setEdit(null)} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void saveEdit()} loading={busy}>Save</Button></>}>
        {edit && <div className="space-y-4">
          <Field label="Full name" htmlFor="e-name"><input id="e-name" className="input" value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="College ID" htmlFor="e-id"><input id="e-id" className="input" value={edit.college_id ?? ''} onChange={(e) => setEdit({ ...edit, college_id: e.target.value })} /></Field>
            <Field label="Department" htmlFor="e-dept"><input id="e-dept" className="input" value={edit.department ?? ''} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Role" htmlFor="e-role"><select id="e-role" className="input" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            <Field label="Status" htmlFor="e-status"><select id="e-status" className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as AccountStatus })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field></div>
          {edit.role === 'student' && <Field label="Program Manager" htmlFor="e-mgr"><select id="e-mgr" className="input" value={edit.assigned_manager_id ?? ''} onChange={(e) => setEdit({ ...edit, assigned_manager_id: e.target.value || null })}><option value="">Not assigned</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field>}
          {edit.id === me?.id && <Notice tone="warn">You cannot demote or disable your own admin account.</Notice>}
          {edit.status === 'DISABLED' && <Notice tone="neutral">Disabled accounts lose all role-gated access immediately. Also ban the user in Supabase Auth to end any open session.</Notice>}
        </div>}
      </Modal>
      <Modal open={creating} title="Add user" onClose={() => setCreating(false)} footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button onClick={() => void create()} loading={busy} disabled={!form.email || !form.full_name}>Create account</Button></>}>
        <div className="space-y-4">
          <Field label="Email" htmlFor="c-mail"><input id="c-mail" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Full name" htmlFor="c-name"><input id="c-name" className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="College ID" htmlFor="c-id"><input id="c-id" className="input" value={form.college_id} onChange={(e) => setForm({ ...form, college_id: e.target.value })} /></Field>
            <Field label="Department" htmlFor="c-dept"><input id="c-dept" className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></Field></div>
          <Field label="Role" htmlFor="c-role"><select id="c-role" className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
          {form.role === 'student' && <Field label="Program Manager" htmlFor="c-mgr"><select id="c-mgr" className="input" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })}><option value="">Assign later</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field>}
        </div>
      </Modal>
      <Modal open={!!created} title="Account created" onClose={() => setCreated(null)} footer={<Button onClick={() => setCreated(null)}>Done</Button>}>
        <p className="text-sm text-ink-2">Account for <strong>{created?.email}</strong> is active.</p>
        {created?.pw && <p className="mt-3 text-sm">Temporary password (shown once): <code className="rounded bg-subtle px-1.5 py-0.5 font-semibold">{created.pw}</code></p>}
        <Notice tone="neutral" className="mt-3">Share it securely and ask the user to change it after signing in.</Notice>
      </Modal>
    </>
  );
}

const ALERT_ROLES: Role[] = ['admin', 'security', 'swo', 'program_manager'];
const blankPolicy = (): Partial<EmergencyPolicy> & { name: string } => ({ name: '', category: 'URGENT', stage: null, response_deadline_minutes: 30, backup_approver_id: null, alert_roles: ['admin'], policy_reference: '', enabled: true });
export function AdminPolicies() {
  const toast = useToast();
  const d = useAsync(async () => { const [policies, settings, staff] = await Promise.all([api.listPolicies(), api.getSettings(), api.listStaff()]); return { policies, settings, staff }; }, []);
  const [edit, setEdit] = useState<(Partial<EmergencyPolicy> & { name: string }) | null>(null); const [busy, setBusy] = useState(false); const [st, setSt] = useState<AppSettings | null>(null);
  if (d.error) return <ErrorState message={d.error} onRetry={d.reload} />;
  if (!d.data) return <PageSkeleton />;
  const settings = st ?? d.data.settings; const mgrs = d.data.staff.filter((s) => s.role === 'program_manager');
  const num = (k: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setSt({ ...settings, [k]: Math.max(1, Number(e.target.value) || 1) });
  async function run(fn: () => Promise<void>, ok: string) { setBusy(true); try { await fn(); toast('success', ok); setEdit(null); d.reload(); } catch (e) { toast('error', errMsg(e)); } finally { setBusy(false); } }
  return (
    <>
      <PageHeader title="Policies & settings" subtitle="Escalation only notifies people. No policy and no timer ever approves a request." />
      <Card className="mb-6">
        <CardTitle>Pass validity & response targets</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {([['pass_validity_minutes', 'Pass valid for (min)'], ['pass_early_minutes', 'Valid before departure (min)'], ['regular_response_minutes', 'Regular target (min)'], ['urgent_response_minutes', 'Urgent target (min)'], ['critical_response_minutes', 'Critical target (min)']] as const).map(([k, l]) => (
            <Field key={k} label={l} htmlFor={k}><input id={k} type="number" min={1} className="input" value={settings[k]} onChange={num(k)} /></Field>))}
        </div>
        <Notice tone="warn" className="mt-4">Email and SMS delivery are not configured. In-app notifications always work. Connect a provider (for example a Supabase Edge Function) before enabling these.</Notice>
        <div className="mt-4 flex justify-end"><Button loading={busy} disabled={!st} onClick={() => void run(() => api.saveSettings(settings), 'Settings saved.')}>Save settings</Button></div>
      </Card>
      <Card pad={false}>
        <div className="flex items-center justify-between px-5 py-4"><h2 className="text-base font-semibold">Emergency policies</h2><Button onClick={() => setEdit(blankPolicy())}><Plus className="h-4 w-4" />Add policy</Button></div>
        {d.data.policies.length === 0 ? <EmptyState title="No emergency policies" text="Without an enabled policy, urgent and critical requests follow the normal path and administrators are alerted when they run late." /> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[13px]"><thead className="bg-subtle text-xs font-semibold text-ink-muted"><tr><th className="px-5 py-2">Policy</th><th className="px-3 py-2">Applies to</th><th className="px-3 py-2">Deadline</th><th className="px-3 py-2">Backup approver</th><th className="px-3 py-2">Basis</th><th className="px-3 py-2">State</th><th className="px-5 py-2" /></tr></thead>
            <tbody>{d.data.policies.map((p) => (
              <tr key={p.id} className="border-t border-line"><td className="px-5 py-3 font-medium">{p.name}</td><td className="px-3 py-3">{p.category === 'URGENT' ? 'Urgent' : 'Critical'} · {p.stage === 'PROGRAM_MANAGER' ? 'Program Manager' : p.stage === 'SWO' ? 'SWO' : 'both stages'}</td>
                <td className="px-3 py-3">{p.response_deadline_minutes} min</td><td className="px-3 py-3">{d.data!.staff.find((s) => s.id === p.backup_approver_id)?.full_name ?? 'None'}</td><td className="px-3 py-3 text-ink-2">{p.policy_reference}</td>
                <td className="px-3 py-3"><Badge tone={p.enabled ? 'ok' : 'neutral'}>{p.enabled ? 'Enabled' : 'Disabled'}</Badge></td>
                <td className="whitespace-nowrap px-5 py-3 text-right"><Button variant="ghost" className="!py-1.5" onClick={() => setEdit({ ...p })}>Edit</Button><Button variant="ghost" className="!py-1.5 !text-danger-text" onClick={() => void run(() => api.deletePolicy(p.id), 'Policy deleted.')}>Delete</Button></td></tr>))}</tbody></table></div>)}
      </Card>
      <Modal open={!!edit} title={edit?.id ? 'Edit policy' : 'Add emergency policy'} onClose={() => setEdit(null)} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} disabled={!edit?.name.trim() || !edit?.policy_reference?.trim()} onClick={() => edit && void run(() => api.savePolicy(edit), 'Policy saved.')}>Save policy</Button></>}>
        {edit && <div className="space-y-4">
          <Field label="Name" htmlFor="p-name"><input id="p-name" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="Category" htmlFor="p-cat"><select id="p-cat" className="input" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as 'URGENT' | 'CRITICAL' })}><option value="URGENT">Urgent</option><option value="CRITICAL">Critical</option></select></Field>
            <Field label="Stage" htmlFor="p-stage"><select id="p-stage" className="input" value={edit.stage ?? ''} onChange={(e) => setEdit({ ...edit, stage: (e.target.value || null) as Stage | null })}><option value="">Both stages</option><option value="PROGRAM_MANAGER">Program Manager</option><option value="SWO">SWO</option></select></Field></div>
          <div className="grid grid-cols-2 gap-3"><Field label="Response deadline (min)" htmlFor="p-min"><input id="p-min" type="number" min={1} className="input" value={edit.response_deadline_minutes} onChange={(e) => setEdit({ ...edit, response_deadline_minutes: Math.max(1, Number(e.target.value) || 1) })} /></Field>
            <Field label="Backup Program Manager" htmlFor="p-bk" hint="Notified on overdue; may act only after escalation."><select id="p-bk" className="input" value={edit.backup_approver_id ?? ''} onChange={(e) => setEdit({ ...edit, backup_approver_id: e.target.value || null })}><option value="">None</option>{mgrs.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}</select></Field></div>
          <fieldset><legend className="mb-1.5 text-[13px] font-medium text-ink-2">Alert these roles on submission</legend><div className="flex flex-wrap gap-3">{ALERT_ROLES.map((r) => <label key={r} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={edit.alert_roles?.includes(r) ?? false} onChange={(e) => setEdit({ ...edit, alert_roles: e.target.checked ? [...(edit.alert_roles ?? []), r] : (edit.alert_roles ?? []).filter((x) => x !== r) })} />{ROLE_LABEL[r]}</label>)}</div></fieldset>
          <Field label="Documented institutional policy" htmlFor="p-ref" hint="Required. Cite the document or circular that authorizes this rule."><input id="p-ref" className="input" value={edit.policy_reference ?? ''} onChange={(e) => setEdit({ ...edit, policy_reference: e.target.value })} placeholder="e.g. Student Handbook §7.2" /></Field>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} />Enabled</label>
        </div>}
      </Modal>
    </>
  );
}
