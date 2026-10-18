import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoApi } from './demoApi';
import type { Api } from './apiTypes';

const PW = 'demo1234';
const HOUR = 3600_000;
let api: Api;
const as = (email: string) => api.signIn(email, PW);
const iso = (ms: number) => new Date(ms).toISOString();
const newReq = (over: Partial<Parameters<Api['submitRequest']>[0]> = {}) => api.submitRequest({
  category: 'REGULAR', reason: 'Dentist appointment', destination: 'Dental clinic', departure_time: iso(Date.now() + 5 * 60000), expected_return: iso(Date.now() + 3 * HOUR), ...over,
});
/** Student submits, manager + SWO approve; returns request id and a pass credential. */
async function approvedPass(student = 'riya@demo.campus', mgr = 'anita@demo.campus') {
  await as(student); const r = await newReq();
  await as(mgr); await api.decide(r.id, 'APPROVED');
  await as('swo@demo.campus'); await api.decide(r.id, 'APPROVED');
  await as(student); const pass = await api.getMyPass(r.id);
  return { r, cred: pass.qr_payload!, code: pass.short_code! };
}

beforeEach(() => { api = createDemoApi(null); });
afterEach(() => vi.useRealTimers());

describe('approval workflow', () => {
  it('1. student submits a valid request and it starts at the Program Manager', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    expect(r.approval_status).toBe('PENDING_PROGRAM_MANAGER'); expect(r.request_code).toMatch(/^CP-\d{4}-\d{6}$/);
  });
  it('2. a student cannot approve their own request or anyone else’s', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow(/not authorized/i);
  });
  it('3-4. manager approval moves it to SWO; SWO cannot act before that', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    await as('swo@demo.campus');
    await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow(/not authorized/i);
    expect((await api.listRequests()).some((x) => x.id === r.id)).toBe(false);
    await as('anita@demo.campus'); await api.decide(r.id, 'APPROVED', 'ok');
    await as('swo@demo.campus'); expect((await api.listRequests()).find((x) => x.id === r.id)?.approval_status).toBe('PENDING_SWO');
    await api.decide(r.id, 'APPROVED');
    await as('riya@demo.campus'); expect((await api.listRequests()).find((x) => x.id === r.id)?.approval_status).toBe('APPROVED_PASS_ISSUED');
  });
  it('blocks a duplicate decision and an unassigned manager', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    await as('vikram@demo.campus'); await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow(/not authorized/i);
    await as('anita@demo.campus'); await api.decide(r.id, 'APPROVED');
    await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow(/not authorized/i);
  });
  it('5. a rejection stops the workflow and notifies the student', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    await as('anita@demo.campus'); await api.decide(r.id, 'REJECTED', 'Exams');
    await as('riya@demo.campus');
    expect((await api.listRequests()).find((x) => x.id === r.id)?.approval_status).toBe('REJECTED');
    expect((await api.listNotifications()).some((n) => n.type === 'PM_REJECTED')).toBe(true);
    await expect(api.getMyPass(r.id)).rejects.toThrow();
  });
  it('6. clarification returns to the same stage and keeps earlier decisions', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    await as('anita@demo.campus');
    await expect(api.decide(r.id, 'CLARIFICATION_REQUESTED')).rejects.toThrow(/comment is required/i);
    await api.decide(r.id, 'CLARIFICATION_REQUESTED', 'Which clinic?');
    await as('riya@demo.campus'); await api.respondClarification(r.id, 'Smile Dental');
    const b = await api.getRequestBundle(r.id);
    expect(b.request.approval_status).toBe('PENDING_PROGRAM_MANAGER'); expect(b.records).toHaveLength(1); expect(b.clarifications).toHaveLength(1);
  });
  it('limits a student to 3 open requests', async () => {
    await as('arjun@demo.campus'); await newReq(); await newReq();
    await expect(newReq()).rejects.toThrow(/3 open requests/);
  });
  it('rejects bad input (past departure, return before departure)', async () => {
    await as('riya@demo.campus');
    await expect(newReq({ departure_time: iso(Date.now() - 2 * HOUR) })).rejects.toThrow(/past/);
    await expect(newReq({ expected_return: iso(Date.now()) })).rejects.toThrow(/after departure/);
  });
});

