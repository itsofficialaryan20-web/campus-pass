/**
 * In-memory DEMO backend. It mirrors the rules of the Supabase functions so the UI can be
 * explored without credentials, but it runs in the browser: it is NOT secure and must never be
 * used for real approvals or real gate checks.
 */
import type { Api } from './apiTypes';
import type * as T from '../types';
import { OPEN_STATUSES } from '../types';

const DEMO_PASSWORD = 'demo1234';
const STORAGE_KEY = 'campuspass-demo-v3';
const DAY = 24 * 60 * 60_000;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN = 60_000;

interface DemoPass { id: string; request_id: string; token: string; short_code: string; valid_from: string; valid_until: string; revoked_at: string | null; revoke_reason: string | null; used_at: string | null; expiry_notified: boolean }
interface DemoState {
  profiles: T.Profile[]; requests: T.ExitRequest[]; records: T.ApprovalRecord[]; clarifications: T.ClarificationResponse[];
  passes: DemoPass[]; movements: Array<T.MovementLog & { security_user_id: string; pass_id: string }>;
  notifications: T.AppNotification[]; audit: T.AuditLog[]; policies: T.EmergencyPolicy[]; settings: T.AppSettings;
  prefs: Record<string, T.NotificationPrefs>; session: string | null; seq: number; auditSeq: number;
  absences: Array<T.Absence & { declared_by: string }>;
}

const id = () => crypto.randomUUID();
const iso = (ms: number) => new Date(ms).toISOString();
function randToken(bytes: number) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randCode() {
  const a = new Uint8Array(10); crypto.getRandomValues(a);
  return Array.from(a, (b) => ALPHA[b % 32]).join('');
}
export const stageOf = (s: T.ApprovalStatus): T.Stage | null =>
  s === 'PENDING_PROGRAM_MANAGER' ? 'PROGRAM_MANAGER' : s === 'PENDING_SWO' ? 'SWO' : null;
const fail = (m: string): never => { throw new Error(m); };

