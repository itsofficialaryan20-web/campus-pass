-- =====================================================================
-- CampusPass — Supabase / PostgreSQL migration 0001
-- Schema, constraints, Row Level Security, and server-side workflow RPCs
--
-- DESIGN RULES
--  * Clients get SELECT only on core tables. Every state change goes
--    through a SECURITY DEFINER function that re-checks role, ownership,
--    and current state under a row lock. Hidden buttons are not security.
--  * approval_status and movement_status are separate columns.
--  * Security records EXITS only. There is no return scan (a student may not
--    come back). A student arriving after their expected return time must
--    file a RE-ENTRY request that follows the same Program Manager -> SWO
--    approval and gets its own single-use pass, verified at the gate.
--  * ABSENCE COVER: if every SWO member is declared absent, a Program Manager may act at
--    the SWO stage; if a student's own Program Manager is declared absent, an SWO member
--    may act at the Program Manager stage (exits AND re-entries). Cover is explicit,
--    time-boxed (max 14 days), requires a written comment on approval, is flagged on the
--    record, and notifies the absent approver and the admins. It is never automatic.
--  * Raw pass tokens are NEVER stored (only SHA-256 hashes). A student's
--    pass screen calls get_my_pass(), which rotates the token and returns
--    the new one once.
--  * approval_records / movement_logs / audit_logs / clarification_responses
--    are append-only (triggers block UPDATE, DELETE, TRUNCATE).
--  * No timer ever approves anything. Escalation only notifies.
--  * Emergency *override* is intentionally NOT implemented in this MVP.
--    If your institution authorizes one, add it as a separate RPC that
--    requires a documented policy, an explicit role, and an audit entry.
--
-- Run once on a fresh Supabase project (SQL editor or `supabase db push`).
-- =====================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------
create type public.user_role as enum ('student', 'program_manager', 'swo', 'security', 'admin');
create type public.account_status as enum ('PENDING', 'ACTIVE', 'DISABLED');
create type public.request_category as enum ('REGULAR', 'URGENT', 'CRITICAL');
create type public.approval_status as enum (
  'PENDING_PROGRAM_MANAGER', 'PENDING_SWO', 'NEEDS_CLARIFICATION',
  'APPROVED_PASS_ISSUED', 'REJECTED', 'CANCELLED'
);
create type public.approval_stage as enum ('PROGRAM_MANAGER', 'SWO');
create type public.decision_type as enum ('APPROVED', 'REJECTED', 'CLARIFICATION_REQUESTED');
create type public.movement_status as enum ('NONE', 'EXITED', 'ENTERED');
create type public.request_kind as enum ('EXIT', 'REENTRY');
create type public.movement_event as enum ('EXIT', 'ENTRY');
create type public.notification_type as enum (
  'REQUEST_SUBMITTED', 'NEW_REQUEST_FOR_APPROVER',
  'PM_APPROVED', 'PM_REJECTED', 'SWO_APPROVED', 'SWO_REJECTED',
  'CLARIFICATION_REQUESTED', 'CLARIFICATION_ANSWERED',
  'PASS_ISSUED', 'PASS_REVOKED', 'PASS_EXPIRED',
  'URGENT_REQUEST', 'CRITICAL_ALERT', 'ESCALATION', 'NO_POLICY_ALERT',
  'EXIT_RECORDED', 'ENTRY_RECORDED', 'COVER_USED', 'ABSENCE_DECLARED'
);

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text not null check (char_length(full_name) between 1 and 120),
  college_id          text unique check (college_id ~ '^[A-Za-z0-9._-]{3,40}$'),
  role                public.user_role not null default 'student',
  department          text check (char_length(department) <= 80),
  assigned_manager_id uuid references public.profiles (id) on delete set null,
  status              public.account_status not null default 'PENDING',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_no_self_manager check (assigned_manager_id is distinct from id)
);
create index profiles_manager_idx on public.profiles (assigned_manager_id);
create index profiles_role_status_idx on public.profiles (role, status);

-- Single-row configuration (admin only)
create table public.app_settings (
  id                        boolean primary key default true check (id),
  pass_validity_minutes     integer not null default 120 check (pass_validity_minutes between 5 and 1440),
  pass_early_minutes        integer not null default 15  check (pass_early_minutes between 0 and 240),
  regular_response_minutes  integer not null default 240 check (regular_response_minutes > 0),
  urgent_response_minutes   integer not null default 30  check (urgent_response_minutes > 0),
  critical_response_minutes integer not null default 10  check (critical_response_minutes > 0),
  email_enabled             boolean not null default false,  -- delivery NOT wired up; in-app always works
  sms_enabled               boolean not null default false,  -- delivery NOT wired up
  updated_at                timestamptz not null default now()
);
insert into public.app_settings default values;

-- Escalation rules. Only a documented, explicitly enabled policy ever
-- causes a backup approver to be notified.
create table public.emergency_policies (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null check (char_length(name) between 1 and 120),
  category                  public.request_category not null check (category in ('URGENT', 'CRITICAL')),
  stage                     public.approval_stage,               -- null = applies to both stages
  response_deadline_minutes integer not null check (response_deadline_minutes > 0),
  backup_approver_id        uuid references public.profiles (id) on delete restrict,
  alert_roles               public.user_role[] not null default '{}',
  policy_reference          text not null check (char_length(trim(policy_reference)) > 0), -- the documented institutional policy
  enabled                   boolean not null default false,
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index emergency_policy_one_enabled_per_stage
  on public.emergency_policies (category, stage) where enabled and stage is not null;
create unique index emergency_policy_one_enabled_all_stages
  on public.emergency_policies (category) where enabled and stage is null;

-- Declared absences (the only way another approver role may cover a stage)
create table public.approver_absences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete restrict,
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  reason      text not null check (char_length(trim(reason)) between 3 and 300),  -- visible only to the user and admins
  declared_by uuid not null references public.profiles (id) on delete restrict,
  ended_at    timestamptz,                                                         -- set when ended early
  created_at  timestamptz not null default now(),
  constraint absence_window check (ends_at > starts_at and ends_at <= starts_at + interval '14 days' + interval '1 minute')
);
create unique index absence_one_active_per_user on public.approver_absences (user_id) where ended_at is null;
create index absences_user_idx on public.approver_absences (user_id, ends_at desc);

create sequence public.exit_request_seq;
create function public.next_request_code() returns text
language sql volatile set search_path = '' as $$
  select 'CP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.exit_request_seq')::text, 6, '0')
$$;

