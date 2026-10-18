# CampusPass

Digital campus exit permission for a college: **Student → Program Manager → SWO → Security gate**, with real-time status, single-use QR passes, an audit trail, and an emergency path that never bypasses authorization.

> **Status: MVP for a controlled pilot, after institutional authorization.** Run with Supabase credentials for real use. Without them the app starts in an explicitly labelled **demo mode** (mock data in the browser; *not* production-secure).

## The workflow

```
Student submits ──► PENDING_PROGRAM_MANAGER ──approve──► PENDING_SWO ──approve──► APPROVED_PASS_ISSUED
                         │  ▲                                │  ▲                        │
                  clarify│  │answer                   clarify│  │answer         QR pass  │ gate scans
                         ▼  │                                ▼  │                        ▼
                    NEEDS_CLARIFICATION (clock paused, earlier decisions kept)        movement: EXITED
        reject at either stage ──► REJECTED (workflow stops, student notified)
```

* **Approval status and movement status are separate.** An approved student has not necessarily left.
* **Security records exits only. There is no "return" scan** (a student may not come back).
* **Late arrival = same process.** A student whose exit was recorded and who will arrive *after the expected return time* files a **re-entry request**. It goes Program Manager → SWO exactly like an exit, produces its own single-use **re-entry pass**, and the gate records an **ENTRY**. Without it the gate cannot admit the student.
* **Absence cover (Program Manager ⇄ SWO).** If *every SWO member* is declared absent, a Program Manager may act at the SWO stage; if a student's *own Program Manager* is declared absent, an SWO member may act at the Program Manager stage. It applies to exits **and** late re-entries. It is never automatic: the approver (or an admin) declares an absence with a reason, it lasts at most 14 days, approving as cover needs a written comment, the record is flagged "Absence cover" in the timeline and audit log, and the absent approver and admins are notified. You can never approve your own request. **Trade-off to decide as an institution:** while cover is active, one person can end up giving both approvals on a request. The flag, notifications and audit trail make that visible; if your policy forbids it, change the rule in `stage_unattended()` / `acting_stage()`.
* **Nothing is ever auto-approved.** Missing a response target only notifies: a configured backup approver (under a *documented, enabled* policy), or administrators when no policy exists.
* Emergency *override* is deliberately **not implemented**. If your institution authorizes one, add a separate function that needs a documented policy, an explicit role, and an audit entry.

## Architecture

| Layer | What | Where |
|---|---|---|
| UI | React 18 + Vite + TypeScript + Tailwind, Lucide icons, `qrcode.react` (generate), `html5-qrcode` (scan, lazy-loaded) | `src/` |
| API contract | One `Api` interface the UI codes against | `src/lib/apiTypes.ts` |
| Real backend | Supabase Auth + Postgres + Realtime. The browser only has the **anon key**; every state change is a `SECURITY DEFINER` function | `src/lib/supabaseApi.ts`, `supabase/migrations/` |
| Demo backend | In-memory twin of the same rules, persisted in `localStorage` | `src/lib/demoApi.ts` |
| Privileged work | Creating users needs the service-role key, so it is an Edge Function | `supabase/functions/admin-create-user/` |

**Security model (enforced in the database, not in the UI):**
RLS on every table; clients get `SELECT` only on core tables; all transitions run inside functions that re-check role, ownership and state under a row lock; pass tokens are stored only as SHA-256 hashes and rotate every time the student opens the pass; redemption is atomic (row locks + unique index); approval, movement and audit records are append-only (triggers block UPDATE/DELETE/TRUNCATE); security staff only ever see name, ID, destination and times (never the reason or details); signups are inactive students until an admin activates and assigns them; role is never read from user-supplied metadata. Route guards in the UI are a convenience only.

## Run it

```bash
npm install
npm run dev          # demo mode if no .env.local
npm test             # 30 backend-rule tests + 11 render/smoke tests
npm run build        # type-check + production build
```

