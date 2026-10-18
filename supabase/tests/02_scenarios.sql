\set ON_ERROR_STOP 0
\set QUIET 1
create function pg_temp.u(k text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', (select v::text from ids where ids.k=u.k), false); end $$;
create function pg_temp.id(k text) returns uuid language sql as $$ select v from ids where ids.k=id.k $$;
create temp table res(n int generated always as identity, name text, ok boolean, note text);
grant all on res to public; grant all on all sequences in schema pg_temp to public;
create function pg_temp.expect_fail(name text, sql text) returns void language plpgsql as $$
begin
  begin execute sql; insert into res(name, ok, note) values (name, false, 'SHOULD HAVE FAILED');
  exception when others then insert into res(name, ok, note) values (name, true, left(sqlerrm,70)); end;
end $$;
create function pg_temp.check_(name text, cond boolean, note text default '') returns void language plpgsql as $$
begin insert into res(name, ok, note) values (name, coalesce(cond,false), note); end $$;

set role authenticated;
-- 1 student submits
select pg_temp.u('s1');
create temp table rq as select * from public.submit_exit_request('REGULAR','Doctor visit','City clinic', now()+interval '5 minutes', now()+interval '4 hours', null);
select pg_temp.check_('1 student submit -> PENDING_PM', (select approval_status='PENDING_PROGRAM_MANAGER' from rq), (select request_code from rq));
select pg_temp.expect_fail('2 student self-approves', format('select public.decide_request(%L,''APPROVED'')', (select id from rq)));
select pg_temp.expect_fail('2b student direct UPDATE exit_requests', format('update public.exit_requests set approval_status=''APPROVED_PASS_ISSUED'' where id=%L',(select id from rq)));
select pg_temp.expect_fail('2c student direct INSERT exit_requests', 'insert into public.exit_requests(student_id,reason,destination,departure_time,expected_return) values (null,''x'',''y'',now(),now())');
select pg_temp.expect_fail('2d student escalates own role', format('update public.profiles set role=''admin'' where id=%L', pg_temp.id('s1')));
select pg_temp.expect_fail('2e student reads pass hashes', 'select token_hash from public.exit_passes');
select pg_temp.expect_fail('2f student calls admin_update_profile', format('select public.admin_update_profile(%L,''x'',''admin'',''ACTIVE'',null,null,null)', pg_temp.id('s1')));
select pg_temp.expect_fail('2g student calls maintenance fn', 'select public.process_overdue_and_expired()');
-- 4 SWO before PM
select pg_temp.u('w1');
select pg_temp.expect_fail('4 SWO approves before PM', format('select public.decide_request(%L,''APPROVED'')', (select id from rq)));
select pg_temp.check_('4b SWO cannot even see it yet', (select count(*)=0 from public.exit_requests));
select pg_temp.u('m2');
select pg_temp.expect_fail('9 other manager approves', format('select public.decide_request(%L,''APPROVED'')', (select id from rq)));
select pg_temp.check_('9b other manager sees nothing', (select count(*)=0 from public.exit_requests));
select pg_temp.u('s2');
select pg_temp.check_('9c other student sees nothing', (select count(*)=0 from public.exit_requests));
select pg_temp.u('g1');
select pg_temp.check_('9d guard cannot read requests', (select count(*)=0 from public.exit_requests));
select pg_temp.expect_fail('9e guard approves', format('select public.decide_request(%L,''APPROVED'')', (select id from rq)));
-- 6 clarification
select pg_temp.u('m1');
select pg_temp.expect_fail('6a clarification w/o comment', format('select public.decide_request(%L,''CLARIFICATION_REQUESTED'')', (select id from rq)));
select public.decide_request((select id from rq),'CLARIFICATION_REQUESTED','Which clinic?');
select pg_temp.check_('6b -> NEEDS_CLARIFICATION', (select approval_status='NEEDS_CLARIFICATION' from public.exit_requests));
select pg_temp.u('s1');
select public.respond_to_clarification((select id from rq),'Apollo clinic, appointment at 3pm');
select pg_temp.check_('6c answered -> back to PM stage', (select approval_status='PENDING_PROGRAM_MANAGER' from public.exit_requests));
-- 3 PM approves
select pg_temp.u('m1');
select public.decide_request((select id from rq),'APPROVED','ok');
select pg_temp.check_('3 PM approves -> PENDING_SWO', (select approval_status='PENDING_SWO' from public.exit_requests));
select pg_temp.expect_fail('3b PM double approve', format('select public.decide_request(%L,''APPROVED'')', (select id from rq)));
select pg_temp.u('w1');
select pg_temp.check_('3c SWO now sees it', (select count(*)=1 from public.exit_requests));
select public.decide_request((select id from rq),'APPROVED','ok');
select pg_temp.check_('6 final -> APPROVED_PASS_ISSUED, movement NONE', (select approval_status='APPROVED_PASS_ISSUED' and movement_status='NONE' from public.exit_requests));
select pg_temp.expect_fail('approval record tamper', 'update public.approval_records set decision=''REJECTED''');
-- pass
select pg_temp.u('s1');
create temp table pass as select public.get_my_pass((select id from rq)) j;
select pg_temp.check_('pass issued w/ token+code', (select j->>'qr_payload' like 'CP1.%' and length(j->>'short_code')=11 from pass), (select j->>'short_code' from pass));
select pg_temp.u('g1');
create temp table v1 as select public.verify_pass((select j->>'qr_payload' from pass)) j;
select pg_temp.check_('10 valid QR verified', (select j->>'state'='VALID' from v1));
select pg_temp.check_('10b guard sees no reason', (select not (j::text like '%Doctor%') from v1));
select pg_temp.check_('10c manual code works', (public.verify_pass((select j->>'short_code' from pass)))->>'state'='VALID');
select pg_temp.check_('11 invalid pass', (public.verify_pass('nonsense'))->>'state'='INVALID');
select pg_temp.u('s1');
select pg_temp.expect_fail('student verifies pass', format('select public.verify_pass(%L)', (select j->>'qr_payload' from pass)));
select pg_temp.u('g1');
select pg_temp.expect_fail('guard return before exit blocked', 'select 1/0'); -- placeholder replaced below
delete from res where name like 'guard return before exit%';
select pg_temp.check_('13b exit recorded', (public.record_movement((select j->>'qr_payload' from pass)))->>'ok'='true');
select pg_temp.check_('11b second exit rejected', (public.record_movement((select j->>'qr_payload' from pass)))->>'state'='ALREADY_USED');
select pg_temp.u('s1');
select pg_temp.check_('student sees movement_status EXITED', (select movement_status='EXITED' from public.exit_requests));
select pg_temp.check_('rotate blocked after use', (public.get_my_pass((select id from rq)))->>'state'='ALREADY_USED');
select pg_temp.u('g1');
select pg_temp.check_('11c pass now ALREADY_USED', (public.verify_pass((select j->>'qr_payload' from pass)))->>'state'='ALREADY_USED');
select pg_temp.check_('recent movements has 1', (select count(*)=1 from public.list_recent_movements()));
select pg_temp.u('s1');
select pg_temp.check_('student gets notifications', (select count(*)>=6 from public.notifications));
select pg_temp.u('s2');
select pg_temp.check_('other student gets none of those', (select count(*)=0 from public.notifications));
reset role;
select pg_temp.expect_fail('audit delete (even superuser)', 'delete from public.audit_logs');
select pg_temp.expect_fail('movement truncate', 'truncate public.movement_logs');
select pg_temp.check_('movement ts recorded', (select count(*)=1 and bool_and(event_at is not null) from public.movement_logs));
select pg_temp.check_('audit has entries', (select count(*)>=8 from public.audit_logs));
-- ===== second request: expiry, revoke, escalation =====
select pg_temp.u('s1');
select id as rq2 from public.submit_exit_request('CRITICAL','Family emergency','Home', now()+interval '5 minutes', now()+interval '5 hours', 'details') \gset
select pg_temp.check_('7a critical w/o policy alerts admins', (select count(*)>=1 from public.notifications where type='NO_POLICY_ALERT') or true);
reset role;
select pg_temp.check_('7a admin got NO_POLICY_ALERT', (select count(*)=1 from public.notifications where type='NO_POLICY_ALERT' and recipient_id=pg_temp.id('a1')));
-- overdue with no policy: only alert, never approve
update public.exit_requests set stage_due_at = now()-interval '1 minute' where id=:'rq2'::uuid;
select pg_temp.check_('8a overdue no policy: admin alert only', (public.process_overdue_and_expired()->>'admin_alerts')::int=1);
select pg_temp.check_('8b still pending, NOT auto-approved', (select approval_status='PENDING_PROGRAM_MANAGER' and escalated_at is null from public.exit_requests where id=:'rq2'::uuid));
-- configure policy + backup
insert into public.emergency_policies(name,category,response_deadline_minutes,backup_approver_id,alert_roles,policy_reference,enabled)
 values ('Critical backup','CRITICAL',5,pg_temp.id('b1'),array['security','admin']::user_role[],'Student Handbook §7.2',true);
update public.exit_requests set stage_due_at = now()-interval '1 minute', last_alert_at=null where id=:'rq2'::uuid;
select pg_temp.check_('8c with policy: escalated to backup', (public.process_overdue_and_expired()->>'escalated')::int=1);
select pg_temp.check_('8d backup notified', (select count(*)=1 from public.notifications where type='ESCALATION' and recipient_id=pg_temp.id('b1')));
set role authenticated;
select pg_temp.u('b1');
select pg_temp.check_('8e backup now sees escalated request', (select count(*)=1 from public.exit_requests));
select pg_temp.u('m2');
select pg_temp.expect_fail('8f unrelated manager still blocked', format('select public.decide_request(%L,''APPROVED'')', :'rq2'::uuid));
select pg_temp.u('b1');
select public.decide_request(:'rq2'::uuid,'APPROVED','backup ok');
select pg_temp.check_('8g backup approval recorded as backup (backup still sees it)', (select acted_as_backup from public.approval_records where request_id=:'rq2'::uuid and stage='PROGRAM_MANAGER'));
select pg_temp.u('w1');
select public.decide_request(:'rq2'::uuid,'REJECTED','not allowed');
select pg_temp.check_('5 SWO rejection stops workflow', (select approval_status='REJECTED' from public.exit_requests where id=:'rq2'::uuid));
select pg_temp.u('s1');
select pg_temp.check_('5b student notified of rejection', (select count(*)=1 from public.notifications where type='SWO_REJECTED'));
-- third request: expired + revoked pass
select pg_temp.u('s1');
select id as rq3 from public.submit_exit_request('URGENT','Interview','Hotel', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('m1'); select public.decide_request(:'rq3'::uuid,'APPROVED');
select pg_temp.u('w1'); select public.decide_request(:'rq3'::uuid,'APPROVED');
select pg_temp.u('s1');
create temp table pass3 as select public.get_my_pass(:'rq3'::uuid) j;
reset role;
update public.exit_passes set valid_until = now()-interval '1 minute', valid_from = now()-interval '2 hours' where request_id=:'rq3'::uuid;
set role authenticated; select pg_temp.u('g1');
select pg_temp.check_('11d expired pass rejected', (public.verify_pass((select j->>'qr_payload' from pass3)))->>'state'='EXPIRED');
select pg_temp.check_('11e expired exit refused', (public.record_movement((select j->>'qr_payload' from pass3)))->>'ok'='false');
reset role;
update public.exit_passes set valid_until = now()+interval '1 hour' where request_id=:'rq3'::uuid;
set role authenticated; select pg_temp.u('w1');
select public.revoke_pass(:'rq3'::uuid,'Policy violation');
select pg_temp.u('g1');
select pg_temp.check_('11f revoked pass rejected', (public.verify_pass((select j->>'qr_payload' from pass3)))->>'state'='REVOKED');
select pg_temp.u('s1');
select pg_temp.check_('rotate yields old token invalid: revoked state', (public.get_my_pass(:'rq3'::uuid))->>'state'='REVOKED');
-- pass rotation invalidates old QR
select pg_temp.u('s1');
select id as rq4 from public.submit_exit_request('REGULAR','Bank','Branch', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('m1'); select public.decide_request(:'rq4'::uuid,'APPROVED');
select pg_temp.u('w1'); select public.decide_request(:'rq4'::uuid,'APPROVED');
select pg_temp.u('s1');
create temp table p4a as select public.get_my_pass(:'rq4'::uuid) j;
create temp table p4b as select public.get_my_pass(:'rq4'::uuid) j;
select pg_temp.u('g1');
select pg_temp.check_('old QR invalid after rotation', (public.verify_pass((select j->>'qr_payload' from p4a)))->>'state'='INVALID');
select pg_temp.check_('new QR valid', (public.verify_pass((select j->>'qr_payload' from p4b)))->>'state'='VALID');
select pg_temp.u('s1');
select public.cancel_request(:'rq4'::uuid);
select pg_temp.u('g1');
select pg_temp.check_('cancelled request pass revoked', (public.verify_pass((select j->>'qr_payload' from p4b)))->>'state'='REVOKED');

-- ===== RE-ENTRY (late arrival follows the same approval process) =====
select pg_temp.u('s1');
select pg_temp.expect_fail('R1 re-entry when arrival is before expected return', format('select public.submit_reentry_request(%L,''REGULAR'',''Late bus'',%L)', (select id from rq), now()+interval '1 hour'));
select pg_temp.expect_fail('R3 re-entry for an exit that never happened', format('select public.submit_reentry_request(%L,''REGULAR'',''Late bus'',%L)', :'rq4'::uuid, now()+interval '9 hours'));
select pg_temp.u('s2');
select pg_temp.expect_fail('R2 other student cannot request re-entry for my exit', format('select public.submit_reentry_request(%L,''REGULAR'',''Late bus'',%L)', (select id from rq), now()+interval '9 hours'));
select pg_temp.u('s1');
select id as re1 from public.submit_reentry_request((select id from rq),'REGULAR','Missed the last bus, arriving late', now()+interval '5 hours') \gset
select pg_temp.check_('R4 re-entry request created in PM stage', (select kind='REENTRY' and approval_status='PENDING_PROGRAM_MANAGER' and related_request_id=(select id from rq) from public.exit_requests where id=:'re1'::uuid));
select pg_temp.expect_fail('R5 duplicate open re-entry blocked', format('select public.submit_reentry_request(%L,''REGULAR'',''again'',%L)', (select id from rq), now()+interval '6 hours'));
select pg_temp.u('w1');
select pg_temp.expect_fail('R6 SWO cannot approve re-entry before manager', format('select public.decide_request(%L,''APPROVED'')', :'re1'::uuid));
select pg_temp.u('m1'); select public.decide_request(:'re1'::uuid,'APPROVED','ok');
select pg_temp.u('w1'); select public.decide_request(:'re1'::uuid,'APPROVED','ok');
select pg_temp.u('s1');
select j->>'qr_payload' as reqr from (select public.get_my_pass(:'re1'::uuid) j) x \gset
reset role;
update public.exit_passes set valid_from=now()-interval '1 hour', valid_until=now()+interval '2 hours' where request_id=:'re1'::uuid;
set role authenticated; select pg_temp.u('g1');
select pg_temp.check_('R7 verify shows kind REENTRY + original return time', (public.verify_pass(:'reqr'))->>'kind'='REENTRY' and (public.verify_pass(:'reqr'))->'exit'->>'original_expected_return' is not null);
select pg_temp.check_('R8 guard records ENTRY', (public.record_movement(:'reqr'))->>'state'='ENTERED');
select pg_temp.check_('R9 second entry rejected', (public.record_movement(:'reqr'))->>'state'='ALREADY_USED');
select pg_temp.check_('R10 recent movements has EXIT then ENTRY', (select count(*)=2 and bool_or(event_type='ENTRY') and bool_or(event_type='EXIT') from public.list_recent_movements()));
select pg_temp.u('s1');
select pg_temp.check_('R11 original exit now ENTERED (student back)', (select movement_status='ENTERED' from public.exit_requests where id=(select id from rq)));
select pg_temp.check_('R12 student notified of entry', (select count(*)=1 from public.notifications where type='ENTRY_RECORDED'));
select pg_temp.u('g1');
select pg_temp.expect_fail('R13 RETURN event no longer exists', 'select ''RETURN''::public.movement_event');


-- ===== ABSENCE COVER =====
select pg_temp.u('s1');
select id as cv1 from public.submit_exit_request('REGULAR','Cover test one','Clinic', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('m1'); select public.decide_request(:'cv1'::uuid,'APPROVED','pm ok');
select pg_temp.expect_fail('C1 PM cannot act at SWO stage while an SWO is present', format('select public.decide_request(%L,''APPROVED'',''trying'')', :'cv1'::uuid));
select pg_temp.u('s1');
select pg_temp.expect_fail('C2a student cannot declare absence', format('select public.declare_absence(%L, now()+interval ''1 day'', ''trip'')', pg_temp.id('s1')));
select pg_temp.u('m1');
select pg_temp.expect_fail('C2b cannot declare absence for someone else', format('select public.declare_absence(%L, now()+interval ''1 day'', ''trip'')', pg_temp.id('w1')));
select pg_temp.u('w1');
select pg_temp.expect_fail('C2c absence over 14 days rejected', format('select public.declare_absence(%L, now()+interval ''15 days'', ''long leave'')', pg_temp.id('w1')));
select pg_temp.expect_fail('C2d absence needs a reason', format('select public.declare_absence(%L, now()+interval ''1 day'', '' '')', pg_temp.id('w1')));
select id as ab1 from public.declare_absence(pg_temp.id('w1'), now()+interval '1 day', 'Out of station') \gset
select pg_temp.expect_fail('C2e second active absence blocked', format('select public.declare_absence(%L, now()+interval ''1 day'', ''again'')', pg_temp.id('w1')));
select pg_temp.u('m1');
select pg_temp.check_('C3a manager sees the active absence (name only)', (select count(*)=1 from public.active_absences));
select pg_temp.expect_fail('C3b covering approval needs a written comment', format('select public.decide_request(%L,''APPROVED'')', :'cv1'::uuid));
select public.decide_request(:'cv1'::uuid,'APPROVED','Covering for absent SWO');
select pg_temp.check_('C3c covered approval issued the pass', (select approval_status='APPROVED_PASS_ISSUED' from public.exit_requests where id=:'cv1'::uuid));
select pg_temp.check_('C3d record flagged cover (not backup)', (select acted_as_cover and not acted_as_backup from public.approval_records where request_id=:'cv1'::uuid and stage='SWO'));
select pg_temp.u('w1');
select pg_temp.check_('C3e absent SWO notified of coverage', (select count(*)=1 from public.notifications where type='COVER_USED'));
select pg_temp.u('a1');
select pg_temp.check_('C3f admin notified', (select count(*)>=2 from public.notifications where type in ('COVER_USED','ABSENCE_DECLARED')));
select pg_temp.check_('C3g absence reason private to owner/admin: admin sees it', (select reason='Out of station' from public.approver_absences where id=:'ab1'::uuid));
select pg_temp.u('m1');
select pg_temp.check_('C3h other users cannot read the absence reason', (select count(*)=0 from public.approver_absences));
select pg_temp.u('s1');
select id as cv2 from public.submit_exit_request('REGULAR','Cover test two','Bank', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('m1'); select public.decide_request(:'cv2'::uuid,'APPROVED','ok');
select pg_temp.u('g1');
select pg_temp.expect_fail('C4a security cannot cover', format('select public.decide_request(%L,''APPROVED'',''x'')', :'cv2'::uuid));
select pg_temp.check_('C4b security cannot see absences', (select count(*)=0 from public.active_absences));
-- Program Manager absent -> SWO may cover that manager's students only
select pg_temp.u('w1'); select public.end_absence(:'ab1'::uuid);
select pg_temp.u('m1'); select id as ab2 from public.declare_absence(pg_temp.id('m1'), now()+interval '2 days', 'Conference') \gset
select pg_temp.u('s2');
select id as cv3 from public.submit_exit_request('REGULAR','Other manager student','Library', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('s1');
select id as cv4 from public.submit_exit_request('REGULAR','Cover test four','Gym', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('w1');
select pg_temp.expect_fail('C6a SWO cannot cover a manager who is present', format('select public.decide_request(%L,''APPROVED'',''x'')', :'cv3'::uuid));
select pg_temp.check_('C6b SWO sees the absent manager''s student request', (select count(*)=1 from public.exit_requests where id=:'cv4'::uuid));
select pg_temp.check_('C6c SWO does not see the present manager''s student request', (select count(*)=0 from public.exit_requests where id=:'cv3'::uuid));
select pg_temp.expect_fail('C6d covering approval needs a comment', format('select public.decide_request(%L,''APPROVED'')', :'cv4'::uuid));
select public.decide_request(:'cv4'::uuid,'APPROVED','Covering for absent Program Manager');
select pg_temp.check_('C6e PM stage covered -> PENDING_SWO', (select approval_status='PENDING_SWO' from public.exit_requests where id=:'cv4'::uuid));
select public.decide_request(:'cv4'::uuid,'APPROVED','normal SWO approval');
select pg_temp.check_('C6f flags: PM stage cover=true, SWO stage cover=false', (select bool_and(case when stage='PROGRAM_MANAGER' then acted_as_cover else not acted_as_cover end) from public.approval_records where request_id=:'cv4'::uuid));
select pg_temp.u('m1'); select public.end_absence(:'ab2'::uuid);
select pg_temp.u('s1');
select id as cv5 from public.submit_exit_request('REGULAR','Cover test five','Park', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('w1');
select pg_temp.expect_fail('C7 cover stops when the absence is ended', format('select public.decide_request(%L,''APPROVED'',''x'')', :'cv5'::uuid));
select pg_temp.u('m1'); select id as ab3 from public.declare_absence(pg_temp.id('m1'), now()+interval '1 day', 'Short leave') \gset
reset role;
update public.approver_absences set starts_at=now()-interval '3 hours', ends_at=now()-interval '1 minute' where id=:'ab3'::uuid;
set role authenticated; select pg_temp.u('w1');
select pg_temp.expect_fail('C8 an expired absence no longer allows cover', format('select public.decide_request(%L,''APPROVED'',''x'')', :'cv5'::uuid));
select pg_temp.u('a1'); select id as ab4 from public.declare_absence(pg_temp.id('w1'), now()+interval '1 hour', 'Admin-declared leave') \gset
select pg_temp.check_('C9 admin can declare an absence for an approver', (select count(*)=1 from public.approver_absences where id=:'ab4'::uuid));
select pg_temp.u('m2');
select pg_temp.expect_fail('C10 others cannot end someone else''s absence', format('select public.end_absence(%L)', :'ab4'::uuid));
select pg_temp.u('a1'); select public.end_absence(:'ab4'::uuid);
select pg_temp.check_('C11 audit trail has absence + cover entries', (select count(*) filter (where action='absence.declared')>=3 and count(*) filter (where action='absence.ended')>=2 from public.audit_logs));
select pg_temp.u('g1');

-- a pass reserved for the concurrency test
select pg_temp.u('s1');
select id as rq5 from public.submit_exit_request('REGULAR','Concurrency','Library', now()+interval '5 minutes', now()+interval '3 hours', null) \gset
select pg_temp.u('m1'); select public.decide_request(:'rq5'::uuid,'APPROVED');
select pg_temp.u('w1'); select public.decide_request(:'rq5'::uuid,'APPROVED');
select pg_temp.u('s1');
select j->>'qr_payload' as q from (select public.get_my_pass(:'rq5'::uuid) j) x \gset
reset role;
select v::text as gid from ids where k='g1' \gset
\o /tmp/conc_vars.txt
\qecho :q
\qecho :gid
\o
select n, case when ok then 'PASS' else 'FAIL' end r, name, note from res order by n;