create table public.exit_requests (
  id                  uuid primary key default gen_random_uuid(),
  request_code        text not null unique default public.next_request_code(),
  student_id          uuid not null references public.profiles (id) on delete restrict,
  kind                public.request_kind not null default 'EXIT',
  related_request_id  uuid references public.exit_requests (id) on delete restrict, -- the exit a RE-ENTRY follows
  category            public.request_category not null default 'REGULAR',
  reason              text not null check (char_length(trim(reason)) between 3 and 1000),
  destination         text not null check (char_length(trim(destination)) between 2 and 200),
  details             text check (char_length(details) <= 2000),
  departure_time      timestamptz not null,   -- intended time of the movement: departure (EXIT) or arrival (REENTRY)
  expected_return     timestamptz,            -- EXIT only
  approval_status     public.approval_status not null default 'PENDING_PROGRAM_MANAGER',
  clarification_stage public.approval_stage,
  movement_status     public.movement_status not null default 'NONE',
  stage_entered_at    timestamptz not null default now(),
  stage_due_at        timestamptz,
  escalated_at        timestamptz,
  last_alert_at       timestamptz,
  pm_approved_at      timestamptz,
  approved_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint exit_return_after_departure check (expected_return is null or expected_return > departure_time),
  constraint exit_kind_fields check (
    (kind = 'EXIT' and expected_return is not null and related_request_id is null)
    or (kind = 'REENTRY' and related_request_id is not null)),
  constraint exit_clarification_consistent
    check ((approval_status = 'NEEDS_CLARIFICATION') = (clarification_stage is not null)),
  constraint exit_movement_requires_approval
    check (movement_status = 'NONE' or approval_status = 'APPROVED_PASS_ISSUED')
);
create unique index reentry_one_open_per_exit on public.exit_requests (related_request_id)
  where kind = 'REENTRY' and approval_status not in ('REJECTED', 'CANCELLED');
create index exit_requests_student_idx on public.exit_requests (student_id, created_at desc);
create index exit_requests_status_idx on public.exit_requests (approval_status, stage_due_at);
create index exit_requests_pm_approved_idx on public.exit_requests (pm_approved_at) where pm_approved_at is not null;

create table public.approval_records (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.exit_requests (id) on delete restrict,
  stage            public.approval_stage not null,
  approver_id      uuid not null references public.profiles (id) on delete restrict,
  decision         public.decision_type not null,
  comments         text check (char_length(comments) <= 1000),
  stage_entered_at timestamptz not null,       -- lets reports measure per-stage delay
  decided_at       timestamptz not null default now(),
  acted_as_backup  boolean not null default false,
  acted_as_cover   boolean not null default false,   -- decided in place of an absent approver
  constraint clarification_needs_comment
    check (decision <> 'CLARIFICATION_REQUESTED' or char_length(trim(coalesce(comments, ''))) > 0)
);
-- At most one final decision per stage per request (blocks duplicate approvals)
create unique index approval_one_final_decision
  on public.approval_records (request_id, stage) where decision in ('APPROVED', 'REJECTED');
create index approval_records_request_idx on public.approval_records (request_id, decided_at);
create index approval_records_approver_idx on public.approval_records (approver_id, decided_at desc);

