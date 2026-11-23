-- ════════════════════════════════════════════════════════════════════
--  Phase 100 — 내 매칭 기준에 맞는 사람이 접속 중이면 "현재 누군가 접속중이에요 매칭을 돌려볼까요?"
--
--  · 기준은 request_match 와 같다 (서로의 성별 조건 · 차단 · 재매칭 제한 · 이미 대화 중 · 대화 상한).
--  · 학생마다 하루(한국 날짜) 한 번, 아침 8시 ~ 밤 11시 — 앱 안 알림과 푸시를 합쳐서 한 번이다 (private.online_nudges).
--  · 앱을 켜 둔 학생: 이미 보내는 heartbeat 대답(match_nudge)을 보고 앱이 claim_match_nudge() 로 받아 앱 안 알림을 띄운다.
--    찾는 중 · 대화방을 보는 중 · 다른 창이 떠 있으면 다음 박동까지 기다린다.
--  · 앱을 안 켠 학생: Worker 의 1분 예약 작업이 이미 부르는 push_retry_jobs() 가 30대씩 돌려준다. 방금(30분 안에) 앱을 쓴 학생은 뺀다.
--  · 설정 › 알림에서 끌 수 있다 (mute 'online').
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.online_nudges (
  user_id uuid primary key references auth.users on delete cascade,
  day     date not null,                               -- 마지막으로 받은 한국 날짜
  sent_at timestamptz not null default now()
);
alter table private.online_nudges enable row level security;
revoke all on private.online_nudges from public, anon, authenticated;

-- 보내지 않는 시간 (한국 시간 밤 11시 ~ 아침 8시)
create or replace function private.nudge_quiet(p_at timestamptz default now())
returns boolean language sql stable set search_path = '' as $fn$
  select extract(hour from p_at at time zone 'Asia/Seoul') not between 8 and 22;
$fn$;
revoke all on function private.nudge_quiet(timestamptz) from public, anon, authenticated;

-- 나와 이어질 수 있는 사람이 지금 찾고 있나(p_online = false) · 접속해 있나(true) — request_match 의 상대 조건과 같다
create or replace function private.match_available(p_me uuid, p_online boolean)
returns boolean language plpgsql stable security definer set search_path = public, private as $fn$
declare
  cfg public.app_settings%rowtype;
  m   public.profiles%rowtype;
begin
  select * into cfg from public.app_settings where id;
  select * into m from public.profiles where id = p_me;
  if not found then return false; end if;
  return exists (
    select 1
      from public.user_presence c
      join public.profiles p on p.id = c.user_id
     where c.user_id <> p_me
       and (case when p_online then c.online_until else c.seeking_until end) > now()
       and private.open_rooms(c.user_id) < cfg.max_open_rooms
       and not exists (select 1 from public.room_members x
                         join public.room_members y on y.room_id = x.room_id
                        where x.user_id = p_me and x.open and y.user_id = c.user_id)
       and p.status = 'active' and p.verified and p.onboarded
       and (p.suspended_until is null or p.suspended_until <= now())
       and (m.want = 'any' or m.want = p.gender)
       and (p.want = 'any' or p.want = m.gender)
       and not exists (select 1 from public.blocks b
                        where (b.blocker_id = p_me and b.blocked_id = c.user_id)
                           or (b.blocker_id = c.user_id and b.blocked_id = p_me))
       and ((coalesce(m.allow_rematch, false) and coalesce(p.allow_rematch, false))
            or not exists (select 1 from public.pair_history h
                            where h.user_lo = least(p_me, c.user_id)
                              and h.user_hi = greatest(p_me, c.user_id)
                              and h.last_matched_at > now() - make_interval(days => cfg.rematch_cooldown_days))));
end
$fn$;
revoke all on function private.match_available(uuid, boolean) from public, anon, authenticated;

create or replace function private.someone_seeking(p_me uuid)
returns boolean language plpgsql stable security definer set search_path = public, private as $fn$
begin
  return private.match_available(p_me, false);
end
$fn$;

-- 오늘 이 학생에게 알려도 되나
create or replace function private.match_nudge_due(p_me uuid)
returns boolean language plpgsql stable security definer set search_path = public, private as $fn$
declare
  cfg public.app_settings%rowtype;
  m   public.profiles%rowtype;
begin
  if private.nudge_quiet() or private.in_maintenance() then return false; end if;
  if exists (select 1 from private.online_nudges n
              where n.user_id = p_me and n.day = (now() at time zone 'Asia/Seoul')::date) then return false; end if;
  select * into cfg from public.app_settings where id;
  if not cfg.is_open then return false; end if;
  select * into m from public.profiles where id = p_me;
  if not found or not m.verified or not m.onboarded or m.status <> 'active'
     or (m.suspended_until is not null and m.suspended_until > now()) then return false; end if;
  if exists (select 1 from public.user_presence up where up.user_id = p_me and up.seeking_until > now()) then return false; end if;
  if exists (select 1 from public.room_members rm where rm.user_id = p_me and rm.open and rm.viewing_until > now()) then return false; end if;
  if private.open_rooms(p_me) >= cfg.max_open_rooms then return false; end if;
  return private.match_available(p_me, true);
end
$fn$;
revoke all on function private.match_nudge_due(uuid) from public, anon, authenticated;

