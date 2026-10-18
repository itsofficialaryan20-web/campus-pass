import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Check, Clock, GraduationCap, Lock, QrCode, ShieldCheck, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, isDemo } from '../lib/api';
import { errMsg } from '../lib/format';
import { homeFor } from '../lib/roles';
import { ROLE_LABEL } from '../types';
import { Button, Field, Notice } from '../components/ui';

export default function LoginPage() {
  const { user, signIn } = useAuth(); const nav = useNavigate(); const loc = useLocation();
  const [id, setId] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  async function go(identifier: string, password: string) {
    setBusy(true); setErr(null);
    try { const p = await signIn(identifier, password); const from = (loc.state as { from?: string } | null)?.from; nav(from && from !== '/login' ? from : homeFor(p.role), { replace: true }); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const submit = (e: FormEvent) => { e.preventDefault(); if (!id.trim() || !pw) { setErr('Enter your email or college ID and your password.'); return; } void go(id, pw); };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="hidden flex-col justify-center gap-6 bg-navy p-14 lg:flex">
        <div className="flex items-center gap-3"><div className="grid h-12 w-12 place-items-center rounded-[10px] bg-brand text-white"><GraduationCap className="h-6 w-6" /></div><span className="text-2xl font-bold text-white">CampusPass</span></div>
        <h1 className="max-w-md text-4xl font-bold leading-tight text-white">Faster, accountable exit permissions.</h1>
        <p className="max-w-md text-[#B6C2DA]">Request, approve and verify campus exit passes in minutes, without skipping the Program Manager and SWO approvals.</p>
        <ul className="space-y-3.5 text-sm font-medium text-white">
          {[[Check, 'Sequential approval: Program Manager, then SWO'], [QrCode, 'Single-use QR pass verified at the gate'], [Clock, 'Real-time status and a full approval timeline']].map(([Icon, t], i) => {
            const I = Icon as typeof Check; return <li key={i} className="flex items-center gap-3"><span className="grid h-8 w-8 place-items-center rounded-lg bg-navy-active"><I className="h-4 w-4" /></span>{t as string}</li>;
          })}
        </ul>
      </div>
      <div className="flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-[440px] space-y-5 rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <div className="flex items-center gap-2 lg:hidden"><div className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white"><GraduationCap className="h-5 w-5" /></div><span className="text-lg font-bold">CampusPass</span></div>
          <div><h2 className="text-2xl font-bold">Sign in</h2><p className="mt-1 text-sm text-ink-2">Use the college account issued by your administrator.</p></div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label={isDemo ? 'College ID or email' : 'College email'} htmlFor="login-id">
              <div className="relative"><User className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" /><input id="login-id" className="input pl-9" autoComplete="username" value={id} onChange={(e) => setId(e.target.value)} placeholder={isDemo ? '22CS1042 or riya@demo.campus' : 'name@college.edu'} /></div>
            </Field>
            <Field label="Password" htmlFor="login-pw">
              <div className="relative"><Lock className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-muted" /><input id="login-pw" type="password" className="input pl-9" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
            </Field>
            {err && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-medium text-danger-text">{err}</p>}
            <Button type="submit" full loading={busy}>Sign in</Button>
          </form>
          <Notice tone="neutral" icon={<ShieldCheck className="h-4 w-4" />}>No self-registration and no role selection. Your role is assigned by the administrator.</Notice>
          {isDemo && api.demo && (
            <div className="space-y-2">
              <Notice tone="warn">Demo mode: mock data in this browser, not production-secure. It appears because no Supabase credentials are configured.</Notice>
              <p className="text-xs font-semibold text-ink-2">Try a demo account (password <code className="rounded bg-subtle px-1">{api.demo.password}</code>)</p>
              <div className="grid grid-cols-2 gap-2">
                {api.demo.accounts().map((a) => (
                  <button key={a.email} type="button" disabled={busy} onClick={() => void go(a.email, api.demo!.password)} className="rounded-lg border border-line-strong px-3 py-2 text-left text-xs hover:bg-subtle disabled:opacity-50">
                    <span className="block font-semibold text-ink">{a.label}</span><span className="text-ink-muted">{ROLE_LABEL[a.role]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