create table public.clarification_responses (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.exit_requests (id) on delete restrict,
  student_id uuid not null references public.profiles (id) on delete restrict,
  stage      public.approval_stage not null,
  message    text not null check (char_length(trim(message)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index clarification_responses_request_idx on public.clarification_responses (request_id, created_at);

create table public.exit_passes (
  id                uuid primary key default gen_random_uuid(),
  request_id        uuid not null unique references public.exit_requests (id) on delete restrict,
  token_hash        bytea not null unique,        -- sha256 of QR token; raw token never stored
  short_code_hash   bytea not null unique,        -- sha256 of manual-entry code
  valid_from        timestamptz not null,
  valid_until       timestamptz not null,
  revoked_at        timestamptz,
  revoked_by        uuid references public.profiles (id) on delete restrict,
  revoke_reason     text check (char_length(revoke_reason) <= 500),
  used_at           timestamptz,                  -- set atomically when exit is recorded
  expiry_notified_at timestamptz,
  token_rotated_at  timestamptz,
  created_at        timestamptz not null default now(),
  constraint pass_valid_window check (valid_until > valid_from)
);

create table public.movement_logs (
  id               uuid primary key default gen_random_uuid(),
  request_id       uuid not null references public.exit_requests (id) on delete restrict,
  pass_id          uuid references public.exit_passes (id) on delete restrict,
  security_user_id uuid not null references public.profiles (id) on delete restrict,
  event_type       public.movement_event not null,
  event_at         timestamptz not null default clock_timestamp()
);
-- Belt and braces on top of row locking: one EXIT and one ENTRY event per request, ever.
create unique index movement_one_event_per_type on public.movement_logs (request_id, event_type);
create index movement_logs_event_at_idx on public.movement_logs (event_at desc);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  type         public.notification_type not null,
  title        text not null,
  body         text,
  request_id   uuid references public.exit_requests (id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);

create table public.notification_preferences (
  user_id        uuid primary key references public.profiles (id) on delete cascade,
  email_opt_in   boolean not null default false,
  sms_opt_in     boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table public.audit_logs (
  id           bigint generated always as identity primary key,
  actor_id     uuid,                       -- deliberately no FK: audit rows must outlive anything
  action       text not null,
  target_table text,
  target_id    text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index audit_logs_target_idx on public.audit_logs (target_table, target_id);

-- ---------------------------------------------------------------------
-- 3. Generic triggers: updated_at, append-only protection
-- ---------------------------------------------------------------------
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger trg_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger trg_touch before update on public.exit_requests
  for each row execute function public.touch_updated_at();
create trigger trg_touch before update on public.emergency_policies
  for each row execute function public.touch_updated_at();
create trigger trg_touch before update on public.app_settings
  for each row execute function public.touch_updated_at();
create trigger trg_touch before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

create function public.forbid_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% on % is not allowed: this table is append-only', tg_op, tg_table_name
    using errcode = '42501';
end $$;

create trigger trg_append_only before update or delete on public.approval_records
  for each row execute function public.forbid_mutation();
create trigger trg_append_only_trunc before truncate on public.approval_records
  for each statement execute function public.forbid_mutation();
create trigger trg_append_only before update or delete on public.movement_logs
  for each row execute function public.forbid_mutation();
create trigger trg_append_only_trunc before truncate on public.movement_logs
  for each statement execute function public.forbid_mutation();
create trigger trg_append_only before update or delete on public.audit_logs
  for each row execute function public.forbid_mutation();
create trigger trg_append_only_trunc before truncate on public.audit_logs
  for each statement execute function public.forbid_mutation();
create trigger trg_append_only before update or delete on public.clarification_responses
  for each row execute function public.forbid_mutation();
create trigger trg_append_only_trunc before truncate on public.clarification_responses
  for each statement execute function public.forbid_mutation();

-- ---------------------------------------------------------------------
-- 4. New-user hook: every signup becomes an inactive STUDENT profile.
--    Role and status are NEVER read from user-supplied metadata.
-- ---------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                  'New user'), 120)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 5. Authorization helpers (SECURITY DEFINER so RLS policies can use
--    them without recursing into profiles' own policies)
-- ---------------------------------------------------------------------
create function public.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.status = 'ACTIVE'
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create function public.is_manager_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_user_role() = 'program_manager'
     and exists (select 1 from public.profiles s
                 where s.id = p_student and s.assigned_manager_id = (select auth.uid()))
$$;

-- Visibility only: an active backup approver may *see* an escalated request.
create function public.is_backup_for(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.current_user_role() = 'program_manager'
     and exists (
       select 1
       from public.exit_requests r
       join public.emergency_policies p
         on p.enabled
        and p.backup_approver_id = (select auth.uid())
        and p.category = r.category
        and (p.stage is null or p.stage = 'PROGRAM_MANAGER')
       where r.id = p_request and r.escalated_at is not null)
$$;

-- Lets an approver (e.g. a backup manager) keep seeing requests they decided.
create function public.has_decided_on(p_request uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.approval_records a
                 where a.request_id = p_request and a.approver_id = (select auth.uid()))
$$;

create function public.stage_of(p_status public.approval_status) returns public.approval_stage
language sql immutable set search_path = '' as $$
  select case p_status
    when 'PENDING_PROGRAM_MANAGER' then 'PROGRAM_MANAGER'::public.approval_stage
    when 'PENDING_SWO'             then 'SWO'::public.approval_stage
  end
$$;

create function public.is_absent(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.approver_absences a
                 where a.user_id = p_user and a.ended_at is null and a.starts_at <= now() and a.ends_at > now())
$$;

-- SWO stage: every active SWO member is absent. Program Manager stage: the student's own manager is absent.
create function public.stage_unattended(p_stage public.approval_stage, p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_stage
    when 'SWO' then
      exists (select 1 from public.profiles p where p.role = 'swo' and p.status = 'ACTIVE')
      and not exists (select 1 from public.profiles p
                      where p.role = 'swo' and p.status = 'ACTIVE' and not public.is_absent(p.id))
    else coalesce((select public.is_absent(s.assigned_manager_id) from public.profiles s
                   where s.id = p_student and s.assigned_manager_id is not null), false)
  end
$$;

-- The stage the CURRENT caller may act on for this request right now, or NULL.
create function public.acting_stage(p_request_id uuid) returns public.approval_stage
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role := public.current_user_role();
  r       public.exit_requests;
  v_stage public.approval_stage;
begin
  if v_uid is null or v_role is null then return null; end if;
  select * into r from public.exit_requests where id = p_request_id;
  if not found then return null; end if;
  v_stage := public.stage_of(r.approval_status);
  if v_stage is null then return null; end if;
  if r.student_id = v_uid then return null; end if;          -- never your own request

  if v_stage = 'PROGRAM_MANAGER' and v_role = 'program_manager' then
    if exists (select 1 from public.profiles s
               where s.id = r.student_id and s.assigned_manager_id = v_uid) then
      return v_stage;
    end if;
    -- Backup manager: only after escalation under an enabled, documented policy
    if r.escalated_at is not null and exists (
         select 1 from public.emergency_policies p
         where p.enabled and p.backup_approver_id = v_uid and p.category = r.category
           and (p.stage is null or p.stage = 'PROGRAM_MANAGER')) then
      return v_stage;
    end if;
  elsif v_stage = 'SWO' and v_role = 'swo' then
    return v_stage;
  end if;

  -- Absence cover (explicitly declared, time-boxed; see declare_absence)
  if v_stage = 'SWO' and v_role = 'program_manager' and public.stage_unattended('SWO', null) then
    return v_stage;
  end if;
  if v_stage = 'PROGRAM_MANAGER' and v_role = 'swo' and public.stage_unattended('PROGRAM_MANAGER', r.student_id) then
    return v_stage;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 6. Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------
create function public.write_audit(p_action text, p_table text, p_target text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, target_table, target_id, metadata)
  values ((select auth.uid()), p_action, p_table, p_target, coalesce(p_meta, '{}'::jsonb))
$$;

create function public.notify(p_recipient uuid, p_type public.notification_type,
                              p_title text, p_body text, p_request uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, body, request_id)
  values (p_recipient, p_type, p_title, p_body, p_request)
$$;

create function public.compute_due_at(p_category public.request_category,
                                      p_stage public.approval_stage,
                                      p_from timestamptz)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select p_from + make_interval(mins => coalesce(
    (select ep.response_deadline_minutes from public.emergency_policies ep
      where ep.enabled and ep.category = p_category and ep.stage = p_stage limit 1),
    (select ep.response_deadline_minutes from public.emergency_policies ep
      where ep.enabled and ep.category = p_category and ep.stage is null limit 1),
    (select case p_category
              when 'REGULAR' then s.regular_response_minutes
              when 'URGENT'  then s.urgent_response_minutes
              else s.critical_response_minutes end
       from public.app_settings s)))
$$;

create function public.pass_state(p_pass public.exit_passes, p_req public.exit_requests)
returns text language sql security definer set search_path = '' as $$
  select case
    when p_pass.revoked_at is not null                   then 'REVOKED'
    when p_req.approval_status <> 'APPROVED_PASS_ISSUED' then 'REVOKED'
    when p_req.movement_status <> 'NONE'                 then 'ALREADY_USED'
    when clock_timestamp() > p_pass.valid_until          then 'EXPIRED'
    when clock_timestamp() < p_pass.valid_from           then 'NOT_YET_VALID'
    else 'VALID'
  end
$$;

-- Accepts the QR payload ("CP1.<token>") or the manual short code.
create function public.find_pass(p_credential text) returns public.exit_passes
language plpgsql stable security definer set search_path = '' as $$
declare
  v_clean text := trim(coalesce(p_credential, ''));
  v_pass  public.exit_passes;
begin
  if v_clean ilike 'CP1.%' then v_clean := substr(v_clean, 5); end if;
  if v_clean = '' or char_length(v_clean) > 200 then return v_pass; end if;

  select * into v_pass from public.exit_passes
   where token_hash = extensions.digest(v_clean, 'sha256');
  if not found then
    select * into v_pass from public.exit_passes
     where short_code_hash = extensions.digest(upper(regexp_replace(v_clean, '[^A-Za-z0-9]', '', 'g')), 'sha256');
  end if;
  return v_pass;                     -- all-null row when nothing matched
end $$;

-- Creates the pass at final approval. Stores only hashes of throwaway random
-- values; the student obtains a displayable token via get_my_pass().
create function public.issue_pass(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.exit_requests;
  s public.app_settings;
begin
  select * into r from public.exit_requests where id = p_request_id;
  select * into s from public.app_settings;
  insert into public.exit_passes (request_id, token_hash, short_code_hash, valid_from, valid_until)
  values (
    p_request_id,
    extensions.digest(extensions.gen_random_bytes(32), 'sha256'),
    extensions.digest(extensions.gen_random_bytes(16), 'sha256'),
    r.departure_time - make_interval(mins => s.pass_early_minutes),
    greatest(r.departure_time, now()) + make_interval(mins => s.pass_validity_minutes)
  );
end $$;

-- ---------------------------------------------------------------------
-- 7. Student RPCs
-- ---------------------------------------------------------------------
create function public.announce_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r      public.exit_requests;
  v_me   public.profiles;
  v_what text;
begin
  select * into r from public.exit_requests where id = p_request_id;
  select * into v_me from public.profiles where id = r.student_id;
  v_what := case r.kind when 'REENTRY' then 're-entry' else 'exit' end;

  perform public.notify(r.student_id, 'REQUEST_SUBMITTED',
    'Request ' || r.request_code || ' submitted', 'Waiting for your Program Manager.', r.id);
  perform public.notify(v_me.assigned_manager_id, 'NEW_REQUEST_FOR_APPROVER',
    case r.category when 'REGULAR' then 'New ' || v_what || ' request'
                    else r.category || ' ' || v_what || ' request' end,
    v_me.full_name || ' (' || r.request_code || ').', r.id);

  if r.category <> 'REGULAR' then
    insert into public.notifications (recipient_id, type, title, body, request_id)
    select distinct pr.id,
           (case r.category when 'CRITICAL' then 'CRITICAL_ALERT' else 'URGENT_REQUEST' end)::public.notification_type,
           r.category || ' ' || v_what || ' request ' || r.request_code,
           v_me.full_name || ' — ' || r.destination, r.id
    from public.emergency_policies ep
    join public.profiles pr on pr.role = any (ep.alert_roles) and pr.status = 'ACTIVE'
    where ep.enabled and ep.category = r.category and pr.id <> r.student_id;

    if r.category = 'CRITICAL' and not exists (
         select 1 from public.emergency_policies ep where ep.enabled and ep.category = 'CRITICAL') then
      insert into public.notifications (recipient_id, type, title, body, request_id)
      select pr.id, 'NO_POLICY_ALERT',
             'Critical request with no emergency policy configured',
             r.request_code || ' is pending the normal approval path. Configure an emergency policy.', r.id
      from public.profiles pr where pr.role = 'admin' and pr.status = 'ACTIVE';
    end if;
  end if;
end $$;

create function public.submit_exit_request(
  p_category        public.request_category,
  p_reason          text,
  p_destination     text,
  p_departure       timestamptz,
  p_expected_return timestamptz,
  p_details         text default null
) returns public.exit_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid  uuid := auth.uid();
  v_me   public.profiles;
  r      public.exit_requests;
begin
  if v_uid is null or public.current_user_role() is distinct from 'student' then
    raise exception 'Only active students can submit exit requests' using errcode = '42501';
  end if;
  select * into v_me from public.profiles where id = v_uid;

  if v_me.assigned_manager_id is null or not exists (
       select 1 from public.profiles m
       where m.id = v_me.assigned_manager_id and m.role = 'program_manager' and m.status = 'ACTIVE') then
    raise exception 'No active Program Manager is assigned to your account. Contact the administrator.'
      using errcode = 'P0001';
  end if;
  if p_departure < now() - interval '10 minutes' then
    raise exception 'Departure time cannot be in the past' using errcode = '22023';
  end if;
  if p_expected_return <= p_departure then
    raise exception 'Expected return must be after departure' using errcode = '22023';
  end if;
  if (select count(*) from public.exit_requests e
       where e.student_id = v_uid
         and e.approval_status in ('PENDING_PROGRAM_MANAGER', 'PENDING_SWO', 'NEEDS_CLARIFICATION')) >= 3 then
    raise exception 'You already have 3 open requests. Wait for a decision or cancel one.' using errcode = 'P0001';
  end if;

  insert into public.exit_requests (student_id, category, reason, destination, details,
                                    departure_time, expected_return, stage_due_at)
  values (v_uid, p_category, trim(p_reason), trim(p_destination), nullif(trim(coalesce(p_details, '')), ''),
          p_departure, p_expected_return,
          public.compute_due_at(p_category, 'PROGRAM_MANAGER', now()))
  returning * into r;

  perform public.announce_request(r.id);
  perform public.write_audit('request.submitted', 'exit_requests', r.id::text,
    jsonb_build_object('kind', 'EXIT', 'category', r.category, 'request_code', r.request_code));
  return r;
end $$;

-- A student who is OUTSIDE (exit recorded) and will arrive after the original
-- expected return time must be approved again, through the same two stages.
create function public.submit_reentry_request(
  p_exit_request_id uuid,
  p_category        public.request_category,
  p_reason          text,
  p_arrival         timestamptz
) returns public.exit_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_me  public.profiles;
  x     public.exit_requests;
  r     public.exit_requests;
begin
  if v_uid is null or public.current_user_role() is distinct from 'student' then
    raise exception 'Only active students can request re-entry' using errcode = '42501';
  end if;
  select * into x from public.exit_requests
   where id = p_exit_request_id and student_id = v_uid and kind = 'EXIT' for update;
  if not found or x.movement_status <> 'EXITED' then
    raise exception 'Re-entry can only be requested for an exit that was recorded at the gate'
      using errcode = 'P0001';
  end if;
  if p_arrival <= x.expected_return then
    raise exception 'Re-entry approval is only needed when arriving after your expected return time'
      using errcode = '22023';
  end if;
  if p_arrival < now() - interval '10 minutes' then
    raise exception 'Arrival time cannot be in the past' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please explain why you will be late' using errcode = '22023';
  end if;
  select * into v_me from public.profiles where id = v_uid;
  if v_me.assigned_manager_id is null or not exists (
       select 1 from public.profiles m
       where m.id = v_me.assigned_manager_id and m.role = 'program_manager' and m.status = 'ACTIVE') then
    raise exception 'No active Program Manager is assigned to your account. Contact the administrator.'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from public.exit_requests e
              where e.related_request_id = x.id and e.kind = 'REENTRY'
                and e.approval_status not in ('REJECTED', 'CANCELLED')) then
    raise exception 'A re-entry request already exists for this exit' using errcode = 'P0001';
  end if;

  insert into public.exit_requests (student_id, kind, related_request_id, category, reason, destination,
                                    departure_time, stage_due_at)
  values (v_uid, 'REENTRY', x.id, p_category, trim(p_reason), 'Campus re-entry', p_arrival,
          public.compute_due_at(p_category, 'PROGRAM_MANAGER', now()))
  returning * into r;

  perform public.announce_request(r.id);
  perform public.write_audit('request.submitted', 'exit_requests', r.id::text,
    jsonb_build_object('kind', 'REENTRY', 'category', r.category, 'request_code', r.request_code,
                       'related_request', x.id));
  return r;
end $$;

create function public.respond_to_clarification(p_request_id uuid, p_message text)
returns public.exit_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r     public.exit_requests;
  v_stage public.approval_stage;
  v_msg text := nullif(trim(coalesce(p_message, '')), '');
begin
  if v_msg is null or char_length(v_msg) > 1000 then
    raise exception 'Provide a response of 1–1000 characters' using errcode = '22023';
  end if;
  select * into r from public.exit_requests
   where id = p_request_id and student_id = v_uid for update;
  if not found or public.current_user_role() is distinct from 'student'
     or r.approval_status <> 'NEEDS_CLARIFICATION' then
    raise exception 'Request not found or not awaiting clarification' using errcode = '42501';
  end if;
  v_stage := r.clarification_stage;

  insert into public.clarification_responses (request_id, student_id, stage, message)
  values (r.id, v_uid, v_stage, v_msg);

  update public.exit_requests
     set approval_status = case v_stage when 'PROGRAM_MANAGER' then 'PENDING_PROGRAM_MANAGER'::public.approval_status
                                        else 'PENDING_SWO'::public.approval_status end,
         clarification_stage = null,
         stage_entered_at = now(),
         stage_due_at = public.compute_due_at(r.category, v_stage, now()),
         escalated_at = null, last_alert_at = null
   where id = r.id returning * into r;

  if v_stage = 'PROGRAM_MANAGER' then
    perform public.notify(m.id, 'CLARIFICATION_ANSWERED', 'Clarification received',
      r.request_code || ' has a new response from the student.', r.id)
    from public.profiles s join public.profiles m on m.id = s.assigned_manager_id
    where s.id = r.student_id and m.status = 'ACTIVE';
  else
    perform public.notify(p.id, 'CLARIFICATION_ANSWERED', 'Clarification received',
      r.request_code || ' has a new response from the student.', r.id)
    from public.profiles p where p.role = 'swo' and p.status = 'ACTIVE';
  end if;

  perform public.write_audit('request.clarification_answered', 'exit_requests', r.id::text,
    jsonb_build_object('stage', v_stage));
  return r;
end $$;

create function public.cancel_request(p_request_id uuid) returns public.exit_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r     public.exit_requests;
begin
  select * into r from public.exit_requests
   where id = p_request_id and student_id = v_uid for update;
  if not found or public.current_user_role() is distinct from 'student' then
    raise exception 'Request not found' using errcode = '42501';
  end if;
  if r.approval_status not in ('PENDING_PROGRAM_MANAGER', 'PENDING_SWO', 'NEEDS_CLARIFICATION', 'APPROVED_PASS_ISSUED')
     or r.movement_status <> 'NONE' then
    raise exception 'This request can no longer be cancelled' using errcode = 'P0001';
  end if;

  update public.exit_requests
     set approval_status = 'CANCELLED', clarification_stage = null, stage_due_at = null
   where id = r.id returning * into r;
  update public.exit_passes
     set revoked_at = now(), revoked_by = v_uid, revoke_reason = 'Cancelled by student'
   where request_id = r.id and revoked_at is null;

  perform public.write_audit('request.cancelled', 'exit_requests', r.id::text, '{}'::jsonb);
  return r;
end $$;

-- Rotates the pass token and returns it ONCE. Previous QR codes stop working.
create function public.get_my_pass(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_pass  public.exit_passes;
  r       public.exit_requests;
  v_state text;
  v_token text;
  v_code  text := '';
  v_bytes bytea;
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- 32 chars, no I/O/0/1
begin
  select * into r from public.exit_requests where id = p_request_id and student_id = v_uid;
  if not found or public.current_user_role() is distinct from 'student' then
    raise exception 'Pass not found' using errcode = '42501';
  end if;
  select * into v_pass from public.exit_passes where request_id = r.id for update;
  if not found then raise exception 'No pass has been issued for this request' using errcode = 'P0001'; end if;

  v_state := public.pass_state(v_pass, r);
  if v_state not in ('VALID', 'NOT_YET_VALID') then
    return jsonb_build_object('pass_id', v_pass.id, 'state', v_state,
                              'valid_from', v_pass.valid_from, 'valid_until', v_pass.valid_until);
  end if;

  v_token := translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/=', '-_');
  v_bytes := extensions.gen_random_bytes(10);
  for i in 0..9 loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;

  update public.exit_passes
     set token_hash = extensions.digest(v_token, 'sha256'),
         short_code_hash = extensions.digest(v_code, 'sha256'),
         token_rotated_at = now()
   where id = v_pass.id;

  return jsonb_build_object(
    'pass_id', v_pass.id, 'state', v_state,
    'qr_payload', 'CP1.' || v_token,
    'short_code', substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5),
    'valid_from', v_pass.valid_from, 'valid_until', v_pass.valid_until);
end $$;

-- ---------------------------------------------------------------------
-- 8. Approver RPC (Program Manager, SWO, authorized backup)
-- ---------------------------------------------------------------------
create function public.decide_request(
  p_request_id uuid,
  p_decision   public.decision_type,
  p_comment    text default null
) returns public.exit_requests
language plpgsql security definer set search_path = '' as $$
declare
  v_uid     uuid := auth.uid();
  r         public.exit_requests;
  v_stage   public.approval_stage;
  v_backup  boolean;
  v_cover   boolean;
  v_role    public.user_role := public.current_user_role();
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_name    text;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if v_comment is not null and char_length(v_comment) > 1000 then
    raise exception 'Comment is too long (max 1000 characters)' using errcode = '22001';
  end if;

  select * into r from public.exit_requests where id = p_request_id for update;
  v_stage := case when found then public.acting_stage(p_request_id) end;
  if v_stage is null then
    raise exception 'Request not found, or you are not authorized to act on it at its current stage'
      using errcode = '42501';
  end if;
  if p_decision = 'CLARIFICATION_REQUESTED' and v_comment is null then
    raise exception 'A comment is required when requesting clarification' using errcode = '22023';
  end if;

  v_backup := v_stage = 'PROGRAM_MANAGER' and v_role = 'program_manager' and not exists (
    select 1 from public.profiles s where s.id = r.student_id and s.assigned_manager_id = v_uid);
  v_cover := (v_stage = 'SWO' and v_role <> 'swo') or (v_stage = 'PROGRAM_MANAGER' and v_role = 'swo');
  if v_cover and p_decision = 'APPROVED' and v_comment is null then
    raise exception 'A comment is required when approving in place of an absent approver' using errcode = '22023';
  end if;
  select full_name into v_name from public.profiles where id = r.student_id;

  insert into public.approval_records (request_id, stage, approver_id, decision, comments,
                                       stage_entered_at, acted_as_backup, acted_as_cover)
  values (r.id, v_stage, v_uid, p_decision, v_comment, r.stage_entered_at, v_backup, v_cover);

  if p_decision = 'REJECTED' then
    update public.exit_requests
       set approval_status = 'REJECTED', clarification_stage = null, stage_due_at = null
     where id = r.id returning * into r;
    perform public.notify(r.student_id,
      (case v_stage when 'PROGRAM_MANAGER' then 'PM_REJECTED' else 'SWO_REJECTED' end)::public.notification_type,
      'Request ' || r.request_code || ' was rejected',
      coalesce(v_comment, 'No comment provided.'), r.id);

  elsif p_decision = 'CLARIFICATION_REQUESTED' then
    update public.exit_requests
       set approval_status = 'NEEDS_CLARIFICATION', clarification_stage = v_stage, stage_due_at = null
     where id = r.id returning * into r;
    perform public.notify(r.student_id, 'CLARIFICATION_REQUESTED',
      'More information needed for ' || r.request_code, v_comment, r.id);

  elsif v_stage = 'PROGRAM_MANAGER' then            -- approved by Program Manager
    update public.exit_requests
       set approval_status = 'PENDING_SWO', pm_approved_at = now(), stage_entered_at = now(),
           stage_due_at = public.compute_due_at(r.category, 'SWO', now()),
           escalated_at = null, last_alert_at = null
     where id = r.id returning * into r;
    perform public.notify(r.student_id, 'PM_APPROVED',
      'Program Manager approved ' || r.request_code, 'Now waiting for SWO.', r.id);
    perform public.notify(p.id, 'NEW_REQUEST_FOR_APPROVER',
      case r.category when 'REGULAR' then 'Request ready for SWO review' else r.category || ' request ready for SWO' end,
      v_name || ' — ' || r.request_code, r.id)
    from public.profiles p where p.role = 'swo' and p.status = 'ACTIVE';

  else                                              -- approved by SWO => final
    update public.exit_requests
       set approval_status = 'APPROVED_PASS_ISSUED', approved_at = now(), stage_due_at = null,
           escalated_at = null
     where id = r.id returning * into r;
    perform public.issue_pass(r.id);
    perform public.notify(r.student_id, 'SWO_APPROVED', 'SWO approved ' || r.request_code, null, r.id);
    perform public.notify(r.student_id, 'PASS_ISSUED',
      case r.kind when 'REENTRY' then 'Your re-entry pass is ready' else 'Your exit pass is ready' end,
      'Open the request to show your QR pass at the gate.', r.id);
  end if;

  if v_cover then      -- tell the absent approver(s) and the admins that their stage was covered
    insert into public.notifications (recipient_id, type, title, body, request_id)
    select distinct x.id, 'COVER_USED'::public.notification_type, 'Your approval stage was covered during your absence',
           r.request_code || ': ' || lower(p_decision::text) || ' by ' || (select full_name from public.profiles where id = v_uid) || '.', r.id
    from public.profiles x
    where x.status = 'ACTIVE' and x.id <> v_uid and (
          (v_stage = 'SWO' and x.role = 'swo')
       or (v_stage = 'PROGRAM_MANAGER' and x.id = (select s.assigned_manager_id from public.profiles s where s.id = r.student_id))
       or x.role = 'admin');
  end if;

  perform public.write_audit('request.' || lower(p_decision::text), 'exit_requests', r.id::text,
    jsonb_build_object('stage', v_stage, 'acted_as_backup', v_backup, 'acted_as_cover', v_cover, 'has_comment', v_comment is not null));
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 9. Security-gate RPCs
-- ---------------------------------------------------------------------
-- Read-only check. Returns the minimum a guard needs; never the reason/details.
create function public.verify_pass(p_credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.user_role := public.current_user_role();
  v_pass public.exit_passes;
  r      public.exit_requests;
  s      public.profiles;
  x      public.exit_requests;
begin
  if v_role is null or v_role not in ('security', 'admin') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  v_pass := public.find_pass(p_credential);
  if v_pass.id is null then
    perform public.write_audit('pass.verify_failed', 'exit_passes', null, '{}'::jsonb);
    return jsonb_build_object('state', 'INVALID');
  end if;
  select * into r from public.exit_requests where id = v_pass.request_id;
  select * into s from public.profiles where id = r.student_id;
  if r.related_request_id is not null then
    select * into x from public.exit_requests where id = r.related_request_id;
  end if;
  return jsonb_build_object(
    'state', public.pass_state(v_pass, r),
    'kind', r.kind,
    'pass_id', v_pass.id,
    'request_code', r.request_code,
    'movement_status', r.movement_status,
    'valid_from', v_pass.valid_from,
    'valid_until', v_pass.valid_until,
    'student', jsonb_build_object('name', s.full_name, 'college_id', s.college_id, 'department', s.department),
    'exit', jsonb_build_object('destination', r.destination, 'category', r.category,
                               'departure_time', r.departure_time, 'expected_return', r.expected_return,
                               'original_expected_return', x.expected_return));
end $$;

-- Atomic redemption. Request row is locked first, then the pass row (same
-- order as cancel_request), so two simultaneous scans serialize and only
-- one can see state = VALID.
create function public.record_movement(p_credential text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_pass  public.exit_passes;
  r       public.exit_requests;
  v_state text;
  v_event public.movement_event;
  v_at    timestamptz := clock_timestamp();
begin
  if public.current_user_role() is distinct from 'security' then
    raise exception 'Only security staff can record movement' using errcode = '42501';
  end if;
  v_pass := public.find_pass(p_credential);
  if v_pass.id is null then
    perform public.write_audit('pass.redeem_failed', 'exit_passes', null, jsonb_build_object('reason', 'INVALID'));
    return jsonb_build_object('ok', false, 'state', 'INVALID');
  end if;

  select * into r from public.exit_requests where id = v_pass.request_id for update;
  select * into v_pass from public.exit_passes where id = v_pass.id for update;
  v_state := public.pass_state(v_pass, r);
  v_event := case r.kind when 'REENTRY' then 'ENTRY'::public.movement_event else 'EXIT'::public.movement_event end;

  if v_state <> 'VALID' then
    perform public.write_audit('pass.redeem_failed', 'exit_requests', r.id::text,
      jsonb_build_object('state', v_state, 'event', v_event));
    return jsonb_build_object('ok', false, 'state', v_state, 'kind', r.kind);
  end if;

  update public.exit_passes set used_at = v_at where id = v_pass.id;
  update public.exit_requests
     set movement_status = case r.kind when 'REENTRY' then 'ENTERED'::public.movement_status
                                       else 'EXITED'::public.movement_status end
   where id = r.id;
  if r.kind = 'REENTRY' then   -- the student is back on campus: close out the original exit too
    update public.exit_requests set movement_status = 'ENTERED' where id = r.related_request_id;
  end if;

  insert into public.movement_logs (request_id, pass_id, security_user_id, event_type, event_at)
  values (r.id, v_pass.id, v_uid, v_event, v_at);

  perform public.notify(r.student_id,
    (case v_event when 'EXIT' then 'EXIT_RECORDED' else 'ENTRY_RECORDED' end)::public.notification_type,
    case v_event when 'EXIT' then 'Exit recorded at the gate' else 'Re-entry recorded at the gate' end,
    r.request_code, r.id);
  perform public.write_audit('movement.' || lower(v_event::text), 'exit_requests', r.id::text, '{}'::jsonb);

  return jsonb_build_object('ok', true, 'kind', r.kind, 'event', v_event, 'event_at', v_at,
    'state', case v_event when 'EXIT' then 'EXITED' else 'ENTERED' end);
end $$;

-- Gate dashboard feed: names + times only.
create function public.list_recent_movements(p_limit integer default 25)
returns table (event_at timestamptz, event_type public.movement_event, request_code text,
               student_name text, college_id text)
language sql stable security definer set search_path = '' as $$
  select m.event_at, m.event_type, r.request_code, s.full_name, s.college_id
  from public.movement_logs m
  join public.exit_requests r on r.id = m.request_id
  join public.profiles s on s.id = r.student_id
  where public.current_user_role() in ('security', 'admin')
  order by m.event_at desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;

-- ---------------------------------------------------------------------
-- 10. Pass revocation + admin RPCs
-- ---------------------------------------------------------------------
create function public.revoke_pass(p_request_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  r     public.exit_requests;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if public.current_user_role() not in ('admin', 'swo') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if v_reason is null then raise exception 'A reason is required' using errcode = '22023'; end if;
  select * into r from public.exit_requests where id = p_request_id for update;
  if not found then raise exception 'Request not found' using errcode = 'P0002'; end if;
  if r.movement_status <> 'NONE' then
    raise exception 'The student has already used this pass' using errcode = 'P0001';
  end if;
  update public.exit_passes
     set revoked_at = now(), revoked_by = v_uid, revoke_reason = left(v_reason, 500)
   where request_id = r.id and revoked_at is null;
  if not found then raise exception 'No active pass to revoke' using errcode = 'P0001'; end if;
  perform public.notify(r.student_id, 'PASS_REVOKED', 'Your exit pass was revoked',
    left(v_reason, 500), r.id);
  perform public.write_audit('pass.revoked', 'exit_requests', r.id::text,
    jsonb_build_object('reason', left(v_reason, 500)));
end $$;

create function public.admin_update_profile(
  p_user       uuid,
  p_full_name  text,
  p_role       public.user_role,
  p_status     public.account_status,
  p_department text,
  p_college_id text,
  p_manager_id uuid
) returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.profiles;
  v_new public.profiles;
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  select * into v_old from public.profiles where id = p_user for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_user = (select auth.uid()) and (p_role <> 'admin' or p_status <> 'ACTIVE') then
    raise exception 'You cannot demote or disable your own admin account' using errcode = 'P0001';
  end if;
  if p_manager_id is not null then
    if p_role <> 'student' then
      raise exception 'Only students have an assigned Program Manager' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles m
                   where m.id = p_manager_id and m.role = 'program_manager' and m.status = 'ACTIVE') then
      raise exception 'Assigned manager must be an active Program Manager' using errcode = '22023';
    end if;
  end if;

  update public.profiles
     set full_name = coalesce(nullif(trim(p_full_name), ''), full_name),
         role = p_role, status = p_status,
         department = nullif(trim(coalesce(p_department, '')), ''),
         college_id = nullif(trim(coalesce(p_college_id, '')), ''),
         assigned_manager_id = p_manager_id
   where id = p_user returning * into v_new;

  perform public.write_audit('profile.updated', 'profiles', p_user::text, jsonb_build_object(
    'old', jsonb_build_object('role', v_old.role, 'status', v_old.status, 'department', v_old.department,
                              'manager', v_old.assigned_manager_id),
    'new', jsonb_build_object('role', v_new.role, 'status', v_new.status, 'department', v_new.department,
                              'manager', v_new.assigned_manager_id)));
  -- NOTE: when disabling someone, also ban them in Supabase Auth from a trusted
  -- server (auth.admin.updateUserById(..., { ban_duration })). The database
  -- already refuses all role-gated work for non-ACTIVE accounts.
  return v_new;
end $$;

-- Audit direct admin edits to configuration tables
create function public.audit_config_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.write_audit(tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce(to_jsonb(new) ->> 'id', to_jsonb(old) ->> 'id'),
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger trg_audit after insert or update or delete on public.emergency_policies
  for each row execute function public.audit_config_change();
create trigger trg_audit after insert or update or delete on public.app_settings
  for each row execute function public.audit_config_change();

-- ---------------------------------------------------------------------
-- 10b. Absence cover
-- ---------------------------------------------------------------------
create function public.declare_absence(p_user uuid, p_ends_at timestamptz, p_reason text)
returns public.approver_absences
language plpgsql security definer set search_path = '' as $$
declare
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.current_user_role();
  t        public.profiles;
  a        public.approver_absences;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if v_role is null then raise exception 'Not authorized' using errcode = '42501'; end if;
  select * into t from public.profiles where id = p_user;
  if not found or t.status <> 'ACTIVE' or t.role not in ('program_manager', 'swo') then
    raise exception 'Absence cover only applies to active Program Managers and SWO members' using errcode = '22023';
  end if;
  if not (p_user = v_uid or v_role = 'admin') then
    raise exception 'You can only declare your own absence' using errcode = '42501';
  end if;
  if char_length(v_reason) < 3 then raise exception 'Please give a short reason' using errcode = '22023'; end if;
  if p_ends_at <= now() then raise exception 'The absence must end in the future' using errcode = '22023'; end if;
  if p_ends_at > now() + interval '14 days' then raise exception 'An absence can last at most 14 days' using errcode = '22023'; end if;
  if public.is_absent(p_user) then raise exception 'This person already has an active absence. End it first.' using errcode = 'P0001'; end if;

  insert into public.approver_absences (user_id, ends_at, reason, declared_by)
  values (p_user, p_ends_at, left(v_reason, 300), v_uid) returning * into a;

  insert into public.notifications (recipient_id, type, title, body)
  select distinct x.id, 'ABSENCE_DECLARED'::public.notification_type, t.full_name || ' is marked absent',
         case when x.role = 'admin' then 'Absent until ' || to_char(p_ends_at at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC.'
              else 'Until ' || to_char(p_ends_at at time zone 'UTC', 'DD Mon HH24:MI') || ' UTC you may be able to act at their stage if no one else is available.' end
  from public.profiles x
  where x.status = 'ACTIVE' and x.id <> v_uid
    and (x.role = 'admin' or x.role = (case t.role when 'swo' then 'program_manager' else 'swo' end)::public.user_role);

  perform public.write_audit('absence.declared', 'approver_absences', a.id::text,
    jsonb_build_object('user', p_user, 'role', t.role, 'ends_at', p_ends_at, 'declared_by_admin', v_uid <> p_user));
  return a;
end $$;

create function public.end_absence(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.approver_absences;
begin
  select * into a from public.approver_absences where id = p_id for update;
  if not found or a.ended_at is not null then raise exception 'No active absence found' using errcode = 'P0002'; end if;
  if not (a.user_id = auth.uid() or public.is_admin()) then raise exception 'Not authorized' using errcode = '42501'; end if;
  update public.approver_absences set ended_at = now() where id = p_id;
  perform public.write_audit('absence.ended', 'approver_absences', p_id::text, '{}'::jsonb);
end $$;

-- Who is absent right now (names only, never the reason). Visible to approvers and admins.
create view public.active_absences as
  select a.id, a.user_id, p.full_name, p.role, a.starts_at, a.ends_at
  from public.approver_absences a join public.profiles p on p.id = a.user_id
  where a.ended_at is null and a.starts_at <= now() and a.ends_at > now()
    and public.current_user_role() in ('program_manager', 'swo', 'admin');

-- ---------------------------------------------------------------------
-- 11. Scheduled maintenance (service role / pg_cron only)
--     Escalation NEVER approves. It notifies a configured backup approver,
--     or — with no enabled policy/backup — alerts administrators.
-- ---------------------------------------------------------------------
create function public.process_overdue_and_expired() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.exit_requests;
  v_stage public.approval_stage;
  v_pol public.emergency_policies;
  v_escalated integer := 0;
  v_admin_alerts integer := 0;
  v_expired integer := 0;
begin
  for r in
    select * from public.exit_requests
     where approval_status in ('PENDING_PROGRAM_MANAGER', 'PENDING_SWO')
       and category <> 'REGULAR'
       and stage_due_at is not null and stage_due_at < now()
       and escalated_at is null
       and (last_alert_at is null or last_alert_at < now() - interval '60 minutes')
     for update skip locked
  loop
    v_stage := public.stage_of(r.approval_status);
    v_pol := null;
    select * into v_pol from public.emergency_policies ep
     where ep.enabled and ep.category = r.category and (ep.stage = v_stage or ep.stage is null)
       and ep.backup_approver_id is not null
       and exists (select 1 from public.profiles b where b.id = ep.backup_approver_id and b.status = 'ACTIVE')
     order by (ep.stage is null) limit 1;

    if v_pol.id is not null then
      update public.exit_requests set escalated_at = now(), last_alert_at = now() where id = r.id;
      perform public.notify(v_pol.backup_approver_id, 'ESCALATION',
        r.category || ' request ' || r.request_code || ' is overdue',
        'Escalated under policy: ' || v_pol.name, r.id);
      perform public.write_audit('request.escalated', 'exit_requests', r.id::text,
        jsonb_build_object('policy_id', v_pol.id, 'backup', v_pol.backup_approver_id, 'stage', v_stage));
      v_escalated := v_escalated + 1;
    else
      update public.exit_requests set last_alert_at = now() where id = r.id;
      insert into public.notifications (recipient_id, type, title, body, request_id)
      select a.id, 'NO_POLICY_ALERT', r.category || ' request ' || r.request_code || ' is overdue',
             'No authorized backup approver is configured. The request remains pending.', r.id
      from public.profiles a where a.role = 'admin' and a.status = 'ACTIVE';
      perform public.write_audit('request.overdue_no_policy', 'exit_requests', r.id::text,
        jsonb_build_object('stage', v_stage));
      v_admin_alerts := v_admin_alerts + 1;
    end if;
  end loop;

  with expired as (
    update public.exit_passes
       set expiry_notified_at = now()
     where used_at is null and revoked_at is null
       and valid_until < now() and expiry_notified_at is null
     returning request_id
  )
  insert into public.notifications (recipient_id, type, title, body, request_id)
  select q.student_id, 'PASS_EXPIRED', 'Your exit pass expired unused', q.request_code, q.id
  from expired e join public.exit_requests q on q.id = e.request_id;
  get diagnostics v_expired = row_count;

  return jsonb_build_object('escalated', v_escalated, 'admin_alerts', v_admin_alerts, 'passes_expired', v_expired);
end $$;

-- To run every minute (enable the pg_cron extension in the Supabase dashboard first):
-- select cron.schedule('campuspass-maintenance', '* * * * *',
--                      $$select public.process_overdue_and_expired()$$);

-- ---------------------------------------------------------------------
-- 12. Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.app_settings            enable row level security;
alter table public.emergency_policies      enable row level security;
alter table public.exit_requests           enable row level security;
alter table public.approval_records        enable row level security;
alter table public.clarification_responses enable row level security;
alter table public.exit_passes             enable row level security;
alter table public.movement_logs           enable row level security;
alter table public.notifications           enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_logs              enable row level security;
alter table public.approver_absences       enable row level security;

-- profiles
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "admins read all profiles" on public.profiles for select to authenticated
  using (public.is_admin());
create policy "managers read assigned students" on public.profiles for select to authenticated
  using (assigned_manager_id = (select auth.uid()) and public.current_user_role() = 'program_manager');
create policy "approvers read students on visible requests" on public.profiles for select to authenticated
  using (public.current_user_role() in ('swo', 'program_manager')
         and exists (select 1 from public.exit_requests r where r.student_id = profiles.id));
create policy "update own display name" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
  -- column grant below limits this to full_name; role/status/manager are unreachable

-- exit_requests (read-only for clients; writes only via RPC)
create policy "students read own requests" on public.exit_requests for select to authenticated
  using (student_id = (select auth.uid()));
create policy "admins read all requests" on public.exit_requests for select to authenticated
  using (public.is_admin());
create policy "managers read assigned students requests" on public.exit_requests for select to authenticated
  using (public.is_manager_of(student_id));
create policy "swo reads requests after manager approval" on public.exit_requests for select to authenticated
  using (pm_approved_at is not null and public.current_user_role() = 'swo');
create policy "backup reads escalated requests" on public.exit_requests for select to authenticated
  using (public.is_backup_for(id));
create policy "approvers keep requests they decided" on public.exit_requests for select to authenticated
  using (public.has_decided_on(id));
create policy "approvers read requests they may act on or cover" on public.exit_requests for select to authenticated
  using (public.acting_stage(id) is not null);

-- Child tables inherit visibility from exit_requests (the subquery is itself RLS-filtered)
create policy "read decisions of visible requests" on public.approval_records for select to authenticated
  using (exists (select 1 from public.exit_requests r where r.id = approval_records.request_id));
create policy "read clarifications of visible requests" on public.clarification_responses for select to authenticated
  using (exists (select 1 from public.exit_requests r where r.id = clarification_responses.request_id));
create policy "read passes of visible requests" on public.exit_passes for select to authenticated
  using (exists (select 1 from public.exit_requests r where r.id = exit_passes.request_id));
create policy "read movement of visible requests" on public.movement_logs for select to authenticated
  using (public.current_user_role() = 'security'
         or exists (select 1 from public.exit_requests r where r.id = movement_logs.request_id));

-- notifications / preferences
create policy "read own notifications" on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
create policy "mark own notifications read" on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid())) with check (recipient_id = (select auth.uid()));
create policy "manage own preferences" on public.notification_preferences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- absences: the person themself and admins (the reason is private); others use the active_absences view
create policy "read own absences" on public.approver_absences for select to authenticated
  using (user_id = (select auth.uid()));
create policy "admins read all absences" on public.approver_absences for select to authenticated
  using (public.is_admin());

-- admin-only tables
create policy "admins read audit log" on public.audit_logs for select to authenticated
  using (public.is_admin());
create policy "admins manage settings" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admins manage emergency policies" on public.emergency_policies for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Names of staff (for approval timelines). Deliberately limited columns, no student rows.
create view public.staff_directory as
  select id, full_name, role, department
  from public.profiles
  where role <> 'student' and status = 'ACTIVE';
comment on view public.staff_directory is
  'Runs with owner rights on purpose (exposes only id/name/role/department of active staff).';

-- ---------------------------------------------------------------------
-- 13. Privileges (deny by default, then grant the minimum)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;

grant select on public.profiles, public.exit_requests, public.approval_records,
                public.clarification_responses, public.movement_logs, public.notifications,
                public.audit_logs, public.staff_directory, public.approver_absences, public.active_absences to authenticated;
grant update (full_name) on public.profiles to authenticated;
-- hash columns of exit_passes are intentionally NOT readable
grant select (id, request_id, valid_from, valid_until, revoked_at, revoke_reason, used_at,
              token_rotated_at, created_at) on public.exit_passes to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select, update on public.app_settings to authenticated;
grant select, insert, update, delete on public.emergency_policies to authenticated;

-- Functions used inside RLS policies
grant execute on function public.current_user_role(), public.is_admin(),
  public.is_manager_of(uuid), public.is_backup_for(uuid), public.has_decided_on(uuid),
  public.acting_stage(uuid), public.is_absent(uuid), public.stage_unattended(public.approval_stage, uuid) to authenticated;
-- Client-callable workflow RPCs
grant execute on function
  public.submit_exit_request(public.request_category, text, text, timestamptz, timestamptz, text),
  public.respond_to_clarification(uuid, text),
  public.cancel_request(uuid),
  public.get_my_pass(uuid),
  public.decide_request(uuid, public.decision_type, text),
  public.verify_pass(text),
  public.record_movement(text),
  public.submit_reentry_request(uuid, public.request_category, text, timestamptz),
  public.list_recent_movements(integer),
  public.revoke_pass(uuid, text),
  public.declare_absence(uuid, timestamptz, text),
  public.end_absence(uuid),
  public.admin_update_profile(uuid, text, public.user_role, public.account_status, text, text, uuid)
  to authenticated;
-- Scheduler entry point: never exposed to clients
grant execute on function public.process_overdue_and_expired() to service_role;

-- Keep future objects private by default
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ---------------------------------------------------------------------
-- 14. Realtime (RLS still applies to what each subscriber receives)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.exit_requests, public.notifications;

commit;

-- =====================================================================
-- FIRST ADMIN (run once in the SQL editor after creating your first user
-- in Supabase Auth; the SQL editor has no end-user JWT, so this is allowed):
--
--   update public.profiles
--      set role = 'admin', status = 'ACTIVE', college_id = 'ADMIN001'
--    where id = '<uuid-from-auth.users>';
--
-- Then, in Supabase Auth settings: disable public sign-ups and create users
-- from a trusted server (Edge Function using the service-role key), then
-- activate and assign them with admin_update_profile().
-- =====================================================================