-- 오늘 몫을 받아 간다 — 앱 안 알림과 푸시가 겹치지 않게 한 줄로
create or replace function private.take_match_nudge(p_me uuid)
returns boolean language plpgsql security definer set search_path = public, private as $fn$
declare v_day date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not private.match_nudge_due(p_me) then return false; end if;
  insert into private.online_nudges (user_id, day) values (p_me, v_day)
  on conflict (user_id) do update set day = excluded.day, sent_at = now()
   where private.online_nudges.day < excluded.day;
  return found;
end
$fn$;
revoke all on function private.take_match_nudge(uuid) from public, anon, authenticated;

create or replace function public.claim_match_nudge()
returns boolean language plpgsql security definer set search_path = public, private as $fn$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  return private.take_match_nudge(auth.uid());
end
$fn$;
revoke all on function public.claim_match_nudge() from public, anon;
grant execute on function public.claim_match_nudge() to authenticated;

-- 이번 분에 앱을 안 켠 학생들에게 보낼 한 묶음 (없으면 null)
create or replace function private.online_nudge_push_batch()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_day  date := (now() at time zone 'Asia/Seoul')::date;
  u      uuid;
  v_one  jsonb;
  v_subs jsonb := '[]'::jsonb;
begin
  if private.nudge_quiet() or private.in_maintenance()
     or not coalesce((select s.is_open from public.app_settings s where s.id), false)
     or not exists (select 1 from public.user_presence p where p.online_until > now()) then
    return null;
  end if;
  for u in
    select s.user_id from public.push_subscriptions s
     where not ('online' = any(s.mute))
       and not exists (select 1 from public.user_presence up
                        where up.user_id = s.user_id and up.online_until > now() - interval '30 minutes')
       and not exists (select 1 from private.online_nudges n where n.user_id = s.user_id and n.day = v_day)
     group by s.user_id
     order by random()
     limit 60
  loop
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'mute', s.mute)), '[]'::jsonb)
      into v_one from public.push_subscriptions s where s.user_id = u and not ('online' = any(s.mute));
    exit when jsonb_array_length(v_subs) + jsonb_array_length(v_one) > 30;
    if private.take_match_nudge(u) then v_subs := v_subs || v_one; end if;
  end loop;
  if jsonb_array_length(v_subs) = 0 then return null; end if;
  return jsonb_build_object('kind', 'online', 'title', 'Landy', 'body', '현재 누군가 접속중이에요 매칭을 돌려볼까요?',
                            'url', '/?seek', 'tag', 'match-nudge', 'subs', v_subs);
end
$fn$;
revoke all on function private.online_nudge_push_batch() from public, anon, authenticated;

create or replace function public.heartbeat(p_online boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare cfg public.app_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into cfg from public.app_settings where id;
  if p_online then
    update public.user_presence
       set online_until = greatest(online_until, now() + make_interval(secs => cfg.online_ttl_sec))
     where user_id = auth.uid();
    perform private.touch_streak(auth.uid());
  else
    update public.user_presence
       set online_until = now(), seeking_until = null, seeking_since = null
     where user_id = auth.uid();
  end if;
  -- 서버 점검(Phase 52) — 앱이 1분마다 보내는 이 박동의 대답으로 알린다(요청을 따로 늘리지 않는다)
  -- 예약(Phase 53): 시각이 지나면 점검 중으로 치고, 아직이면 24시간 안의 예약을 미리 알린다(홈 예고)
  return jsonb_build_object('server_now', now(),
    'maintenance', case when private.in_maintenance() then jsonb_build_object('msg', cfg.maintenance_msg, 'until', cfg.maintenance_until) end,
    'maintenance_at', case when not private.in_maintenance() and cfg.maintenance_at > now() and cfg.maintenance_at < now() + interval '24 hours'
                           then cfg.maintenance_at end,
    -- 새로 딴 업적이 있나 (Phase 55) — 앱이 10분마다 따로 묻던 것을 박동에 싣는다. 있을 때만 앱이 new_achievements() 를 부른다
    'ach_new', p_online and exists (select 1 from private.user_achievements a join public.profiles p on p.id = a.user_id
                                     where a.user_id = auth.uid() and a.earned_at > coalesce(p.ach_seen_at, '-infinity')),
    -- 내 기준에 맞는 사람이 접속 중이고 오늘 아직 안 알렸나 (Phase 100)
    'match_nudge', case when p_online then private.match_nudge_due(auth.uid()) else false end);
end
$fn$;

create or replace function public.set_push_mute(p_endpoint text, p_mute text[])
returns void language plpgsql security definer set search_path = public as $fn$
declare m text[];
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select coalesce(array_agg(distinct k order by k), '{}') into m
    from unnest(coalesce(p_mute, '{}')) k
   where k in ('chat', 'reaction', 'letter', 'crowd', 'online');
  update public.push_subscriptions set mute = m where endpoint = p_endpoint and user_id = auth.uid();
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
  -- 한 번 실행에 대량 발송은 한 묶음만 (Worker 하위 요청 한도) — 편지 열림(Phase 99) → 접속자 알림(Phase 92) → 맞는 사람 접속(Phase 100)
  payload := coalesce(private.letters_open_push_batch(), private.crowd_push_batch(), private.online_nudge_push_batch());
  if payload is not null then out := out || jsonb_build_array(payload); end if;
  return out;
end
$fn$;
notify pgrst, 'reload schema';