describe('emergencies and escalation', () => {
  it('7. a critical request with no policy alerts administrators', async () => {
    await as('riya@demo.campus'); await newReq({ category: 'CRITICAL' });
    await as('admin@demo.campus'); expect((await api.listNotifications()).filter((n) => n.type === 'NO_POLICY_ALERT').length).toBeGreaterThan(0);
  });
  it('8. overdue with no backup only alerts admins and never approves', async () => {
    await as('admin@demo.campus');
    const res = await api.demo!.runMaintenance(); expect(res.escalated).toBe(0); expect(res.admin_alerts).toBeGreaterThan(0);
    const kiran = (await api.listRequests()).find((r) => r.category === 'CRITICAL' && r.approval_status === 'PENDING_PROGRAM_MANAGER');
    expect(kiran).toBeTruthy(); expect(kiran!.escalated_at).toBeNull();
  });
  it('8b. with a documented policy and backup, escalation notifies the backup who may then act', async () => {
    await as('admin@demo.campus');
    await expect(api.savePolicy({ name: 'x', category: 'CRITICAL', response_deadline_minutes: 5, policy_reference: '  ', enabled: true })).rejects.toThrow(/documented/i);
    await api.savePolicy({ name: 'Critical backup', category: 'CRITICAL', response_deadline_minutes: 5, backup_approver_id: 'u-m1', alert_roles: ['security'], policy_reference: 'Handbook §7.2', enabled: true });
    const kiranReq = (await api.listRequests()).find((r) => r.category === 'CRITICAL' && r.student?.full_name === 'Kiran Patel' && r.approval_status === 'PENDING_PROGRAM_MANAGER')!;
    await as('anita@demo.campus');
    await expect(api.decide(kiranReq.id, 'APPROVED')).rejects.toThrow(/not authorized/i); // before escalation
    await as('admin@demo.campus'); expect((await api.demo!.runMaintenance()).escalated).toBe(1);
    await as('anita@demo.campus'); await api.decide(kiranReq.id, 'APPROVED', 'backup ok');
    const rec = (await api.getRequestBundle(kiranReq.id)).records[0]!; expect(rec.acted_as_backup).toBe(true);
  });
});

describe('gate and passes', () => {
  it('10-13. valid QR verifies, exit is recorded once, simultaneous scans cannot both win', async () => {
    const { cred } = await approvedPass();
    await as('gate@demo.campus');
    const v = await api.verifyPass(cred); expect(v.state).toBe('VALID'); expect(JSON.stringify(v)).not.toMatch(/Dentist/);
    const [a, b] = await Promise.all([api.recordMovement(cred), api.recordMovement(cred)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await api.verifyPass(cred)).state).toBe('ALREADY_USED');
    expect((await api.recentMovements())[0]!.event_type).toBe('EXIT');
  });
  it('accepts the manual code and rejects garbage', async () => {
    const { code } = await approvedPass(); await as('gate@demo.campus');
    expect((await api.verifyPass(code)).state).toBe('VALID'); expect((await api.verifyPass('nonsense')).state).toBe('INVALID');
  });
  it('rotating the pass invalidates the old QR', async () => {
    const { r, cred } = await approvedPass(); await as('riya@demo.campus'); const fresh = await api.getMyPass(r.id);
    await as('gate@demo.campus'); expect((await api.verifyPass(cred)).state).toBe('INVALID'); expect((await api.verifyPass(fresh.qr_payload!)).state).toBe('VALID');
  });
  it('11. expired, revoked and cancelled passes are rejected', async () => {
    const { r, cred } = await approvedPass();
    await as('swo@demo.campus'); await api.revokePass(r.id, 'Policy breach');
    await as('gate@demo.campus'); expect((await api.verifyPass(cred)).state).toBe('REVOKED'); expect((await api.recordMovement(cred)).ok).toBe(false);
    const second = await approvedPass('meera@demo.campus');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 6 * HOUR);
    await as('gate@demo.campus'); expect((await api.verifyPass(second.cred)).state).toBe('EXPIRED'); expect((await api.recordMovement(second.cred)).ok).toBe(false);
    vi.useRealTimers();
    const third = await approvedPass('arjun@demo.campus'); await as('arjun@demo.campus'); await api.cancelRequest(third.r.id);
    await as('gate@demo.campus'); expect((await api.verifyPass(third.cred)).state).toBe('REVOKED');
  });
  it('security cannot approve and students cannot verify passes', async () => {
    await as('riya@demo.campus'); const r = await newReq();
    await as('gate@demo.campus'); await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow();
    expect(await api.listRequests()).toHaveLength(0);
    await as('riya@demo.campus'); await expect(api.verifyPass('x')).rejects.toThrow(/not authorized/i);
  });
});

