-- ════════════════════════════════════════════════════════════════════
--  Phase 101 — Disk IO 예산 경고: 바뀌는 게 없는데 디스크에 쓰던 일을 뺀다
--
--  Supabase 가 "Disk IO Budget 소진" 경고를 보냈다 (기준 5 MB/s). 동작은 그대로, 쓰기만 줄인다.
--  · private.room_clock — 대화 화면이 30초마다 보내는 "보고 있음"(room_view)이 방 행을 두 번씩 잠갔다.
--    대부분 이미 흐르는 중 · 멈춘 중이라 바꿀 게 없다. 이제 잠그지 않고 먼저 보고, 바꿀 때만 잠근 뒤 다시 본다.
--  · public.request_match — 찾는 중 화면이 몇 초마다 부를 때마다 user_presence 를 고쳐 썼다.
--    남은 시간(seek_ttl_sec)이 절반 넘게 남아 있으면 쓰지 않는다 → 쓰기 절반, 대부분의 대기 요청은 읽기만 한다.
--  · private.crowd_push_batch · private.letters_open_push_batch — 1분마다 불리며 다 끝난 날에도 행을 잠갔다. 끝났으면 바로 돌아간다.
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.request_match()
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me        uuid := auth.uid();
  cfg       public.app_settings%rowtype;
  m         public.profiles%rowtype;
  v_now     timestamptz := now();
  v_partner uuid;
  v_room    uuid;
  v_pool    int;
  v_exp     record;
  v_bucket  jsonb;
  v_open    int;
  a1 text; a2 text;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into cfg from public.app_settings where id;
  if not cfg.is_open or private.in_maintenance() then -- 서버 점검 중(Phase 52 · 예약 53)에도 새 대화 없음
    return jsonb_build_object('status', 'service_closed', 'notice', cfg.notice, 'server_now', v_now);
  end if;

  select * into m from public.profiles where id = me;
  if not found or not m.verified or not m.onboarded or m.status <> 'active'
     or (m.suspended_until is not null and m.suspended_until > v_now) then
    return jsonb_build_object('status', 'not_eligible', 'server_now', v_now);
  end if;

  -- 방금 갱신해서 남은 시간이 절반 넘게 있으면 다시 쓰지 않는다 — 몇 초마다 오는 대기 요청이 매번 디스크에 쓰지 않게 (Phase 101)
  if not exists (select 1 from public.user_presence
                  where user_id = me and seeking_since is not null
                    and seeking_until > v_now + cfg.seek_ttl_sec * interval '500 milliseconds'
                    and online_until  > v_now + cfg.seek_ttl_sec * interval '500 milliseconds') then
    insert into public.user_presence (user_id, online_until, seeking_until, seeking_since)
    values (me, v_now + make_interval(secs => cfg.seek_ttl_sec),
                v_now + make_interval(secs => cfg.seek_ttl_sec), v_now)
    on conflict (user_id) do update
       set online_until  = greatest(public.user_presence.online_until, excluded.online_until),
           seeking_until = excluded.seeking_until,
           seeking_since = coalesce(public.user_presence.seeking_since, excluded.seeking_since);
  end if;

  if not pg_try_advisory_xact_lock(hashtext('simbun_match_pool')) then
    return jsonb_build_object('status', 'busy', 'retry_after_ms', 300, 'server_now', v_now);
  end if;

  for v_exp in
    select r.id, r.status from public.rooms r
      join public.room_members rm on rm.room_id = r.id
     where rm.user_id = me and rm.open and r.status <> 'closed' and v_now >= r.expires_at
  loop
    perform public.close_if_expired(v_exp.id);
  end loop;

  select rm.room_id into v_room
    from public.room_members rm join public.rooms r on r.id = rm.room_id
   where rm.user_id = me and rm.open and rm.joined_at is null and r.status = 'pending'
   order by r.created_at desc limit 1;
  if v_room is not null then
    update public.user_presence set seeking_until = null, seeking_since = null where user_id = me;
    return jsonb_build_object('status', 'matched', 'room_id', v_room, 'server_now', v_now);
  end if;

  -- 동시 대화 상한 — 고정한 대화는 빼고 센다
  v_open := private.open_rooms(me);
  if v_open >= cfg.max_open_rooms then
    update public.user_presence set seeking_until = null, seeking_since = null where user_id = me;
    return jsonb_build_object('status', 'full', 'max', cfg.max_open_rooms, 'server_now', v_now);
  end if;

  select c.user_id into v_partner
    from public.user_presence c
    join public.profiles p on p.id = c.user_id
   where c.user_id <> me
     and c.seeking_until > v_now
     and private.open_rooms(c.user_id) < cfg.max_open_rooms
     and not exists (select 1 from public.room_members x
                       join public.room_members y on y.room_id = x.room_id
                      where x.user_id = me and x.open and y.user_id = c.user_id)
     and p.status = 'active' and p.verified and p.onboarded
     and (p.suspended_until is null or p.suspended_until <= v_now)
     and (m.want = 'any' or m.want = p.gender)
     and (p.want = 'any' or p.want = m.gender)
     and not exists (select 1 from public.blocks b
                      where (b.blocker_id = me and b.blocked_id = c.user_id)
                         or (b.blocker_id = c.user_id and b.blocked_id = me))
     and ((coalesce(m.allow_rematch, false) and coalesce(p.allow_rematch, false))
          or not exists (select 1 from public.pair_history h
                          where h.user_lo = least(me, c.user_id)
                            and h.user_hi = greatest(me, c.user_id)
                            and h.last_matched_at > v_now - make_interval(days => cfg.rematch_cooldown_days)))
   order by exists (select 1 from public.pair_history h
                     where h.user_lo = least(me, c.user_id)
                       and h.user_hi = greatest(me, c.user_id)
                       and h.last_matched_at > v_now - make_interval(days => cfg.rematch_cooldown_days)),
            c.seeking_since asc,
            random()
   limit 1;

  if v_partner is null then
    select count(*) into v_pool
      from public.user_presence
     where user_id <> me and seeking_until > v_now;
    return jsonb_build_object(
      'status', 'waiting',
      'reason', case when v_pool = 0 then 'empty' else 'filtered' end,
      'poll_ms', cfg.seek_poll_sec * 1000,
      'server_now', v_now);
  end if;

  v_bucket := public.match_bucket_take(me);
  if not (v_bucket->>'ok')::boolean then
    return jsonb_build_object('status', 'cooldown',
      'retry_after_ms', (v_bucket->>'retry_after_ms')::int, 'server_now', v_now);
  end if;

  a1 := coalesce(m.nickname, public.random_alias());
  select coalesce(nickname, public.random_alias()) into a2 from public.profiles where id = v_partner;
  while a2 = a1 loop a2 := public.random_alias(); end loop;

  insert into public.rooms (status, expires_at, alias1, alias2)
  values ('pending', v_now + make_interval(secs => cfg.join_grace_sec), a1, a2)
  returning id into v_room;

  insert into public.room_members (room_id, user_id, seat)
  values (v_room, me, 1), (v_room, v_partner, 2);

  update public.user_presence
     set seeking_until = null, seeking_since = null
   where user_id in (me, v_partner);

  return jsonb_build_object('status', 'matched', 'room_id', v_room, 'server_now', v_now);

