import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Api } from './apiTypes';
import type * as T from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const REQ_SELECT = '*, student:profiles!exit_requests_student_id_fkey(full_name,college_id,department,assigned_manager_id)';
const PASS_COLS = 'id,request_id,valid_from,valid_until,revoked_at,revoke_reason,used_at'; // hashes are never readable

function unwrap<V>(res: { data: V | null; error: { message: string } | null }): V {
  if (res.error) throw new Error(res.error.message);
  return res.data as V;
}

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb: SupabaseClient = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });

  async function me(): Promise<T.Profile | null> {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? ({ ...(data as T.Profile), email: session.user.email ?? undefined }) : null;
  }
  async function uid(): Promise<string> {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Please sign in again.');
    return session.user.id;
  }

  const api: Api = {
    mode: 'supabase',
    getCurrentUser: me,
    async signIn(identifier, password) {
      if (!identifier.includes('@')) throw new Error('Sign in with your college email address.');
      const { error } = await sb.auth.signInWithPassword({ email: identifier.trim(), password });
      if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message);
      const p = await me();
      if (!p) { await sb.auth.signOut(); throw new Error('No profile exists for this account. Contact the administrator.'); }
      if (p.status !== 'ACTIVE') { await sb.auth.signOut(); throw new Error('Your account is not active yet. Contact the administrator.'); }
      return p;
    },
    async signOut() { await sb.auth.signOut(); },
    async updateMyName(name) { unwrap(await sb.from('profiles').update({ full_name: name.trim() }).eq('id', await uid())); },

    async listRequests() {
      return unwrap(await sb.from('exit_requests').select(REQ_SELECT).order('created_at', { ascending: false })) as unknown as T.ExitRequest[];
    },
    async getRequestBundle(id) {
      const [req, records, clar, pass, moves] = await Promise.all([
        sb.from('exit_requests').select(REQ_SELECT).eq('id', id).maybeSingle(),
        sb.from('approval_records').select('*').eq('request_id', id).order('decided_at'),
        sb.from('clarification_responses').select('*').eq('request_id', id).order('created_at'),
        sb.from('exit_passes').select(PASS_COLS).eq('request_id', id).maybeSingle(),
        sb.from('movement_logs').select('id,request_id,event_type,event_at').eq('request_id', id).order('event_at'),
      ]);
      const request = unwrap(req as any) as T.ExitRequest | null;
      if (!request) throw new Error('Request not found.');
      let linked: T.ExitRequest | null = null;
      if (request.related_request_id) {
        linked = unwrap((await sb.from('exit_requests').select(REQ_SELECT).eq('id', request.related_request_id).maybeSingle()) as any);
      } else {
        const { data } = await sb.from('exit_requests').select(REQ_SELECT).eq('related_request_id', id).eq('kind', 'REENTRY').not('approval_status', 'in', '(REJECTED,CANCELLED)').maybeSingle();
        linked = (data as unknown as T.ExitRequest) ?? null;
      }
      return {
        request, records: unwrap(records as any) as T.ApprovalRecord[], clarifications: unwrap(clar as any) as T.ClarificationResponse[],
        pass: (unwrap(pass as any) as T.PassMeta | null) ?? null, movements: unwrap(moves as any) as T.MovementLog[], linked,
      };
    },
    async listApprovalRecords() { return unwrap(await sb.from('approval_records').select('*').order('decided_at', { ascending: false }).limit(2000)) as T.ApprovalRecord[]; },
    async submitRequest(i) {
      return unwrap(await sb.rpc('submit_exit_request', {
        p_category: i.category, p_reason: i.reason, p_destination: i.destination, p_departure: i.departure_time,
        p_expected_return: i.expected_return, p_details: i.details ?? null,
      })) as T.ExitRequest;
    },
    async submitReentry(i) {
      return unwrap(await sb.rpc('submit_reentry_request', { p_exit_request_id: i.exit_request_id, p_category: i.category, p_reason: i.reason, p_arrival: i.arrival_time })) as T.ExitRequest;
    },
    async respondClarification(id, message) { unwrap(await sb.rpc('respond_to_clarification', { p_request_id: id, p_message: message })); },
    async cancelRequest(id) { unwrap(await sb.rpc('cancel_request', { p_request_id: id })); },
    async decide(id, decision, comment) { unwrap(await sb.rpc('decide_request', { p_request_id: id, p_decision: decision, p_comment: comment ?? null })); },
    async getMyPass(id) { return unwrap(await sb.rpc('get_my_pass', { p_request_id: id })) as T.PassView; },
    async revokePass(id, reason) { unwrap(await sb.rpc('revoke_pass', { p_request_id: id, p_reason: reason })); },

    async verifyPass(credential) { return unwrap(await sb.rpc('verify_pass', { p_credential: credential })) as T.VerifyResult; },
    async recordMovement(credential) { return unwrap(await sb.rpc('record_movement', { p_credential: credential })) as T.MovementResult; },
    async recentMovements() { return (unwrap(await sb.rpc('list_recent_movements', { p_limit: 25 })) ?? []) as T.MovementRow[]; },

    async listNotifications() { return unwrap(await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)) as T.AppNotification[]; },
    async markNotificationsRead() { unwrap(await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)); },
    async getPrefs() {
      const { data } = await sb.from('notification_preferences').select('email_opt_in,sms_opt_in').maybeSingle();
      return (data as T.NotificationPrefs) ?? { email_opt_in: false, sms_opt_in: false };
    },
    async setPrefs(p) { unwrap(await sb.from('notification_preferences').upsert({ user_id: await uid(), ...p })); },
    async listStaff() { return unwrap(await sb.from('staff_directory').select('*')) as T.StaffEntry[]; },
    subscribe(cb) {
      const ch = sb.channel('campuspass-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'exit_requests' }, cb)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, cb)
        .subscribe();
      return () => { void sb.removeChannel(ch); };
    },

    async listProfiles() { return unwrap(await sb.from('profiles').select('*').order('full_name')) as T.Profile[]; },
    async updateProfile(i) {
      unwrap(await sb.rpc('admin_update_profile', {
        p_user: i.id, p_full_name: i.full_name, p_role: i.role, p_status: i.status, p_department: i.department,
        p_college_id: i.college_id, p_manager_id: i.assigned_manager_id,
      }));
    },
    async createUser(i) {
      // Needs the service-role key, so it runs server-side: supabase/functions/admin-create-user
      const { data, error } = await sb.functions.invoke('admin-create-user', { body: i });
      if (error) {
        let msg = error.message;
        try { const j = await (error as any).context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep generic */ }
        throw new Error(msg);
      }
      return data as T.CreateUserResult;
    },
    async listAudit() {
      const rows = unwrap(await sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(300)) as T.AuditLog[];
      const names = new Map((await api.listProfiles()).map((p) => [p.id, p.full_name]));
      return rows.map((r) => ({ ...r, actor_name: r.actor_id ? names.get(r.actor_id) ?? 'Unknown user' : 'System' }));
    },
    async listPolicies() { return unwrap(await sb.from('emergency_policies').select('*').order('created_at')) as T.EmergencyPolicy[]; },
    async savePolicy(p) {
      const row = {
        name: p.name, category: p.category, stage: p.stage ?? null, response_deadline_minutes: p.response_deadline_minutes,
        backup_approver_id: p.backup_approver_id ?? null, alert_roles: p.alert_roles ?? [], policy_reference: p.policy_reference, enabled: !!p.enabled,
        ...(p.id ? {} : { created_by: await uid() }),
      };
      unwrap(p.id ? await sb.from('emergency_policies').update(row).eq('id', p.id) : await sb.from('emergency_policies').insert(row));
    },
    async deletePolicy(id) { unwrap(await sb.from('emergency_policies').delete().eq('id', id)); },
    async listAbsences() {
      const [rows, staff] = await Promise.all([sb.from('approver_absences').select('*').order('created_at', { ascending: false }).limit(100), api.listStaff()]);
      const names = new Map(staff.map((s) => [s.id, s]));
      return (unwrap(rows as any) as any[]).map((a) => ({ ...a, full_name: names.get(a.user_id)?.full_name ?? 'You', role: names.get(a.user_id)?.role ?? 'program_manager' })) as T.Absence[];
    },
    async listActiveAbsences() { return unwrap(await sb.from('active_absences').select('*')) as T.Absence[]; },
    async declareAbsence(i) { unwrap(await sb.rpc('declare_absence', { p_user: i.user_id, p_ends_at: i.ends_at, p_reason: i.reason })); },
    async endAbsence(id) { unwrap(await sb.rpc('end_absence', { p_id: id })); },
    async getSettings() { return unwrap(await sb.from('app_settings').select('*').single()) as T.AppSettings; },
    async saveSettings(s) { unwrap(await sb.from('app_settings').update(s).eq('id', true)); },
  };
  return api;
}
