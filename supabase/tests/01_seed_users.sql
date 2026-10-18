\set ON_ERROR_STOP 1
create temp table ids(k text primary key, v uuid);
grant all on ids to public;
do $$
declare k text;
begin
  foreach k in array array['s1','s2','m1','m2','b1','w1','g1','a1'] loop
    insert into auth.users(email, raw_user_meta_data) values (k||'@c.edu', jsonb_build_object('full_name', upper(k), 'role','admin'));
  end loop;
  insert into ids select split_part(email,'@',1), id from auth.users;
end $$;
update public.profiles p set status='ACTIVE', role = case left(i.k,1) when 's' then 'student'::user_role when 'm' then 'program_manager' when 'b' then 'program_manager' when 'w' then 'swo' when 'g' then 'security' else 'admin' end,
  college_id = 'ID-'||i.k, department='CSE'
  from ids i where i.v=p.id;
update public.profiles set assigned_manager_id=(select v from ids where k='m1') where id in (select v from ids where k in ('s1'));
update public.profiles set assigned_manager_id=(select v from ids where k='m2') where id in (select v from ids where k in ('s2'));
select 'signup role stayed:', count(*) filter (where role='student') from public.profiles where college_id is null;

create or replace function pg_temp.as_user(k text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', (select v::text from ids where ids.k=as_user.k), false); end $$;