describe('late arrival: re-entry follows the same approval process', () => {
  const lateExit = async () => (await (async () => { await as('kiran@demo.campus'); return api.listRequests(); })()).find((r) => r.kind === 'EXIT' && r.movement_status === 'EXITED')!;
  it('there is no return step: recordMovement never logs a return', async () => {
    const { cred } = await approvedPass(); await as('gate@demo.campus'); await api.recordMovement(cred);
    const again = await api.recordMovement(cred); expect(again.ok).toBe(false);
  });
  it('re-entry needs an exit that happened and an arrival after the expected return', async () => {
    const x = await lateExit();
    await expect(api.submitReentry({ exit_request_id: x.id, category: 'REGULAR', reason: 'Bus delay', arrival_time: iso(new Date(x.expected_return!).getTime() - HOUR) })).rejects.toThrow(/only needed when arriving after/);
    await as('riya@demo.campus'); const own = await newReq();
    await expect(api.submitReentry({ exit_request_id: own.id, category: 'REGULAR', reason: 'x late', arrival_time: iso(Date.now() + 9 * HOUR) })).rejects.toThrow(/recorded at the gate/);
    await as('meera@demo.campus');
    await expect(api.submitReentry({ exit_request_id: x.id, category: 'REGULAR', reason: 'x late', arrival_time: iso(Date.now() + 9 * HOUR) })).rejects.toThrow(/recorded at the gate/);
  });
  it('full flow: request, Program Manager, SWO, pass, gate records ENTRY, student is back', async () => {
    const x = await lateExit();
    const re = await api.submitReentry({ exit_request_id: x.id, category: 'REGULAR', reason: 'Missed the last bus', arrival_time: iso(Date.now() + 2 * HOUR) });
    expect(re.kind).toBe('REENTRY'); expect(re.approval_status).toBe('PENDING_PROGRAM_MANAGER');
    await expect(api.submitReentry({ exit_request_id: x.id, category: 'REGULAR', reason: 'again please', arrival_time: iso(Date.now() + 3 * HOUR) })).rejects.toThrow(/already exists/);
    await as('swo@demo.campus'); await expect(api.decide(re.id, 'APPROVED')).rejects.toThrow(/not authorized/i);
    await as('vikram@demo.campus'); await api.decide(re.id, 'APPROVED');
    await as('swo@demo.campus'); await api.decide(re.id, 'APPROVED');
    await as('kiran@demo.campus'); const pass = await api.getMyPass(re.id);
    await as('gate@demo.campus'); expect((await api.verifyPass(pass.qr_payload!)).state).toBe('NOT_YET_VALID'); // window opens shortly before the planned arrival
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 2 * HOUR);
    const v = await api.verifyPass(pass.qr_payload!);
    expect(v.kind).toBe('REENTRY'); expect(v.exit?.original_expected_return).toBeTruthy();
    expect(v.state).toBe('VALID');
    const out = await api.recordMovement(pass.qr_payload!); expect(out).toMatchObject({ ok: true, event: 'ENTRY', state: 'ENTERED' });
    expect((await api.recordMovement(pass.qr_payload!)).ok).toBe(false);
    await as('kiran@demo.campus'); expect((await api.getRequestBundle(x.id)).request.movement_status).toBe('ENTERED');
  });
});