function seedState(): DemoState {
  const t = Date.now();
  const P = (pid: string, full_name: string, role: T.Role, extra: Partial<T.Profile> = {}): T.Profile => ({
    id: pid, full_name, role, college_id: null, department: null, assigned_manager_id: null, status: 'ACTIVE', ...extra,
  });
  const profiles: T.Profile[] = [
    P('u-admin', 'Admin Office', 'admin', { college_id: 'ADMIN001', email: 'admin@demo.campus' }),
    P('u-m1', 'Dr. Anita Rao', 'program_manager', { college_id: 'PM001', department: 'CSE', email: 'anita@demo.campus' }),
    P('u-m2', 'Prof. Vikram Joshi', 'program_manager', { college_id: 'PM002', department: 'ECE', email: 'vikram@demo.campus' }),
    P('u-swo', 'Rahul Menon', 'swo', { college_id: 'SWO001', email: 'swo@demo.campus' }),
    P('u-gate', 'Gate Security (Unit 1)', 'security', { college_id: 'SEC001', email: 'gate@demo.campus' }),
    P('u-s1', 'Riya Sharma', 'student', { college_id: '22CS1042', department: 'CSE', assigned_manager_id: 'u-m1', email: 'riya@demo.campus' }),
    P('u-s2', 'Kiran Patel', 'student', { college_id: '22EC1015', department: 'ECE', assigned_manager_id: 'u-m2', email: 'kiran@demo.campus' }),
    P('u-s3', 'Meera Iyer', 'student', { college_id: '22CS1067', department: 'CSE', assigned_manager_id: 'u-m1', email: 'meera@demo.campus' }),
    P('u-s4', 'Arjun Nair', 'student', { college_id: '22CS1011', department: 'CSE', assigned_manager_id: 'u-m1', email: 'arjun@demo.campus' }),
  ];
  const settings: T.AppSettings = {
    pass_validity_minutes: 120, pass_early_minutes: 15, regular_response_minutes: 240, urgent_response_minutes: 30,
    critical_response_minutes: 10, email_enabled: false, sms_enabled: false,
  };
  const st: DemoState = {
    profiles, requests: [], records: [], clarifications: [], passes: [], movements: [], notifications: [], audit: [],
    policies: [], settings, prefs: {}, session: null, seq: 118, auditSeq: 1, absences: [],
  };
  const mk = (p: Partial<T.ExitRequest> & { student_id: string; reason: string; destination: string }): T.ExitRequest => {
    st.seq += 1;
    const created = p.created_at ?? iso(t - 20 * MIN);
    const r: T.ExitRequest = {
      id: id(), request_code: `CP-${new Date(t).getFullYear()}-${String(st.seq).padStart(6, '0')}`, kind: 'EXIT', related_request_id: null,
      category: 'REGULAR', details: null, departure_time: iso(t + 30 * MIN), expected_return: iso(t + 4 * 60 * MIN),
      approval_status: 'PENDING_PROGRAM_MANAGER', clarification_stage: null, movement_status: 'NONE',
      stage_entered_at: created, stage_due_at: iso(new Date(created).getTime() + 240 * MIN), escalated_at: null,
      pm_approved_at: null, approved_at: null, created_at: created, ...p,
    };
    st.requests.push(r); return r;
  };
  const rec = (r: T.ExitRequest, stage: T.Stage, approver: string, decision: T.Decision, at: number, comments: string | null, entered?: number) =>
    st.records.push({ id: id(), request_id: r.id, stage, approver_id: approver, decision, comments, stage_entered_at: iso(entered ?? at - 8 * MIN), decided_at: iso(at), acted_as_backup: false, acted_as_cover: false });
  const pass = (r: T.ExitRequest, used: boolean) => st.passes.push({
    id: id(), request_id: r.id, token: randToken(32), short_code: randCode(), valid_from: iso(new Date(r.departure_time).getTime() - 15 * MIN),
    valid_until: iso(Math.max(new Date(r.departure_time).getTime(), t) + 120 * MIN), revoked_at: null, revoke_reason: null,
    used_at: used ? iso(t - 150 * MIN) : null, expiry_notified: false,
  });

  // Riya: rejected (old), pending SWO (urgent), approved + pass ready
  const old = mk({ student_id: 'u-s1', reason: 'Bank KYC visit', destination: 'Bank branch', approval_status: 'REJECTED', created_at: iso(t - 9 * 24 * 60 * MIN), departure_time: iso(t - 9 * 24 * 60 * MIN + 60 * MIN), expected_return: iso(t - 9 * 24 * 60 * MIN + 240 * MIN) });
  rec(old, 'PROGRAM_MANAGER', 'u-m1', 'REJECTED', t - 9 * 24 * 60 * MIN + 12 * MIN, 'Internal exams are ongoing.');
  const urgent = mk({ student_id: 'u-s1', category: 'URGENT', reason: 'Follow-up appointment (Cardiology OPD), 10:30 AM', destination: 'City Hospital, MG Road', approval_status: 'PENDING_SWO', pm_approved_at: iso(t - 9 * MIN), created_at: iso(t - 21 * MIN), stage_entered_at: iso(t - 9 * MIN), stage_due_at: iso(t + 21 * MIN) });
  rec(urgent, 'PROGRAM_MANAGER', 'u-m1', 'CLARIFICATION_REQUESTED', t - 18 * MIN, 'Which clinic, and what is the appointment time?', t - 21 * MIN);
  st.clarifications.push({ id: id(), request_id: urgent.id, student_id: 'u-s1', stage: 'PROGRAM_MANAGER', message: 'City Hospital OPD, appointment at 10:30 AM.', created_at: iso(t - 15 * MIN) });
  rec(urgent, 'PROGRAM_MANAGER', 'u-m1', 'APPROVED', t - 9 * MIN, 'Approved. Please be back by 1 PM.', t - 15 * MIN);
  const ok = mk({ student_id: 'u-s1', reason: 'Passport appointment', destination: 'Passport Seva Kendra', approval_status: 'APPROVED_PASS_ISSUED', pm_approved_at: iso(t - 70 * MIN), approved_at: iso(t - 40 * MIN), created_at: iso(t - 95 * MIN), departure_time: iso(t - 5 * MIN), expected_return: iso(t + 180 * MIN), stage_due_at: null });
  rec(ok, 'PROGRAM_MANAGER', 'u-m1', 'APPROVED', t - 70 * MIN, null, t - 95 * MIN); rec(ok, 'SWO', 'u-swo', 'APPROVED', t - 40 * MIN, null, t - 70 * MIN); pass(ok, false);
  // Kiran: critical, overdue, pending PM; and an exit that is now LATE (can request re-entry)
  mk({ student_id: 'u-s2', category: 'CRITICAL', reason: 'Family emergency — father admitted to hospital', destination: "St. John's Hospital", created_at: iso(t - 14 * MIN), stage_entered_at: iso(t - 14 * MIN), stage_due_at: iso(t - 4 * MIN) });
  const late = mk({ student_id: 'u-s2', reason: 'Cousin’s wedding ceremony', destination: 'Community Hall, Indiranagar', approval_status: 'APPROVED_PASS_ISSUED', movement_status: 'EXITED', pm_approved_at: iso(t - 5 * 60 * MIN), approved_at: iso(t - 290 * MIN), created_at: iso(t - 6 * 60 * MIN), departure_time: iso(t - 240 * MIN), expected_return: iso(t - 30 * MIN), stage_due_at: null });
  rec(late, 'PROGRAM_MANAGER', 'u-m2', 'APPROVED', t - 5 * 60 * MIN, null, t - 6 * 60 * MIN); rec(late, 'SWO', 'u-swo', 'APPROVED', t - 290 * MIN, null, t - 5 * 60 * MIN); pass(late, true);
  st.movements.push({ id: id(), request_id: late.id, event_type: 'EXIT', event_at: iso(t - 150 * MIN), security_user_id: 'u-gate', pass_id: st.passes[st.passes.length - 1].id });
  // Others waiting on Dr. Anita Rao
  mk({ student_id: 'u-s3', category: 'URGENT', reason: 'Inter-college event travel', destination: 'Inter-college event venue', created_at: iso(t - 8 * MIN), stage_entered_at: iso(t - 8 * MIN), stage_due_at: iso(t + 22 * MIN) });
  mk({ student_id: 'u-s4', reason: 'Family visit', destination: 'Home', created_at: iso(t - 41 * MIN), stage_entered_at: iso(t - 41 * MIN) });

  const n = (to: string, type: T.NotificationType, title: string, body: string | null, req: T.ExitRequest | null, ago: number, read = false) =>
    st.notifications.push({ id: id(), recipient_id: to, type, title, body, request_id: req?.id ?? null, read_at: read ? iso(t - ago * MIN) : null, created_at: iso(t - ago * MIN) });
  n('u-s1', 'PM_APPROVED', `Program Manager approved ${urgent.request_code}`, 'Now waiting for SWO.', urgent, 9);
  n('u-s1', 'REQUEST_SUBMITTED', `Request ${urgent.request_code} submitted`, 'Waiting for your Program Manager.', urgent, 21);
  n('u-s1', 'PASS_ISSUED', 'Your exit pass is ready', 'Open the request to show your QR pass at the gate.', ok, 40, true);
  n('u-admin', 'NO_POLICY_ALERT', 'Critical request with no emergency policy configured', 'It is pending the normal approval path. Configure an emergency policy.', null, 14);
  st.audit.push({ id: st.auditSeq++, actor_id: 'u-m1', action: 'request.approved', target_table: 'exit_requests', target_id: urgent.id, metadata: { stage: 'PROGRAM_MANAGER' }, created_at: iso(t - 9 * MIN) });
  return st;
}

