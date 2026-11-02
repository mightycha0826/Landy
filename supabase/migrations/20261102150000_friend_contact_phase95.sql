-- ════════════════════════════════════════════════════════════════════
--  Phase 95 — 익명 친구에게 연락해보기: 익명 친구 카드를 눌러 크게 본 뒤 "연락해보기"로 대화를 건다
--
--  · anon_friends() 가 카드마다 연락용 표(token)를 같이 준다 — uuid 대신. 표는 받은 학생만 · 1시간 · 한 번 쓴다.
--    다시 펼치면(anon_friends 를 다시 부르면) 이전 표는 지워진다. (anon_friends 는 Phase 93 에서 옮겨 와 여기서 고쳤다)
--  · friend_contact(token) — 대기(pending) 대화를 만든다. 건 사람은 이미 들어와 있고(joined_at), 받는 사람이
--    대화 목록에서 "새 대화 · 눌러서 시작하기"를 누르면(ack_room) 랜덤 채팅과 똑같이 시작한다. 하루 안에 안 열면 no_show 로 닫힌다.
--  · 이 대화도 동시 대화 상한(max_open_rooms, 고정 대화 제외)에 센다 — 건 사람 · 받는 사람 둘 다.
--    이미 둘이 열린 대화가 있으면 그 대화로 보낸다. 매칭과 같은 한도(match_bucket_take)를 쓴다.
--  · 방 안 이름은 랜덤 채팅과 같이 계정의 익명 이름(Phase 8) — 카드의 임의 별명과는 다르다.
--  실DB 는 supabase/migrations/20261102150000_friend_contact_phase95.sql (이 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.friend_cards (
  token      uuid primary key default gen_random_uuid(),
  viewer     uuid not null references public.profiles(id) on delete cascade,
  target     uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists friend_cards_viewer on private.friend_cards (viewer);
alter table private.friend_cards enable row level security;
revoke all on private.friend_cards from public, anon, authenticated;

-- 익명 친구들 (Phase 93) — 무작위 10명의 익명 프로필 + 카드마다 연락용 표
create or replace function public.anon_friends()
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare me uuid := auth.uid(); v jsonb;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  delete from private.friend_cards where viewer = me or created_at < now() - interval '1 hour';
  with x as (
    select p.id, p.bio, p.interests, p.mbti, p.manner_temp
      from public.profiles p
     where p.id <> me and p.verified and p.onboarded
       and p.status = 'active' and (p.suspended_until is null or p.suspended_until <= now())
       and (p.bio <> '' or p.mbti is not null or cardinality(p.interests) > 0)
       and not private.blocked_between(me, p.id)
     order by random()
     limit 10),
  c as (insert into private.friend_cards (viewer, target) select me, x.id from x returning token, target)
  select jsonb_agg(jsonb_build_object(
           'token',       c.token,
           'nickname',    public.random_alias(),
           'bio',         x.bio,
           'interests',   to_jsonb(x.interests),
           'mbti',        x.mbti,
           'manner_temp', x.manner_temp,
           'badges',      private.featured_for(x.id, 'chat'),
           'online',      coalesce((select up.online_until > now() from public.user_presence up where up.user_id = x.id), false)))
    into v from x join c on c.target = x.id;
  return coalesce(v, '[]'::jsonb);
end
$fn$;
revoke all on function public.anon_friends() from public, anon;
grant execute on function public.anon_friends() to authenticated;

-- 연락해보기 — { status: ok, room_id } · service_closed · not_eligible · expired(표가 없거나 지남) · unavailable(상대가 정지 · 차단)
--   · full(내 대화가 꽉 참) · partner_full(상대 대화가 꽉 참) · cooldown(너무 자주)
create or replace function public.friend_contact(p_token uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me       uuid := auth.uid();
  cfg      public.app_settings%rowtype;
  m        public.profiles%rowtype;
  p        public.profiles%rowtype;
  v_target uuid;
  v_room   uuid;
  v_bucket jsonb;
  a1 text; a2 text;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into cfg from public.app_settings where id;
  if not cfg.is_open or private.in_maintenance() then return jsonb_build_object('status', 'service_closed'); end if;
  select * into m from public.profiles where id = me;
  if not found or not m.verified or not m.onboarded or m.status <> 'active'
     or (m.suspended_until is not null and m.suspended_until > now()) then
    return jsonb_build_object('status', 'not_eligible');
  end if;
  select target into v_target from private.friend_cards
   where token = p_token and viewer = me and created_at > now() - interval '1 hour';
  if v_target is null then return jsonb_build_object('status', 'expired'); end if;
  select * into p from public.profiles where id = v_target;
  if not found or not p.verified or not p.onboarded or p.status <> 'active'
     or (p.suspended_until is not null and p.suspended_until > now()) or private.blocked_between(me, v_target) then
    return jsonb_build_object('status', 'unavailable');
  end if;

  -- 매칭과 같은 잠금 — 동시에 걸린 대화 · 매칭이 상한을 넘기지 않게
  perform pg_advisory_xact_lock(hashtext('simbun_match_pool'));
  select x.room_id into v_room
    from public.room_members x
    join public.room_members y on y.room_id = x.room_id and y.user_id = v_target
    join public.rooms r on r.id = x.room_id
   where x.user_id = me and x.open and r.status <> 'closed' and now() < r.expires_at
   limit 1;
  if v_room is not null then return jsonb_build_object('status', 'ok', 'room_id', v_room); end if;
  if private.open_rooms(me) >= cfg.max_open_rooms then
    return jsonb_build_object('status', 'full', 'max', cfg.max_open_rooms);
  end if;
  if private.open_rooms(v_target) >= cfg.max_open_rooms then return jsonb_build_object('status', 'partner_full'); end if;
  v_bucket := public.match_bucket_take(me);
  if not coalesce((v_bucket->>'ok')::boolean, true) then
    return jsonb_build_object('status', 'cooldown', 'retry_after_ms', (v_bucket->>'retry_after_ms')::int);
  end if;

  a1 := coalesce(m.nickname, public.random_alias());
  a2 := coalesce(p.nickname, public.random_alias());
  while a2 = a1 loop a2 := public.random_alias(); end loop;
  insert into public.rooms (status, expires_at, alias1, alias2)
  values ('pending', now() + interval '1 day', a1, a2)
  returning id into v_room;
  insert into public.room_members (room_id, user_id, seat, joined_at)
  values (v_room, me, 1, now()), (v_room, v_target, 2, null);
  delete from private.friend_cards where token = p_token;
  return jsonb_build_object('status', 'ok', 'room_id', v_room);
end
$fn$;
revoke all on function public.friend_contact(uuid) from public, anon;
grant execute on function public.friend_contact(uuid) to authenticated;
notify pgrst, 'reload schema';