describe('administration', () => {
  it('an admin cannot demote or disable themselves; non-admins cannot manage users', async () => {
    await as('admin@demo.campus');
    await expect(api.updateProfile({ id: 'u-admin', full_name: 'Admin Office', role: 'student', status: 'ACTIVE', department: '', college_id: 'ADMIN001', assigned_manager_id: null })).rejects.toThrow(/your own admin/);
    await as('riya@demo.campus'); await expect(api.listProfiles()).rejects.toThrow(/admins only/i);
    await expect(api.updateProfile({ id: 'u-s1', full_name: 'Riya', role: 'admin', status: 'ACTIVE', department: '', college_id: '', assigned_manager_id: null })).rejects.toThrow(/admins only/i);
  });
  it('disabled accounts cannot sign in; managers must be active Program Managers', async () => {
    await as('admin@demo.campus');
    await api.updateProfile({ id: 'u-s3', full_name: 'Meera Iyer', role: 'student', status: 'DISABLED', department: 'CSE', college_id: '22CS1067', assigned_manager_id: 'u-m1' });
    await expect(api.updateProfile({ id: 'u-s4', full_name: 'Arjun Nair', role: 'student', status: 'ACTIVE', department: 'CSE', college_id: '22CS1011', assigned_manager_id: 'u-swo' })).rejects.toThrow(/active Program Manager/);
    await expect(as('meera@demo.campus')).rejects.toThrow(/not active/);
  });
  it('audit log records the actions', async () => {
    await as('riya@demo.campus'); await newReq(); await as('admin@demo.campus');
    expect((await api.listAudit()).some((a) => a.action === 'request.submitted' && a.actor_name === 'Riya Sharma')).toBe(true);
  });
});

