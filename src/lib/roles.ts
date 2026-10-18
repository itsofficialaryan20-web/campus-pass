import { Bell, ClipboardCheck, History, LayoutDashboard, FilePlus2, ScanLine, ShieldCheck, SlidersHorizontal, User, UserX, Users, BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Role } from '../types';

export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean }

export const homeFor = (r: Role): string =>
  ({ student: '/dashboard', program_manager: '/approvals', swo: '/approvals', security: '/gate', admin: '/admin' } as const)[r];

const common: NavItem[] = [
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: User },
];
export const navFor = (r: Role): NavItem[] => {
  switch (r) {
    case 'student': return [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/requests/new', label: 'New request', icon: FilePlus2 },
      { to: '/requests', label: 'My requests', icon: History, end: true }, ...common];
    case 'program_manager':
    case 'swo': return [
      { to: '/approvals', label: 'Approvals', icon: ClipboardCheck, end: true },
      { to: '/approvals/history', label: 'Decision history', icon: History },
      { to: '/absence', label: 'Absence cover', icon: UserX }, ...common];
    case 'security': return [{ to: '/gate', label: 'Gate verification', icon: ScanLine }, ...common];
    case 'admin': return [
      { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
      { to: '/admin/users', label: 'Users & roles', icon: Users },
      { to: '/admin/reports', label: 'Reports & audit', icon: BarChart3 },
      { to: '/admin/policies', label: 'Policies & settings', icon: ShieldCheck },
      { to: '/absence', label: 'Absence cover', icon: UserX },
      ...common];
  }
};
export { SlidersHorizontal };
