import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Bell, ChevronsLeft, ChevronsRight, GraduationCap, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useAsync } from '../hooks/useAsync';
import { api, isDemo } from '../lib/api';
import { navFor } from '../lib/roles';
import { ROLE_LABEL } from '../types';
import { cx } from '../lib/format';

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

export function Layout() {
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('cp-sidebar') === '1');
  const loc = useLocation();
  const notes = useAsync(() => api.listNotifications(), [loc.pathname], true);
  useEffect(() => { localStorage.setItem('cp-sidebar', collapsed ? '1' : '0'); }, [collapsed]);
  if (!user) return null;
  const nav = navFor(user.role);
  const unread = notes.data?.filter((n) => !n.read_at).length ?? 0;
  const mobileNav = nav.slice(0, 4);

  return (
    <div className="flex min-h-screen">
      <aside className={cx('sticky top-0 hidden h-screen shrink-0 flex-col bg-navy px-3 py-5 transition-[width] md:flex', collapsed ? 'w-[72px]' : 'w-[248px]')} aria-label="Primary">
        <div className={cx('mb-5 flex items-center gap-2.5 px-2', collapsed && 'justify-center')}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand text-white"><GraduationCap className="h-5 w-5" /></div>
          {!collapsed && <div><p className="text-[17px] font-bold leading-5 text-white">CampusPass</p><p className="text-xs text-[#B6C2DA]">{ROLE_LABEL[user.role]}</p></div>}
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={collapsed ? n.label : undefined}
              className={({ isActive }) => cx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium', collapsed && 'justify-center', isActive ? 'bg-navy-active font-semibold text-white' : 'text-[#B6C2DA] hover:bg-navy-active/60 hover:text-white')}>
              <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed && n.label}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-[#B6C2DA] hover:bg-navy-active/60 hover:text-white">
          {collapsed ? <ChevronsRight className="mx-auto h-[18px] w-[18px]" /> : <><ChevronsLeft className="h-[18px] w-[18px]" />Collapse</>}
        </button>
        <div className={cx('flex items-center gap-2.5 rounded-lg p-2', collapsed && 'justify-center')}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-tint text-[13px] font-semibold text-brand">{initials(user.full_name)}</div>
          {!collapsed && <div className="min-w-0 flex-1"><p className="truncate text-[13px] font-semibold text-white">{user.full_name}</p>
            <button onClick={() => void signOut()} className="flex items-center gap-1 text-xs text-[#B6C2DA] hover:text-white"><LogOut className="h-3 w-3" />Sign out</button></div>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[60px] items-center gap-3 border-b border-line bg-white px-4 md:h-[72px] md:px-8">
          <div className="flex items-center gap-2 md:hidden"><div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white"><GraduationCap className="h-4 w-4" /></div><span className="font-bold">CampusPass</span></div>
          <div className="flex-1" />
          {isDemo && <span className="rounded-full bg-[#E2E8F0] px-2.5 py-0.5 text-xs font-semibold text-[#334155]">Demo data</span>}
          <NavLink to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className="relative grid h-10 w-10 place-items-center rounded-[10px] border border-line text-ink-2 hover:bg-subtle">
            <Bell className="h-[18px] w-[18px]" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger-solid px-1 text-[10px] font-bold text-white">{unread}</span>}
          </NavLink>
          <button onClick={() => void signOut()} aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-[10px] border border-line text-ink-2 hover:bg-subtle md:hidden"><LogOut className="h-[18px] w-[18px]" /></button>
        </header>
        {isDemo && (
          <div className="border-b border-warn-bg bg-warn-bg px-4 py-2 text-xs font-medium text-warn-text md:px-8">
            Demo mode: mock data stored in this browser. Approvals and gate checks here are <strong>not production-secure</strong>. Set the Supabase variables to use the real backend.
          </div>
        )}
        <main className="flex-1 px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-8"><Outlet /></main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid border-t border-line bg-white md:hidden" style={{ gridTemplateColumns: `repeat(${mobileNav.length}, minmax(0,1fr))` }} aria-label="Mobile">
        {mobileNav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', isActive ? 'text-brand' : 'text-ink-muted')}>
            <n.icon className="h-5 w-5" aria-hidden />{n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