describe('absence cover (Program Manager <-> SWO)', () => {
  const tomorrow = () => iso(Date.now() + 24 * HOUR);
  const declareSwo = async () => { await as('swo@demo.campus'); await api.declareAbsence({ user_id: 'u-swo', ends_at: tomorrow(), reason: 'Out of station' }); };
  const pmApproved = async () => { await as('riya@demo.campus'); const r = await newReq(); await as('anita@demo.campus'); await api.decide(r.id, 'APPROVED', 'ok'); return r; };

  it('a Program Manager cannot act at the SWO stage while an SWO is available', async () => {
    const r = await pmApproved(); await as('anita@demo.campus');
    await expect(api.decide(r.id, 'APPROVED', 'trying')).rejects.toThrow(/not authorized/i);
  });
  it('SWO absent: the Program Manager can cover, but only with a comment; it is flagged and the absent SWO + admins are told', async () => {
    await declareSwo(); const r = await pmApproved(); await as('anita@demo.campus');
    await expect(api.decide(r.id, 'APPROVED')).rejects.toThrow(/comment is required/i);
    await api.decide(r.id, 'APPROVED', 'Covering for absent SWO');
    const b = await api.getRequestBundle(r.id);
    expect(b.request.approval_status).toBe('APPROVED_PASS_ISSUED');
    expect(b.records.find((x) => x.stage === 'SWO')).toMatchObject({ acted_as_cover: true, acted_as_backup: false });
    await as('swo@demo.campus'); expect((await api.listNotifications()).some((n) => n.type === 'COVER_USED')).toBe(true);
    await as('admin@demo.campus'); expect((await api.listNotifications()).some((n) => n.type === 'COVER_USED')).toBe(true);
    expect((await api.listAudit()).some((a) => a.action === 'request.approved' && a.metadata.acted_as_cover === true)).toBe(true);
  });
  it('Program Manager absent: an SWO member can cover that manager’s students only', async () => {
    await as('anita@demo.campus'); await api.declareAbsence({ user_id: 'u-m1', ends_at: tomorrow(), reason: 'Conference' });
    await as('riya@demo.campus'); const mine = await newReq();
    await as('swo@demo.campus');
    expect((await api.listRequests()).some((r) => r.id === mine.id)).toBe(true);
    await expect(api.decide(mine.id, 'APPROVED')).rejects.toThrow(/comment is required/i);
    await api.decide(mine.id, 'APPROVED', 'Covering for absent Program Manager');
    expect((await api.getRequestBundle(mine.id)).request.approval_status).toBe('PENDING_SWO');
    const others = (await api.listRequests()).filter((r) => r.student?.full_name === 'Kiran Patel' && r.approval_status === 'PENDING_PROGRAM_MANAGER');
    expect(others).toHaveLength(0);               // Vikram is present, so his students are not coverable
  });
  it('cover stops when the absence is ended or expires', async () => {
    await declareSwo(); const r = await pmApproved();
    await as('swo@demo.campus'); const [a] = await api.listAbsences(); await api.endAbsence(a!.id);
    await as('anita@demo.campus'); await expect(api.decide(r.id, 'APPROVED', 'x')).rejects.toThrow(/not authorized/i);
    await as('swo@demo.campus'); await api.declareAbsence({ user_id: 'u-swo', ends_at: tomorrow(), reason: 'Again' });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 2 * 24 * HOUR);
    await as('anita@demo.campus'); await expect(api.decide(r.id, 'APPROVED', 'x')).rejects.toThrow(/not authorized/i);
  });
  it('who may declare: only the approver (or an admin); max 14 days; reason required; no duplicates', async () => {
    const d = (user_id: string, over: Partial<{ ends_at: string; reason: string }> = {}) => api.declareAbsence({ user_id, ends_at: tomorrow(), reason: 'Leave', ...over });
    await as('riya@demo.campus'); await expect(d('u-s1')).rejects.toThrow(/only applies to active Program Managers/);
    await as('gate@demo.campus'); await expect(d('u-gate')).rejects.toThrow(/only applies/);
    await as('anita@demo.campus'); await expect(d('u-swo')).rejects.toThrow(/only declare your own/);
    await expect(d('u-m1', { ends_at: iso(Date.now() + 15 * 24 * HOUR) })).rejects.toThrow(/at most 14 days/);
    await expect(d('u-m1', { reason: ' ' })).rejects.toThrow(/short reason/);
    await expect(d('u-m1', { ends_at: iso(Date.now() - 1000) })).rejects.toThrow(/future/);
    await d('u-m1'); await expect(d('u-m1')).rejects.toThrow(/already has an active absence/);
    await as('admin@demo.campus'); await d('u-swo');
  });
  it('the reason stays private: others only see who is absent', async () => {
    await declareSwo();
    await as('anita@demo.campus'); const active = await api.listActiveAbsences();
    expect(active).toHaveLength(1); expect(active[0]).not.toHaveProperty('reason'); expect(await api.listAbsences()).toHaveLength(0);
    await as('riya@demo.campus'); expect(await api.listActiveAbsences()).toHaveLength(0);
    await as('swo@demo.campus'); expect((await api.listAbsences())[0]!.reason).toBe('Out of station');
  });
  it('late re-entry follows the same cover rule', async () => {
    await as('kiran@demo.campus'); const x = (await api.listRequests()).find((r) => r.kind === 'EXIT' && r.movement_status === 'EXITED')!;
    const re = await api.submitReentry({ exit_request_id: x.id, category: 'REGULAR', reason: 'Missed the last bus', arrival_time: iso(Date.now() + 2 * HOUR) });
    await as('vikram@demo.campus'); await api.declareAbsence({ user_id: 'u-m2', ends_at: tomorrow(), reason: 'Sick leave' });
    await as('swo@demo.campus'); await api.decide(re.id, 'APPROVED', 'Covering for absent Program Manager'); await api.decide(re.id, 'APPROVED');
    await as('kiran@demo.campus'); expect((await api.getRequestBundle(re.id)).request.approval_status).toBe('APPROVED_PASS_ISSUED');
  });
  it('a student can never be covered into approving their own request', async () => {
    await declareSwo(); await as('riya@demo.campus'); const r = await newReq();
    await expect(api.decide(r.id, 'APPROVED', 'me')).rejects.toThrow(/not authorized/i);
  });
});