exception
  when unique_violation then
    return jsonb_build_object('status', 'retry', 'retry_after_ms', 300, 'server_now', now());
end
$fn$;

create or replace function private.room_clock(p_room uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare r public.rooms%rowtype; v_n int; v_stop timestamptz; v_left interval; v_locked boolean := false;
begin
  -- 대부분은 바꿀 게 없다 (이미 흐르는 중 · 이미 멈춤). 행 잠금도 디스크에 쓰는 일이라 바꿀 때만 잠그고 다시 본다 (Phase 101)
  loop
    if v_locked then
      select * into r from public.rooms where id = p_room for update;
    else
      select * into r from public.rooms where id = p_room;
    end if;
    if not found or r.status <> 'active' or r.pinned then return; end if;
    select count(*) filter (where viewing_until > now()), min(coalesce(viewing_until, now() - interval '90 seconds'))
      into v_n, v_stop
      from public.room_members where room_id = p_room;
    if (v_n = 2) = (r.paused_left is null) then return; end if;   -- 둘 다 보면 흐르는 중 · 아니면 멈춘 중 — 그대로
    exit when v_locked;
    v_locked := true;
  end loop;
  if v_n = 2 then
    if r.paused_left is not null then
      update public.rooms set expires_at = now() + r.paused_left, paused_left = null, paused_since = null where id = p_room;
    end if;
  elsif r.paused_left is null then
    -- 먼저 떠난 쪽이 마지막으로 보고 있던 때부터 멈춘다 (앱이 갑자기 꺼져도 90초 넘게는 흐르지 않게)
    v_stop := least(now(), greatest(v_stop, now() - interval '90 seconds', r.armed_at));
    v_left := r.expires_at - v_stop;
    if v_left > interval '0' then
      update public.rooms set paused_left = v_left, paused_since = now(), expires_at = 'infinity' where id = p_room;
    end if;
  end if;
end
$fn$;

create or replace function private.crowd_push_batch()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_day   date := (now() at time zone 'Asia/Seoul')::date;
  c       private.crowd_push%rowtype;
  v_total int;
  v_subs  jsonb;
  v_last  text;
begin
  -- 오늘 몫을 다 보냈으면 잠그지 않고 끝 — 1분마다 부르므로 (Phase 101)
  if exists (select 1 from private.crowd_push where day = v_day and done) then return null; end if;
  select * into c from private.crowd_push where day = v_day for update;
  if not found then
    v_total := coalesce((select students from public.signup_stats where id), 0);
    if v_total = 0 or (select count(*) from public.user_presence up join public.profiles p on p.id = up.user_id
                        where up.online_until > now() and p.verified and p.onboarded) * 10 < v_total * 3 then
      return null;
    end if;
    insert into private.crowd_push (day) values (v_day) on conflict (day) do nothing returning * into c;
    if not found then return null; end if;
  end if;
  if c.done then return null; end if;
  if c.started_at < now() - interval '1 hour' then
    update private.crowd_push set done = true where day = v_day;
    return null;
  end if;

  -- 지금 접속 중인 학생 · 이 알림을 끈 기기는 건너뛴다
  with b as (
    select s.endpoint, s.p256dh, s.auth, s.mute from public.push_subscriptions s
     where s.endpoint > c.sent_to and not ('crowd' = any(s.mute))
       and not exists (select 1 from public.user_presence up where up.user_id = s.user_id and up.online_until > now())
     order by s.endpoint limit 30)
  select max(b.endpoint), jsonb_agg(jsonb_build_object('endpoint', b.endpoint, 'p256dh', b.p256dh, 'auth', b.auth, 'mute', b.mute))
    into v_last, v_subs from b;
  update private.crowd_push set sent_to = coalesce(v_last, sent_to), done = v_last is null where day = v_day;
  if v_last is null then return null; end if;
  return jsonb_build_object('kind', 'crowd', 'title', 'Landy', 'body', '많은 사람들이 Landy를 이용중이에요!',
                            'url', '/', 'tag', 'crowd', 'subs', v_subs);
end
$fn$;

create or replace function private.letters_open_push_batch()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  c       private.letters_open_push%rowtype;
  v_subs  jsonb;
  v_last  text;
begin
  -- 이미 다 보냈으면 잠그지 않고 끝 — 1분마다 부르므로 (Phase 101)
  if exists (select 1 from private.letters_open_push where id and done) then return null; end if;
  select * into c from private.letters_open_push where id for update;
  if not found then
    if private.letters_locked() or private.in_maintenance()
       or not coalesce((select s.is_open from public.app_settings s where s.id), false) then
      return null;
    end if;
    insert into private.letters_open_push (id) values (true) on conflict (id) do nothing returning * into c;
    if not found then return null; end if;
  end if;
  if c.done then return null; end if;

  with b as (
    select s.endpoint, s.p256dh, s.auth, s.mute from public.push_subscriptions s
     where s.endpoint > c.sent_to and not ('letter' = any(s.mute))
     order by s.endpoint limit 30)
  select max(b.endpoint), jsonb_agg(jsonb_build_object('endpoint', b.endpoint, 'p256dh', b.p256dh, 'auth', b.auth, 'mute', b.mute))
    into v_last, v_subs from b;
  update private.letters_open_push set sent_to = coalesce(v_last, sent_to), done = v_last is null where id;
  if v_last is null then return null; end if;
  return jsonb_build_object('kind', 'letter', 'title', 'Landy', 'body', '익명편지가 열렸어요! 지금 편지를 보내 보세요',
                            'url', '/letters', 'tag', 'letters-open', 'subs', v_subs);
end
$fn$;

notify pgrst, 'reload schema';
