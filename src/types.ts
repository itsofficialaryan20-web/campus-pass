export type Role = 'student' | 'program_manager' | 'swo' | 'security' | 'admin';
export type AccountStatus = 'PENDING' | 'ACTIVE' | 'DISABLED';
export type Category = 'REGULAR' | 'URGENT' | 'CRITICAL';
export type ApprovalStatus =
  | 'PENDING_PROGRAM_MANAGER' | 'PENDING_SWO' | 'NEEDS_CLARIFICATION'
  | 'APPROVED_PASS_ISSUED' | 'REJECTED' | 'CANCELLED';
export type Stage = 'PROGRAM_MANAGER' | 'SWO';
export type Decision = 'APPROVED' | 'REJECTED' | 'CLARIFICATION_REQUESTED';
/** Security records exits and re-entries only. There is no "return" state. */
export type MovementStatus = 'NONE' | 'EXITED' | 'ENTERED';
export type RequestKind = 'EXIT' | 'REENTRY';
export type PassState = 'VALID' | 'EXPIRED' | 'REVOKED' | 'ALREADY_USED' | 'NOT_YET_VALID' | 'INVALID';

export interface Profile {
  id: string; full_name: string; college_id: string | null; role: Role;
  department: string | null; assigned_manager_id: string | null; status: AccountStatus; email?: string;
}
export interface StudentRef { full_name: string; college_id: string | null; department: string | null; assigned_manager_id?: string | null }
export interface ExitRequest {
  id: string; request_code: string; student_id: string; kind: RequestKind; related_request_id: string | null;
  category: Category; reason: string; destination: string; details: string | null;
  /** Intended time of the movement: departure (EXIT) or arrival (REENTRY). */
  departure_time: string; expected_return: string | null;
  approval_status: ApprovalStatus; clarification_stage: Stage | null; movement_status: MovementStatus;
  stage_entered_at: string; stage_due_at: string | null; escalated_at: string | null;
  pm_approved_at: string | null; approved_at: string | null; created_at: string;
  student?: StudentRef | null;
}
export interface ApprovalRecord {
  id: string; request_id: string; stage: Stage; approver_id: string; decision: Decision; comments: string | null;
  stage_entered_at: string; decided_at: string; acted_as_backup: boolean;
  /** Decided in place of an absent approver (declared absence cover). */
  acted_as_cover?: boolean;
}
export interface ClarificationResponse { id: string; request_id: string; student_id: string; stage: Stage; message: string; created_at: string }
export interface PassMeta {
  id: string; request_id: string; valid_from: string; valid_until: string;
  revoked_at: string | null; revoke_reason: string | null; used_at: string | null;
}
export interface MovementLog { id: string; request_id: string; event_type: 'EXIT' | 'ENTRY'; event_at: string }
export interface RequestBundle {
  request: ExitRequest; records: ApprovalRecord[]; clarifications: ClarificationResponse[];
  pass: PassMeta | null; movements: MovementLog[];
  /** For a REENTRY: the exit it follows. For an EXIT: its re-entry request, if any. */
  linked: ExitRequest | null;
}
export interface PassView {
  pass_id: string; state: string; valid_from: string; valid_until: string;
  /** Only present while the pass can still be used. Shown once; the next call rotates it. */
  qr_payload?: string; short_code?: string;
}
export interface VerifyResult {
  state: PassState; kind?: RequestKind; pass_id?: string; request_code?: string; movement_status?: MovementStatus;
  valid_from?: string; valid_until?: string;
  student?: { name: string; college_id: string | null; department: string | null };
  exit?: { destination: string; category: Category; departure_time: string; expected_return: string | null; original_expected_return: string | null };
}
export interface MovementResult { ok: boolean; state: string; kind?: RequestKind; event?: 'EXIT' | 'ENTRY'; event_at?: string }
export interface MovementRow { event_at: string; event_type: 'EXIT' | 'ENTRY'; request_code: string; student_name: string; college_id: string | null }
export type NotificationType =
  | 'REQUEST_SUBMITTED' | 'NEW_REQUEST_FOR_APPROVER' | 'PM_APPROVED' | 'PM_REJECTED' | 'SWO_APPROVED' | 'SWO_REJECTED'
  | 'CLARIFICATION_REQUESTED' | 'CLARIFICATION_ANSWERED' | 'PASS_ISSUED' | 'PASS_REVOKED' | 'PASS_EXPIRED'
  | 'URGENT_REQUEST' | 'CRITICAL_ALERT' | 'ESCALATION' | 'NO_POLICY_ALERT' | 'EXIT_RECORDED' | 'ENTRY_RECORDED' | 'COVER_USED' | 'ABSENCE_DECLARED';
export interface AppNotification {
  id: string; recipient_id: string; type: NotificationType; title: string; body: string | null;
  request_id: string | null; read_at: string | null; created_at: string;
}
export interface AuditLog { id: string | number; actor_id: string | null; actor_name?: string; action: string; target_table: string | null; target_id: string | null; metadata: Record<string, unknown>; created_at: string }
export interface EmergencyPolicy {
  id: string; name: string; category: 'URGENT' | 'CRITICAL'; stage: Stage | null; response_deadline_minutes: number;
  backup_approver_id: string | null; alert_roles: Role[]; policy_reference: string; enabled: boolean;
}
export interface AppSettings {
  pass_validity_minutes: number; pass_early_minutes: number; regular_response_minutes: number;
  urgent_response_minutes: number; critical_response_minutes: number; email_enabled: boolean; sms_enabled: boolean;
}
export interface Absence {
  id: string; user_id: string; full_name: string; role: Role; starts_at: string; ends_at: string;
  /** Private: only the person and admins can read it. */
  reason?: string; ended_at?: string | null;
}
export interface DeclareAbsenceInput { user_id: string; ends_at: string; reason: string }
export interface NotificationPrefs { email_opt_in: boolean; sms_opt_in: boolean }
export interface StaffEntry { id: string; full_name: string; role: Role; department: string | null }
export interface NewRequestInput { category: Category; reason: string; destination: string; departure_time: string; expected_return: string; details?: string }
export interface ReentryInput { exit_request_id: string; category: Category; reason: string; arrival_time: string }
export interface UpdateProfileInput {
  id: string; full_name: string; role: Role; status: AccountStatus; department: string; college_id: string; assigned_manager_id: string | null;
}
export interface CreateUserInput { email: string; full_name: string; college_id: string; role: Role; department?: string; assigned_manager_id?: string | null }
export interface CreateUserResult { profile: Profile; temporaryPassword?: string }

export const ROLE_LABEL: Record<Role, string> = {
  student: 'Student', program_manager: 'Program Manager', swo: 'SWO', security: 'Security', admin: 'Administrator',
};
export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING_PROGRAM_MANAGER: 'Pending Program Manager', PENDING_SWO: 'Pending SWO', NEEDS_CLARIFICATION: 'Needs clarification',
  APPROVED_PASS_ISSUED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};
export const CATEGORY_LABEL: Record<Category, string> = { REGULAR: 'Regular', URGENT: 'Urgent', CRITICAL: 'Critical Emergency' };
export const OPEN_STATUSES: ApprovalStatus[] = ['PENDING_PROGRAM_MANAGER', 'PENDING_SWO', 'NEEDS_CLARIFICATION'];
