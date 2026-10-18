import type { ApprovalRecord, EmergencyPolicy, ExitRequest } from '../types';

const median = (a: number[]) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export interface Stats {
  today: number; avgApprovalMs: number | null; pending: { pm: number; swo: number; clarification: number; passReady: number };
  emergencyMedianMs: number | null; emergencyCount: number; overdue: ExitRequest[]; overdueNoBackup: ExitRequest[]; categoriesWithoutPolicy: Array<'URGENT' | 'CRITICAL'>;
}
export function computeStats(reqs: ExitRequest[], records: ApprovalRecord[], policies: EmergencyPolicy[], now = Date.now()): Stats {
  const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
  const approved = reqs.filter((r) => r.approved_at);
  const emergency = reqs.filter((r) => r.category !== 'REGULAR');
  const first = (r: ExitRequest) => records.filter((x) => x.request_id === r.id).map((x) => new Date(x.decided_at).getTime()).sort((a, b) => a - b)[0];
  const resp = emergency.map((r) => { const f = first(r); return f ? f - new Date(r.created_at).getTime() : null; }).filter((v): v is number => v !== null);
  const overdue = reqs.filter((r) => (r.approval_status === 'PENDING_PROGRAM_MANAGER' || r.approval_status === 'PENDING_SWO') && r.stage_due_at && new Date(r.stage_due_at).getTime() < now);
  const hasBackup = (r: ExitRequest) => policies.some((p) => p.enabled && p.category === r.category && p.backup_approver_id);
  const enabled = (c: 'URGENT' | 'CRITICAL') => policies.some((p) => p.enabled && p.category === c);
  return {
    today: reqs.filter((r) => new Date(r.created_at) >= startOfDay).length,
    avgApprovalMs: approved.length ? approved.reduce((s, r) => s + (new Date(r.approved_at!).getTime() - new Date(r.created_at).getTime()), 0) / approved.length : null,
    pending: {
      pm: reqs.filter((r) => r.approval_status === 'PENDING_PROGRAM_MANAGER').length, swo: reqs.filter((r) => r.approval_status === 'PENDING_SWO').length,
      clarification: reqs.filter((r) => r.approval_status === 'NEEDS_CLARIFICATION').length, passReady: reqs.filter((r) => r.approval_status === 'APPROVED_PASS_ISSUED' && r.movement_status === 'NONE').length,
    },
    emergencyMedianMs: median(resp), emergencyCount: emergency.length, overdue,
    overdueNoBackup: overdue.filter((r) => r.category !== 'REGULAR' && !hasBackup(r)),
    categoriesWithoutPolicy: (['URGENT', 'CRITICAL'] as const).filter((c) => !enabled(c)),
  };
}