export function createDemoApi(storage: Storage | null = null): Api {
  let st: DemoState = load();
  const listeners = new Set<() => void>();

  function load(): DemoState {
    try { const raw = storage?.getItem(STORAGE_KEY); if (raw) { const saved = JSON.parse(raw) as DemoState; saved.absences ??= []; return saved; } } catch { /* corrupted: reseed */ }
    return seedState();
  }
  const emit = () => { try { storage?.setItem(STORAGE_KEY, JSON.stringify(st)); } catch { /* quota */ } listeners.forEach((l) => l()); };
  const wait = async <V,>(v: V): Promise<V> => { await Promise.resolve(); return structuredClone(v); };

  // ---------- helpers that mirror the SQL helpers ----------
  const user = (): T.Profile => {
    const u = st.profiles.find((p) => p.id === st.session);
    if (!u || u.status !== 'ACTIVE') fail('Please sign in with an active account.');
    return u!;
  };
  const roleOf = (): T.Role | null => { const u = st.profiles.find((p) => p.id === st.session); return u && u.status === 'ACTIVE' ? u.role : null; };
  const profile = (pid: string) => st.profiles.find((p) => p.id === pid);
  const audit = (action: string, target: string | null, metadata: Record<string, unknown> = {}) => {
    st.audit.push({ id: st.auditSeq++, actor_id: st.session, action, target_table: 'exit_requests', target_id: target, metadata, created_at: iso(Date.now()) });
  };
  const notify = (to: string | null | undefined, type: T.NotificationType, title: string, body: string | null, req: string | null) => {
    if (!to) return;
    st.notifications.push({ id: id(), recipient_id: to, type, title, body, request_id: req, read_at: null, created_at: iso(Date.now()) });
  };
  const policyFor = (category: T.Category, stage: T.Stage) =>
    st.policies.find((p) => p.enabled && p.category === category && p.stage === stage) ?? st.policies.find((p) => p.enabled && p.category === category && p.stage === null);
  const dueAt = (category: T.Category, stage: T.Stage, from: number) => {
    const s = st.settings; const pol = policyFor(category as T.Category, stage);
    const mins = pol ? pol.response_deadline_minutes : category === 'REGULAR' ? s.regular_response_minutes : category === 'URGENT' ? s.urgent_response_minutes : s.critical_response_minutes;
    return iso(from + mins * MIN);
  };
  const withStudent = (r: T.ExitRequest): T.ExitRequest => {
    const s = profile(r.student_id); return { ...r, student: s ? { full_name: s.full_name, college_id: s.college_id, department: s.department, assigned_manager_id: s.assigned_manager_id } : null };
  };
  const isBackupFor = (r: T.ExitRequest, uid: string) =>
    r.escalated_at !== null && st.policies.some((p) => p.enabled && p.backup_approver_id === uid && p.category === r.category && (p.stage === null || p.stage === 'PROGRAM_MANAGER'));
  const isAbsent = (uid: string, at = Date.now()) => st.absences.some((a) => a.user_id === uid && !a.ended_at && new Date(a.starts_at).getTime() <= at && new Date(a.ends_at).getTime() > at);
  /** SWO stage: every active SWO member is absent. Program Manager stage: the student's own manager is absent. */
  const stageUnattended = (stage: T.Stage, studentId: string | null) => {
    if (stage === 'SWO') { const swo = st.profiles.filter((p) => p.role === 'swo' && p.status === 'ACTIVE'); return swo.length > 0 && swo.every((p) => isAbsent(p.id)); }
    const m = studentId ? profile(studentId)?.assigned_manager_id : null; return !!m && isAbsent(m);
  };
  const visible = (u: T.Profile): T.ExitRequest[] => st.requests.filter((r) => {
    if (u.role === 'admin') return true;
    if (u.role === 'student') return r.student_id === u.id;
    if (u.role === 'program_manager') return profile(r.student_id)?.assigned_manager_id === u.id || isBackupFor(r, u.id) || st.records.some((x) => x.request_id === r.id && x.approver_id === u.id) || actingStage(r, u) !== null;
    if (u.role === 'swo') return r.pm_approved_at !== null || st.records.some((x) => x.request_id === r.id && x.approver_id === u.id) || actingStage(r, u) !== null;
    return false;
  });
  const actingStage = (r: T.ExitRequest, u: T.Profile): T.Stage | null => {
    const stg = stageOf(r.approval_status);
    if (!stg || r.student_id === u.id) return null;
    if (stg === 'PROGRAM_MANAGER' && u.role === 'program_manager') {
      if (profile(r.student_id)?.assigned_manager_id === u.id) return stg;
      return isBackupFor(r, u.id) ? stg : null;
    }
    if (stg === 'SWO' && u.role === 'swo') return stg;
    // Absence cover (explicitly declared and time-boxed)
    if (stg === 'SWO' && u.role === 'program_manager' && stageUnattended('SWO', null)) return stg;
    if (stg === 'PROGRAM_MANAGER' && u.role === 'swo' && stageUnattended('PROGRAM_MANAGER', r.student_id)) return stg;
    return null;
  };
  const passState = (p: DemoPass, r: T.ExitRequest): T.PassState => {
    const n = Date.now();
    if (p.revoked_at || r.approval_status !== 'APPROVED_PASS_ISSUED') return 'REVOKED';
    if (r.movement_status !== 'NONE') return 'ALREADY_USED';
    if (n > new Date(p.valid_until).getTime()) return 'EXPIRED';
    if (n < new Date(p.valid_from).getTime()) return 'NOT_YET_VALID';
    return 'VALID';
  };
  const findPass = (cred: string): DemoPass | null => {
    let c = cred.trim(); if (/^cp1\./i.test(c)) c = c.slice(4);
    if (!c || c.length > 200) return null;
    const code = c.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return st.passes.find((p) => p.token === c) ?? st.passes.find((p) => p.short_code === code) ?? null;
  };
  const managerOk = (u: T.Profile) => {
    const m = u.assigned_manager_id ? profile(u.assigned_manager_id) : null;
    if (!m || m.role !== 'program_manager' || m.status !== 'ACTIVE') fail('No active Program Manager is assigned to your account. Contact the administrator.');
  };
  const announce = (r: T.ExitRequest, u: T.Profile) => {
    const what = r.kind === 'REENTRY' ? 're-entry' : 'exit';
    notify(u.id, 'REQUEST_SUBMITTED', `Request ${r.request_code} submitted`, 'Waiting for your Program Manager.', r.id);
    notify(u.assigned_manager_id, 'NEW_REQUEST_FOR_APPROVER', r.category === 'REGULAR' ? `New ${what} request` : `${r.category} ${what} request`, `${u.full_name} (${r.request_code}).`, r.id);
    if (r.category !== 'REGULAR') {
      const pols = st.policies.filter((p) => p.enabled && p.category === r.category);
      const targets = new Set(st.profiles.filter((p) => p.status === 'ACTIVE' && p.id !== u.id && pols.some((pl) => pl.alert_roles.includes(p.role))).map((p) => p.id));
      targets.forEach((to) => notify(to, r.category === 'CRITICAL' ? 'CRITICAL_ALERT' : 'URGENT_REQUEST', `${r.category} ${what} request ${r.request_code}`, `${u.full_name} — ${r.destination}`, r.id));
      if (r.category === 'CRITICAL' && pols.length === 0)
        st.profiles.filter((p) => p.role === 'admin' && p.status === 'ACTIVE').forEach((a) => notify(a.id, 'NO_POLICY_ALERT', 'Critical request with no emergency policy configured', `${r.request_code} is pending the normal approval path. Configure an emergency policy.`, r.id));
    }
  };
  const requireStudent = () => { const u = user(); if (u.role !== 'student') fail('Only active students can do this.'); return u; };
  const openCount = (uid: string) => st.requests.filter((r) => r.student_id === uid && OPEN_STATUSES.includes(r.approval_status)).length;
  const issuePass = (r: T.ExitRequest) => {
    const s = st.settings;
    st.passes.push({
      id: id(), request_id: r.id, token: randToken(32), short_code: randCode(), valid_from: iso(new Date(r.departure_time).getTime() - s.pass_early_minutes * MIN),
      valid_until: iso(Math.max(new Date(r.departure_time).getTime(), Date.now()) + s.pass_validity_minutes * MIN), revoked_at: null, revoke_reason: null, used_at: null, expiry_notified: false,
    });
  };

  const api: Api = {
    mode: 'demo',
    async getCurrentUser() { return wait(st.profiles.find((p) => p.id === st.session) ?? null); },
    async signIn(identifier, password) {
      const key = identifier.trim().toLowerCase();
      const u = st.profiles.find((p) => p.email?.toLowerCase() === key || p.college_id?.toLowerCase() === key);
      if (!u || password !== DEMO_PASSWORD) fail('Incorrect ID/email or password.');
      if (u!.status !== 'ACTIVE') fail('Your account is not active. Contact the administrator.');
      st.session = u!.id; emit(); return structuredClone(u!);
    },
    async signOut() { st.session = null; emit(); },
    async updateMyName(name) { const u = user(); const n = name.trim(); if (!n || n.length > 120) fail('Enter a name of 1–120 characters.'); u.full_name = n; emit(); },

    async listRequests() { const u = user(); return wait(visible(u).map(withStudent).sort((a, b) => b.created_at.localeCompare(a.created_at))); },
    async getRequestBundle(rid) {
      const u = user(); const r = visible(u).find((x) => x.id === rid); if (!r) fail('Request not found.');
      const p = st.passes.find((x) => x.request_id === rid);
      const linkedId = r!.related_request_id;
      const linked = linkedId ? st.requests.find((x) => x.id === linkedId) : st.requests.find((x) => x.related_request_id === rid && x.kind === 'REENTRY' && !['REJECTED', 'CANCELLED'].includes(x.approval_status));
      return wait<T.RequestBundle>({
        request: withStudent(r!), records: st.records.filter((x) => x.request_id === rid).sort((a, b) => a.decided_at.localeCompare(b.decided_at)),
        clarifications: st.clarifications.filter((x) => x.request_id === rid),
        pass: p ? { id: p.id, request_id: p.request_id, valid_from: p.valid_from, valid_until: p.valid_until, revoked_at: p.revoked_at, revoke_reason: p.revoke_reason, used_at: p.used_at } : null,
        movements: st.movements.filter((m) => m.request_id === rid).map((m) => ({ id: m.id, request_id: m.request_id, event_type: m.event_type, event_at: m.event_at })),
        linked: linked ? withStudent(linked) : null,
      });
    },
    async listApprovalRecords() { const u = user(); const ids = new Set(visible(u).map((r) => r.id)); return wait(st.records.filter((x) => ids.has(x.request_id))); },

    async submitRequest(i) {
      const u = requireStudent(); managerOk(u);
      const dep = new Date(i.departure_time).getTime(), ret = new Date(i.expected_return).getTime();
      if (!i.reason.trim() || i.reason.trim().length < 3) fail('Please give a reason (at least 3 characters).');
      if (!i.destination.trim() || i.destination.trim().length < 2) fail('Please enter a destination.');
      if (dep < Date.now() - 10 * MIN) fail('Departure time cannot be in the past');
      if (ret <= dep) fail('Expected return must be after departure');
      if (openCount(u.id) >= 3) fail('You already have 3 open requests. Wait for a decision or cancel one.');
      st.seq += 1; const n = Date.now();
      const r: T.ExitRequest = {
        id: id(), request_code: `CP-${new Date(n).getFullYear()}-${String(st.seq).padStart(6, '0')}`, student_id: u.id, kind: 'EXIT', related_request_id: null,
        category: i.category, reason: i.reason.trim(), destination: i.destination.trim(), details: i.details?.trim() || null, departure_time: i.departure_time, expected_return: i.expected_return,
        approval_status: 'PENDING_PROGRAM_MANAGER', clarification_stage: null, movement_status: 'NONE', stage_entered_at: iso(n), stage_due_at: dueAt(i.category, 'PROGRAM_MANAGER', n),
        escalated_at: null, pm_approved_at: null, approved_at: null, created_at: iso(n),
      };
      st.requests.push(r); announce(r, u); audit('request.submitted', r.id, { kind: 'EXIT', category: r.category, request_code: r.request_code }); emit(); return wait(withStudent(r));
    },
    async submitReentry(i) {
      const u = requireStudent();
      const x = st.requests.find((r) => r.id === i.exit_request_id && r.student_id === u.id && r.kind === 'EXIT');
      if (!x || x.movement_status !== 'EXITED') fail('Re-entry can only be requested for an exit that was recorded at the gate');
      const arr = new Date(i.arrival_time).getTime();
      if (arr <= new Date(x!.expected_return!).getTime()) fail('Re-entry approval is only needed when arriving after your expected return time');
      if (arr < Date.now() - 10 * MIN) fail('Arrival time cannot be in the past');
      if (i.reason.trim().length < 3) fail('Please explain why you will be late');
      managerOk(u);
      if (st.requests.some((r) => r.related_request_id === x!.id && r.kind === 'REENTRY' && !['REJECTED', 'CANCELLED'].includes(r.approval_status))) fail('A re-entry request already exists for this exit');
      st.seq += 1; const n = Date.now();
      const r: T.ExitRequest = {
        id: id(), request_code: `CP-${new Date(n).getFullYear()}-${String(st.seq).padStart(6, '0')}`, student_id: u.id, kind: 'REENTRY', related_request_id: x!.id,
        category: i.category, reason: i.reason.trim(), destination: 'Campus re-entry', details: null, departure_time: i.arrival_time, expected_return: null,
        approval_status: 'PENDING_PROGRAM_MANAGER', clarification_stage: null, movement_status: 'NONE', stage_entered_at: iso(n), stage_due_at: dueAt(i.category, 'PROGRAM_MANAGER', n),
        escalated_at: null, pm_approved_at: null, approved_at: null, created_at: iso(n),
      };
      st.requests.push(r); announce(r, u); audit('request.submitted', r.id, { kind: 'REENTRY', related_request: x!.id, request_code: r.request_code }); emit(); return wait(withStudent(r));
    },
    async respondClarification(rid, message) {
      const u = requireStudent(); const msg = message.trim();
      if (!msg || msg.length > 1000) fail('Provide a response of 1–1000 characters');
      const r = st.requests.find((x) => x.id === rid && x.student_id === u.id);
      if (!r || r.approval_status !== 'NEEDS_CLARIFICATION' || !r.clarification_stage) fail('Request not found or not awaiting clarification');
      const stage = r!.clarification_stage!; const n = Date.now();
      st.clarifications.push({ id: id(), request_id: r!.id, student_id: u.id, stage, message: msg, created_at: iso(n) });
      r!.approval_status = stage === 'PROGRAM_MANAGER' ? 'PENDING_PROGRAM_MANAGER' : 'PENDING_SWO'; r!.clarification_stage = null;
      r!.stage_entered_at = iso(n); r!.stage_due_at = dueAt(r!.category, stage, n); r!.escalated_at = null;
      if (stage === 'PROGRAM_MANAGER') notify(u.assigned_manager_id, 'CLARIFICATION_ANSWERED', 'Clarification received', `${r!.request_code} has a new response from the student.`, r!.id);
      else st.profiles.filter((p) => p.role === 'swo' && p.status === 'ACTIVE').forEach((p) => notify(p.id, 'CLARIFICATION_ANSWERED', 'Clarification received', `${r!.request_code} has a new response from the student.`, r!.id));
      audit('request.clarification_answered', r!.id, { stage }); emit();
    },
    async cancelRequest(rid) {
      const u = requireStudent(); const r = st.requests.find((x) => x.id === rid && x.student_id === u.id); if (!r) fail('Request not found');
      if (![...OPEN_STATUSES, 'APPROVED_PASS_ISSUED'].includes(r!.approval_status) || r!.movement_status !== 'NONE') fail('This request can no longer be cancelled');
      r!.approval_status = 'CANCELLED'; r!.clarification_stage = null; r!.stage_due_at = null;
      st.passes.filter((p) => p.request_id === r!.id && !p.revoked_at).forEach((p) => { p.revoked_at = iso(Date.now()); p.revoke_reason = 'Cancelled by student'; });
      audit('request.cancelled', r!.id); emit();
    },
    async decide(rid, decision, comment) {
      const u = user(); const r = st.requests.find((x) => x.id === rid);
      const stage = r ? actingStage(r, u) : null;
      if (!r || !stage) return fail('Request not found, or you are not authorized to act on it at its current stage');
      const c = comment?.trim() || null;
      if (c && c.length > 1000) fail('Comment is too long (max 1000 characters)');
      const cover = (stage === 'SWO' && u.role !== 'swo') || (stage === 'PROGRAM_MANAGER' && u.role === 'swo');
      if (cover && decision === 'APPROVED' && !c) fail('A comment is required when approving in place of an absent approver');
      if (decision === 'CLARIFICATION_REQUESTED' && !c) fail('A comment is required when requesting clarification');
      if (decision !== 'CLARIFICATION_REQUESTED' && st.records.some((x) => x.request_id === r.id && x.stage === stage && x.decision !== 'CLARIFICATION_REQUESTED')) fail('A decision was already recorded for this stage');
      const backup = stage === 'PROGRAM_MANAGER' && u.role === 'program_manager' && profile(r.student_id)?.assigned_manager_id !== u.id;
      const n = Date.now();
      st.records.push({ id: id(), request_id: r.id, stage, approver_id: u.id, decision, comments: c, stage_entered_at: r.stage_entered_at, decided_at: iso(n), acted_as_backup: backup, acted_as_cover: cover });
      if (decision === 'REJECTED') {
        r.approval_status = 'REJECTED'; r.clarification_stage = null; r.stage_due_at = null;
        notify(r.student_id, stage === 'PROGRAM_MANAGER' ? 'PM_REJECTED' : 'SWO_REJECTED', `Request ${r.request_code} was rejected`, c ?? 'No comment provided.', r.id);
      } else if (decision === 'CLARIFICATION_REQUESTED') {
        r.approval_status = 'NEEDS_CLARIFICATION'; r.clarification_stage = stage; r.stage_due_at = null;
        notify(r.student_id, 'CLARIFICATION_REQUESTED', `More information needed for ${r.request_code}`, c, r.id);
      } else if (stage === 'PROGRAM_MANAGER') {
        r.approval_status = 'PENDING_SWO'; r.pm_approved_at = iso(n); r.stage_entered_at = iso(n); r.stage_due_at = dueAt(r.category, 'SWO', n); r.escalated_at = null;
        notify(r.student_id, 'PM_APPROVED', `Program Manager approved ${r.request_code}`, 'Now waiting for SWO.', r.id);
        st.profiles.filter((p) => p.role === 'swo' && p.status === 'ACTIVE').forEach((p) => notify(p.id, 'NEW_REQUEST_FOR_APPROVER', r.category === 'REGULAR' ? 'Request ready for SWO review' : `${r.category} request ready for SWO`, `${profile(r.student_id)?.full_name} — ${r.request_code}`, r.id));
      } else {
        r.approval_status = 'APPROVED_PASS_ISSUED'; r.approved_at = iso(n); r.stage_due_at = null; r.escalated_at = null; issuePass(r);
        notify(r.student_id, 'SWO_APPROVED', `SWO approved ${r.request_code}`, null, r.id);
        notify(r.student_id, 'PASS_ISSUED', r.kind === 'REENTRY' ? 'Your re-entry pass is ready' : 'Your exit pass is ready', 'Open the request to show your QR pass at the gate.', r.id);
      }
      if (cover) {
        const absentManager = profile(r.student_id)?.assigned_manager_id;
        st.profiles.filter((p) => p.status === 'ACTIVE' && p.id !== u.id && ((stage === 'SWO' && p.role === 'swo') || (stage === 'PROGRAM_MANAGER' && p.id === absentManager) || p.role === 'admin'))
          .forEach((p) => notify(p.id, 'COVER_USED', 'Your approval stage was covered during your absence', `${r.request_code}: ${decision.toLowerCase()} by ${u.full_name}.`, r.id));
      }
      audit(`request.${decision.toLowerCase()}`, r.id, { stage, acted_as_backup: backup, acted_as_cover: cover, has_comment: !!c }); emit();
    },
    async getMyPass(rid) {
      const u = requireStudent(); const r = st.requests.find((x) => x.id === rid && x.student_id === u.id); if (!r) fail('Pass not found');
      const p = st.passes.find((x) => x.request_id === rid); if (!p) fail('No pass has been issued for this request');
      const state = passState(p!, r!);
      if (state !== 'VALID' && state !== 'NOT_YET_VALID') return wait({ pass_id: p!.id, state, valid_from: p!.valid_from, valid_until: p!.valid_until });
      p!.token = randToken(32); p!.short_code = randCode(); emit();   // rotate: older QR codes stop working
      return wait({ pass_id: p!.id, state, qr_payload: `CP1.${p!.token}`, short_code: `${p!.short_code.slice(0, 5)}-${p!.short_code.slice(5)}`, valid_from: p!.valid_from, valid_until: p!.valid_until });
    },
    async revokePass(rid, reason) {
      const role = roleOf(); if (role !== 'admin' && role !== 'swo') fail('Not authorized');
      if (!reason.trim()) fail('A reason is required');
      const r = st.requests.find((x) => x.id === rid); if (!r) fail('Request not found');
      if (r!.movement_status !== 'NONE') fail('The student has already used this pass');
      const p = st.passes.find((x) => x.request_id === rid && !x.revoked_at); if (!p) fail('No active pass to revoke');
      p!.revoked_at = iso(Date.now()); p!.revoke_reason = reason.trim().slice(0, 500);
      notify(r!.student_id, 'PASS_REVOKED', 'Your pass was revoked', p!.revoke_reason, r!.id); audit('pass.revoked', r!.id, { reason: p!.revoke_reason }); emit();
    },

    async verifyPass(cred) {
      const role = roleOf(); if (role !== 'security' && role !== 'admin') fail('Not authorized');
      const p = findPass(cred);
      if (!p) { audit('pass.verify_failed', null); emit(); return wait<T.VerifyResult>({ state: 'INVALID' }); }
      const r = st.requests.find((x) => x.id === p.request_id)!; const s = profile(r.student_id)!;
      const x = r.related_request_id ? st.requests.find((q) => q.id === r.related_request_id) : null;
      return wait<T.VerifyResult>({
        state: passState(p, r), kind: r.kind, pass_id: p.id, request_code: r.request_code, movement_status: r.movement_status, valid_from: p.valid_from, valid_until: p.valid_until,
        student: { name: s.full_name, college_id: s.college_id, department: s.department },
        exit: { destination: r.destination, category: r.category, departure_time: r.departure_time, expected_return: r.expected_return, original_expected_return: x?.expected_return ?? null },
      });
    },
    async recordMovement(cred) {
      const u = user(); if (u.role !== 'security') fail('Only security staff can record movement');
      const p = findPass(cred);
      if (!p) { audit('pass.redeem_failed', null, { reason: 'INVALID' }); emit(); return wait({ ok: false, state: 'INVALID' }); }
      const r = st.requests.find((x) => x.id === p.request_id)!; const state = passState(p, r);
      const event = r.kind === 'REENTRY' ? 'ENTRY' : 'EXIT';
      if (state !== 'VALID') { audit('pass.redeem_failed', r.id, { state, event }); emit(); return wait({ ok: false, state, kind: r.kind }); }
      const at = iso(Date.now()); p.used_at = at; r.movement_status = event === 'ENTRY' ? 'ENTERED' : 'EXITED';
      if (event === 'ENTRY' && r.related_request_id) { const x = st.requests.find((q) => q.id === r.related_request_id); if (x) x.movement_status = 'ENTERED'; }
      st.movements.push({ id: id(), request_id: r.id, pass_id: p.id, security_user_id: u.id, event_type: event, event_at: at });
      notify(r.student_id, event === 'EXIT' ? 'EXIT_RECORDED' : 'ENTRY_RECORDED', event === 'EXIT' ? 'Exit recorded at the gate' : 'Re-entry recorded at the gate', r.request_code, r.id);
      audit(`movement.${event.toLowerCase()}`, r.id); emit();
      return wait({ ok: true, kind: r.kind, event, event_at: at, state: event === 'EXIT' ? 'EXITED' : 'ENTERED' });
    },
    async recentMovements() {
      const role = roleOf(); if (role !== 'security' && role !== 'admin') fail('Not authorized');
      return wait(st.movements.slice().sort((a, b) => b.event_at.localeCompare(a.event_at)).slice(0, 25).map((m) => {
        const r = st.requests.find((x) => x.id === m.request_id)!; const s = profile(r.student_id)!;
        return { event_at: m.event_at, event_type: m.event_type, request_code: r.request_code, student_name: s.full_name, college_id: s.college_id };
      }));
    },

    async listNotifications() { const u = user(); return wait(st.notifications.filter((n) => n.recipient_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50)); },
    async markNotificationsRead() { const u = user(); const n = iso(Date.now()); st.notifications.filter((x) => x.recipient_id === u.id && !x.read_at).forEach((x) => (x.read_at = n)); emit(); },
    async getPrefs() { const u = user(); return wait(st.prefs[u.id] ?? { email_opt_in: false, sms_opt_in: false }); },
    async setPrefs(p) { const u = user(); st.prefs[u.id] = { ...p }; emit(); },
    async listStaff() { user(); return wait(st.profiles.filter((p) => p.role !== 'student' && p.status === 'ACTIVE').map((p) => ({ id: p.id, full_name: p.full_name, role: p.role, department: p.department }))); },
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },

    async listProfiles() { if (roleOf() !== 'admin') fail('Admins only'); return wait(st.profiles); },
    async updateProfile(i) {
      const u = user(); if (u.role !== 'admin') fail('Admins only');
      const t = profile(i.id); if (!t) return fail('User not found');
      if (i.id === u.id && (i.role !== 'admin' || i.status !== 'ACTIVE')) fail('You cannot demote or disable your own admin account');
      if (i.assigned_manager_id) {
        if (i.role !== 'student') fail('Only students have an assigned Program Manager');
        const m = profile(i.assigned_manager_id); if (!m || m.role !== 'program_manager' || m.status !== 'ACTIVE') fail('Assigned manager must be an active Program Manager');
      }
      const before = { role: t!.role, status: t!.status, department: t!.department, manager: t!.assigned_manager_id };
      Object.assign(t!, { full_name: i.full_name.trim() || t!.full_name, role: i.role, status: i.status, department: i.department.trim() || null, college_id: i.college_id.trim() || null, assigned_manager_id: i.assigned_manager_id });
      st.audit.push({ id: st.auditSeq++, actor_id: u.id, action: 'profile.updated', target_table: 'profiles', target_id: t!.id, metadata: { old: before, new: { role: t!.role, status: t!.status, department: t!.department, manager: t!.assigned_manager_id } }, created_at: iso(Date.now()) });
      emit();
    },
    async createUser(i) {
      const u = user(); if (u.role !== 'admin') fail('Admins only');
      if (!/^\S+@\S+\.\S+$/.test(i.email)) fail('Enter a valid email address.');
      if (st.profiles.some((p) => p.email?.toLowerCase() === i.email.toLowerCase())) fail('A user with this email already exists.');
      const p: T.Profile = { id: id(), full_name: i.full_name.trim(), college_id: i.college_id.trim() || null, role: i.role, department: i.department?.trim() || null, assigned_manager_id: i.assigned_manager_id ?? null, status: 'ACTIVE', email: i.email };
      st.profiles.push(p);
      st.audit.push({ id: st.auditSeq++, actor_id: u.id, action: 'profile.created', target_table: 'profiles', target_id: p.id, metadata: { role: p.role }, created_at: iso(Date.now()) });
      emit(); return wait({ profile: p, temporaryPassword: DEMO_PASSWORD });
    },
    async listAudit() {
      if (roleOf() !== 'admin') fail('Admins only');
      return wait(st.audit.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300).map((a) => ({ ...a, actor_name: a.actor_id ? profile(a.actor_id)?.full_name ?? 'System' : 'System' })));
    },
    async listPolicies() { if (roleOf() !== 'admin') fail('Admins only'); return wait(st.policies); },
    async savePolicy(p) {
      if (roleOf() !== 'admin') fail('Admins only');
      if (!p.policy_reference?.trim()) fail('Cite the documented institutional policy this rule is based on.');
      const existing = p.id ? st.policies.find((x) => x.id === p.id) : undefined;
      const next: T.EmergencyPolicy = { id: existing?.id ?? id(), name: p.name, category: p.category ?? 'URGENT', stage: p.stage ?? null, response_deadline_minutes: p.response_deadline_minutes ?? 30, backup_approver_id: p.backup_approver_id ?? null, alert_roles: p.alert_roles ?? [], policy_reference: p.policy_reference!.trim(), enabled: !!p.enabled };
      if (next.enabled && st.policies.some((x) => x.id !== next.id && x.enabled && x.category === next.category && x.stage === next.stage)) fail('Another enabled policy already covers this category and stage.');
      if (existing) Object.assign(existing, next); else st.policies.push(next);
      audit('emergency_policies.save', next.id); emit();
    },
    async deletePolicy(pid) { if (roleOf() !== 'admin') fail('Admins only'); st.policies = st.policies.filter((x) => x.id !== pid); audit('emergency_policies.delete', pid); emit(); },
    async getSettings() { if (roleOf() !== 'admin') fail('Admins only'); return wait(st.settings); },
    async listAbsences() {
      const u = user(); if (u.role !== 'program_manager' && u.role !== 'swo' && u.role !== 'admin') fail('Not authorized');
      return wait(st.absences.filter((a) => u.role === 'admin' || a.user_id === u.id).sort((a, b) => b.starts_at.localeCompare(a.starts_at)).map(({ declared_by: _d, ...a }) => a));
    },
    async listActiveAbsences() {
      const role = roleOf(); if (role !== 'program_manager' && role !== 'swo' && role !== 'admin') return wait([]);
      return wait(st.absences.filter((a) => isAbsent(a.user_id)).map(({ declared_by: _d, reason: _r, ...a }) => a));
    },
    async declareAbsence(i) {
      const u = user(); const t = profile(i.user_id); const reason = i.reason.trim(); const ends = new Date(i.ends_at).getTime(); const n = Date.now();
      if (!t || t.status !== 'ACTIVE' || (t.role !== 'program_manager' && t.role !== 'swo')) fail('Absence cover only applies to active Program Managers and SWO members');
      if (!(t!.id === u.id || u.role === 'admin')) fail('You can only declare your own absence');
      if (reason.length < 3) fail('Please give a short reason');
      if (!(ends > n)) fail('The absence must end in the future');
      if (ends > n + 14 * DAY) fail('An absence can last at most 14 days');
      if (isAbsent(t!.id)) fail('This person already has an active absence. End it first.');
      const a = { id: id(), user_id: t!.id, full_name: t!.full_name, role: t!.role, starts_at: iso(n), ends_at: i.ends_at, reason: reason.slice(0, 300), ended_at: null, declared_by: u.id };
      st.absences.push(a);
      const counterpart: T.Role = t!.role === 'swo' ? 'program_manager' : 'swo';
      st.profiles.filter((p) => p.status === 'ACTIVE' && p.id !== u.id && (p.role === 'admin' || p.role === counterpart))
        .forEach((p) => notify(p.id, 'ABSENCE_DECLARED', `${t!.full_name} is marked absent`, `Until ${new Date(i.ends_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}${p.role === 'admin' ? '.' : ' you may be able to act at their stage if no one else is available.'}`, null));
      st.audit.push({ id: st.auditSeq++, actor_id: u.id, action: 'absence.declared', target_table: 'approver_absences', target_id: a.id, metadata: { user: t!.id, role: t!.role, declared_by_admin: u.id !== t!.id }, created_at: iso(n) });
      emit();
    },
    async endAbsence(aid) {
      const u = user(); const a = st.absences.find((x) => x.id === aid && !x.ended_at); if (!a) fail('No active absence found');
      if (!(a!.user_id === u.id || u.role === 'admin')) fail('Not authorized');
      a!.ended_at = iso(Date.now());
      st.audit.push({ id: st.auditSeq++, actor_id: u.id, action: 'absence.ended', target_table: 'approver_absences', target_id: a!.id, metadata: {}, created_at: iso(Date.now()) }); emit();
    },
    async saveSettings(s) { if (roleOf() !== 'admin') fail('Admins only'); st.settings = { ...s }; audit('app_settings.update', null); emit(); },

    demo: {
      password: DEMO_PASSWORD,
      accounts: () => st.profiles.filter((p) => p.email).map((p) => ({ label: p.full_name, role: p.role, email: p.email! })),
      reset() { st = seedState(); emit(); },
      /** Mirrors process_overdue_and_expired(): escalation never approves anything. */
      async runMaintenance() {
        let escalated = 0, adminAlerts = 0, expired = 0; const n = Date.now();
        for (const r of st.requests) {
          const stg = stageOf(r.approval_status);
          if (!stg || r.category === 'REGULAR' || !r.stage_due_at || new Date(r.stage_due_at).getTime() >= n || r.escalated_at) continue;
          const pol = st.policies.find((p) => p.enabled && p.category === r.category && (p.stage === stg || p.stage === null) && p.backup_approver_id && profile(p.backup_approver_id)?.status === 'ACTIVE');
          if (pol) { r.escalated_at = iso(n); notify(pol.backup_approver_id, 'ESCALATION', `${r.category} request ${r.request_code} is overdue`, `Escalated under policy: ${pol.name}`, r.id); escalated++; }
          else { st.profiles.filter((p) => p.role === 'admin').forEach((a) => notify(a.id, 'NO_POLICY_ALERT', `${r.category} request ${r.request_code} is overdue`, 'No authorized backup approver is configured. The request remains pending.', r.id)); adminAlerts++; }
          audit(pol ? 'request.escalated' : 'request.overdue_no_policy', r.id, { stage: stg });
        }
        for (const p of st.passes) if (!p.used_at && !p.revoked_at && !p.expiry_notified && new Date(p.valid_until).getTime() < n) {
          p.expiry_notified = true; const r = st.requests.find((x) => x.id === p.request_id)!; notify(r.student_id, 'PASS_EXPIRED', 'Your pass expired unused', r.request_code, r.id); expired++;
        }
        emit(); return { escalated, admin_alerts: adminAlerts, passes_expired: expired };
      },
    },
  };
  return api;
}
