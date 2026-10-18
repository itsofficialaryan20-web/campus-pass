import type * as T from '../types';

/** Everything the UI needs. Implemented twice: against Supabase, and as an in-memory demo. */
export interface Api {
  mode: 'demo' | 'supabase';
  getCurrentUser(): Promise<T.Profile | null>;
  signIn(identifier: string, password: string): Promise<T.Profile>;
  signOut(): Promise<void>;
  updateMyName(name: string): Promise<void>;

  listRequests(): Promise<T.ExitRequest[]>;
  getRequestBundle(id: string): Promise<T.RequestBundle>;
  listApprovalRecords(): Promise<T.ApprovalRecord[]>;
  submitRequest(i: T.NewRequestInput): Promise<T.ExitRequest>;
  submitReentry(i: T.ReentryInput): Promise<T.ExitRequest>;
  respondClarification(requestId: string, message: string): Promise<void>;
  cancelRequest(requestId: string): Promise<void>;
  decide(requestId: string, decision: T.Decision, comment?: string): Promise<void>;
  getMyPass(requestId: string): Promise<T.PassView>;
  revokePass(requestId: string, reason: string): Promise<void>;

  verifyPass(credential: string): Promise<T.VerifyResult>;
  recordMovement(credential: string): Promise<T.MovementResult>;
  recentMovements(): Promise<T.MovementRow[]>;

  listNotifications(): Promise<T.AppNotification[]>;
  markNotificationsRead(): Promise<void>;
  getPrefs(): Promise<T.NotificationPrefs>;
  setPrefs(p: T.NotificationPrefs): Promise<void>;
  listStaff(): Promise<T.StaffEntry[]>;
  /** Calls back whenever data may have changed (Supabase Realtime, or local mutations in demo). */
  subscribe(cb: () => void): () => void;

  listProfiles(): Promise<T.Profile[]>;
  updateProfile(i: T.UpdateProfileInput): Promise<void>;
  createUser(i: T.CreateUserInput): Promise<T.CreateUserResult>;
  listAudit(): Promise<T.AuditLog[]>;
  listPolicies(): Promise<T.EmergencyPolicy[]>;
  savePolicy(p: Partial<T.EmergencyPolicy> & { name: string }): Promise<void>;
  deletePolicy(id: string): Promise<void>;
  getSettings(): Promise<T.AppSettings>;
  /** Absence cover: your own absences (admins: everyone's), who is absent right now, declare and end. */
  listAbsences(): Promise<T.Absence[]>;
  listActiveAbsences(): Promise<T.Absence[]>;
  declareAbsence(i: T.DeclareAbsenceInput): Promise<void>;
  endAbsence(id: string): Promise<void>;
  saveSettings(s: T.AppSettings): Promise<void>;

  /** Demo-only helpers. Undefined in Supabase mode. */
  demo?: {
    accounts(): Array<{ label: string; role: T.Role; email: string }>;
    password: string;
    reset(): void;
    runMaintenance(): Promise<{ escalated: number; admin_alerts: number; passes_expired: number }>;
  };
}
