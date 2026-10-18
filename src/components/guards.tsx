import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';
import { homeFor } from '../lib/roles';
import { Spinner } from './ui';
import type { Role } from '../types';

export function RequireAuth() {
  const { user, loading } = useAuth(); const loc = useLocation();
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner label="Loading CampusPass" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}
/** UI guard only. The database enforces the same rules with RLS and role-checked functions. */
export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.role)) return <Navigate to="/access-denied" replace />;
  return <Outlet />;
}
export function RoleHome() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error(error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="grid min-h-screen place-items-center p-6 text-center">
        <div><h1 className="text-xl font-bold">Something went wrong</h1><p className="mt-2 text-sm text-ink-muted">{this.state.error.message}</p>
          <button className="mt-4 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white" onClick={() => location.assign('/')}>Reload</button></div>
      </div>
    );
  }
}
