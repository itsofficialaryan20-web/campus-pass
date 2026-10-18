import type { Absence, ExitRequest, Profile, Stage, StaffEntry } from '../types';

/**
 * Client-side mirror of the server's cover rule, used only to show or hide controls.
 * The database decides for real: it re-checks this inside decide_request().
 *  - SWO stage: a Program Manager may cover when EVERY active SWO member is declared absent.
 *  - Program Manager stage: an SWO member may cover when the student's own manager is declared absent.
 */
export function coverStage(r: ExitRequest, me: Profile, staff: StaffEntry[], active: Absence[]): Stage | null {
  if (r.student_id === me.id) return null;
  const absent = new Set(active.map((a) => a.user_id));
  if (r.approval_status === 'PENDING_SWO' && me.role === 'program_manager') {
    const swo = staff.filter((s) => s.role === 'swo');
    return swo.length > 0 && swo.every((s) => absent.has(s.id)) ? 'SWO' : null;
  }
  if (r.approval_status === 'PENDING_PROGRAM_MANAGER' && me.role === 'swo') {
    const mid = r.student?.assigned_manager_id;
    return mid && absent.has(mid) ? 'PROGRAM_MANAGER' : null;
  }
  return null;
}
export const stageLabel = (s: Stage) => (s === 'SWO' ? 'SWO' : 'Program Manager');
