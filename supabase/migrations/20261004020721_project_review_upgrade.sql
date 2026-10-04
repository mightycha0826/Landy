-- PROJECT-REVIEW R10/R24/R25/R26/R27/R28/R29. 운영 반영 전 staging 검증.
begin;

revoke all on public.signup_stats from anon, authenticated;
grant select on public.signup_stats to authenticated;
create index if not exists room_members_user_all on public.room_members(user_id);
create index if not exists personal_notices_user_all on private.personal_notices(user_id);
create index if not exists badge_requests_code_all on private.badge_requests(code);

create table if not exists private.api_windows (
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null,
  started_at timestamptz not null,
  calls int not null,
  primary key(user_id, endpoint)
);
alter table private.api_windows enable row level security;
revoke all on private.api_windows from public, anon, authenticated;
create or replace function public.api_rate_take(p_user uuid, p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare n int; v_limit int; v_start timestamptz;
begin
  v_limit := case p_endpoint when 'ai-chat' then 20 when 'moderate' then 12 when 'push' then 120 else 0 end;
  if v_limit = 0 or p_user is null then raise exception 'bad_request'; end if;
  insert into private.api_windows(user_id, endpoint, started_at, calls) values(p_user, p_endpoint, clock_timestamp(), 1)
  on conflict(user_id, endpoint) do update set
    calls = case when private.api_windows.started_at <= clock_timestamp() - interval '1 minute' then 1 else private.api_windows.calls + 1 end,
    started_at = case when private.api_windows.started_at <= clock_timestamp() - interval '1 minute' then clock_timestamp() else private.api_windows.started_at end
  returning calls, started_at into n, v_start;
  return jsonb_build_object('allowed', n <= v_limit, 'retry_after', greatest(1, ceil(extract(epoch from v_start + interval '1 minute' - clock_timestamp()))::int));
end
$fn$;
revoke all on function public.api_rate_take(uuid, text) from public, anon, authenticated;
grant execute on function public.api_rate_take(uuid, text) to service_role;

-- 입력 원문은 저장하지 않는다. ID/입력 해시는 채팅 수명까지, 성공 응답은 최대 15분 보관한다.
create table if not exists private.ai_requests (
  chat_id uuid not null references private.ai_chats on delete cascade,
  request_id uuid not null,
  input_hash text not null,
  state text not null check (state in ('pending','succeeded','failed')),
  attempts int not null default 1,
  lease uuid not null,
  leased_until timestamptz not null,
  reply text,
  completed_at timestamptz,
  primary key(chat_id, request_id)
);
alter table private.ai_requests enable row level security;
revoke all on private.ai_requests from public, anon, authenticated;
create table if not exists private.ai_attempt_budget (
  day timestamptz primary key, attempts bigint not null default 0
);
alter table private.ai_attempt_budget enable row level security;
revoke all on private.ai_attempt_budget from public, anon, authenticated;

create or replace function public.ai_chat_claim(p_chat uuid, p_user uuid, p_request uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c private.ai_chats%rowtype; r private.ai_requests%rowtype; cfg public.app_settings%rowtype;
  result jsonb; lease_id uuid := gen_random_uuid(); day_start timestamptz := private.ai_day_start(); spent bigint;
begin
  if p_request is null or p_user is null or p_chat is null then return jsonb_build_object('status','bad_text'); end if;
  select * into cfg from public.app_settings where id;
  if not found or private.in_maintenance() or not cfg.ai_chat or not cfg.is_open then return jsonb_build_object('status','off'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_model_attempt_budget', 0));
  perform 1 from public.profiles where id=p_user and verified and onboarded and status='active'
    and not coalesce(suspended_until > now(),false) for share;
  if not found then return jsonb_build_object('status','restricted'); end if;
  select * into c from private.ai_chats where id=p_chat and user_id=p_user for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if c.expires_at <= now() then return jsonb_build_object('status','expired'); end if;
  if char_length(btrim(coalesce(p_text,''))) not between 1 and 10019 then return jsonb_build_object('status','bad_text'); end if;
  update private.ai_requests set reply=null where reply is not null and completed_at < now()-interval '15 minutes';
  select * into r from private.ai_requests where chat_id=p_chat and request_id=p_request;
  if found then
    if r.input_hash <> encode(sha256(convert_to(p_text,'UTF8')),'hex') then return jsonb_build_object('status','bad_text'); end if;
    if r.state='succeeded' then
      if r.reply is null then return jsonb_build_object('status','expired'); end if;
      return jsonb_build_object('status','ok','cached',true,'reply',r.reply,'turns',c.turns,'max_turns',cfg.ai_chat_max_turns);
    end if;
    if r.state='pending' and r.leased_until > clock_timestamp() then return jsonb_build_object('status','pending'); end if;
    if r.attempts >= 2 then return jsonb_build_object('status','ai_unavailable'); end if;
  end if;
  if (select count(*) from private.ai_requests req join private.ai_chats chat on chat.id=req.chat_id
    where chat.user_id=p_user and req.state='pending' and req.leased_until > clock_timestamp()) >= 2 then
    return jsonb_build_object('status','pending');
  end if;
  select attempts into spent from private.ai_attempt_budget where day=day_start;
  if coalesce(spent,0) >= cfg.ai_chat_daily_cap::bigint * cfg.ai_chat_max_turns * 2 then return jsonb_build_object('status','off'); end if;
  if r.request_id is null then
    result := public.ai_chat_turn(p_chat,p_user,p_text);
    if result->>'status' <> 'ok' then return result; end if;
    insert into private.ai_requests(chat_id,request_id,input_hash,state,lease,leased_until)
    values(p_chat,p_request,encode(sha256(convert_to(p_text,'UTF8')),'hex'),'pending',lease_id,clock_timestamp()+interval '90 seconds');
    c.turns := c.turns+1;
  else
    update private.ai_requests set state='pending', attempts=attempts+1, lease=lease_id,
      leased_until=clock_timestamp()+interval '90 seconds' where chat_id=p_chat and request_id=p_request;
  end if;
  insert into private.ai_attempt_budget(day,attempts) values(day_start,1)
    on conflict(day) do update set attempts=private.ai_attempt_budget.attempts+1;
  return jsonb_build_object('status','ok','lease',lease_id,'turns',c.turns,'max_turns',cfg.ai_chat_max_turns);
end
$fn$;

create or replace function public.ai_chat_finish(p_chat uuid,p_request uuid,p_lease uuid,p_reply text default null)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  update private.ai_requests set state=case when p_reply is null then 'failed' else 'succeeded' end,
    reply=case when p_reply is null then null else left(p_reply,600) end, completed_at=now()
    where chat_id=p_chat and request_id=p_request and lease=p_lease and state='pending';
  return found;
end
$fn$;
revoke all on function public.ai_chat_claim(uuid,uuid,uuid,text), public.ai_chat_finish(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ai_chat_claim(uuid,uuid,uuid,text), public.ai_chat_finish(uuid,uuid,uuid,text) to service_role;

-- 15분 응답 TTL은 정기 작업에서도 제거한다. Auth 세션 원문/토큰을 저장하지 않는다.
create or replace function public.review_cleanup()
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  update private.ai_requests set reply=null where reply is not null and completed_at < now()-interval '15 minutes';
  delete from private.api_windows where started_at < now()-interval '1 day';
  delete from private.ai_attempt_budget where day < now()-interval '2 days';
  delete from private.admin_sessions where expires_at < now() or revoked_at is not null;
  delete from private.push_outbox where created_at < now()-interval '1 day';
  delete from private.message_exports where created_at < now()-interval '1 hour';
end
$fn$;
revoke all on function public.review_cleanup() from public,anon,authenticated;
grant execute on function public.review_cleanup() to service_role;

-- 아래 기존 함수 재정의는 snapshot과 같은 내용으로 관리한다.
create or replace function private.refresh_signup_stats()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  perform pg_advisory_xact_lock(hashtextextended('signup_stats',0));
  select count(*) into n from public.profiles where verified and onboarded;
  -- 바뀌었을 때만 쓴다 — 쓸 때마다 Realtime 으로 지켜보는 앱들에 신호가 간다
  insert into public.signup_stats(id,students,updated_at) values(true,n,now())
  on conflict(id) do update set students=excluded.students,updated_at=excluded.updated_at
  where public.signup_stats.students is distinct from excluded.students;
  return null;
end
$fn$;

create or replace function private.letters_locked()
returns boolean language sql security definer set search_path = public stable as $fn$
  select coalesce((select s.letters_gate and st.students < s.letters_gate_min
                     from public.app_settings s cross join public.signup_stats st
                    where s.id and st.id), true);
$fn$;

create or replace function public.ai_chat_start()
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me     uuid := auth.uid();
  cfg    public.app_settings%rowtype;
  p      public.profiles%rowtype;
  v_day  timestamptz := private.ai_day_start();
  v_mine int;
  v_all  int;
  c      private.ai_chats%rowtype;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into cfg from public.app_settings where id;
  if not found or private.in_maintenance() or not cfg.ai_chat or not cfg.is_open then return jsonb_build_object('status', 'off'); end if;
  select * into p from public.profiles where id = me;
  if not found or not p.verified or not p.onboarded or p.status <> 'active' or coalesce(p.suspended_until > now(), false) then
    return jsonb_build_object('status', 'restricted');
  end if;

  -- 아직 안 끝난 대화가 있으면 그걸 이어간다 (화면을 다시 열어도 한 번으로 센다)
  -- 잠금 순서는 전역 예산 → 사용자. 대기 후 최신 사용량을 다시 읽는다.
  perform pg_advisory_xact_lock(hashtextextended('ai_chat_budget', 0));
  perform pg_advisory_xact_lock(hashtextextended('ai_chat_user:' || me::text, 0));
  select * into c from private.ai_chats
   where user_id = me and expires_at > now() and turns < cfg.ai_chat_max_turns
   order by created_at desc limit 1;
  if not found then
    select count(*) filter (where user_id = me), count(*) into v_mine, v_all
      from private.ai_chats where created_at >= v_day;
    if v_mine >= cfg.ai_chat_per_user then return jsonb_build_object('status', 'limit', 'per_user', cfg.ai_chat_per_user); end if;
    if v_all >= cfg.ai_chat_daily_cap then return jsonb_build_object('status', 'full'); end if;
    insert into private.ai_chats (user_id, expires_at)
    values (me, now() + make_interval(mins => cfg.ai_chat_minutes))
    returning * into c;
  end if;
  select count(*) into v_mine from private.ai_chats where user_id = me and created_at >= v_day;
  return jsonb_build_object('status', 'ok', 'id', c.id, 'expires_at', c.expires_at, 'turns', c.turns,
    'max_turns', cfg.ai_chat_max_turns, 'left_today', greatest(cfg.ai_chat_per_user - v_mine, 0),
    'server_now', now());
end
$fn$;

create or replace function public.ai_chat_turn(p_chat uuid, p_user uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare cfg public.app_settings%rowtype; c private.ai_chats%rowtype; v text;
begin
  select * into cfg from public.app_settings where id;
  -- 제재와 매 턴의 권한 판단을 같은 프로필 행 잠금으로 직렬화한다.
  perform 1 from public.profiles where id = p_user and verified and onboarded and status = 'active'
    and not coalesce(suspended_until > now(), false) for share;
  if not found then return jsonb_build_object('status', 'restricted'); end if;
  select * into c from private.ai_chats where id = p_chat and user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if private.in_maintenance() or not cfg.ai_chat or not cfg.is_open then return jsonb_build_object('status', 'off'); end if;
  if now() >= c.expires_at then return jsonb_build_object('status', 'expired'); end if;
  if c.turns >= cfg.ai_chat_max_turns then return jsonb_build_object('status', 'turns'); end if;
  -- 서버가 사용자 턴 최대 20개(각 500자)를 줄바꿈으로 합쳐 모두 검사한다.
  if char_length(btrim(coalesce(p_text, ''))) not between 1 and 10019 then return jsonb_build_object('status', 'bad_text'); end if;
  v := private.rule_violation(p_text);
  if v is not null then return jsonb_build_object('status', 'blocked', 'code', v); end if;
  update private.ai_chats set turns = turns + 1 where id = p_chat;
  return jsonb_build_object('status', 'ok', 'turns', c.turns + 1, 'max_turns', cfg.ai_chat_max_turns);
end
$fn$;

create or replace function public.dm_folder_put(p_msgs bigint[], p_folder bigint default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me uuid := auth.uid();
  nm text := private.dm_folder_name(p_name);
  fid bigint;
  fname text;
  n int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dm_folder:' || me::text,0));
  if p_msgs is null or cardinality(p_msgs) = 0 or cardinality(p_msgs) > 200 then return jsonb_build_object('status', 'bad_request'); end if;
  if p_folder is not null then
    select id, name into fid, fname from private.dm_folders where id = p_folder and owner_id = me;
    if fid is null then return jsonb_build_object('status', 'not_found'); end if;
  else
    if nm is null or char_length(nm) > 20 then return jsonb_build_object('status', 'bad_name'); end if;
    select id, name into fid, fname from private.dm_folders where owner_id = me and lower(name) = lower(nm);
    if fid is null then
      if (select count(*) from private.dm_folders where owner_id = me) >= 30 then return jsonb_build_object('status', 'too_many'); end if;
      insert into private.dm_folders (owner_id, name) values (me, nm)
        on conflict (owner_id, lower(name)) do nothing returning id, name into fid, fname;
      if fid is null then
        select id, name into fid, fname from private.dm_folders where owner_id = me and lower(name) = lower(nm);
      end if;
    end if;
  end if;
  insert into private.dm_folder_items (owner_id, msg_id, folder_id)
  select me, m.id, fid
    from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
   where m.id = any(p_msgs) and m.is_letter and t.status <> 'removed'
     and case private.dm_box_of(m, t, me) when 'sent' then true when 'received' then m.opened_at is not null else false end
  on conflict (owner_id, msg_id) do update set folder_id = excluded.folder_id, added_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'ok', 'folder', jsonb_build_object('id', fid, 'name', fname), 'moved', n);
end
$fn$;

create or replace function public.dm_folder_rename(p_folder bigint, p_name text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); nm text := private.dm_folder_name(p_name);
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dm_folder:' || me::text,0));
  if nm is null or char_length(nm) > 20 then return jsonb_build_object('status', 'bad_name'); end if;
  if not exists (select 1 from private.dm_folders where id = p_folder and owner_id = me) then return jsonb_build_object('status', 'not_found'); end if;
  if exists (select 1 from private.dm_folders where owner_id = me and lower(name) = lower(nm) and id <> p_folder) then
    return jsonb_build_object('status', 'exists');
  end if;
  update private.dm_folders set name = nm where id = p_folder and owner_id = me;
  return jsonb_build_object('status', 'ok', 'folder', jsonb_build_object('id', p_folder, 'name', nm));
end
$fn$;

create or replace function public.dm_folder_delete(p_folder bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dm_folder:' || me::text,0));
  delete from private.dm_folders where id = p_folder and owner_id = me;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok');
end
$fn$;

create or replace function public.rt_allowed(p_topic text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare me uuid := auth.uid();
begin
  if me is null or p_topic is null then return false; end if;
  if not exists(select 1 from public.profiles where id=me and verified and onboarded and status='active'
    and not coalesce(suspended_until > now(),false)) then return false; end if;
  if p_topic ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return not p_write and exists (select 1 from public.room_members where room_id = substr(p_topic, 6)::uuid and user_id = me);
  end if;
  if p_topic ~ '^peer:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return exists (select 1 from public.room_members rm join public.rooms r on r.id=rm.room_id
      where rm.room_id=substr(p_topic,6)::uuid and rm.user_id=me and rm.open and r.status <> 'closed');
  end if;
  if p_write then return false; end if;
  return p_topic = 'inbox:' || me::text or p_topic = 'signups';
end
$fn$;
create or replace function public.push_payload(p_message bigint, p_sender uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  m        public.messages%rowtype;
  r        public.rooms%rowtype;
  v_seat   smallint;
  v_to     uuid;
  v_subs   jsonb;
  v_job jsonb;
begin
  select * into m from public.messages where id = p_message;
  if not found or m.sender_seat = 0 then return jsonb_build_object('skip', 'no_message'); end if;
  select seat into v_seat from public.room_members where room_id = m.room_id and user_id = p_sender;
  if v_seat is null or v_seat <> m.sender_seat then return jsonb_build_object('skip', 'not_sender'); end if;
  if m.created_at < now() - interval '10 minutes' then return jsonb_build_object('skip', 'stale'); end if;
  select * into r from public.rooms where id = m.room_id;
  if r.status = 'closed' then return jsonb_build_object('skip', 'closed'); end if;

  -- 한 메시지에 한 번만


  select user_id into v_to from public.room_members where room_id = m.room_id and seat <> m.sender_seat;
  -- 그 대화 화면을 보고 있으면 보내지 않는다 (이미 보고 있다). 앱의 다른 화면이면 보낸다 — 앱 안 알림으로 뜬다 (Phase 35)
  if private.viewing_room(v_to, m.room_id) then return jsonb_build_object('skip', 'viewing'); end if;
  v_subs := private.push_target(v_to);          -- 기기가 없으면 { skip }
  if v_subs ? 'skip' then return v_subs; end if;
  v_subs := v_subs -> 'subs';

  -- ★ 알림 문구에 uuid 는 없다. 제목 = 받는 사람이 보는 상대 이름(보낸 사람의 익명 이름).
  --   id · at = 서비스워커가 늦게 도착한 알림으로 새 알림을 덮지 않게 (같은 대화의 알림은 한 장에 최근 말 몇 줄로 모인다)
  v_job := private.push_reserve('chat',p_message,p_sender);
  if v_job is null then return jsonb_build_object('skip','already'); end if;
  return v_job || jsonb_build_object(
    'title',   case when m.sender_seat = 1 then r.alias1 else r.alias2 end,
    'body',    left(m.body, 120),
    'room_id', m.room_id,
    'id',      m.id,
    'at',      m.created_at,
    'subs',    v_subs);
end
$fn$;
create or replace function public.reaction_push_payload(p_message bigint, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  m      public.messages%rowtype;
  r      public.rooms%rowtype;
  v_seat smallint;
  v_rx   public.message_reactions%rowtype;
  v_to   uuid;
  v_subs jsonb;
  v_job jsonb;
begin
  select * into m from public.messages where id = p_message;
  if not found then return jsonb_build_object('skip', 'no_message'); end if;
  select seat into v_seat from public.room_members where room_id = m.room_id and user_id = p_actor;
  if v_seat is null then return jsonb_build_object('skip', 'not_member'); end if;
  if m.sender_seat = v_seat or m.sender_seat = 0 then return jsonb_build_object('skip', 'own_message'); end if;
  select * into v_rx from public.message_reactions where message_id = p_message and seat = v_seat;
  if not found or v_rx.emoji is null then return jsonb_build_object('skip', 'no_reaction'); end if;
  if v_rx.updated_at < now() - interval '10 minutes' then return jsonb_build_object('skip', 'stale'); end if;
  select * into r from public.rooms where id = m.room_id;
  if r.status = 'closed' then return jsonb_build_object('skip', 'closed'); end if;



  select user_id into v_to from public.room_members where room_id = m.room_id and seat = m.sender_seat;
  if private.viewing_room(v_to, m.room_id) then return jsonb_build_object('skip', 'viewing'); end if;
  v_subs := private.push_target(v_to);
  if v_subs ? 'skip' then return v_subs; end if;
  v_subs := v_subs -> 'subs';

  v_job := private.push_reserve('reaction',p_message,p_actor);
  if v_job is null then return jsonb_build_object('skip','already'); end if;
  return v_job || jsonb_build_object(
    'title',   case when v_seat = 1 then r.alias1 else r.alias2 end,
    'body',    (case v_rx.emoji when 'heart' then '❤️' when 'laugh' then '😂' when 'wow' then '😮'
                               when 'sad' then '😢' when 'like' then '👍' else '🔥' end)
               || ' 공감: ' || left(m.body, 80),
    'room_id', m.room_id,
    'subs',    v_subs);
end
$fn$;
create or replace function public.dm_push_payload(p_msg bigint, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare m private.dm_msgs%rowtype; t private.dm_threads%rowtype; v_to uuid; v_subs jsonb;
  v_job jsonb;
begin
  select * into m from private.dm_msgs where id = p_msg;
  if not found or m.status <> 'visible' or not m.is_letter or not m.delivered then return jsonb_build_object('skip', 'no_message'); end if;
  select * into t from private.dm_threads where id = m.thread_id;
  if private.dm_writer(m, t) is distinct from p_actor then return jsonb_build_object('skip', 'not_author'); end if;
  if m.created_at < now() - interval '10 minutes' then return jsonb_build_object('skip', 'stale'); end if;
  if t.status <> 'open' then return jsonb_build_object('skip', 'closed'); end if;
  if private.blocked_between(t.sender_id, t.recipient_id) then return jsonb_build_object('skip', 'blocked'); end if;

  v_to := private.dm_reader(m, t);
  v_subs := private.push_target(v_to);
  if v_subs ? 'skip' then return v_subs; end if;
  -- ★ 받는 사람 쪽 알림에 보낸 사람 정보 없음 (성별만)
  v_job := private.push_reserve('letter',p_msg,p_actor);
  if v_job is null then return jsonb_build_object('skip','already'); end if;
  return v_job || jsonb_build_object(
    'title', case when m.from_sender
                  then coalesce(m.from_nick, '익명의 ' || case m.from_gender when 'm' then '남학생' when 'f' then '여학생' else '학생' end)
                       || '에게서 편지가 왔어요'
                  else (select name from private.person(t.recipient_id)) || '님의 답장이 왔어요' end,
    'body',  '봉투를 열어 확인해 보세요',
    'url',   '/letters/m/' || m.id,
    'tag',   'dm-' || m.id,
    'subs',  v_subs -> 'subs');
end
$fn$;
create or replace function public.personal_notice_push(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare n private.personal_notices%rowtype; v_subs jsonb;
  v_job jsonb;
begin
  select * into n from private.personal_notices where id = p_id and removed_at is null;
  if not found then return jsonb_build_object('skip', 'no_notice'); end if;
  if n.created_at < now() - interval '10 minutes' then return jsonb_build_object('skip', 'stale'); end if;

  v_subs := private.push_target(n.user_id);
  if v_subs ? 'skip' then return v_subs; end if;
  v_job := private.push_reserve('notice',p_id,null);
  if v_job is null then return jsonb_build_object('skip','already'); end if;
  return v_job || jsonb_build_object(
    'title', case when n.kind = 'warning' then '운영진 경고' else '운영진이 보낸 공지' end,
    'body',  n.title,
    'url',   '/notices',
    'tag',   'pn-' || n.id,
    'subs',  v_subs -> 'subs');
end
$fn$;
create or replace function public.admin_export_messages_bounded(
  p_staff uuid, p_from timestamptz, p_to timestamptz, p_after bigint, p_limit int, p_upper bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare v_csv text; v_last bigint; v_n int;
begin
  perform private.require_perm(p_staff,'identity');
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'bad_range'; end if;
  -- 모든 조각을 기록한다. 임의 커서로 시작한 내보내기도 열람 기록을 우회할 수 없다.
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'export_messages', jsonb_build_object('from', p_from, 'to', p_to, 'after', coalesce(p_after, 0)));

  with x as (
    select m.id, m.room_id, r.status, m.sender_seat,
           case m.sender_seat when 1 then r.alias1 when 2 then r.alias2 else '시스템 안내' end as alias,
           m.created_at, m.body, m.reply_to
      from public.messages m
      join public.rooms r on r.id = m.room_id
     where m.id > coalesce(p_after, 0) and m.id <= p_upper and m.created_at >= p_from and m.created_at < p_to
     order by m.id
     limit least(greatest(coalesce(p_limit, 5000), 1), 10000)
  )
  select string_agg(array_to_string(array[
           x.id::text, x.room_id::text, x.status, x.sender_seat::text, private.csv_cell(x.alias),
           to_char(x.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
           private.csv_cell(x.body), coalesce(x.reply_to::text, '')], ','), E'\n' order by x.id),
         max(x.id), count(*)
    into v_csv, v_last, v_n
    from x;
  return jsonb_build_object('csv', coalesce(v_csv, ''), 'last_id', v_last, 'count', v_n);
end
$fn$;
revoke all on function public.admin_export_messages_bounded(uuid,timestamptz,timestamptz,bigint,int,bigint) from public,anon,authenticated;
grant execute on function public.admin_export_messages_bounded(uuid,timestamptz,timestamptz,bigint,int,bigint) to service_role;
-- R09: 운영자 쿠키를 검증된 Auth session과 개별 폐기 가능한 세션 ID에 연결한다.
create table if not exists private.admin_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  auth_session uuid not null,
  password_fingerprint text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '8 hours',
  revoked_at timestamptz
);
create index if not exists admin_sessions_user on private.admin_sessions(user_id);
alter table private.admin_sessions enable row level security;
revoke all on private.admin_sessions from public,anon,authenticated;
create or replace function public.admin_session_issue(p_user uuid,p_auth_session uuid)
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare sid uuid;
begin
  perform private.require_staff(p_user);
  if not exists(select 1 from auth.sessions where id=p_auth_session and user_id=p_user
    and (not_after is null or not_after > now())) then raise exception 'invalid_auth_session'; end if;
  insert into private.admin_sessions(user_id,auth_session,password_fingerprint)
    select p_user,p_auth_session,encode(sha256(convert_to(coalesce(encrypted_password,''),'UTF8')),'hex') from auth.users where id=p_user returning id into sid;
  return sid;
end
$fn$;
create or replace function public.admin_session_valid(p_user uuid,p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists(select 1 from private.admin_sessions a join auth.sessions s on s.id=a.auth_session and s.user_id=a.user_id
    join auth.users u on u.id=a.user_id where a.id=p_session and a.user_id=p_user and a.revoked_at is null
    and a.expires_at > now() and (s.not_after is null or s.not_after > now())
    and a.password_fingerprint=encode(sha256(convert_to(coalesce(u.encrypted_password,''),'UTF8')),'hex'));
$fn$;
create or replace function public.admin_session_revoke(p_user uuid,p_session uuid)
returns void language sql security definer set search_path = '' as $fn$
  update private.admin_sessions set revoked_at=now() where id=p_session and user_id=p_user;
$fn$;
revoke all on function public.admin_session_issue(uuid,uuid),public.admin_session_valid(uuid,uuid),public.admin_session_revoke(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_session_issue(uuid,uuid),public.admin_session_valid(uuid,uuid),public.admin_session_revoke(uuid,uuid) to service_role;

-- R06: 원문/기기 키를 복사하지 않고 발송 식별자와 임대·성공·실패 상태만 보관한다.
create table if not exists private.push_outbox (
  job_key text primary key,
  kind text not null check(kind in ('chat','reaction','letter','notice')),
  ref_id bigint not null,
  actor uuid,
  state text not null check(state in ('pending','sent','failed','skipped')),
  lease uuid not null,
  leased_until timestamptz not null,
  attempts int not null default 1,
  sent int not null default 0,
  failed int not null default 0,
  next_attempt timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists push_outbox_retry on private.push_outbox(next_attempt) where state in ('pending','failed');
alter table private.push_outbox enable row level security;
revoke all on private.push_outbox from public,anon,authenticated;
create or replace function private.push_reserve(p_kind text,p_id bigint,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_key text := p_kind||':'||p_id||':'||coalesce(p_actor::text,''); v_lease uuid := gen_random_uuid(); ok boolean;
begin
  insert into private.push_outbox(job_key,kind,ref_id,actor,state,lease,leased_until)
    values(v_key,p_kind,p_id,p_actor,'pending',v_lease,clock_timestamp()+interval '90 seconds')
    on conflict(job_key) do update set state='pending',lease=excluded.lease,leased_until=excluded.leased_until,attempts=private.push_outbox.attempts+1
    where private.push_outbox.attempts < 3 and private.push_outbox.created_at > now()-interval '10 minutes'
      and ((private.push_outbox.state='failed' and private.push_outbox.next_attempt <= now())
        or (private.push_outbox.state='pending' and private.push_outbox.leased_until <= clock_timestamp()));
  ok := found;
  return case when ok then jsonb_build_object('job',v_key,'lease',v_lease) else null end;
end
$fn$;
revoke all on function private.push_reserve(text,bigint,uuid) from public,anon,authenticated;
create or replace function public.push_complete(p_job text,p_lease uuid,p_sent int,p_failed int,p_skip boolean default false)
returns boolean language plpgsql security definer set search_path = '' as $fn$
begin
  update private.push_outbox set state=case when p_skip then 'skipped' when p_sent > 0 then 'sent' else 'failed' end,
    sent=greatest(p_sent,0),failed=greatest(p_failed,0),next_attempt=now()+interval '15 seconds'
    where job_key=p_job and lease=p_lease and state='pending';
  return found;
end
$fn$;
create or replace function public.push_retry_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare job private.push_outbox%rowtype; payload jsonb; out jsonb := '[]'::jsonb;
begin
  -- 아래 payload 함수가 자기 job을 원자적으로 임대한다. 병렬 소비자는 already를 받고 건너뛴다.
  for job in select * from private.push_outbox where attempts < 3 and created_at > now()-interval '10 minutes'
    and ((state='failed' and next_attempt <= now()) or (state='pending' and leased_until <= clock_timestamp()))
    order by next_attempt limit 20 loop
    payload := case job.kind
      when 'chat' then public.push_payload(job.ref_id,job.actor)
      when 'reaction' then public.reaction_push_payload(job.ref_id,job.actor)
      when 'letter' then public.dm_push_payload(job.ref_id,job.actor)
      when 'notice' then public.personal_notice_push(job.ref_id) end;
    if payload ? 'skip' then
      if payload->>'skip' <> 'already' then update private.push_outbox set state='skipped' where job_key=job.job_key and lease=job.lease; end if;
    else out := out || jsonb_build_array(payload || jsonb_build_object('kind',job.kind)); end if;
  end loop;
  return out;
end
$fn$;
revoke all on function public.push_complete(text,uuid,int,int,boolean),public.push_retry_jobs() from public,anon,authenticated;
grant execute on function public.push_complete(text,uuid,int,int,boolean),public.push_retry_jobs() to service_role;

-- R23: 같은 DB snapshot이라고 주장하지 않는다. 상한 ID/생성 시점/기간을 고정한 추출 작업.
create table if not exists private.message_exports (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references auth.users on delete cascade,
  from_at timestamptz not null, to_at timestamptz not null,
  upper_id bigint not null,
  created_at timestamptz not null default now()
);
alter table private.message_exports enable row level security;
revoke all on private.message_exports from public,anon,authenticated;
create or replace function public.admin_export_start(p_staff uuid,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare job private.message_exports%rowtype;
begin
  perform private.require_perm(p_staff,'identity');
  if p_from is null or p_to is null or p_to <= p_from or p_to-p_from > interval '31 days' then raise exception 'bad_range'; end if;
  insert into private.message_exports(staff_id,from_at,to_at,upper_id)
    select p_staff,p_from,p_to,coalesce(max(id),0) from public.messages returning * into job;
  return jsonb_build_object('id',job.id,'upper_id',job.upper_id,'created_at',job.created_at);
end
$fn$;
create or replace function public.admin_export_chunk(p_staff uuid,p_job uuid,p_after bigint default 0)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare job private.message_exports%rowtype; result jsonb;
begin
  perform private.require_perm(p_staff,'identity');
  select * into job from private.message_exports where id=p_job and staff_id=p_staff and created_at > now()-interval '1 hour';
  if not found then raise exception 'export_expired'; end if;
  result := public.admin_export_messages_bounded(p_staff,job.from_at,job.to_at,p_after,5000,job.upper_id);
  return result || jsonb_build_object('job_id',job.id,'upper_id',job.upper_id,'created_at',job.created_at);
end
$fn$;
revoke all on function public.admin_export_start(uuid,timestamptz,timestamptz),public.admin_export_chunk(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.admin_export_start(uuid,timestamptz,timestamptz),public.admin_export_chunk(uuid,uuid,bigint) to service_role;


-- 실패 응답이 모델 미실행을 보장하지 않으므로 검토 승인 예산은 환불하지 않는다.
create or replace function public.mod_release(p_ids bigint[])
returns void language sql security definer set search_path = public, private as $fn$
  update private.mod_queue set status = case when tries >= 3 then 'error' else 'pending' end,
         done_at = case when tries >= 3 then now() else null end
   where id = any(p_ids) and status = 'working';
$fn$;
revoke all on function public.mod_release(bigint[]) from public,anon,authenticated;
grant execute on function public.mod_release(bigint[]) to service_role;

-- 통계 singleton 복구도 참여 학생에게 알린다.
drop trigger if exists signup_stats_insert_rt on public.signup_stats;
create trigger signup_stats_insert_rt after insert on public.signup_stats
  for each row execute function private.rt_broadcast();

commit;