Demo accounts (password `demo1234`, shown on the login page): Riya Sharma, Kiran Patel, Meera Iyer, Arjun Nair (students), Dr. Anita Rao and Prof. Vikram Joshi (Program Managers), Rahul Menon (SWO), Gate Security, Admin Office. Kiran is already "late", so you can try the re-entry flow. These are demo-only values that do nothing in Supabase mode.

## Set up Supabase (real mode)

1. Create a Supabase project. **Authentication → Providers → Email:** turn **off "Allow new users to sign up"**.
2. Run `supabase/migrations/0001_campuspass_schema.sql` in the SQL editor (once, on a fresh project).
3. **Authentication → Users → Add user** for yourself, then make yourself the first admin:
   ```sql
   update public.profiles
      set role = 'admin', status = 'ACTIVE', college_id = 'ADMIN001'
    where id = (select id from auth.users where email = 'you@college.edu');
   ```
4. Copy `.env.example` to `.env.local` and fill in the project URL and **anon** key. Never put the service-role key in the frontend or in `.env*` files that are committed.
5. Deploy the user-creation function: `supabase functions deploy admin-create-user`. Then admins can add users from **Users & roles**.
6. Schedule escalation/expiry (enable `pg_cron` in the dashboard):
   ```sql
   select cron.schedule('campuspass-maintenance', '* * * * *', $$select public.process_overdue_and_expired()$$);
   ```
7. In the app, as admin: set pass validity and response targets, then add an **emergency policy** (it must cite the institutional document that authorizes it).

**Demo accounts on a real project:** create users in Auth, then assign roles in SQL with no secrets involved (replace the emails):
```sql
update public.profiles p set status='ACTIVE', role='program_manager', college_id='PM001', department='CSE' from auth.users u where u.id=p.id and u.email='pm@college.edu';
update public.profiles p set status='ACTIVE', role='student', college_id='22CS1001', department='CSE',
  assigned_manager_id=(select id from auth.users where email='pm@college.edu') from auth.users u where u.id=p.id and u.email='student@college.edu';
```

## Deploy to Vercel

Push to GitHub, import the repo in Vercel (framework: Vite), add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, deploy. `vercel.json` provides SPA routing and basic security headers. Camera scanning needs HTTPS (Vercel provides it). Deploy a demo only after the core workflow works against your Supabase project.

## Verification

* `supabase/tests/run.sh`: applies the migration to a throwaway local Postgres and runs 99 scenario checks (self-approval, wrong-stage approval, cross-role access, clarification loop, escalation, pass states, simultaneous redemption, re-entry, absence cover). Last result: **99 pass, 0 fail**; two simultaneous scans of one pass → exactly one succeeds.
* `npm test`: the same rules against the demo backend, plus rendering every role's main screens.
* **Not yet verified:** a run on a live Supabase project, Realtime delivery, and the camera scanner on real phones. Test those in your pilot environment.

## Integrations that still need configuration

* **Email / SMS notifications:** not wired. In-app notifications work; the profile and settings screens say so. Add a provider (e.g. an Edge Function triggered from `notifications`).
* **Disabling a user in Auth:** the database refuses role-gated work for non-ACTIVE accounts immediately, but also ban the user via the Auth admin API to end open sessions.
* **Login by college ID:** real mode signs in with the college **email**. (Demo mode accepts either.)
* **Rate limiting** on pass-code attempts (use Supabase/edge rate limits). Failed checks are audited.
* **Institution-specific policy:** response targets, backup approvers, and any override rules must come from your written policy.

## Project structure

```
src/
  lib/        apiTypes.ts · demoApi.ts · supabaseApi.ts · api.ts · stats.ts · roles.ts · format.ts
  context/    AuthContext · ToastContext
  components/ Layout (collapsible sidebar + mobile nav) · ui · Timeline · DecisionPanel · Scanner · guards
  pages/      Login · StudentDashboard · NewRequest · MyRequests · RequestDetail · Reentry · Pass
              Approvals (+history) · Absence cover · Gate · Admin (overview/users/reports/policies) · Notifications · Profile
supabase/     migrations/ · functions/admin-create-user/ · tests/
```
