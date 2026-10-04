-- ════════════════════════════════════════════════════════════════════
--  Landy — 교내 익명 대화 앱 스키마
--  Supabase SQL Editor 에 통째로 붙여넣어 실행. 여러 번 실행해도 안전(idempotent).
--
--  제1원칙: 익명성을 규율이 아니라 구조로 보장한다.
--    · messages 에 식별 컬럼을 두지 않는다 (sender_seat 만)
--    · room_members 는 '내 행만' 읽힌다
--    · private 스키마는 PostgREST 에 노출하지 않는다 (URL 자체가 없음)
--    · 실명·학번을 수집하지 않는다 (이메일은 auth.users 에만 존재)
-- ════════════════════════════════════════════════════════════════════

-- ── 0. 스키마 ───────────────────────────────────────────────────────
-- ★ 함수 본문 검사를 끈다 — 함수는 처음 나오는 자리에 최종 정의 하나만 두므로(Phase 34 정리),
--   본문이 뒤에서 만드는 표 · 열 · 함수를 가리킬 수 있다. 실제 검사는 부를 때 이루어진다.
set check_function_bodies = off;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
-- ★ Dashboard > Settings > API > Exposed schemas 에 private 를 넣지 말 것.


-- ── 1. 운영 파라미터 (단일 행) ──────────────────────────────────────
-- 코드 배포 없이 학생회가 조정한다.
create table if not exists public.app_settings (
  id                    boolean  primary key default true check (id),
  is_open               boolean  not null default true,      -- 킬 스위치
  notice                text     not null default '',
  room_minutes          int      not null default 5 check (room_minutes between 1 and 60),   -- 첫 대화 5분 (Phase 44), 연장부터 extend_minutes
  extend_minutes        int      not null default 10 check (extend_minutes between 1 and 60),
  vote_window_sec       int      not null default 90,        -- 만료 N초 전부터 연장 투표 가능
  join_grace_sec        int      not null default 60,        -- 양쪽 입장 대기 한도
  max_rounds            smallint not null default 0,         -- 0 = 무제한 연장
  rematch_cooldown_days int      not null default 7,
  heartbeat_sec         int      not null default 15,
  presence_ttl_sec      int      not null default 45,
  msg_burst             real     not null default 12,        -- 토큰버킷 용량
  msg_refill_per_sec    real     not null default 1.5,
  msg_max_len           int      not null default 500
);
insert into public.app_settings (id) values (true) on conflict (id) do nothing;

alter table public.app_settings enable row level security;
drop policy if exists "settings: read" on public.app_settings;
create policy "settings: read" on public.app_settings
  for select to authenticated using (true);
revoke insert, update, delete on public.app_settings from anon, authenticated;


-- ── 2. 가입 도메인 제한 · 운영진 (private) ──────────────────────────
create table if not exists private.auth_config (
  id              boolean primary key default true check (id),
  allowed_domains text[] not null default array['cnsa.hs.kr']
);
insert into private.auth_config (id) values (true) on conflict (id) do nothing;
alter table private.auth_config enable row level security;
-- ★ 정책 0개 = anon/authenticated 전면 차단. service_role 만 통과.

create table if not exists private.staff (
  user_id    uuid primary key references auth.users on delete cascade,
  role       text not null default 'moderator' check (role in ('moderator','admin')),
  created_at timestamptz not null default now()
);
alter table private.staff enable row level security;


-- ── 3. 계정 ─────────────────────────────────────────────────────────
-- 매칭 파라미터와 상태만. 상대에게 보여줄 정보는 여기 없다(방별 alias 를 쓴다).
create table if not exists public.profiles (
  id              uuid primary key references auth.users on delete cascade,
  gender          text not null default 'x' check (gender in ('m','f','x')),
  want            text not null default 'any' check (want in ('m','f','any')),
  status          text not null default 'active' check (status in ('active','suspended','banned')),
  suspended_until timestamptz,
  strikes         smallint not null default 0,
  verified        boolean not null default false,   -- 이메일 확인 완료
  onboarded       boolean not null default false,
  created_at      timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "profiles: self read"   on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
-- (select auth.uid()) — 줄마다 다시 계산하지 않고 한 번만 (Phase 34, Supabase advisor auth_rls_initplan)
create policy "profiles: self read" on public.profiles
  for select using (id = (select auth.uid()));
create policy "profiles: self update" on public.profiles
  for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- ★ insert 정책 없음 → 가입 트리거(security definer)만 행을 만든다.
-- ★ 남의 프로필은 어떤 쿼리로도 읽히지 않는다. 매칭은 security definer RPC 안에서만.

-- 컬럼 레벨 권한: 정지당한 사용자가 스스로 status / verified 를 되돌리지 못하게
revoke update on public.profiles from authenticated;
grant  update (gender, want, onboarded) on public.profiles to authenticated;


-- presence + 레이트리밋 버킷.
-- ★ 정책 0개 — "누가 지금 접속 중인가" 자체가 비밀이어야 한다. 전부 RPC 경유.
create table if not exists public.user_presence (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  online_until    timestamptz not null default now(),
  seeking_until   timestamptz,          -- '상대 찾는 중' 만료 시각
  seeking_since   timestamptz,          -- 공정성 정렬 키 (오래 기다린 사람 우선)
  current_room_id uuid,
  msg_tokens      real not null default 12,
  tokens_at       timestamptz not null default now()
);
create index if not exists user_presence_pool
  on public.user_presence (seeking_since)
  where current_room_id is null;
alter table public.user_presence enable row level security;


-- ── 4. 가입 파이프라인 ──────────────────────────────────────────────

-- (a) 학교 이메일 도메인 강제 — 실질 권위 지점.
--     BEFORE INSERT 에서 예외를 던지면 가입 트랜잭션이 통째로 롤백된다.
create or replace function private.enforce_school_domain()
returns trigger language plpgsql security definer set search_path = private, public as $fn$
declare
  v_domain  text;
  v_allowed text[];
begin
  if new.email is null or new.email = '' then
    raise exception 'school_email_required' using errcode = '22023';
  end if;
  v_domain := lower(split_part(new.email, '@', 2));
  select allowed_domains into v_allowed from private.auth_config where id;
  if v_allowed is null or not (v_domain = any(v_allowed)) then
    raise exception 'school_email_required' using errcode = '22023';
  end if;
  return new;
end
$fn$;

drop trigger if exists enforce_domain_ins on auth.users;
create trigger enforce_domain_ins
  before insert on auth.users
  for each row execute function private.enforce_school_domain();

-- ★ 이메일 변경 경로도 막는다. 안 막으면 가입 후 외부 메일로 바꿔치기가 된다.
drop trigger if exists enforce_domain_upd on auth.users;
create trigger enforce_domain_upd
  before update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function private.enforce_school_domain();


-- (a-2) 계정 선점 방지 — 이메일 확인 전인 계정에는 비밀번호를 저장하지 않는다.
--   앱은 코드(OTP)로만 로그인하지만 Supabase 가입 API 자체는 비밀번호 가입을 받는다.
--   막지 않으면: 공격자가 피해자 이메일 + 자기 비밀번호로 미리 가입 → 피해자가 OTP 로 확인 →
--   공격자가 그 비밀번호로 피해자 계정에 로그인할 여지가 생긴다.
--   확인 전에는 비밀번호가 늘 비어 있으므로 선점해도 쓸모가 없다.
--   (대시보드에서 Auto Confirm 으로 만든 개발용 계정은 처음부터 확인된 상태라 영향 없음)
create or replace function private.strip_unconfirmed_password()
returns trigger language plpgsql security definer set search_path = private, public as $fn$
begin
  if new.email_confirmed_at is null and coalesce(new.encrypted_password, '') <> '' then
    new.encrypted_password := '';
  end if;
  return new;
end
$fn$;

drop trigger if exists strip_password_ins on auth.users;
create trigger strip_password_ins
  before insert on auth.users
  for each row execute function private.strip_unconfirmed_password();

drop trigger if exists strip_password_upd on auth.users;
create trigger strip_password_upd
  before update on auth.users
  for each row execute function private.strip_unconfirmed_password();


-- (b) 계정 부속 행 생성. 실명·학번은 저장하지 않는다.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  insert into public.profiles (id, verified)
    values (new.id, new.email_confirmed_at is not null)
    on conflict (id) do nothing;
  insert into public.user_presence (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  perform private.assign_nickname(new.id);
  return new;
end
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- (c) 이메일 확인 완료를 profiles.verified 로 동기화.
create or replace function public.sync_verified()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    update public.profiles set verified = true where id = new.id;
  end if;
  return new;
end
$fn$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.sync_verified();


-- (d) 클라이언트 폴백 — 트리거가 못 만든 경우를 대비한 자기 행 보장.
--     (gyeol-app 의 ensureProfile 패턴)
create or replace function public.ensure_self()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  insert into public.profiles (id) values (me) on conflict (id) do nothing;
  insert into public.user_presence (user_id) values (me) on conflict (user_id) do nothing;
  update public.profiles p set verified = true
    where p.id = me and not p.verified
      and exists (select 1 from auth.users u
                   where u.id = me and u.email_confirmed_at is not null);
  perform private.assign_nickname(me);
end
$fn$;
revoke all on function public.ensure_self() from public, anon;
grant execute on function public.ensure_self() to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 2 — 채팅 코어
-- ════════════════════════════════════════════════════════════════════

-- ── 5. 방 · 좌석 · 메시지 ───────────────────────────────────────────
create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  status       text not null default 'pending' check (status in ('pending','active','closed')),
  round        smallint not null default 1,
  created_at   timestamptz not null default now(),
  armed_at     timestamptz,                    -- 양쪽 입장 확인 시각 = 타이머 시작점
  expires_at   timestamptz not null,           -- pending: 입장 마감 / active: 대화 마감
  closed_at    timestamptz,
  close_reason text check (close_reason in
                ('expired','declined','skipped','no_show','left','reported','blocked','admin')),
  alias1       text not null,                  -- 방 안에서만 쓰는 이름. 방이 닫히면 버려진다.
  alias2       text not null,
  read1        bigint,                         -- seat1 이 읽은 마지막 message id
  read2        bigint
);
create index if not exists rooms_open on public.rooms (expires_at) where status <> 'closed';

create table if not exists public.room_members (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  seat      smallint not null check (seat in (1,2)),
  open      boolean not null default true,     -- 방이 살아 있는 동안 true
  joined_at timestamptz,                       -- 실제로 대화 화면을 연 시각 (Phase 3 ack_room)
  primary key (room_id, user_id)
);
create unique index if not exists rm_room_seat on public.room_members (room_id, seat);
-- (예전 "한 사람 한 방" 유니크 인덱스는 Phase 8 에서 여러 대화 동시 진행으로 바뀌며 없앴다)
drop index if exists public.rm_one_open_room;
create index if not exists rm_user_open on public.room_members (user_id) where open;

create table if not exists public.messages (
  id            bigint generated always as identity primary key,
  room_id       uuid not null references public.rooms(id) on delete cascade,
  sender_seat   smallint not null check (sender_seat in (0,1,2)),   -- 0 = 시스템 안내
  body          text not null check (char_length(btrim(body)) between 1 and 500),
  client_msg_id uuid not null,
  created_at    timestamptz not null default now()
);
-- ★ 식별 컬럼이 없다. 있을 수 없다.
create unique index if not exists messages_dedupe on public.messages (room_id, client_msg_id);
create index        if not exists messages_cursor on public.messages (room_id, id desc);


-- ── 6. RLS 헬퍼 — security definer 로 재귀를 끊는다 ─────────────────
-- rooms 정책이 room_members 를 보고 room_members 정책이 rooms 를 보면 무한 재귀.
-- (gyeol-app is_group_member 패턴)
create or replace function public.is_room_member(p_room uuid)
returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (select 1 from public.room_members
                  where room_id = p_room and user_id = auth.uid());
$fn$;

create or replace function public.my_seat(p_room uuid)
returns smallint language sql security definer set search_path = public stable as $fn$
  select seat from public.room_members where room_id = p_room and user_id = auth.uid();
$fn$;

-- 메시지를 '볼 수' 있는 방 — 닫히면 과거 대화가 사라진다
create or replace function public.room_is_visible(p_room uuid)
returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (select 1 from public.rooms where id = p_room and status <> 'closed');
$fn$;

-- 메시지를 '쓸 수' 있는 방 — ★ 만료 강제는 배치가 아니라 여기에 있다.
-- status 가 아직 active 여도 now() >= expires_at 이면 쓸 수 없다.
create or replace function public.room_is_writable(p_room uuid)
returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (select 1 from public.rooms
                  where id = p_room and status = 'active' and now() < expires_at);
$fn$;

revoke all on function public.is_room_member(uuid), public.my_seat(uuid),
                       public.room_is_visible(uuid), public.room_is_writable(uuid)
  from public, anon;
grant execute on function public.is_room_member(uuid), public.my_seat(uuid),
                          public.room_is_visible(uuid), public.room_is_writable(uuid)
  to authenticated;


-- ── 7. RLS 정책 ─────────────────────────────────────────────────────
alter table public.rooms enable row level security;
drop policy if exists "rooms: member read" on public.rooms;
create policy "rooms: member read" on public.rooms
  for select to authenticated using (public.is_room_member(id));
-- status 로 막지 않는다 — 방이 닫히는 UPDATE 를 Realtime 으로 양쪽에 전달해야 하므로.
revoke all on public.rooms from anon, authenticated;
grant select on public.rooms to authenticated;

alter table public.room_members enable row level security;
drop policy if exists "rm: self read only" on public.room_members;
create policy "rm: self read only" on public.room_members
  for select to authenticated using (user_id = (select auth.uid()));
-- ★ 익명성의 급소. "같은 방 멤버 전부 읽기"로 바꾸는 순간 상대 uuid 가 샌다.
revoke all on public.room_members from anon, authenticated;
grant select on public.room_members to authenticated;

alter table public.messages enable row level security;
drop policy if exists "messages: read while room alive" on public.messages;
drop policy if exists "messages: send as my seat"       on public.messages;
create policy "messages: read while room alive" on public.messages
  for select to authenticated
  using (public.is_room_member(room_id) and public.room_is_visible(room_id));
create policy "messages: send as my seat" on public.messages
  for insert to authenticated
  with check (sender_seat = public.my_seat(room_id)     -- 좌석 위조 불가
              and public.room_is_writable(room_id));    -- 만료 후 쓰기 원천 차단
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
-- 컬럼 단위 insert: id·created_at 은 클라가 정할 수 없다
grant insert (room_id, sender_seat, body, client_msg_id) on public.messages to authenticated;
-- ★ update/delete 없음 = 증거 무결성. "보낸 메시지 삭제" 기능은 의도적으로 없다.


-- ── 8. alias ────────────────────────────────────────────────────────
create or replace function public.random_alias()
returns text language sql volatile as $fn$
  select (array['말랑','포근','새벽','바삭','조용','느긋','반짝','시원','담백','뭉게',
                '노란','파란','초록','보라','하얀','까만','붉은','은은'])[floor(random()*18)::int + 1]
      || (array['복숭아','고양이','달팽이','구름','수달','펭귄','자몽','토끼','라떼','북극곰',
                '해달','민트','오리','참새','여우','고래','두더지','감자'])[floor(random()*18)::int + 1];
$fn$;


-- ── 9. 방 스냅샷 — 익명성의 경계선 ──────────────────────────────────
-- 클라가 방에 대해 아는 모든 것이 여기서 나온다. room_id 외의 uuid 는 절대 반환하지 않는다.
-- (Phase 3 에서 투표 상태, Phase 4 에서 상대 접속 상태가 추가된다)
create or replace function public.room_snapshot(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare
  r   public.rooms%rowtype;
  cfg public.app_settings%rowtype;
  s   smallint;
  v_my boolean; v_their boolean; v_joined boolean; v_online boolean; v_next text;
  v_rated boolean := false; v_can_rate boolean := false;
begin
  s := public.my_seat(p_room);
  if s is null then raise exception 'not_member'; end if;
  select * into r   from public.rooms where id = p_room;
  select * into cfg from public.app_settings where id;

  select agree into v_my    from public.extension_votes where room_id = p_room and round = r.round and seat = s;
  select agree into v_their from public.extension_votes where room_id = p_room and round = r.round and seat <> s;
  select joined_at is not null into v_joined
    from public.room_members where room_id = p_room and seat <> s;
  select coalesce(up.online_until > now(), false) into v_online
    from public.room_members rm join public.user_presence up on up.user_id = rm.user_id
   where rm.room_id = p_room and rm.seat <> s;
  v_next := case when not r.pinned then private.hint_kind(r.round) end;
  if r.status = 'closed' or r.pinned then
    v_rated := exists (select 1 from private.ratings x where x.room_id = p_room and x.rater_id = auth.uid());
    v_can_rate := not v_rated and private.rating_eligible(p_room, auth.uid());
  end if;

  return jsonb_build_object(
    'room_id',         r.id,
    'status',          r.status,
    'my_seat',         s,
    'my_alias',        case when s = 1 then r.alias1 else r.alias2 end,
    'partner_alias',   case when s = 1 then r.alias2 else r.alias1 end,
    'expires_at',      private.room_deadline(r.expires_at, r.paused_left),
    'paused',          r.paused_left is not null,
    'pinned',          r.pinned,
    'pin_next',        private.pin_round(r),
    'round',           r.round,
    'max_rounds',      cfg.max_rounds,
    'extend_minutes',  cfg.extend_minutes,
    'vote_window_sec', cfg.vote_window_sec,
    'my_vote',         v_my,
    'partner_vote',    v_their,
    'partner_joined',  coalesce(v_joined, false),
    'partner_online',  coalesce(v_online, false),
    'their_read_id',   case when s = 1 then r.read2 else r.read1 end,
    'close_reason',    r.close_reason,
    'partner_hints',   private.room_hints_of(p_room, (3 - s)::smallint, r.round - 1),
    'my_hints',        private.room_hints_of(p_room, s, r.round - 1),
    'next_hint',       case when v_next is not null then jsonb_build_object(
                         'kind', v_next, 'label', private.hint_label_in(p_room, v_next), 'typed', private.hint_typed(v_next)) end,
    'can_rate',        v_can_rate,
    'rated',           v_rated,
    'server_now',      now());
end
$fn$;

-- 내가 지금 들어가 있는 방 (없으면 null)
create or replace function public.my_room()
returns jsonb language plpgsql security definer set search_path = public stable as $fn$
declare v_room uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  -- 여러 방이 열려 있을 수 있다(Phase 8) — 가장 최근 방. 목록은 my_rooms() 를 쓴다.
  select rm.room_id into v_room from public.room_members rm join public.rooms r on r.id = rm.room_id
   where rm.user_id = auth.uid() and rm.open order by r.created_at desc limit 1;
  if v_room is null then
    return jsonb_build_object('room', null, 'server_now', now());
  end if;
  return jsonb_build_object('room', public.room_snapshot(v_room), 'server_now', now());
end
$fn$;

-- 읽음 표시 — room_members 는 self-only 라 상대가 못 보므로 rooms 에 seat 기준으로 둔다
create or replace function public.mark_read(p_room uuid, p_last_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare s smallint := public.my_seat(p_room);
begin
  if s is null then raise exception 'not_member'; end if;
  if s = 1 then
    update public.rooms set read1 = greatest(coalesce(read1, 0), p_last_id)
     where id = p_room and coalesce(read1, 0) < p_last_id;
  else
    update public.rooms set read2 = greatest(coalesce(read2, 0), p_last_id)
     where id = p_room and coalesce(read2, 0) < p_last_id;
  end if;
end
$fn$;

revoke all on function public.room_snapshot(uuid), public.my_room(),
                       public.mark_read(uuid, bigint) from public, anon;
grant execute on function public.room_snapshot(uuid), public.my_room(),
                          public.mark_read(uuid, bigint) to authenticated;


-- ── 10. 개발용: 테스트 방 만들기 (service_role / SQL Editor 전용) ───
-- Phase 4 매칭이 생기기 전까지 두 계정을 손으로 한 방에 넣는다.
--   select private.dev_open_room('a@cnsa.hs.kr', 'b@cnsa.hs.kr', 60);
create or replace function private.dev_open_room(p_email1 text, p_email2 text, p_minutes int default 60)
returns uuid language plpgsql security definer set search_path = public, private as $fn$
declare
  u1 uuid; u2 uuid; v_room uuid; a1 text; a2 text;
begin
  select id into u1 from auth.users where lower(email) = lower(p_email1);
  select id into u2 from auth.users where lower(email) = lower(p_email2);
  if u1 is null or u2 is null then raise exception 'user_not_found'; end if;

  -- 기존에 열린 방이 있으면 닫는다 (한 사람 한 방)
  update public.rooms set status = 'closed', closed_at = now(), close_reason = 'admin'
   where id in (select room_id from public.room_members where user_id in (u1, u2) and open);
  update public.room_members set open = false where user_id in (u1, u2) and open;

  -- 방 안 이름 = 계정의 고유 익명 이름 (Phase 8). 없으면 임시 이름.
  select coalesce(nickname, public.random_alias()) into a1 from public.profiles where id = u1;
  select coalesce(nickname, public.random_alias()) into a2 from public.profiles where id = u2;
  while a2 = a1 loop a2 := public.random_alias(); end loop;

  insert into public.rooms (status, armed_at, expires_at, alias1, alias2)
  values ('active', now(), now() + make_interval(mins => p_minutes), a1, a2)
  returning id into v_room;

  insert into public.room_members (room_id, user_id, seat, joined_at)
  values (v_room, u1, 1, now()), (v_room, u2, 2, now());

  insert into public.messages (room_id, sender_seat, body, client_msg_id)
  values (v_room, 0, '대화 시작. 이름·학번·SNS는 묻지도 말하지도 않기로 해요.',
          gen_random_uuid());
  return v_room;
end
$fn$;
revoke all on function private.dev_open_room(text, text, int) from public, anon, authenticated;


-- ── 11. Realtime ────────────────────────────────────────────────────
-- 처음엔 표 변경(postgres_changes)을 발행했지만, Phase 55 에서 DB 가 직접 방송(Broadcast)하는 방식으로 바꿨다 — 맨 아래 Phase 55.


-- ════════════════════════════════════════════════════════════════════
--  Phase 3 — 타임박스
--
--  [pending] --양쪽 ack_room--> [active] --만료/거절/나가기--> [closed]
--                                  └─ 양쪽 연장 동의: expires_at += 10분, round += 1
--
--  "연장투표중"은 상태가 아니다. 만료 vote_window_sec 전부터의 구간일 뿐이다.
--  마감 시각은 방 전체에 딱 하나(expires_at)이고 그게 곧 투표 데드라인이다.
-- ════════════════════════════════════════════════════════════════════

-- ── 12. 연장 투표 ───────────────────────────────────────────────────
create table if not exists public.extension_votes (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  round      smallint not null,
  seat       smallint not null check (seat in (1,2)),
  agree      boolean not null,
  created_at timestamptz not null default now(),
  primary key (room_id, round, seat)   -- ★ round 가 키에 있어 라운드 간 표가 섞이지 않는다
);
alter table public.extension_votes enable row level security;
drop policy if exists "votes: member read" on public.extension_votes;
create policy "votes: member read" on public.extension_votes
  for select to authenticated using (public.is_room_member(room_id));
-- 행에 seat 만 있으므로 상대 투표를 봐도 익명성 손상 없음. 쓰기는 RPC 만.
revoke all on public.extension_votes from anon, authenticated;
grant select on public.extension_votes to authenticated;


-- ── 13. 방 닫기 (내부 전용) ─────────────────────────────────────────
create or replace function public.close_room(p_room uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  update public.rooms
     set status = 'closed', closed_at = now(), close_reason = p_reason,
         expires_at = least(expires_at, now())
   where id = p_room and status <> 'closed';
  update public.room_members set open = false where room_id = p_room and open;
  update public.user_presence set current_room_id = null where current_room_id = p_room;
end
$fn$;
-- ★ 클라이언트가 직접 부르면 아무 방이나 닫을 수 있으므로 완전히 막는다
revoke all on function public.close_room(uuid, text) from public, anon, authenticated;


-- ── 15. 입장 확인 — 10분 타이머는 양쪽이 실제로 화면을 열어야 시작 ──
create or replace function public.ack_room(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  r   public.rooms%rowtype;
  cfg public.app_settings%rowtype;
  v_joined int;
begin
  if public.my_seat(p_room) is null then raise exception 'not_member'; end if;
  select * into cfg from public.app_settings where id;
  perform private.room_clock(p_room);
  select * into r from public.rooms where id = p_room for update;

  if r.status = 'pending' and now() >= r.expires_at then
    perform public.close_room(p_room, 'no_show');
    return public.room_snapshot(p_room);
  end if;

  update public.room_members set joined_at = coalesce(joined_at, now()), viewing_until = now() + interval '45 seconds'
   where room_id = p_room and user_id = auth.uid();

  if r.status = 'pending' then
    select count(*) into v_joined from public.room_members
     where room_id = p_room and joined_at is not null;
    if v_joined = 2 then
      update public.rooms
         set status = 'active', armed_at = now(),
             expires_at = now() + make_interval(mins => cfg.room_minutes)
       where id = p_room;
      insert into public.pair_history (user_lo, user_hi)
      select least(a.user_id, b.user_id), greatest(a.user_id, b.user_id)
        from public.room_members a join public.room_members b
          on a.room_id = b.room_id and a.seat = 1 and b.seat = 2
       where a.room_id = p_room
      on conflict (user_lo, user_hi) do update
         set last_matched_at = now(), times = public.pair_history.times + 1;
      insert into public.messages (room_id, sender_seat, body, client_msg_id)
      values (p_room, 0,
              cfg.room_minutes || '분 동안 이야기할 수 있어요. 둘 다 대화를 보고 있을 때만 시간이 흘러요.',
              gen_random_uuid());
    end if;
  end if;
  perform private.room_clock(p_room);
  return public.room_snapshot(p_room);
end
$fn$;


-- ── 16. 연장 투표 ───────────────────────────────────────────────────
create or replace function public.vote_extension(p_room uuid, p_agree boolean)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  r   public.rooms%rowtype;
  cfg public.app_settings%rowtype;
  s   smallint;
  v_yes int; v_no int;
begin
  s := public.my_seat(p_room);
  if s is null then raise exception 'not_member'; end if;
  select * into cfg from public.app_settings where id;

  -- ★ 방 행을 잠근다. 양쪽이 같은 밀리초에 눌러도 여기서 줄을 선다.
  select * into r from public.rooms where id = p_room for update;

  if r.status <> 'active' then
    return jsonb_build_object('result', 'closed', 'snap', public.room_snapshot(p_room));
  end if;
  -- 만료 직후 도착한 표 → 버리고 방을 닫는다. 늦게 온 패킷에 시간을 되살릴 권한을 주지 않는다.
  if now() >= r.expires_at then
    perform public.close_room(p_room, 'expired');
    return jsonb_build_object('result', 'expired', 'snap', public.room_snapshot(p_room));
  end if;
  -- 너무 이른 투표 (조작된 클라이언트가 미리 시간을 쌓지 못하게)
  if now() < r.expires_at - make_interval(secs => cfg.vote_window_sec) then
    return jsonb_build_object('result', 'too_early', 'snap', public.room_snapshot(p_room));
  end if;
  -- 연장 상한 (0 = 무제한)
  if cfg.max_rounds > 0 and r.round >= cfg.max_rounds then
    return jsonb_build_object('result', 'max_rounds', 'snap', public.room_snapshot(p_room));
  end if;

  insert into public.extension_votes (room_id, round, seat, agree)
  values (p_room, r.round, s, p_agree)
  on conflict (room_id, round, seat)
    do update set agree = excluded.agree, created_at = now();   -- 마음 바꾸기 허용

  select count(*) filter (where agree), count(*) filter (where not agree)
    into v_yes, v_no
    from public.extension_votes where room_id = p_room and round = r.round;

  if v_no > 0 then
    perform public.close_room(p_room, 'declined');
    return jsonb_build_object('result', 'declined', 'snap', public.room_snapshot(p_room));
  elsif v_yes = 2 then
    update public.rooms
       set expires_at = r.expires_at + make_interval(mins => cfg.extend_minutes),  -- ★ now() 가 아니다
           round      = r.round + 1
     where id = p_room;
    insert into public.messages (room_id, sender_seat, body, client_msg_id)
    values (p_room, 0, cfg.extend_minutes || '분 연장됨.', gen_random_uuid());
    return jsonb_build_object('result', 'extended', 'snap', public.room_snapshot(p_room));
  end if;
  return jsonb_build_object('result', 'waiting', 'snap', public.room_snapshot(p_room));
end
$fn$;


-- ── 17. 만료 확인 · 나가기 ──────────────────────────────────────────
-- 카운트다운이 0 이 된 클라이언트가 부른다. "이미 만료됐으면 닫아라" — 조기 종료는 불가능하므로 안전.
create or replace function public.close_if_expired(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r public.rooms%rowtype;
begin
  if public.my_seat(p_room) is null then raise exception 'not_member'; end if;
  perform private.room_clock(p_room);
  select * into r from public.rooms where id = p_room for update;
  if r.status <> 'closed' and now() >= r.expires_at then
    perform public.close_room(p_room, case when r.status = 'pending' then 'no_show' else 'expired' end);
  end if;
  return public.room_snapshot(p_room);   -- 언제나 최신 스냅샷 + server_now
end
$fn$;

-- p_skip = true: 다음 상대로 넘기기 / false: 그냥 나가기
create or replace function public.leave_room(p_room uuid, p_skip boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $fn$
begin
  if public.my_seat(p_room) is null then raise exception 'not_member'; end if;
  perform public.close_room(p_room, case when p_skip then 'skipped' else 'left' end);
  return public.room_snapshot(p_room);
end
$fn$;

revoke all on function public.ack_room(uuid), public.vote_extension(uuid, boolean),
                       public.close_if_expired(uuid), public.leave_room(uuid, boolean)
  from public, anon;
grant execute on function public.ack_room(uuid), public.vote_extension(uuid, boolean),
                          public.close_if_expired(uuid), public.leave_room(uuid, boolean)
  to authenticated;


-- ── 18. 스위퍼 — 양쪽 다 앱을 꺼버린 방 정리 ───────────────────────
-- 이걸 안 하면 만료된 방이 계속 "열린 대화"로 남아 동시 대화 상한을 차지한다(좀비 방).
-- 메시지 쓰기 차단은 여기가 아니라 room_is_writable 정책이 이미 하고 있다.
create or replace function public.sweep_rooms()
returns int language plpgsql security definer set search_path = public, private as $fn$
declare n int := 0; v record;
begin
  for v in select r.id from public.rooms r
            where r.status = 'active' and not r.pinned and r.paused_left is null
              and exists (select 1 from public.room_members m
                           where m.room_id = r.id and (m.viewing_until is null or m.viewing_until <= now()))
            limit 500
  loop
    perform private.room_clock(v.id);
  end loop;
  for v in select id from public.rooms
            where status = 'active' and not pinned and paused_since < now() - interval '1 day'
            limit 500 for update skip locked
  loop
    perform public.close_room(v.id, 'expired');
    n := n + 1;
  end loop;
  for v in select id, status from public.rooms
            where status <> 'closed' and now() >= expires_at
            order by expires_at limit 500
            for update skip locked
  loop
    perform public.close_room(v.id, case when v.status = 'pending' then 'no_show' else 'expired' end);
    n := n + 1;
  end loop;
  return n;
end
$fn$;
revoke all on function public.sweep_rooms() from public, anon, authenticated;


-- ── 19. 예약 작업 ───────────────────────────────────────────────────
-- (연장 투표의 실시간 전달은 Phase 55 방송)

-- pg_cron: 1분마다 스위퍼, 매일 새벽 24시간 지난 대화 삭제.
-- (PGlite 등 pg_cron 이 없는 환경에서는 조용히 건너뛴다)
do $do$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron 을 쓸 수 없는 환경 — 예약 작업을 건너뜀';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname in ('simbun-sweep', 'simbun-purge');
    perform cron.schedule('simbun-sweep', '* * * * *', 'select public.sweep_rooms()');
    perform cron.schedule('simbun-purge', '17 4 * * *',
      $q$delete from public.messages m using public.rooms r
          where r.id = m.room_id and r.status = 'closed'
            and r.closed_at < now() - interval '24 hours'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 4 — 랜덤 매칭
--
--  별도 대기큐 테이블이 없다. "지금 찾는 중인 사람들의 집합"(user_presence.seeking_until)이 곧 큐다.
--  대기 화면은 request_match() 를 몇 초마다 다시 부른다 — 이 한 번의 호출이
--    ① '나 아직 찾는 중' 갱신  ② 매칭 시도  ③ 누가 이미 나를 잡아갔는지 확인
--  을 모두 한다. 대기자는 웹소켓을 쓰지 않으므로 Realtime 동시 연결 한도를 아낀다.
-- ════════════════════════════════════════════════════════════════════

alter table public.app_settings add column if not exists seek_poll_sec int not null default 4;
alter table public.app_settings add column if not exists seek_ttl_sec  int not null default 15;

-- ── 20. 재매칭 방지 · 차단 ──────────────────────────────────────────
-- 둘 다 RLS on + 정책 0개. 클라가 이 목록을 읽으면 = 내가 만난/차단한 사람들의 uuid 목록 = linkability 복원.
create table if not exists public.pair_history (
  user_lo         uuid not null references public.profiles(id) on delete cascade,
  user_hi         uuid not null references public.profiles(id) on delete cascade,
  last_matched_at timestamptz not null default now(),
  times           int not null default 1,
  primary key (user_lo, user_hi),
  check (user_lo < user_hi)
);
create index if not exists pair_history_hi on public.pair_history (user_hi, last_matched_at desc);
alter table public.pair_history enable row level security;
revoke all on public.pair_history from anon, authenticated;

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked on public.blocks (blocked_id);
alter table public.blocks enable row level security;
revoke all on public.blocks from anon, authenticated;


-- ── 21. 매칭 ────────────────────────────────────────────────────────
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

  insert into public.user_presence (user_id, online_until, seeking_until, seeking_since)
  values (me, v_now + make_interval(secs => cfg.seek_ttl_sec),
              v_now + make_interval(secs => cfg.seek_ttl_sec), v_now)
  on conflict (user_id) do update
     set online_until  = greatest(public.user_presence.online_until, excluded.online_until),
         seeking_until = excluded.seeking_until,
         seeking_since = coalesce(public.user_presence.seeking_since, excluded.seeking_since);

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

-- 대기 화면을 떠날 때. 안 불러도 seek_ttl_sec 뒤에 자동으로 풀에서 빠진다.
create or replace function public.stop_seeking()
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  update public.user_presence set seeking_until = null, seeking_since = null where user_id = auth.uid();
end
$fn$;

revoke all on function public.request_match(), public.stop_seeking() from public, anon;
grant execute on function public.request_match(), public.stop_seeking() to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 5 — 안전장치 (신고 · 차단 · 도배 제한 · 자동 정지)
-- ════════════════════════════════════════════════════════════════════

alter table public.app_settings add column if not exists auto_suspend_reports int not null default 3;
alter table public.app_settings add column if not exists match_burst          real not null default 6;
alter table public.app_settings add column if not exists match_refill_sec     real not null default 10;
alter table public.user_presence add column if not exists match_tokens real not null default 6;
alter table public.user_presence add column if not exists match_at     timestamptz not null default now();

-- ── 22. 신고 (private — PostgREST 에 노출되지 않음) ─────────────────
create table if not exists private.reports (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null,        -- ★ FK 없음: 방이 purge 돼도 신고는 남아야 한다
  reporter_id  uuid not null,
  reported_id  uuid not null,
  reason       text not null check (reason in
               ('harassment','sexual','spam','personal_info','hate','impersonation','other')),
  note         text not null default '',
  status       text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  handled_by   uuid,
  handled_at   timestamptz,
  action_note  text,
  created_at   timestamptz not null default now(),
  unique (room_id, reporter_id)       -- 같은 방을 두 번 신고할 수 없다
);
-- Phase 19: 누가 올렸나 — user = 사람이 신고 / auto = AI 자동 감지 (auto 는 reporter_id 가 비어 있다)
alter table private.reports add column if not exists source text not null default 'user' check (source in ('user','auto'));
create index if not exists reports_queue    on private.reports (status, created_at desc);
create index if not exists reports_reported on private.reports (reported_id, created_at desc);
alter table private.reports enable row level security;

-- 증거: messages 를 참조하지 않고 '복사'한다 → 24시간 purge 와 무관하게 남는다
create table if not exists private.report_evidence (
  report_id   uuid not null references private.reports(id) on delete cascade,
  ord         int  not null,
  sender      smallint not null,     -- 0 시스템 / 1 신고자 / 2 피신고자 (좌석이 아니라 역할)
  body        text not null,
  sent_at     timestamptz not null,
  primary key (report_id, ord)
);
alter table private.report_evidence enable row level security;

-- 운영진 활동 기록 — 운영자에 대한 감시도 필요하다 (특히 신원 열람)
create table if not exists private.audit_log (
  id          bigint generated always as identity primary key,
  staff_id    uuid,                  -- null = 시스템 자동 조치
  action      text not null,
  target_user uuid,
  report_id   uuid,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_recent on private.audit_log (created_at desc);
alter table private.audit_log enable row level security;


-- ── 23. 신고 · 차단 RPC ─────────────────────────────────────────────
-- ★ 상대 uuid 해석은 전부 서버 안에서. 신고자는 상대 uuid 를 보지도, 보내지도 않는다.
-- 방이 이미 닫힌 뒤에도 동작한다 — 대화가 끝나고 신고하는 경우가 많다.
create or replace function public.report_partner(p_room uuid, p_reason text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me       uuid := auth.uid();
  cfg      public.app_settings%rowtype;
  s        smallint;
  v_other  uuid;
  v_report uuid;
  v_n      int;
begin
  s := public.my_seat(p_room);
  if s is null then raise exception 'not_member'; end if;
  if p_reason not in ('harassment','sexual','spam','personal_info','hate','impersonation','other') then
    raise exception 'invalid_reason';
  end if;
  select * into cfg from public.app_settings where id;
  select user_id into v_other from public.room_members where room_id = p_room and seat <> s;

  if exists (select 1 from private.reports where room_id = p_room and reporter_id = me) then
    return jsonb_build_object('status', 'already', 'snap', public.room_snapshot(p_room));
  end if;

  insert into private.reports (room_id, reporter_id, reported_id, reason, note)
  values (p_room, me, v_other, p_reason, left(coalesce(p_note, ''), 1000))
  returning id into v_report;

  insert into private.report_evidence (report_id, ord, sender, body, sent_at)
  select v_report, row_number() over (order by m.id),
         case when m.sender_seat = 0 then 0 when m.sender_seat = s then 1 else 2 end,
         case when d.body is not null then '[삭제함] ' || d.body else m.body end, m.created_at
    from public.messages m left join private.deleted_messages d on d.message_id = m.id
   where m.room_id = p_room;

  insert into public.blocks (blocker_id, blocked_id) values (me, v_other) on conflict do nothing;
  perform public.close_room(p_room, 'reported');

  select count(distinct reporter_id) into v_n
    from private.reports
   where reported_id = v_other and status <> 'dismissed' and created_at > now() - interval '30 days';
  if v_n >= cfg.auto_suspend_reports then
    update public.profiles set status = 'suspended' where id = v_other and status = 'active';
    if found then
      insert into private.audit_log (staff_id, action, target_user, report_id, detail)
      values (null, 'auto_suspend', v_other, v_report, jsonb_build_object('distinct_reporters', v_n));
      perform public.close_room(rm.room_id, 'admin')
         from public.room_members rm where rm.user_id = v_other and rm.open;
    end if;
  end if;

  return jsonb_build_object('status', 'ok', 'snap', public.room_snapshot(p_room));
end
$fn$;

create or replace function public.block_partner(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare s smallint; v_other uuid;
begin
  s := public.my_seat(p_room);
  if s is null then raise exception 'not_member'; end if;
  select user_id into v_other from public.room_members where room_id = p_room and seat <> s;
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), v_other) on conflict do nothing;
  perform public.close_room(p_room, 'blocked');
  return jsonb_build_object('status', 'ok', 'snap', public.room_snapshot(p_room));
end
$fn$;

revoke all on function public.report_partner(uuid, text, text), public.block_partner(uuid) from public, anon;
grant execute on function public.report_partner(uuid, text, text), public.block_partner(uuid) to authenticated;


-- ── 24. 메시지 도배 제한 — 토큰 버킷 ────────────────────────────────
-- "최근 N초 메시지 수를 센다" 대신 행 하나에 버킷을 둔다 → O(1), 행 락으로 원자적, 우회 불가.
-- ★ 좌석이 아니라 auth.uid() 로 차감한다 — 남의 방에 끼어드는 요청이 방 주인의 한도를 깎을 여지를 없앤다.
create or replace function public.msg_rate_limit()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare cfg public.app_settings%rowtype;
begin
  if new.sender_seat = 0 or auth.uid() is null then return new; end if;   -- 시스템 메시지 · 서버 작업
  select * into cfg from public.app_settings where id;
  update public.user_presence up
     set msg_tokens = least(cfg.msg_burst,
                            up.msg_tokens + extract(epoch from (now() - up.tokens_at)) * cfg.msg_refill_per_sec) - 1,
         tokens_at  = now()
   where up.user_id = auth.uid()
     and least(cfg.msg_burst,
               up.msg_tokens + extract(epoch from (now() - up.tokens_at)) * cfg.msg_refill_per_sec) >= 1;
  if not found then
    raise exception 'rate_limited';
  end if;
  return new;
end
$fn$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.msg_rate_limit();


-- ── 25. 넘기기 연타 제한 — request_match 에 버킷 추가 ───────────────
-- 방을 '만드는' 쪽만 차감한다. 잡혀간 쪽은 차감하지 않는다.
create or replace function public.match_bucket_take(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare cfg public.app_settings%rowtype; v_tokens real;
begin
  select * into cfg from public.app_settings where id;
  select least(cfg.match_burst, match_tokens + extract(epoch from (now() - match_at)) / cfg.match_refill_sec)
    into v_tokens from public.user_presence where user_id = p_user for update;
  if v_tokens < 1 then
    return jsonb_build_object('ok', false,
      'retry_after_ms', ceil((1 - v_tokens) * cfg.match_refill_sec * 1000));
  end if;
  update public.user_presence set match_tokens = v_tokens - 1, match_at = now() where user_id = p_user;
  return jsonb_build_object('ok', true);
end
$fn$;
revoke all on function public.match_bucket_take(uuid) from public, anon, authenticated;


-- ── 26. 신고 증거 보존 기간 ─────────────────────────────────────────
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-purge-evidence';
    perform cron.schedule('simbun-purge-evidence', '37 4 * * *',
      $q$delete from private.reports where status in ('actioned','dismissed')
          and created_at < now() - interval '180 days'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 6 — 운영자 RPC (service_role 전용)
--
--  private 스키마는 PostgREST 에 노출되지 않으므로 service_role 키로도 REST 로는 못 읽는다.
--  그래서 운영 기능은 service_role 만 실행할 수 있는 public 함수로 만든다.
--  → private 는 계속 숨긴 채로, 학생 키(anon/authenticated)로는 호출 자체가 불가능.
--  이 함수들은 /admin 서버 라우트(+page.server.ts)에서만 부른다.
--
--  운영진 지정:
--    insert into private.staff (user_id, role)
--    select id, 'admin' from auth.users where email = '담당자@cnsa.hs.kr';
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_staff_role(p_uid uuid)
returns text language sql security definer set search_path = public, private stable as $fn$
  select role from private.staff where user_id = p_uid;
$fn$;

create or replace function public.admin_stats()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select jsonb_build_object(
    'open_reports',    (select count(*) from private.reports where status = 'open'),
    'reviewing',       (select count(*) from private.reports where status = 'reviewing'),
    'open_letter_reports', (select count(*) from private.letter_reports where status = 'open'),
    'active_rooms',    (select count(*) from public.rooms where status <> 'closed' and now() < expires_at),
    'seeking_now',     (select count(*) from public.user_presence where seeking_until > now()),
    'restricted_users',(select count(*) from public.profiles
                         where status <> 'active' or suspended_until > now()),
    'rooms_24h',       (select count(*) from public.rooms where created_at > now() - interval '24 hours'),
    'letters_24h',     (select count(*) from private.dm_msgs where is_letter and created_at > now() - interval '24 hours'),
    'is_open',         (select is_open from public.app_settings where id));
$fn$;

-- 목록에는 신원 정보가 없다. 사용자 id 만 (조치에 필요).
create or replace function public.admin_list_reports(p_status text default 'open', p_limit int default 100)
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select r.id, r.created_at, r.reason, left(r.note, 140) as note, r.status,
           r.reported_id, r.reporter_id, r.source,
           (select count(distinct r2.reporter_id) from private.reports r2
             where r2.reported_id = r.reported_id and r2.status <> 'dismissed'
               and r2.created_at > now() - interval '30 days') as reported_30d,
           (select count(*) from private.report_evidence e where e.report_id = r.id) as evidence_count,
           p.status as reported_status
      from private.reports r
      left join public.profiles p on p.id = r.reported_id
     where p_status = 'all' or r.status = p_status
     order by r.created_at desc
     limit p_limit
  ) x;
$fn$;

create or replace function public.admin_report(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare r private.reports%rowtype;
begin
  select * into r from private.reports where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'report', to_jsonb(r),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
                    'ord', e.ord, 'sender', e.sender, 'body', e.body, 'sent_at', e.sent_at) order by e.ord), '[]'::jsonb)
                   from private.report_evidence e where e.report_id = p_id),
    'reported', (select jsonb_build_object('status', p.status, 'strikes', p.strikes,
                        'suspended_until', p.suspended_until, 'gender', p.gender, 'created_at', p.created_at)
                   from public.profiles p where p.id = r.reported_id),
    -- 같은 사람에 대한 다른 신고들 (반복 가해 여부)
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', h.id, 'created_at', h.created_at, 'reason', h.reason, 'status', h.status) order by h.created_at desc), '[]'::jsonb)
                  from private.reports h where h.reported_id = r.reported_id and h.id <> p_id),
    -- 신고자가 낸 신고 수 (허위 신고 남발 여부)
    'reporter_filed', (select count(*) from private.reports f where f.reporter_id = r.reporter_id),
    'reporter_dismissed', (select count(*) from private.reports f
                            where f.reporter_id = r.reporter_id and f.status = 'dismissed'));
end
$fn$;

create or replace function public.admin_set_report(p_id uuid, p_status text, p_note text, p_staff uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);   -- 운영진 명단에 없는 id 로는 처리·기록할 수 없다
  update private.reports
     set status = p_status, action_note = nullif(p_note, ''), handled_by = p_staff, handled_at = now()
   where id = p_id;
  insert into private.audit_log (staff_id, action, report_id, detail)
  values (p_staff, 'report_' || p_status, p_id, jsonb_build_object('note', p_note));
end
$fn$;

-- warn: 경고(strike+1) / suspend: N일 정지 / ban: 영구 정지 / reinstate: 제한 해제
create or replace function public.admin_sanction(
  p_user uuid, p_action text, p_days int, p_staff uuid, p_report uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare v_role text := private.require_staff(p_staff);
begin
  -- 탈퇴한 계정 — 아무것도 바뀌지 않는데 "조치 완료"로 보이지 않게
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user_not_found'; end if;
  if v_role <> 'admin' then
    if p_action = 'ban' then raise exception 'admin_only'; end if;
    if p_action = 'suspend' and coalesce(p_days, 0) > private.mod_max_suspend_days() then
      raise exception 'mod_days_limit';
    end if;
    if p_action = 'reinstate' and exists (select 1 from public.profiles where id = p_user and status = 'banned') then
      raise exception 'admin_only';
    end if;
    if exists (select 1 from private.staff where user_id = p_user) then raise exception 'admin_only'; end if;
  end if;

  if p_action = 'warn' then
    update public.profiles set strikes = strikes + 1 where id = p_user;
  elsif p_action = 'suspend' then
    if coalesce(p_days, 0) < 1 then raise exception 'days_required'; end if;
    update public.profiles
       set status = 'active', suspended_until = now() + make_interval(days => p_days), strikes = strikes + 1
     where id = p_user;
  elsif p_action = 'ban' then
    update public.profiles set status = 'banned', strikes = strikes + 1 where id = p_user;
  elsif p_action = 'reinstate' then
    update public.profiles set status = 'active', suspended_until = null where id = p_user;
  else
    raise exception 'invalid_action';
  end if;

  if p_action in ('suspend', 'ban') then
    perform public.close_room(rm.room_id, 'admin')
       from public.room_members rm where rm.user_id = p_user and rm.open;
    update public.user_presence set seeking_until = null, seeking_since = null where user_id = p_user;
  end if;

  insert into private.audit_log (staff_id, action, target_user, report_id, detail)
  values (p_staff, 'sanction_' || p_action, p_user, p_report,
          jsonb_build_object('days', p_days, 'note', p_note));
  return (select jsonb_build_object('status', status, 'strikes', strikes, 'suspended_until', suspended_until)
            from public.profiles where id = p_user);
end
$fn$;

-- ★ 신원(이메일) 열람은 반드시 기록한다. 이메일 자체는 서버가 auth admin API 로 그 순간에만 조회.
create or replace function public.admin_log_identity_view(p_staff uuid, p_users uuid[], p_report uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff, true);
  insert into private.audit_log (staff_id, action, target_user, report_id, detail)
  values (p_staff, 'view_identity', case when cardinality(p_users) = 1 then p_users[1] end, p_report,
          jsonb_build_object('users', p_users));
end
$fn$;

create or replace function public.admin_audit(p_limit int default 50)
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
    from (select * from private.audit_log order by created_at desc limit p_limit) a;
$fn$;

create or replace function public.admin_get_settings()
returns jsonb language sql security definer set search_path = public stable as $fn$
  select to_jsonb(s) - 'id' from public.app_settings s where id;
$fn$;

-- 허용된 키만 반영. 범위는 테이블 check 제약이 지킨다.
-- 운영자(moderator)는 서비스 열고 닫기(is_open)만, 나머지 수치·홈 배너는 개발자 · 관리자 (Phase 49 권한표 settings)
create or replace function public.admin_update_settings(p_patch jsonb, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare v text := private.require_perm(p_staff, 'any');
begin
  -- 수치 · 배너는 settings, 서비스 열고 닫기(is_open)는 service 또는 settings (Phase 51 표)
  -- 서비스 열고 닫기 · 서버 점검(Phase 52)은 service 또는 settings, 나머지는 settings
  if not private.staff_can(v, 'settings')
     and exists (select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) k
                  where k not in ('is_open', 'maintenance', 'maintenance_msg', 'maintenance_until', 'maintenance_at')) then
    raise exception 'admin_only';
  end if;
  if (p_patch ?| array['is_open', 'maintenance', 'maintenance_msg', 'maintenance_until', 'maintenance_at'])
     and not (private.staff_can(v, 'service') or private.staff_can(v, 'settings')) then
    raise exception 'no_permission';
  end if;
  update public.app_settings set
    is_open               = coalesce((p_patch->>'is_open')::boolean, is_open),
    notice                = coalesce(p_patch->>'notice', notice),
    room_minutes          = coalesce((p_patch->>'room_minutes')::int, room_minutes),
    extend_minutes        = coalesce((p_patch->>'extend_minutes')::int, extend_minutes),
    vote_window_sec       = coalesce((p_patch->>'vote_window_sec')::int, vote_window_sec),
    max_rounds            = coalesce((p_patch->>'max_rounds')::smallint, max_rounds),
    rematch_cooldown_days = coalesce((p_patch->>'rematch_cooldown_days')::int, rematch_cooldown_days),
    auto_suspend_reports  = coalesce((p_patch->>'auto_suspend_reports')::int, auto_suspend_reports),
    max_open_rooms        = coalesce((p_patch->>'max_open_rooms')::int, max_open_rooms),
    -- Phase 19 — AI 검토 · AI 대화 (컬럼은 Phase 19 에서 추가. 이 함수가 먼저 만들어져도 실행 시점엔 있다)
    ai_moderation         = coalesce((p_patch->>'ai_moderation')::boolean, ai_moderation),
    ai_mod_daily_cap      = coalesce((p_patch->>'ai_mod_daily_cap')::int, ai_mod_daily_cap),
    ai_chat               = coalesce((p_patch->>'ai_chat')::boolean, ai_chat),
    ai_chat_per_user      = coalesce((p_patch->>'ai_chat_per_user')::int, ai_chat_per_user),
    ai_chat_daily_cap     = coalesce((p_patch->>'ai_chat_daily_cap')::int, ai_chat_daily_cap),
    ai_chat_minutes       = coalesce((p_patch->>'ai_chat_minutes')::int, ai_chat_minutes),
    ai_chat_max_turns     = coalesce((p_patch->>'ai_chat_max_turns')::int, ai_chat_max_turns),
    -- Phase 44 — 익명편지 잠금 (가입한 학생이 letters_gate_min 명이 될 때까지)
    letters_gate          = coalesce((p_patch->>'letters_gate')::boolean, letters_gate),
    letters_gate_min      = coalesce((p_patch->>'letters_gate_min')::int, letters_gate_min),
    -- Phase 52 — 서버 점검 (끝나는 시각은 빈 값이면 지운다)
    maintenance           = coalesce((p_patch->>'maintenance')::boolean, maintenance),
    maintenance_msg       = coalesce(left(p_patch->>'maintenance_msg', 300), maintenance_msg),
    maintenance_until     = case when p_patch ? 'maintenance_until' then nullif(p_patch->>'maintenance_until', '')::timestamptz else maintenance_until end,
    -- Phase 53 — 점검 예약 (이 시각이 되면 저절로 점검 중. 빈 값이면 예약 취소)
    maintenance_at        = case when p_patch ? 'maintenance_at' then nullif(p_patch->>'maintenance_at', '')::timestamptz else maintenance_at end
  where id;
  insert into private.audit_log (staff_id, action, detail) values (p_staff, 'update_settings', p_patch);
  return public.admin_get_settings();
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array[
    'admin_staff_role(uuid)', 'admin_stats()', 'admin_list_reports(text, int)', 'admin_report(uuid)',
    'admin_set_report(uuid, text, text, uuid)', 'admin_sanction(uuid, text, int, uuid, uuid, text)',
    'admin_log_identity_view(uuid, uuid[], uuid)', 'admin_audit(int)', 'admin_get_settings()',
    'admin_update_settings(jsonb, uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 8 — 고유 익명 이름 · 프로필 · 온라인 표시 · 여러 대화 동시 진행
--
--  익명성 경계는 그대로다:
--    · 클라이언트는 여전히 상대의 uuid 를 어떤 경로로도 받지 않는다
--    · 상대 프로필은 "같은 방에 있을 때" room_id 로만 조회된다 (partner_profile)
--  달라진 점(운영 결정): 이름이 방마다 새로 뽑히지 않고 계정에 고정된다.
--    → 같은 사람을 다른 방에서 다시 만나면 알아볼 수 있다.
--      그래서 소개글·관심사에 연락처·학번처럼 보이는 내용은 서버가 거절한다.
-- ════════════════════════════════════════════════════════════════════

alter table public.app_settings add column if not exists max_open_rooms int not null default 5;
alter table public.app_settings add column if not exists online_ttl_sec int not null default 130;
alter table public.app_settings drop constraint if exists app_settings_max_open_rooms;
alter table public.app_settings add  constraint app_settings_max_open_rooms check (max_open_rooms between 1 and 20);

-- ── 27. 프로필 — 익명 이름 + 간단한 기본 정보 ───────────────────────
alter table public.profiles add column if not exists nickname  text;
alter table public.profiles add column if not exists bio       text   not null default '';
alter table public.profiles add column if not exists interests text[] not null default '{}';
alter table public.profiles add column if not exists mbti      text;
create unique index if not exists profiles_nickname on public.profiles (nickname);

alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add  constraint profiles_bio_len check (char_length(bio) <= 60);
alter table public.profiles drop constraint if exists profiles_interests_len;
alter table public.profiles add  constraint profiles_interests_len check (cardinality(interests) <= 5);
alter table public.profiles drop constraint if exists profiles_mbti;
alter table public.profiles add  constraint profiles_mbti check (mbti is null or mbti ~ '^[EI][NS][TF][JP]$');

-- 자기 행 읽기 (정책은 self read 그대로). ★ 소개글 등은 컬럼 update 권한을 주지 않는다 —
-- 검사를 거치는 update_my_profile() 로만 바뀐다. 이름(nickname)은 아예 바꿀 수 없다.
grant select on public.profiles to authenticated;

-- 이름 후보 — 40 × 40 = 1600 조합
create or replace function private.nickname_candidate()
returns text language sql volatile as $fn$
  select (array['말랑','포근','새벽','바삭','조용','느긋','반짝','시원','담백','뭉게',
                '노란','파란','초록','보라','하얀','까만','붉은','은은','졸린','수줍은',
                '용감한','엉뚱한','다정한','배고픈','씩씩한','얌전한','꼬마','몽글','촉촉','단단',
                '동글','포슬','말간','깜찍','새침','든든','나른','산뜻','달콤','상큼'])[floor(random()*40)::int + 1]
      || (array['복숭아','고양이','달팽이','구름','수달','펭귄','자몽','토끼','라떼','북극곰',
                '해달','민트','오리','참새','여우','고래','두더지','감자','다람쥐','판다',
                '코알라','햄스터','부엉이','거북이','문어','해파리','청귤','망고','호랑이','너구리',
                '강아지','도토리','양파','치즈','마카롱','푸딩','젤리','별똥별','솜사탕','뭉치'])[floor(random()*40)::int + 1];
$fn$;

-- 계정에 고유 이름을 붙인다. 이미 있으면 그대로 돌려준다.
-- ★ 동시에 가입한 두 사람이 같은 이름을 뽑아도 유니크 인덱스 충돌을 잡아 다시 뽑는다 — 가입이 실패하지 않는다.
create or replace function private.assign_nickname(p_user uuid)
returns text language plpgsql security definer set search_path = public, private as $fn$
declare v text; i int := 0;
begin
  select nickname into v from public.profiles where id = p_user;
  if v is not null then return v; end if;
  loop
    i := i + 1;
    v := private.nickname_candidate();
    -- 조합이 붐비면 숫자를 붙인다
    if i > 5 then v := v || (floor(random() * 900) + 100)::int::text; end if;
    begin
      update public.profiles set nickname = v where id = p_user and nickname is null;
      return v;
    exception when unique_violation then
      if i >= 40 then raise; end if;
    end;
  end loop;
end
$fn$;
revoke all on function private.nickname_candidate(), private.assign_nickname(uuid) from public, anon, authenticated;


-- 이미 가입해 있던 계정들에도 이름을 붙인다
do $do$
declare v uuid;
begin
  for v in select id from public.profiles where nickname is null loop
    perform private.assign_nickname(v);
  end loop;
end
$do$;

-- 내 기본 정보 수정 — 검사를 거쳐서만 바뀐다
create or replace function public.update_my_profile(p_bio text, p_interests text[], p_mbti text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me     uuid := auth.uid();
  v_bio  text := btrim(regexp_replace(coalesce(p_bio, ''), '\s+', ' ', 'g'));
  v_tags text[];
  v_mbti text := nullif(upper(btrim(coalesce(p_mbti, ''))), '');
  t      text;
begin
  if me is null then raise exception 'unauthenticated'; end if;

  -- 관심사: 앞뒤 공백 제거, 빈 값·중복 제거(순서 유지)
  select coalesce(array_agg(x order by o), '{}') into v_tags
    from (select distinct on (lower(x)) x, o
            from (select btrim(e) x, o from unnest(coalesce(p_interests, '{}')) with ordinality u(e, o)) s
           where x <> ''
           order by lower(x), o) d;

  if char_length(v_bio) > 60 then raise exception 'bio_too_long'; end if;
  if cardinality(v_tags) > 5 then raise exception 'too_many_interests'; end if;
  foreach t in array v_tags loop
    if char_length(t) > 12 then raise exception 'interest_too_long'; end if;
  end loop;
  if v_mbti is not null and v_mbti !~ '^[EI][NS][TF][JP]$' then raise exception 'invalid_mbti'; end if;

  -- ★ 신원이 드러나는 정보 차단 — 학번·전화번호처럼 긴 숫자, 이메일·SNS 아이디(@)
  if v_bio ~ '[0-9]{4,}' or v_bio ~ '@' or array_to_string(v_tags, ' ') ~ '[0-9]{4,}|@' then
    raise exception 'personal_info';
  end if;

  update public.profiles set bio = v_bio, interests = v_tags, mbti = v_mbti where id = me;
  return jsonb_build_object('bio', v_bio, 'interests', to_jsonb(v_tags), 'mbti', v_mbti);
end
$fn$;

-- 비밀번호가 설정됐는지 (auth.users 는 클라가 읽을 수 없으므로)
create or replace function public.my_account()
returns jsonb language sql security definer set search_path = public, auth stable as $fn$
  select jsonb_build_object('has_password', coalesce(u.encrypted_password, '') <> '',
                            'name', p.name, 'grade', p.grade, 'name_source', p.source)
    from auth.users u cross join lateral private.person(u.id) p
   where u.id = auth.uid();
$fn$;


-- ── 28. 온라인 표시 ─────────────────────────────────────────────────
-- 앱이 화면에 떠 있는 동안 30초마다 부른다. 백그라운드로 가면 p_online = false 로 한 번.
-- ★ user_presence 는 여전히 정책 0개. 상대가 아는 것은 "같은 방 상대가 지금 켜져 있는가" 한 비트뿐.
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
                                     where a.user_id = auth.uid() and a.earned_at > coalesce(p.ach_seen_at, '-infinity')));
end
$fn$;


-- ── 29. 대화 목록 · 상대 프로필 ─────────────────────────────────────
-- 내 열린 대화 전부. ★ 방마다 room_id 외의 uuid 는 없다.
create or replace function public.my_rooms()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select jsonb_build_object(
    'rooms', coalesce(jsonb_agg(to_jsonb(x) - 'sort_at' order by x.pinned desc, x.sort_at desc), '[]'::jsonb),
    'server_now', now())
  from (
    select r.id as room_id, r.status, rm.seat as my_seat,
           case when rm.seat = 1 then r.alias2 else r.alias1 end as partner_alias,
           private.room_deadline(r.expires_at, r.paused_left) as expires_at, r.round,
           r.paused_left is not null as paused,
           r.pinned,
           rm.joined_at is not null as joined,
           coalesce(up.online_until > now(), false) as partner_online,
           lm.body as last_body, lm.sender_seat as last_seat, lm.created_at as last_at,
           (select count(*) from public.messages m
             where m.room_id = r.id and m.sender_seat not in (0, rm.seat)
               and m.id > coalesce(case when rm.seat = 1 then r.read1 else r.read2 end, 0))::int as unread,
           coalesce(lm.created_at, r.created_at) as sort_at
      from public.room_members rm
      join public.rooms r on r.id = rm.room_id
      join public.room_members o on o.room_id = r.id and o.seat <> rm.seat
      left join public.user_presence up on up.user_id = o.user_id
      left join lateral (select body, sender_seat, created_at from public.messages
                          where room_id = r.id order by id desc limit 1) lm on true
     where rm.user_id = auth.uid() and rm.open
       and r.status <> 'closed' and now() < r.expires_at
  ) x;
$fn$;

-- 대화 상대의 기본 정보. 같은 방에 있었던 사람만 볼 수 있다(대화가 끝난 뒤 신고 화면에서도).
create or replace function public.partner_profile(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare s smallint; v jsonb; v_other uuid;
begin
  s := public.my_seat(p_room);
  if s is null then raise exception 'not_member'; end if;
  select user_id into v_other from public.room_members where room_id = p_room and seat <> s;
  select jsonb_build_object(
           'nickname',    case when s = 1 then r.alias2 else r.alias1 end,
           'bio',         p.bio,
           'interests',   to_jsonb(p.interests),
           'mbti',        p.mbti,
           'manner_temp', p.manner_temp,
           -- 랜덤채팅에서 숨긴 뱃지는 빼고 (Phase 84 — 정하지 않았으면 CNSA 뱃지는 숨김)
           'badges',      private.featured_for(v_other, 'chat'),
           'badge_count', (select count(*) from private.user_achievements a join private.achievement_defs d on d.code = a.code
                            where a.user_id = v_other and private.badge_chat_visible(p.badge_chat, d.code, d.category)),
           'online',      coalesce(up.online_until > now(), false))
    into v
    from public.rooms r
    join public.profiles p on p.id = v_other
    left join public.user_presence up on up.user_id = v_other
   where r.id = p_room;
  return v;
end
$fn$;

revoke all on function public.update_my_profile(text, text[], text), public.my_account(),
                       public.heartbeat(boolean), public.my_rooms(), public.partner_profile(uuid)
  from public, anon;
grant execute on function public.update_my_profile(text, text[], text), public.my_account(),
                          public.heartbeat(boolean), public.my_rooms(), public.partner_profile(uuid)
  to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 9 — 새 메시지 푸시 알림
--
--  흐름: 보낸 사람 앱이 메시지 저장에 성공하면 /api/push 에 message_id 만 알린다.
--        서버(Worker)가 보낸 사람을 JWT 로 확인한 뒤 push_payload() 로
--        "받는 사람이 앱을 안 보고 있으면" 그 사람의 기기 목록과 알림 문구를 받아 보낸다.
--  ★ 구독 정보(기기 주소·키)는 정책 0개 — 클라는 자기 것을 저장·삭제만 할 수 있고 읽을 수 없다.
--  ★ 같은 메시지로는 한 번만 보낸다 (private.push_log) — 조작된 앱이 알림을 반복시키지 못한다.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
-- 이 기기로 받지 않을 알림 종류 (Phase 43, 설정 › 알림) — chat(대화 메시지) · reaction(공감) · letter(편지).
--   운영진의 개인 공지(notice)는 끌 수 없다. 거르는 곳은 서버(Worker, lib/server/pushSend.ts) — push_target 이 기기마다 같이 돌려준다
alter table public.push_subscriptions add column if not exists mute text[] not null default '{}';

create table if not exists private.push_log (
  message_id bigint primary key,
  created_at timestamptz not null default now()
);
alter table private.push_log enable row level security;

-- 이 기기로 알림 받기. 같은 기기에서 다른 계정으로 로그인하면 주인이 바뀐다.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  -- ★ 알려진 푸시 서버 주소만 (Phase 22 보안 점검) — 아무 https 주소나 받으면 서버(Worker)가 그 주소로
  --   요청을 보내게 만들 수 있다. 구글(FCM: 크롬·안드로이드·삼성) · 애플(사파리·아이폰) · 모질라(파이어폭스) · 윈도(엣지)
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
     or char_length(p_endpoint) > 1000
     or char_length(coalesce(p_p256dh, '')) not between 80 and 100
     or char_length(coalesce(p_auth, '')) not between 16 and 32 then
    raise exception 'invalid_subscription';
  end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
     set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
  -- 한 사람 기기 10대까지 — 넘으면 오래된 것부터 지운다 (알림 한 번에 수백 곳으로 보내게 만들지 못하게)
  delete from public.push_subscriptions
   where user_id = auth.uid()
     and endpoint not in (select endpoint from public.push_subscriptions
                           where user_id = auth.uid() order by created_at desc limit 10);
end
$fn$;

-- 알림 끄기 · 로그아웃. 내 것만 지운다.
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end
$fn$;

-- 이 기기로 받지 않을 알림 종류 (Phase 43). 내 기기만 · 알려진 종류만 남긴다 (중복 · 모르는 값은 버린다)
create or replace function public.set_push_mute(p_endpoint text, p_mute text[])
returns void language plpgsql security definer set search_path = public as $fn$
declare m text[];
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select coalesce(array_agg(distinct k order by k), '{}') into m
    from unnest(coalesce(p_mute, '{}')) k
   where k in ('chat', 'reaction', 'letter');
  update public.push_subscriptions set mute = m where endpoint = p_endpoint and user_id = auth.uid();
end
$fn$;

revoke all on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.set_push_mute(text, text[])
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.set_push_mute(text, text[])
  to authenticated;

-- ★ service_role 전용 — 알림을 보낼지, 누구에게, 무슨 문구로.
--   p_sender 는 서버가 JWT 로 확인한 보낸 사람. 그 사람이 실제로 보낸 메시지일 때만 동작한다.
-- 받는 사람의 알림 대상 — 채팅 메시지 · 편지 댓글 · 공감 알림이 같이 쓴다.
--   앱이 켜져 있어도 보낸다 (Phase 35) — 앱이 화면에 떠 있으면 서비스워커가 시스템 알림 대신 앱 안 알림으로 띄운다.
--   그 대화 화면을 보고 있을 때만 보내지 않는다 (채팅 · 공감이 private.viewing_room 으로 따로 확인).
--   알림을 켠 기기가 없으면 → { skip: 'no_device' },  있으면 → { subs: [{endpoint, p256dh, auth, mute}, …] }
--   mute = 그 기기가 끈 알림 종류 (Phase 43) — 서버(Worker)가 보낼 때 알림 종류를 보고 거른다
create or replace function private.push_target(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare v_subs jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth, 'mute', mute)), '[]'::jsonb)
    into v_subs from public.push_subscriptions where user_id = p_user;
  if jsonb_array_length(v_subs) = 0 then return jsonb_build_object('skip', 'no_device'); end if;
  return jsonb_build_object('subs', v_subs);
end
$fn$;
revoke all on function private.push_target(uuid) from public, anon, authenticated;

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

-- 푸시 서버가 "없는 기기"(404/410)라고 답한 구독을 지운다
create or replace function public.push_prune(p_endpoints text[])
returns void language sql security definer set search_path = public as $fn$
  delete from public.push_subscriptions where endpoint = any(p_endpoints);
$fn$;

revoke all on function public.push_payload(bigint, uuid), public.push_prune(text[]) from public, anon, authenticated;
grant execute on function public.push_payload(bigint, uuid), public.push_prune(text[]) to service_role;

-- 발송 기록은 하루면 충분 (중복 방지용)
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-purge-push';
    perform cron.schedule('simbun-purge-push', '47 4 * * *',
      $q$delete from private.push_log where created_at < now() - interval '1 day'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 10 — 익명편지 (옛 공개 게시판)
--
--  공개 게시판 · 댓글 · 답장 배정은 Phase 85 에서 걷어냈다 (학생 화면은 Phase 23 부터 이름 편지 — private.dm_*).
--  여기 남은 것은 이름 편지가 같이 쓰는 것뿐: 편지 한도(letter_bucket_take) · 익명 이름(letter_alias_candidate) ·
--  차단 확인(blocked_between) · 서식 검사(letter_fmt_ok) · 신고 표(private.letter_reports) · 운영자 신고 RPC.
-- ════════════════════════════════════════════════════════════════════

-- ponytail: letter_max_len · comment_max_len 은 이제 아무도 쓰지 않지만 캐시된 옛 앱(PWA)이 설정을 읽을 때 같이 고른다 — 새 앱이 다 퍼진 뒤 열과 제약을 지운다
alter table public.app_settings add column if not exists letter_max_len              int  not null default 500;
alter table public.app_settings add column if not exists comment_max_len             int  not null default 300;
alter table public.app_settings add column if not exists letter_burst                real not null default 3;
alter table public.app_settings add column if not exists letter_refill_per_sec       real not null default 0.0000347;  -- 하루에 3통 분량이 채워진다
alter table public.app_settings add column if not exists comment_burst               real not null default 10;
alter table public.app_settings add column if not exists comment_refill_per_sec      real not null default 0.5;
alter table public.app_settings add column if not exists letter_auto_suspend_reports int  not null default 3;
alter table public.app_settings drop constraint if exists app_settings_letter_lens;
alter table public.app_settings add  constraint app_settings_letter_lens
  check (letter_max_len between 20 and 1000 and comment_max_len between 10 and 500);

-- 토큰 버킷 2종 (새 편지 · 이어 쓰기)
alter table public.user_presence add column if not exists letter_tokens  real        not null default 3;
alter table public.user_presence add column if not exists letter_at      timestamptz not null default now();
alter table public.user_presence add column if not exists comment_tokens real        not null default 10;
alter table public.user_presence add column if not exists comment_at     timestamptz not null default now();


-- ── 32. 헬퍼 ────────────────────────────────────────────────────────
-- 편지 이름 후보 — "형용사 명사" (공백 포함 → 채팅 닉네임 공간과 절대 겹치지 않음)
create or replace function private.letter_alias_candidate()
returns text language sql volatile as $fn$
  select (array['푸른','조용한','따뜻한','수줍은','느린','작은','먼','흐린','맑은','졸린',
                '낯선','다정한','서툰','오래된','새하얀','깊은','가벼운','둥근','비밀스런','차분한',
                '설레는','고요한','반짝이는','포근한','아득한','투명한','엉성한','느긋한','선선한','부드러운'])[floor(random()*30)::int + 1]
      || ' ' ||
         (array['우표','편지지','우체통','등대','엽서','봉투','연필','잉크','창문','가로등',
                '종이배','별빛','달빛','바람','구름','파도','새벽','오후','계절','첫눈',
                '벚꽃','낙엽','모래','시계','책갈피','풍선','기차','정류장','골목','담벼락'])[floor(random()*30)::int + 1];
$fn$;

-- 편지 쪽 토큰 버킷 2종. msg_rate_limit / match_bucket_take 와 같은 O(1) 행 잠금 방식.
create or replace function private.letter_bucket_take(p_user uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare cfg public.app_settings%rowtype; v_tokens real; v_burst real; v_rate real;
begin
  select * into cfg from public.app_settings where id;
  if p_kind = 'letter' then
    v_burst := cfg.letter_burst; v_rate := cfg.letter_refill_per_sec;
    select least(v_burst, letter_tokens + extract(epoch from (now() - letter_at)) * v_rate)
      into v_tokens from public.user_presence where user_id = p_user for update;
  elsif p_kind = 'comment' then
    v_burst := cfg.comment_burst; v_rate := cfg.comment_refill_per_sec;
    select least(v_burst, comment_tokens + extract(epoch from (now() - comment_at)) * v_rate)
      into v_tokens from public.user_presence where user_id = p_user for update;
  else
    raise exception 'invalid_bucket';
  end if;
  if v_tokens is null then raise exception 'unauthenticated'; end if;
  if v_tokens < 1 then
    return jsonb_build_object('ok', false, 'retry_after_ms', ceil((1 - v_tokens) / v_rate * 1000));
  end if;
  if p_kind = 'letter' then
    update public.user_presence set letter_tokens = v_tokens - 1, letter_at = now() where user_id = p_user;
  else
    update public.user_presence set comment_tokens = v_tokens - 1, comment_at = now() where user_id = p_user;
  end if;
  return jsonb_build_object('ok', true);
end
$fn$;

-- 두 사람 사이에 차단이 있는가 (어느 쪽이 했든)
create or replace function private.blocked_between(a uuid, b uuid)
returns boolean language sql security definer set search_path = public stable as $fn$
  select exists (select 1 from public.blocks
                  where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$fn$;

revoke all on function private.letter_alias_candidate(), private.letter_bucket_take(uuid, text),
                       private.blocked_between(uuid, uuid)
  from public, anon, authenticated;


-- ── 34. 쓰기 RPC ────────────────────────────────────────────────────
-- 편지 서식 검사. 화면은 이 목록에 있는 종류·색·크기만 그린다(src/lib/letters/rich.ts) — 여기서 한 번 더 막는다.
--   m: [[시작, 끝, 종류]...]  글자(code point) 위치, 끝은 포함 안 함, 0 <= 시작 < 끝 <= 본문 길이
--   a: [[줄 번호, 'center'|'right']...]  줄 번호는 본문의 줄 수보다 작아야 함
create or replace function private.letter_fmt_ok(f jsonb, p_body text) returns boolean
language plpgsql immutable as $fn$
declare n int := char_length(p_body);
        v_lines int := char_length(p_body) - char_length(replace(p_body, E'\n', '')) + 1;
        e jsonb; k text;
begin
  if f is null then return true; end if;
  if jsonb_typeof(f) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(f) loop
    if k not in ('m', 'a') then return false; end if;
  end loop;
  if f ? 'm' then
    if jsonb_typeof(f->'m') <> 'array' or jsonb_array_length(f->'m') > 500 then return false; end if;
    for e in select value from jsonb_array_elements(f->'m') loop
      if jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 3 then return false; end if;
      if jsonb_typeof(e->0) <> 'number' or jsonb_typeof(e->1) <> 'number' or jsonb_typeof(e->2) <> 'string' then
        return false;
      end if;
      if (e->>0) !~ '^\d{1,5}$' or (e->>1) !~ '^\d{1,5}$' then return false; end if;
      if (e->>0)::int >= (e->>1)::int or (e->>1)::int > n then return false; end if;
      if (e->>2) !~ '^(b|i|u|s|h:(yellow|green|blue|pink|orange)|c:(red|orange|green|blue|purple|gray)|z:(sm|lg|xl))$' then
        return false;
      end if;
    end loop;
  end if;
  if f ? 'a' then
    if jsonb_typeof(f->'a') <> 'array' or jsonb_array_length(f->'a') > 500 then return false; end if;
    for e in select value from jsonb_array_elements(f->'a') loop
      if jsonb_typeof(e) <> 'array' or jsonb_array_length(e) <> 2 then return false; end if;
      if jsonb_typeof(e->0) <> 'number' or (e->>0) !~ '^\d{1,5}$' then return false; end if;
      if (e->>0)::int >= v_lines or (e->>1) is null or (e->>1) not in ('center', 'right') then return false; end if;
    end loop;
  end if;
  return true;
end
$fn$;
revoke all on function private.letter_fmt_ok(jsonb, text) from public, anon, authenticated;

-- ── 36. 신고 · 차단 ─────────────────────────────────────────────────
-- 채팅 신고(private.reports)는 2인 방 구조에 맞춰 굳어 있어 따로 둔다.
create table if not exists private.letter_reports (
  id          uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('letter','comment')),
  letter_id   bigint not null,       -- ★ FK 없음: 글이 지워져도 신고는 남아야 한다
  comment_id  bigint,
  reporter_id uuid not null,
  reported_id uuid not null,
  reason      text not null check (reason in
              ('harassment','sexual','spam','personal_info','hate','impersonation','other')),
  note        text not null default '',
  status      text not null default 'open' check (status in ('open','reviewing','actioned','dismissed')),
  handled_by  uuid,
  handled_at  timestamptz,
  action_note text,
  created_at  timestamptz not null default now()
);
alter table private.letter_reports add column if not exists source text not null default 'user' check (source in ('user','auto'));
create index if not exists letter_reports_queue    on private.letter_reports (status, created_at desc);
create index if not exists letter_reports_reported on private.letter_reports (reported_id, created_at desc);
create unique index if not exists letter_reports_once_letter
  on private.letter_reports (letter_id, reporter_id) where comment_id is null;
create unique index if not exists letter_reports_once_comment
  on private.letter_reports (comment_id, reporter_id) where comment_id is not null;
alter table private.letter_reports enable row level security;

create table if not exists private.letter_report_evidence (
  report_id uuid not null references private.letter_reports(id) on delete cascade,
  ord       int  not null,
  kind      text not null,          -- letter / parent / comment
  alias     text,
  body      text not null,
  sent_at   timestamptz not null,
  primary key (report_id, ord)
);
alter table private.letter_report_evidence enable row level security;

-- ── 38. 운영자 RPC (편지) — service_role 전용 ───────────────────────
create or replace function public.admin_list_letter_reports(p_status text default 'open', p_limit int default 100)
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select r.id, r.created_at, r.target_type, r.letter_id, r.comment_id, r.reason, left(r.note, 140) as note,
           r.status, r.reported_id, r.reporter_id, r.source,
           (select count(distinct r2.reporter_id) from private.letter_reports r2
             where r2.reported_id = r.reported_id and r2.status <> 'dismissed'
               and r2.created_at > now() - interval '30 days') as reported_30d,
           (select left(e.body, 80) from private.letter_report_evidence e
             where e.report_id = r.id order by e.ord desc limit 1) as preview,
           p.status as reported_status
      from private.letter_reports r
      left join public.profiles p on p.id = r.reported_id
     where p_status = 'all' or r.status = p_status
     order by r.created_at desc
     limit p_limit
  ) x;
$fn$;

create or replace function public.admin_letter_report(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare r private.letter_reports%rowtype;
begin
  select * into r from private.letter_reports where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'report', to_jsonb(r),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object(
                    'ord', e.ord, 'kind', e.kind, 'alias', e.alias, 'body', e.body, 'sent_at', e.sent_at)
                    order by e.ord), '[]'::jsonb)
                   from private.letter_report_evidence e where e.report_id = p_id),
    'target', jsonb_build_object('thread_status', (select status from private.dm_threads where id = r.letter_id)),
    'reported', (select jsonb_build_object('status', p.status, 'strikes', p.strikes,
                        'suspended_until', p.suspended_until, 'created_at', p.created_at)
                   from public.profiles p where p.id = r.reported_id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', h.id, 'created_at', h.created_at, 'reason', h.reason, 'status', h.status)
                    order by h.created_at desc), '[]'::jsonb)
                  from private.letter_reports h where h.reported_id = r.reported_id and h.id <> p_id),
    'chat_reports', (select count(*) from private.reports where reported_id = r.reported_id),
    'reporter_filed', (select count(*) from private.letter_reports f where f.reporter_id = r.reporter_id),
    'reporter_dismissed', (select count(*) from private.letter_reports f
                            where f.reporter_id = r.reporter_id and f.status = 'dismissed'));
end
$fn$;

create or replace function public.admin_set_letter_report(p_id uuid, p_status text, p_note text, p_staff uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  update private.letter_reports
     set status = p_status, action_note = nullif(p_note, ''), handled_by = p_staff, handled_at = now()
   where id = p_id;
  insert into private.audit_log (staff_id, action, report_id, detail)
  values (p_staff, 'letter_report_' || p_status, p_id, jsonb_build_object('note', p_note));
end
$fn$;


do $do$
declare f text;
begin
  foreach f in array array[
    'admin_list_letter_reports(text, int)', 'admin_letter_report(uuid)',
    'admin_set_letter_report(uuid, text, text, uuid)',
    'admin_stats()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;

-- 편지 신고 증거 보존 기간 (옛 알림 기록 정리 작업은 지운다)
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job
     where jobname in ('simbun-purge-letter-reports', 'simbun-purge-letter-push');
    perform cron.schedule('simbun-purge-letter-reports', '57 4 * * *',
      $q$delete from private.letter_reports where status in ('actioned','dismissed')
          and created_at < now() - interval '180 days'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 11 — 관리자 권한 확장
--
--  역할:
--    moderator(운영진) — 신고 처리, 경고, 7일 이하 정지, 사용자 검색(익명 이름·ID)·상세
--    admin(관리자)     — 위 전부 + 영구 정지·영구정지 해제, 이메일 열람·이메일 검색,
--                        모든 대화 열람, 모든 편지·댓글 작성자 확인, 설정 변경
--
--  ★ 학생 앱의 구조적 익명성(학생끼리)은 그대로다. 넓어진 것은 운영자 → 학생 방향의 열람뿐이고,
--    모든 열람·검색은 private.audit_log 에 남는다. 역할 검사는 서버 라우트와 이 함수들 양쪽에서 한다.
-- ════════════════════════════════════════════════════════════════════

create or replace function private.require_staff(p_staff uuid, p_admin boolean default false)
returns text language plpgsql security definer set search_path = public, private stable as $fn$
declare v text;
begin
  select role into v from private.staff where user_id = p_staff;
  if v is null then raise exception 'not_staff'; end if;
  -- 역할별 권한표(Phase 51 — 최고 관리자가 운영진 관리에서 바꾼다)를 따른다:
  --   p_admin = 학생 신원 · 전체 대화 · 편지 활동(identity), 아니면 신고 · 제재 · 사용자 · 개인 공지 · 업적(moderate)
  if p_admin and not private.staff_can(v, 'identity') then raise exception 'admin_only'; end if;
  if not p_admin and not private.staff_can(v, 'moderate') then raise exception 'no_permission'; end if;
  return v;
end
$fn$;
revoke all on function private.require_staff(uuid, boolean) from public, anon, authenticated;

-- 역할별 권한표 (Phase 49) — 운영자(moderator) · 개발자(developer) · 관리자(admin). 서버(lib/server/adminAuth.ts PERMS)도 같은 표
--   moderate  신고 처리 · 제재 · 사용자 · 개인 공지 · 업적     운영자 · 관리자
--   identity  학생 신원(이메일 · 학번 이름) · 전체 대화 · 편지 활동   관리자
--   settings  운영 수치 · AI · 금칙어 · 익명편지 잠금 · 홈 배너       개발자 · 관리자
--   service   서비스 열고 닫기                                    모두
--   inquiry   문의 보기 · 답변                                   모두
--   notice    공지 올리기 · 내리기                                관리자
--   any       운영진이면 누구나 (실시간 · 공지 목록)
-- Phase 51: 역할별 권한 표 — 최고 관리자가 운영진 관리 화면에서 바꾼다(관리자 줄은 없다 = 늘 전부).
--   live 실시간 현황 · moderate · identity · settings · service · inquiry · notice · audit (뜻은 위 표, live 는 Phase 51 에서 'any' 에서 떼어 냄)
create table if not exists private.role_perms (
  role text not null check (role in ('moderator', 'developer', 'beta')),
  perm text not null check (perm in ('live', 'moderate', 'identity', 'settings', 'service', 'inquiry', 'notice', 'audit')),
  primary key (role, perm)
);
alter table private.role_perms enable row level security;
-- 처음 값 = Phase 49 표 그대로 + 베타테스터(실시간만). 이미 있으면 건드리지 않는다
insert into private.role_perms (role, perm)
select r, p from (values
  ('moderator', 'live'), ('moderator', 'moderate'), ('moderator', 'service'), ('moderator', 'inquiry'), ('moderator', 'audit'),
  ('developer', 'live'), ('developer', 'settings'), ('developer', 'service'), ('developer', 'inquiry'), ('developer', 'audit'),
  ('beta', 'live')) v(r, p)
where not exists (select 1 from private.role_perms)
on conflict do nothing;

-- Phase 51: 표(private.role_perms)에서 읽는다 — 관리자는 늘 전부, 'any' 는 운영진이면 누구나
create or replace function private.staff_can(p_role text, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select p_role = 'admin'
      or (p_perm = 'any' and p_role is not null)
      or exists (select 1 from private.role_perms r where r.role = p_role and r.perm = p_perm);
$fn$;
revoke all on function private.staff_can(text, text) from public, anon, authenticated;

create or replace function private.require_perm(p_staff uuid, p_perm text)
returns text language plpgsql security definer set search_path = public, private stable as $fn$
declare v text;
begin
  select role into v from private.staff where user_id = p_staff;
  if v is null then raise exception 'not_staff'; end if;
  if not private.staff_can(v, p_perm) then raise exception 'no_permission'; end if;
  return v;
end
$fn$;
revoke all on function private.require_perm(uuid, text) from public, anon, authenticated;

-- 운영진이 정지할 수 있는 최대 일수
create or replace function private.mod_max_suspend_days() returns int
language sql immutable as $fn$ select 7 $fn$;


-- 한 사람이 받은 신고 수 (기각 제외, 채팅 + 편지)
create or replace function private.reports_received(p_user uuid) returns int
language sql security definer set search_path = public, private stable as $fn$
  select ((select count(*) from private.reports where reported_id = p_user and status <> 'dismissed')
        + (select count(*) from private.letter_reports where reported_id = p_user and status <> 'dismissed'))::int;
$fn$;
revoke all on function private.reports_received(uuid) from public, anon, authenticated;

-- 사용자 검색.  p_filter: all | restricted | staff
--   '@' 가 들어간 검색어 = 이메일 검색 → 관리자만, 기록 남김
--   그 외 = 익명 이름 부분 일치 또는 ID 앞자리
create or replace function public.admin_find_users(p_query text, p_filter text, p_staff uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  q text := btrim(coalesce(p_query, ''));
  by_email boolean := position('@' in btrim(coalesce(p_query, ''))) > 0;
begin
  perform private.require_staff(p_staff, by_email);
  if by_email then
    insert into private.audit_log (staff_id, action, detail)
    values (p_staff, 'search_email', jsonb_build_object('query', q));
  end if;

  return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select p.id, p.nickname, p.status, p.suspended_until, p.strikes, p.verified, p.onboarded, p.created_at,
           coalesce(pr.online_until > now(), false) as online, pr.online_until as last_seen,
           s.role as staff_role,
           private.reports_received(p.id) as reports_received
      from public.profiles p
      left join public.user_presence pr on pr.user_id = p.id
      left join private.staff s on s.user_id = p.id
     where (q = ''
            or (by_email and exists (select 1 from auth.users u where u.id = p.id and u.email ilike '%' || q || '%'))
            or (not by_email and (p.nickname ilike '%' || q || '%' or p.id::text like lower(q) || '%')))
       and (coalesce(p_filter, 'all') = 'all'
            or (p_filter = 'restricted' and (p.status <> 'active' or p.suspended_until > now()))
            or (p_filter = 'staff' and s.role is not null))
     order by p.created_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) x);
end
$fn$;

-- 사용자 상세 (이메일 없음 — 이메일은 admin_log_identity_view 후 서버가 따로 조회)
create or replace function public.admin_user(p_user uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_staff(p_staff);
  if not exists (select 1 from public.profiles where id = p_user) then return null; end if;
  return jsonb_build_object(
    'profile', (select jsonb_build_object(
                  'id', p.id, 'nickname', p.nickname, 'bio', p.bio, 'interests', p.interests, 'mbti', p.mbti,
                  'gender', p.gender, 'want', p.want, 'status', p.status, 'suspended_until', p.suspended_until,
                  'strikes', p.strikes, 'verified', p.verified, 'onboarded', p.onboarded, 'created_at', p.created_at)
                  from public.profiles p where p.id = p_user),
    'online', coalesce((select online_until > now() from public.user_presence where user_id = p_user), false),
    'last_seen', (select online_until from public.user_presence where user_id = p_user),
    'staff_role', (select role from private.staff where user_id = p_user),
    'counts', jsonb_build_object(
      'rooms', (select count(*) from public.room_members where user_id = p_user),
      'open_rooms', (select count(*) from public.room_members where user_id = p_user and open),
      -- 쓴 편지 (이름 편지 · 답장)
      'letters', (select count(*) from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
                   where m.is_letter and ((m.from_sender and t.sender_id = p_user) or (not m.from_sender and t.recipient_id = p_user))),
      'reports_filed', (select count(*) from private.reports where reporter_id = p_user)
                     + (select count(*) from private.letter_reports where reporter_id = p_user),
      'reports_dismissed', (select count(*) from private.reports where reporter_id = p_user and status = 'dismissed')
                         + (select count(*) from private.letter_reports where reporter_id = p_user and status = 'dismissed')),
    'chat_reports', (select coalesce(jsonb_agg(jsonb_build_object(
                        'id', r.id, 'created_at', r.created_at, 'reason', r.reason, 'status', r.status)
                        order by r.created_at desc), '[]'::jsonb)
                       from (select * from private.reports where reported_id = p_user
                              order by created_at desc limit 50) r),
    'letter_reports', (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', r.id, 'created_at', r.created_at, 'reason', r.reason, 'status', r.status,
                          'target_type', r.target_type)
                          order by r.created_at desc), '[]'::jsonb)
                         from (select * from private.letter_reports where reported_id = p_user
                                order by created_at desc limit 50) r),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                   'action', a.action, 'staff_id', a.staff_id, 'detail', a.detail, 'created_at', a.created_at)
                   order by a.created_at desc), '[]'::jsonb)
                  from (select * from private.audit_log
                         where target_user = p_user and (action like 'sanction_%' or action like '%auto_suspend%')
                         order by created_at desc limit 50) a));
end
$fn$;

-- 한 사람의 대화 목록 (관리자) — 내용은 admin_room 으로
create or replace function public.admin_user_rooms(p_user uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff, true);
  return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select r.id, r.status, r.created_at, r.closed_at, r.close_reason,
           (r.status <> 'closed' and now() < r.expires_at) as live,
           case when me.seat = 1 then r.alias1 else r.alias2 end as alias,
           other.user_id as partner_id,
           (select nickname from public.profiles where id = other.user_id) as partner_nickname,
           (select count(*) from public.messages m where m.room_id = r.id and m.sender_seat > 0) as message_count
      from public.room_members me
      join public.rooms r on r.id = me.room_id
      left join public.room_members other on other.room_id = r.id and other.user_id <> me.user_id
     where me.user_id = p_user
     order by r.created_at desc
     limit 200
  ) x);
end
$fn$;

-- 전체 대화 목록 (관리자).  p_filter: live | all
create or replace function public.admin_rooms(p_filter text, p_staff uuid, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff, true);
  return (select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) from (
    select r.id, r.status, r.created_at, r.closed_at, r.close_reason, r.round,
           (r.status <> 'closed' and now() < r.expires_at) as live,
           (select jsonb_agg(jsonb_build_object('seat', rm.seat, 'user_id', rm.user_id,
                     'nickname', (select nickname from public.profiles where id = rm.user_id)) order by rm.seat)
              from public.room_members rm where rm.room_id = r.id) as members,
           (select count(*) from public.messages m where m.room_id = r.id and m.sender_seat > 0) as message_count
      from public.rooms r
     where coalesce(p_filter, 'all') = 'all'
        or (p_filter = 'live' and r.status <> 'closed' and now() < r.expires_at)
     order by r.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 300)
  ) x);
end
$fn$;

-- 대화 열람 (관리자) — 열 때마다 기록
create or replace function public.admin_room(p_room uuid, p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare r public.rooms%rowtype;
begin
  perform private.require_staff(p_staff, true);
  select * into r from public.rooms where id = p_room;
  if not found then return null; end if;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'view_room', jsonb_build_object('room', p_room));
  return jsonb_build_object(
    'room', jsonb_build_object('id', r.id, 'status', r.status, 'round', r.round, 'created_at', r.created_at,
              'armed_at', r.armed_at, 'expires_at', r.expires_at, 'closed_at', r.closed_at,
              'close_reason', r.close_reason, 'live', r.status <> 'closed' and now() < r.expires_at),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                   'seat', rm.seat, 'user_id', rm.user_id, 'open', rm.open,
                   'alias', case when rm.seat = 1 then r.alias1 else r.alias2 end,
                   'nickname', p.nickname, 'status', p.status) order by rm.seat), '[]'::jsonb)
                  from public.room_members rm join public.profiles p on p.id = rm.user_id
                 where rm.room_id = p_room),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', m.id, 'seat', m.sender_seat, 'body', m.body, 'created_at', m.created_at,
                    'reply_to', m.reply_to,   -- 답장 (Phase 18)
                    -- 공감 (Phase 17) — { "1": "heart", "2": "laugh" } 누가(자리) 어떤 공감을 달았는지
                    'reactions', (select jsonb_object_agg(mr.seat::text, mr.emoji)
                                    from public.message_reactions mr
                                   where mr.message_id = m.id and mr.emoji is not null)) order by m.id), '[]'::jsonb)
                   from public.messages m where m.room_id = p_room));
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array[
    'admin_sanction(uuid, text, int, uuid, uuid, text)', 'admin_log_identity_view(uuid, uuid[], uuid)',
    'admin_find_users(text, text, uuid, int)', 'admin_user(uuid, uuid)', 'admin_user_rooms(uuid, uuid)',
    'admin_rooms(text, uuid, int)', 'admin_room(uuid, uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 12 — 학번-이름 명렬표 (관리자 신원 확인 보조)
--
--  private.student_roster 는 학교가 관리하는 학번↔실명 명단이다. 학생이 직접 입력하는 값이 아니고
--  (Phase 1~11 의 "실명·학번을 수집하지 않는다" 원칙은 학생 쪽 입력·저장에 대한 것),
--  admin(관리자) 화면에서만 쓴다:
--    · admin_roster_name — "이메일 확인"(admin_log_identity_view 로 기록됨) 옆에 이름
--    · admin_student_labels — 운영자 화면의 익명 이름 옆에 "(학번 이름)". 부를 때마다 view_identity 기록.
--    · 운영진(moderator)은 둘 다 못 부른다. 학생 앱·PostgREST 에는 노출되지 않는다 (service_role RPC 전용).
--  명단 원본(xlsx/csv)은 실명이 들어 있으므로 저장소에 커밋하지 않는다 — scripts/import-roster.mjs 로
--  로컬에서 서비스 키를 이용해 바로 DB 에 반영한다.
-- ════════════════════════════════════════════════════════════════════

create table if not exists private.student_roster (
  student_no int primary key,
  grade      smallint not null,
  name       text not null
);
revoke all on private.student_roster from public, anon, authenticated;

-- 명단 일괄 반영 (scripts/import-roster.mjs 전용) — p_rows: [{"no": 10101, "name": "홍길동"}, ...]
create or replace function public.admin_roster_import(p_grade smallint, p_rows jsonb)
returns int language plpgsql security definer set search_path = public, private as $fn$
declare n int;
begin
  insert into private.student_roster (student_no, grade, name)
  select (r->>'no')::int, p_grade, r->>'name'
    from jsonb_array_elements(p_rows) r
  on conflict (student_no) do update set grade = excluded.grade, name = excluded.name;
  get diagnostics n = row_count;
  insert into private.audit_log (staff_id, action, detail)
  values (null, 'roster_import', jsonb_build_object('grade', p_grade, 'count', n));
  return n;
end
$fn$;

-- 이메일 앞자리의 학번 (숫자 1~9자리만 — 그보다 길면 학번이 아니고 int 로 바꿀 수도 없다)
create or replace function private.email_student_no(p_email text) returns text
language sql immutable as $fn$
  select case when n ~ '^[0-9]{1,9}$' then n end
    from (select substring(split_part(coalesce(p_email, ''), '@', 1) from '^[0-9]+') as n) x;
$fn$;
revoke all on function private.email_student_no(text) from public, anon, authenticated;

-- 학교 이메일 앞자리(학번)로 이름 찾기 — admin(관리자)만, 이미 이메일을 확인한 다음에만 의미가 있다
create or replace function public.admin_roster_name(p_staff uuid, p_email text)
returns text language plpgsql security definer set search_path = public, private stable as $fn$
declare v_no text := private.email_student_no(p_email);
begin
  perform private.require_staff(p_staff, true);
  if v_no is null then return null; end if;
  return (select name from private.student_roster where student_no = v_no::int);
end
$fn$;

-- 화면에 나오는 사용자들의 "학번 이름" 한꺼번에 — 관리자만, 한 번 부를 때마다 활동 기록 한 줄.
-- 명단에 이름이 없으면 학번만, 이메일이 학번 형태가 아니면 빠진다.
create or replace function public.admin_student_labels(p_staff uuid, p_users uuid[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare r jsonb;
begin
  perform private.require_staff(p_staff, true);
  if coalesce(cardinality(p_users), 0) = 0 then return '{}'::jsonb; end if;
  select coalesce(jsonb_object_agg(x.id, x.label), '{}'::jsonb) into r from (
    select u.id, concat_ws(' ', v.no, sr.name) as label
      from auth.users u
      cross join lateral (select private.email_student_no(u.email) as no) v
      left join private.student_roster sr on sr.student_no = v.no::int
     where u.id = any(p_users) and v.no is not null
  ) x;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, 'view_identity', case when cardinality(p_users) = 1 then p_users[1] end,
          jsonb_build_object('users', p_users, 'via', 'label'));
  return r;
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['admin_roster_import(smallint, jsonb)', 'admin_roster_name(uuid, text)',
                           'admin_student_labels(uuid, uuid[])']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 13 — 실시간 현황 (전체 사용자 + 지금 상태)
--
--  상태는 이미 있는 값에서만 계산한다 (새로 수집하는 정보 없음):
--    · 접속 중   user_presence.online_until > now()   (앱이 화면에 떠 있으면 heartbeat 로 갱신)
--    · 매칭 대기 user_presence.seeking_until > now()
--    · 대화 중   열린 room_members + 살아 있는 방(닫히지 않았고 마감 전)
--  어느 방인지(= 누구와 대화 중인지)는 전체 대화 열람과 같은 관리자 전용이라 운영진에게는 개수만 준다.
--  상태만 보는 것이므로 열람 기록은 남기지 않는다 (학번·이름은 admin_student_labels 가 따로 기록).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.admin_live_users(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare v_admin boolean := private.staff_can(private.require_perm(p_staff, 'live'), 'identity'); -- 실시간 권한(Phase 51), 방 목록은 신원 권한
begin
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select p.id, p.nickname, p.status, p.suspended_until, p.onboarded, s.role as staff_role,
           coalesce(pr.online_until > now(), false) as online,
           pr.online_until as last_seen,
           coalesce(pr.seeking_until > now(), false) as seeking,
           coalesce(lr.n, 0) as room_count,
           coalesce(lr.talking, 0) as talking,
           case when v_admin then coalesce(lr.ids, '[]'::jsonb) end as rooms
      from public.profiles p
      left join public.user_presence pr on pr.user_id = p.id
      left join private.staff s on s.user_id = p.id
      left join lateral (
        select count(*)::int as n, jsonb_agg(r.id order by r.created_at) as ids,
               -- 둘 다 대화 화면을 보고 있는 방 (Phase 35) — 이것만 "대화 중"
               count(*) filter (where (select count(*) from public.room_members v
                                        where v.room_id = r.id and v.viewing_until > now()) = 2)::int as talking
          from public.room_members rm
          join public.rooms r on r.id = rm.room_id
         where rm.user_id = p.id and rm.open and r.status <> 'closed' and now() < r.expires_at
      ) lr on true
  ) x);
end
$fn$;
revoke all on function public.admin_live_users(uuid) from public, anon, authenticated;
grant execute on function public.admin_live_users(uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════
--  Phase 16 — 공지사항 (종 아이콘 · 빨간 점)
--
--  · 공지는 관리자만 올리고 내린다 (활동 기록에 남음). 운영진은 목록만 본다.
--  · 학생은 my_notices() 로 최근 공지와 "어디까지 봤는지"를 함께 받는다.
--    봤는지는 계정에 저장한다 (private.notice_reads) — 폰을 바꿔도 이미 본 공지에 점이 다시 뜨지 않게.
--  · 홈 화면 맨 위 한 줄(app_settings.notice)은 그대로 둔다 — 서비스를 닫았을 때 안내로도 쓰인다.
-- ════════════════════════════════════════════════════════════════════

create table if not exists private.notices (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  body        text not null default '' check (char_length(body) <= 2000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);
create index if not exists notices_live on private.notices (id desc) where removed_at is null;
alter table private.notices enable row level security;

create table if not exists private.notice_reads (
  user_id    uuid   primary key references public.profiles(id) on delete cascade,
  last_id    bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table private.notice_reads enable row level security;

-- 학생: 최근 공지 30개 + 내가 마지막으로 본 공지 번호. 이용 제한 계정도 공지는 본다.
create or replace function public.my_notices()
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  return jsonb_build_object(
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'created_at', n.created_at)
                       order by n.id desc)
        from (select * from private.notices where removed_at is null order by id desc limit 30) n
    ), '[]'::jsonb),
    'last_seen', coalesce((select last_id from private.notice_reads where user_id = me), 0),
    -- 나에게만 온 공지 (Phase 35 — 운영자의 경고 · 개인 연락). 읽었는지는 한 통씩
    'personal', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                                          'created_at', n.created_at, 'read', n.read_at is not null) order by n.id desc)
        from (select * from private.personal_notices where user_id = me and removed_at is null order by id desc limit 30) n
    ), '[]'::jsonb)
  );
end
$fn$;

-- 학생: 여기까지 봤다. 뒤로 가지 않고(greatest), 없는 번호로 앞질러 가지도 않는다.
create or replace function public.mark_notices_seen(p_id bigint)
returns bigint language plpgsql security definer set search_path = public, private as $fn$
declare
  me uuid := auth.uid();
  v  bigint := least(coalesce(p_id, 0), coalesce((select max(id) from private.notices), 0));
  r  bigint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  insert into private.notice_reads (user_id, last_id) values (me, greatest(v, 0))
  on conflict (user_id) do update
     set last_id = greatest(private.notice_reads.last_id, excluded.last_id), updated_at = now()
  returning last_id into r;
  return r;
end
$fn$;

revoke all on function public.my_notices(), public.mark_notices_seen(bigint) from public, anon;
grant execute on function public.my_notices(), public.mark_notices_seen(bigint) to authenticated;

-- 운영자: 목록 (운영진도 볼 수 있다)
create or replace function public.admin_notices(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_perm(p_staff, 'any'); -- 개발자도 목록은 본다 (Phase 49)
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'created_at', created_at)
                     order by id desc)
      from private.notices where removed_at is null
  ), '[]'::jsonb);
end
$fn$;

-- 관리자: 공지 올리기
create or replace function public.admin_post_notice(p_staff uuid, p_title text, p_body text)
returns bigint language plpgsql security definer set search_path = public, private as $fn$
declare v bigint;
begin
  if not private.staff_can(private.require_perm(p_staff, 'any'), 'notice') then raise exception 'admin_only'; end if; -- 공지 권한 (Phase 51 표)
  insert into private.notices (title, body, created_by)
  values (btrim(p_title), btrim(coalesce(p_body, '')), p_staff)
  returning id into v;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'post_notice', jsonb_build_object('notice', v, 'title', btrim(p_title)));
  return v;
end
$fn$;

-- 관리자: 공지 내리기 (지우지 않고 숨긴다 — 기록은 남는다)
create or replace function public.admin_remove_notice(p_staff uuid, p_id bigint)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare v_title text;
begin
  if not private.staff_can(private.require_perm(p_staff, 'any'), 'notice') then raise exception 'admin_only'; end if; -- 공지 권한 (Phase 51 표)
  update private.notices set removed_at = now()
   where id = p_id and removed_at is null
  returning title into v_title;
  if not found then raise exception 'notice_not_found'; end if;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'remove_notice', jsonb_build_object('notice', p_id, 'title', v_title));
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['admin_notices(uuid)', 'admin_post_notice(uuid, text, text)',
                           'admin_remove_notice(uuid, bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 17 — 메시지 공감 (❤️ 😂 😮 😢 👍 🔥)
--
--  · messages 는 그대로 둔다 (update 없음 = 증거 무결성). 공감은 별도 표에 자리(seat)로만 남긴다 —
--    extension_votes 와 같은 방식이라 사용자 식별자가 없다.
--  · 메시지 하나에 자리마다 공감 하나. 다른 걸 누르면 바뀌고, emoji = null 이 "취소".
--    ★ 행을 지우지 않는 이유: Realtime 의 DELETE 는 room_id 필터·RLS 가 적용되지 않는다.
--      null 로 바꾸는 UPDATE 는 둘 다 적용되어 같은 방 두 사람에게만 간다.
--  · 대화 중(쓸 수 있는 방)에만 달 수 있다. 방이 닫히면 메시지와 함께 보이지 않고, 지워질 때 같이 지워진다.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.message_reactions (
  message_id bigint   not null references public.messages(id) on delete cascade,
  room_id    uuid     not null references public.rooms(id) on delete cascade,
  seat       smallint not null check (seat in (1, 2)),
  emoji      text     check (emoji in ('heart', 'laugh', 'wow', 'sad', 'like', 'fire')),
  updated_at timestamptz not null default now(),
  primary key (message_id, seat)
);
create index if not exists message_reactions_room on public.message_reactions (room_id);

alter table public.message_reactions enable row level security;
drop policy if exists "reactions: read while room alive" on public.message_reactions;
create policy "reactions: read while room alive" on public.message_reactions
  for select to authenticated
  using (public.is_room_member(room_id) and public.room_is_visible(room_id));
revoke all on public.message_reactions from anon, authenticated;
grant select on public.message_reactions to authenticated;
-- 쓰기는 react_message() 로만. 실시간 전달은 Phase 55 방송.

create or replace function public.react_message(p_message bigint, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  me       uuid := auth.uid();
  v_room   uuid;
  v_sender smallint;
  v_seat   smallint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_emoji is not null and p_emoji not in ('heart', 'laugh', 'wow', 'sad', 'like', 'fire') then
    return jsonb_build_object('status', 'bad_emoji');
  end if;
  select room_id, sender_seat into v_room, v_sender from public.messages where id = p_message;
  if found then
    select seat into v_seat from public.room_members where room_id = v_room and user_id = me;
  end if;
  -- 내 방의 메시지가 아니면 있는지 없는지도 알려주지 않는다
  if v_seat is null then return jsonb_build_object('status', 'not_found'); end if;
  if v_sender = 0 then return jsonb_build_object('status', 'system'); end if;
  if not public.room_is_writable(v_room) then return jsonb_build_object('status', 'closed'); end if;

  insert into public.message_reactions (message_id, room_id, seat, emoji)
  values (p_message, v_room, v_seat, p_emoji)
  on conflict (message_id, seat) do update
     set emoji = excluded.emoji, updated_at = now()
   where public.message_reactions.emoji is distinct from excluded.emoji;  -- 같은 걸 또 보내면 이벤트 없음

  return jsonb_build_object('status', 'ok', 'message_id', p_message, 'seat', v_seat, 'emoji', p_emoji);
end
$fn$;
revoke all on function public.react_message(bigint, text) from public, anon;
grant execute on function public.react_message(bigint, text) to authenticated;

-- ── 공감 푸시 알림 ─────────────────────────────────────────────────
-- 상대 메시지에 공감을 달면 상대에게 알림. /api/push 가 { reaction_message_id } 로 부른다.
--  · 메시지 하나 × 자리 하나에 딱 한 번 — 공감을 바꾸거나 껐다 켜도 다시 울리지 않는다 (연타로 알림 폭탄 방지)
--  · 내 메시지에 단 공감, 받는 사람이 앱을 보고 있을 때(이미 보인다)는 보내지 않는다
--  · 문구에 uuid 없음 — 제목은 공감한 사람의 방 안 이름
create table if not exists private.reaction_push_log (
  message_id bigint   not null references public.messages(id) on delete cascade,
  seat       smallint not null,
  created_at timestamptz not null default now(),
  primary key (message_id, seat)
);
alter table private.reaction_push_log enable row level security;

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
revoke all on function public.reaction_push_payload(bigint, uuid) from public, anon, authenticated;
grant execute on function public.reaction_push_payload(bigint, uuid) to service_role;


-- ════════════════════════════════════════════════════════════════════
--  Phase 18 — 메시지 답장 (특정 메시지를 짚어서 답하기)
--
--  · messages.reply_to = 같은 방의 다른 메시지 id. 식별 정보가 아니라 메시지 번호일 뿐이다.
--  · 보낼 때 한 번만 정하고 바꿀 수 없다 (update 권한 없음 — 증거 무결성 그대로).
--  · 같은 방 · 시스템 안내가 아닌 메시지만 — 트리거가 검사한다 (다른 방 메시지 번호를 넣어 내용을 엿볼 수 없게).
--    FK 를 걸지 않는 이유: 방이 지워질 때 메시지가 한꺼번에 지워지므로 가리킬 대상이 남지 않는다.
-- ════════════════════════════════════════════════════════════════════

alter table public.messages add column if not exists reply_to bigint;

create or replace function public.msg_reply_check()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if new.reply_to is not null and not exists (
       select 1 from public.messages r
        where r.id = new.reply_to and r.room_id = new.room_id and r.sender_seat <> 0) then
    raise exception 'bad_reply';
  end if;
  return new;
end
$fn$;
revoke all on function public.msg_reply_check() from public, anon, authenticated;

drop trigger if exists messages_reply_check on public.messages;
create trigger messages_reply_check
  before insert on public.messages
  for each row execute function public.msg_reply_check();

grant insert (reply_to) on public.messages to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 19 — 검열봇 (규칙 필터 + AI 검토) · AI 대화 상대
--
--  1단 규칙 필터 — 보내기 전에 DB 가 막는다 (무료 · 즉시 · 밖으로 나가는 데이터 없음).
--     전화번호 · 학번 · "N학년 N반" · SNS 아이디/주소 · 금칙어(private.banned_terms, 관리자가 고친다).
--     채팅 메시지 · 편지 · 댓글 모두 insert 트리거에서. 막히면 'personal_info' / 'blocked_word' 오류.
--  2단 AI 검토 — 올라간 뒤에 서버(/api/moderate)가 Cloudflare Workers AI 로 판정한다.
--     걸리면 운영진 신고함에 '자동 감지'(source = 'auto', reporter_id 없음)로 올라간다. 판단은 사람이.
--     하루 한도(ai_mod_daily_cap) — Workers AI 무료 몫이 하루 단위(UTC 00:00 = 한국 오전 9시)라서.
--     자동 신고는 자동 정지 횟수에 세지 않는다 (count(distinct reporter_id) 가 null 을 빼므로).
--  AI 대화 상대 — 매칭을 기다리는 동안. 사람당 하루 N번 · 앱 전체 하루 N번 · 한 번에 N분 · N턴.
--     대화 내용은 DB 에 남기지 않는다 (몇 번 썼는지만 센다).
--  AI 두 기능 모두 기본은 꺼짐 — 개인정보 처리방침에 적고 운영 설정에서 켠다.
-- ════════════════════════════════════════════════════════════════════

-- ── 설정 ──
alter table public.app_settings add column if not exists ai_moderation     boolean not null default false;
alter table public.app_settings add column if not exists ai_mod_daily_cap  int     not null default 250;
alter table public.app_settings add column if not exists ai_chat           boolean not null default false;
alter table public.app_settings add column if not exists ai_chat_per_user  int     not null default 3;
alter table public.app_settings add column if not exists ai_chat_daily_cap int     not null default 3;
alter table public.app_settings add column if not exists ai_chat_minutes   int     not null default 10;
alter table public.app_settings add column if not exists ai_chat_max_turns int     not null default 30;
do $do$
begin
  alter table public.app_settings add constraint app_settings_ai_check check (
    ai_mod_daily_cap between 0 and 100000 and ai_chat_per_user between 0 and 50
    and ai_chat_daily_cap between 0 and 100000 and ai_chat_minutes between 1 and 30
    and ai_chat_max_turns between 1 and 100);
exception when duplicate_object then null;
end
$do$;

-- ── 1단: 규칙 필터 ──
create table if not exists private.banned_terms (
  pattern    text primary key,     -- 정규식 (소문자로 바꾼 글에 맞춘다)
  created_at timestamptz not null default now()
);
alter table private.banned_terms enable row level security;
-- 처음 한 번만 채운다 (관리자가 지운 것을 schema.sql 을 다시 돌릴 때 되살리지 않게)
insert into private.banned_terms (pattern)
select unnest(array[
  '섹\s*스', '씹\s*창', '보\s*빨', '느\s*금\s*마', '니\s*애\s*미', '니\s*엄\s*마\s*(뒤|죽)',
  '자\s*살\s*(해\s*라|하\s*세\s*요|해\s*버\s*려)', '뒤\s*져\s*(라|버\s*려)', '창\s*녀', '한\s*남\s*충', '김\s*치\s*녀'])
 where not exists (select 1 from private.banned_terms);

-- null = 통과, 아니면 막는 이유
create or replace function private.rule_violation(p_text text)
returns text language plpgsql stable security definer set search_path = public, private as $fn$
declare
  t text := lower(coalesce(p_text, ''));
  d text;
begin
  -- 숫자 사이의 띄어쓰기·하이픈·점을 없앤 글 (010 1234 5678, 010-1234-5678 → 01012345678)
  d := regexp_replace(t, '([0-9])[\s.\-]+(?=[0-9])', '\1', 'g');
  if d ~ '01[016789][0-9]{7,8}' then return 'personal_info'; end if;
  -- 학번: 학년 1~3 · 반 01~12 · 번호 01~39 (20529). 돈·개수 같은 숫자(15000원)는 반 자리가 맞지 않거나 단위로 걸러진다
  if t ~ '(^|[^0-9])[1-3](0[1-9]|1[0-2])(0[1-9]|[1-3][0-9])(?![0-9]|\s*(원|명|개|년|점|번|위|등|분|초|살|층|호|회|장|권|m|km|kg|%))' then
    return 'personal_info';
  end if;
  if t ~ '[1-3]\s*학년\s*[0-9]{1,2}\s*반' then return 'personal_info'; end if;
  -- SNS · 메신저 — @아이디, 주소, "인스타 아이디" 같은 말
  if t ~ '@[a-z0-9_.]{3,}' then return 'personal_info'; end if;
  if t ~ '(instagram\.com|instagr\.am|open\.kakao\.com|discord\.gg|discord\.com/invite|t\.me/|facebook\.com|tiktok\.com|snapchat\.com)' then
    return 'personal_info';
  end if;
  if t ~ '(인스타|insta|카톡|카카오톡|kakao|페메|페북|디코|디스코드|discord|텔레그램|telegram|스냅챗|snapchat|틱톡|tiktok)\s*(아이디|id|아뒤|주소|계정|알려|추가|맞팔|팔로|친추|dm|디엠)' then
    return 'personal_info';
  end if;
  if exists (select 1 from private.banned_terms b where t ~ b.pattern) then return 'blocked_word'; end if;
  return null;
end
$fn$;
revoke all on function private.rule_violation(text) from public, anon, authenticated;

create or replace function public.content_rule_check()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
declare v text;
begin
  -- ★ 조건을 and 로 묶으면 편지 표에도 new.sender_seat 를 찾다가 오류 — 따로 묻는다
  if tg_table_name = 'messages' then
    if new.sender_seat = 0 then return new; end if;  -- 시스템 안내
  end if;
  v := private.rule_violation(new.body);
  if v is not null then raise exception '%', v; end if;
  return new;
end
$fn$;
revoke all on function public.content_rule_check() from public, anon, authenticated;

drop trigger if exists messages_rule_check on public.messages;
create trigger messages_rule_check before insert on public.messages
  for each row execute function public.content_rule_check();

-- ── 2단: AI 검토 대기열 ──
alter table private.reports        alter column reporter_id drop not null;
alter table private.letter_reports alter column reporter_id drop not null;
-- self_harm(위기 신호)은 AI 만 붙인다 — 학생 신고 사유 목록(report_partner · report_letter)은 그대로
alter table private.reports drop constraint if exists reports_reason_check;
alter table private.reports add constraint reports_reason_check check (reason in
  ('harassment','sexual','spam','personal_info','hate','impersonation','other','self_harm'));
alter table private.letter_reports drop constraint if exists letter_reports_reason_check;
alter table private.letter_reports add constraint letter_reports_reason_check check (reason in
  ('harassment','sexual','spam','personal_info','hate','impersonation','other','self_harm'));

create table if not exists private.mod_queue (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('message','letter','comment')),
  ref_id     bigint not null,
  status     text not null default 'pending' check (status in ('pending','working','done','skipped','error')),
  tries      smallint not null default 0,
  verdict    jsonb,              -- {flag, category, reason} — 글 본문은 담지 않는다
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at    timestamptz,
  unique (kind, ref_id)
);
create index if not exists mod_queue_open on private.mod_queue (created_at) where status in ('pending','working');
create index if not exists mod_queue_claimed on private.mod_queue (claimed_at);
alter table private.mod_queue enable row level security;

create or replace function public.mod_enqueue()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  if not coalesce((select ai_moderation from public.app_settings where id), false) then return null; end if;
  if tg_table_name = 'messages' then
    if new.sender_seat = 0 then return null; end if;
    insert into private.mod_queue (kind, ref_id) values ('message', new.id) on conflict do nothing;
  else
    insert into private.mod_queue (kind, ref_id) values ('dm', new.id) on conflict do nothing;
  end if;
  return null;
end
$fn$;
revoke all on function public.mod_enqueue() from public, anon, authenticated;

drop trigger if exists messages_mod_enqueue on public.messages;
create trigger messages_mod_enqueue after insert on public.messages
  for each row execute function public.mod_enqueue();

-- 오늘 (Workers AI 무료 몫이 초기화되는 UTC 00:00 = 한국 오전 9시 기준)
create or replace function private.ai_day_start()
returns timestamptz language sql stable as $fn$
  select date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$fn$;

-- 검토할 글 N개를 가져간다 (서버 전용). 글 본문 + 앞뒤 맥락. 동시에 여러 요청이 와도 같은 글을 두 번 가져가지 않는다.
create or replace function public.mod_claim(p_n int default 3)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  cfg    public.app_settings%rowtype;
  v_used int;
  v_take int;
  v_out  jsonb;
begin
  select * into cfg from public.app_settings where id;
  if not cfg.ai_moderation then return '[]'::jsonb; end if;

  -- 일일 예산 조회와 작업 예약을 함께 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended('ai_mod_budget', 0));

  -- 정리: 하루 지난 것은 건너뜀 · 세 번 실패한 것은 오류 · 오래된 기록은 지움 (본문은 원래 없다)
  update private.mod_queue set status = 'skipped', done_at = now()
   where status in ('pending','working') and created_at < now() - interval '1 day';
  update private.mod_queue set status = 'error', done_at = now()
   where status = 'working' and claimed_at < now() - interval '2 minutes' and tries >= 3;
  delete from private.mod_queue where created_at < now() - interval '30 days';
  delete from private.ai_chats where created_at < now() - interval '7 days';

  select coalesce(sum(tries), 0) into v_used from private.mod_queue where claimed_at >= private.ai_day_start();
  v_take := least(greatest(coalesce(p_n, 0), 0), 10, cfg.ai_mod_daily_cap - v_used);
  if v_take <= 0 then return '[]'::jsonb; end if;

  update private.mod_queue q set status = 'working', claimed_at = now(), tries = q.tries + 1
   where q.id in (select id from private.mod_queue
                   where status = 'pending'
                      or (status = 'working' and claimed_at < now() - interval '2 minutes')
                   order by created_at limit v_take
                   for update skip locked);

  -- 원문이 이미 지워졌으면(방 purge 등) 건너뜀
  update private.mod_queue q set status = 'skipped', done_at = now()
   where q.status = 'working' and q.claimed_at = now()
     and not case q.kind
       when 'message' then exists (select 1 from public.messages m where m.id = q.ref_id)
       when 'dm'      then exists (select 1 from private.dm_msgs d where d.id = q.ref_id and d.status = 'visible')
       else false end;   -- 옛 공개 편지 · 댓글 (Phase 85 에서 걷어냄)

  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'text', x.body, 'context', x.ctx)
                            order by q.id), '[]'::jsonb) into v_out
    from private.mod_queue q
    cross join lateral (
      select m.body,
             -- 앞의 메시지 4개 (시간 순) — 같은 사람 = 작성자, 다른 사람 = 상대
             (select coalesce(jsonb_agg(jsonb_build_object('who', case when p.sender_seat = m.sender_seat then '작성자' else '상대' end,
                                                           'text', left(p.body, 300)) order by p.id), '[]'::jsonb)
                from (select * from public.messages p2
                       where p2.room_id = m.room_id and p2.id < m.id and p2.sender_seat <> 0
                       order by p2.id desc limit 4) p) as ctx
        from public.messages m where q.kind = 'message' and m.id = q.ref_id
      union all
      -- 이름 편지 (Phase 23) — 앞의 말 4개 (같은 쪽 = 작성자). 서명(Phase 35)이 있으면 본문 앞에 붙여 같이 검사
      select coalesce('[서명: ' || d.from_nick || '] ', '') || d.body,
             (select coalesce(jsonb_agg(jsonb_build_object('who', case when e.from_sender = d.from_sender then '작성자' else '상대' end,
                                                           'text', left(e.body, 300)) order by e.id), '[]'::jsonb)
                from (select * from private.dm_msgs e2
                       where e2.thread_id = d.thread_id and e2.id < d.id and e2.status = 'visible'
                       order by e2.id desc limit 4) e)
        from private.dm_msgs d where q.kind = 'dm' and d.id = q.ref_id
    ) x
   where q.status = 'working' and q.claimed_at = now();
  return v_out;
end
$fn$;

-- AI 실패도 승인한 호출 예산에서 환불하지 않는다. 최대 3회 뒤 오류로 남긴다.
create or replace function public.mod_release(p_ids bigint[])
returns void language sql security definer set search_path = public, private as $fn$
  update private.mod_queue set status = case when tries >= 3 then 'error' else 'pending' end,
         done_at = case when tries >= 3 then now() else null end
   where id = any(p_ids) and status = 'working';
$fn$;

-- 채팅 자동 신고 — 같은 방 · 같은 사람의 처리 안 된 자동 신고가 있으면 거기에 덧붙인다
create or replace function private.auto_report_message(p_msg bigint, p_reason text, p_why text)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare m public.messages%rowtype; v_sender uuid; v_report uuid; v_line text; v_body text;
begin
  select * into m from public.messages where id = p_msg;
  if not found then return; end if;
  select user_id into v_sender from public.room_members where room_id = m.room_id and seat = m.sender_seat;
  if v_sender is null then return; end if;
  v_body := coalesce((select body from private.deleted_messages where message_id = m.id), m.body);
  v_line := '[자동 감지] "' || left(v_body, 60) || '" — ' || left(coalesce(p_why, ''), 200);

  select id into v_report from private.reports
   where room_id = m.room_id and source = 'auto' and reported_id = v_sender and status in ('open','reviewing')
   limit 1;
  if v_report is null then
    insert into private.reports (room_id, reporter_id, reported_id, reason, note, source)
    values (m.room_id, null, v_sender, p_reason, v_line, 'auto')
    returning id into v_report;
  else
    update private.reports set note = left(note || E'\n' || v_line, 1000) where id = v_report;
    delete from private.report_evidence where report_id = v_report;
  end if;

  insert into private.report_evidence (report_id, ord, sender, body, sent_at)
  select v_report, row_number() over (order by x.id),
         case when x.sender_seat = 0 then 0 when x.sender_seat = m.sender_seat then 2 else 1 end,
         case when d.body is not null then '[삭제함] ' || d.body else x.body end, x.created_at
    from public.messages x left join private.deleted_messages d on d.message_id = x.id
   where x.room_id = m.room_id and x.id <= m.id;
end
$fn$;

revoke all on function private.auto_report_message(bigint, text, text) from public, anon, authenticated;

-- AI 판정 결과 (서버 전용). 걸렸으면 자동 신고.
create or replace function public.mod_verdict(p_id bigint, p_flag boolean, p_category text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare q private.mod_queue%rowtype; v_cat text;
begin
  select * into q from private.mod_queue where id = p_id for update;
  if not found or q.status <> 'working' then return jsonb_build_object('status', 'gone'); end if;
  v_cat := case when p_category in ('harassment','sexual','hate','personal_info','spam','self_harm')
                then p_category else 'other' end;
  update private.mod_queue
     set status = 'done', done_at = now(),
         verdict = jsonb_build_object('flag', coalesce(p_flag, false), 'category', v_cat, 'reason', left(coalesce(p_reason, ''), 200))
   where id = p_id;
  if coalesce(p_flag, false) then
    if q.kind = 'message' then perform private.auto_report_message(q.ref_id, v_cat, p_reason);
    elsif q.kind = 'dm' then perform private.auto_report_dm(q.ref_id, v_cat, p_reason);
    end if;
  end if;
  return jsonb_build_object('status', 'ok', 'flagged', coalesce(p_flag, false));
end
$fn$;

-- ── AI 대화 상대 ──
create table if not exists private.ai_chats (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  turns      int not null default 0
);
create index if not exists ai_chats_day  on private.ai_chats (created_at);
create index if not exists ai_chats_user on private.ai_chats (user_id, created_at desc);
alter table private.ai_chats enable row level security;

-- 학생이 부른다. 한도 안이면 새 AI 대화(또는 아직 안 끝난 대화)를 돌려준다.
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

-- 한 턴 (서버 전용 — /api/ai-chat 이 토큰에서 확인한 사용자로 부른다). 규칙 필터도 여기서.
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

-- ── 운영자 ──
create or replace function public.admin_ai_usage()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select jsonb_build_object(
    'mod_checked_today', (select coalesce(sum(tries), 0) from private.mod_queue where claimed_at >= private.ai_day_start()),
    'mod_flagged_today', (select count(*) from private.mod_queue
                           where done_at >= private.ai_day_start() and (verdict->>'flag')::boolean),
    'mod_pending',       (select count(*) from private.mod_queue where status in ('pending','working')),
    'ai_chats_today',    (select count(*) from private.ai_chats where created_at >= private.ai_day_start()),
    'day_start',         private.ai_day_start());
$fn$;

create or replace function public.admin_banned_terms()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(pattern order by created_at, pattern), '[]'::jsonb) from private.banned_terms;
$fn$;

-- 통째로 바꾼다 (관리자만). 정규식이 틀리면 모든 글이 막히므로 하나씩 미리 돌려 본다.
create or replace function public.admin_set_banned_terms(p_terms text[], p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare t text; v_clean text[] := '{}';
begin
  if not private.staff_can(private.require_perm(p_staff, 'any'), 'settings') then raise exception 'admin_only'; end if; -- 개발자 · 관리자 (Phase 49)
  foreach t in array coalesce(p_terms, '{}') loop
    t := lower(btrim(t));
    if t = '' or t = any(v_clean) then continue; end if;
    if char_length(t) > 100 then raise exception 'bad_pattern:%', left(t, 40); end if;
    begin
      perform '' ~ t;
    exception when others then
      raise exception 'bad_pattern:%', left(t, 40);
    end;
    v_clean := v_clean || t;
  end loop;
  if cardinality(v_clean) > 300 then raise exception 'too_many_terms'; end if;
  delete from private.banned_terms where pattern <> all(v_clean);
  insert into private.banned_terms (pattern) select unnest(v_clean) on conflict do nothing;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'update_banned_terms', jsonb_build_object('count', cardinality(v_clean)));
  return public.admin_banned_terms();
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array[
    'mod_claim(int)', 'mod_release(bigint[])', 'mod_verdict(bigint, boolean, text, text)',
    'ai_chat_turn(uuid, uuid, text)', 'admin_ai_usage()', 'admin_banned_terms()',
    'admin_set_banned_terms(text[], uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;
revoke all on function public.ai_chat_start() from public, anon;
grant execute on function public.ai_chat_start() to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 20 — 대화 백업 (CSV) — 서버에서 지워지기(방이 닫히고 24시간 뒤, 매일 04:17) 전에 관리자가 내려받는다
--
--  · 관리자만. 내려받을 때마다 활동 기록(export_messages)에 기간과 함께 남는다.
--  · 파일에는 계정 정보(이메일 · 사용자 id)가 없다 — 방 번호 · 방 안 익명 이름 · 시각 · 내용만.
--    누가 누구였는지는 여전히 운영자 화면에서만, 열람 기록과 함께 (방 번호로 찾아간다).
--  · 한 번에 최대 10,000줄씩 잘라서 준다 (Workers 의 요청당 CPU 한도 안에서 끝나게). 화면이 이어 붙인다.
--  · 엑셀 수식 주입 방지: = + - @ 로 시작하는 칸은 앞에 ' 를 붙인다 (학생이 쓴 글이 엑셀에서 실행되지 않게).
-- ════════════════════════════════════════════════════════════════════

create or replace function private.csv_cell(v text)
returns text language sql immutable as $fn$
  select '"' || replace(case when coalesce(v, '') ~ '^[=+\-@\t\r]' then '''' || v else coalesce(v, '') end, '"', '""') || '"';
$fn$;

create or replace function public.admin_export_messages(
  p_staff uuid, p_from timestamptz, p_to timestamptz, p_after bigint default 0, p_limit int default 5000)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare v_csv text; v_last bigint; v_n int;
begin
  if private.require_staff(p_staff) <> 'admin' then raise exception 'admin_only'; end if;
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
     where m.id > coalesce(p_after, 0) and m.created_at >= p_from and m.created_at < p_to
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
revoke all on function private.csv_cell(text) from public, anon, authenticated;
revoke all on function public.admin_export_messages(uuid, timestamptz, timestamptz, bigint, int) from public, anon, authenticated;
grant execute on function public.admin_export_messages(uuid, timestamptz, timestamptz, bigint, int) to service_role;


-- ════════════════════════════════════════════════════════════════════
--  Phase 21 — 만났던 사람도 다시 만나기 (설정 화면 스위치)
--
--  · 기본은 꺼짐 — 지금처럼 최근(운영 설정 rematch_cooldown_days, 기본 7일)에 대화한 상대는 다시 잡히지 않는다.
--  · 둘 다 켰을 때만 다시 잡힌다 (한쪽만 켜면 그대로 제외 — 다시 만나고 싶지 않은 사람의 뜻이 우선).
--  · 켜도 처음 보는 사람이 기다리고 있으면 그쪽이 먼저. 차단한 사이 · 이미 대화 중인 사이는 여전히 안 잡힌다.
--  · 본인만 바꾼다 (profiles 의 열 단위 update 권한 + "self update" 정책).
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists allow_rematch boolean not null default false;
grant update (allow_rematch) on public.profiles to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 22 — 보안 점검 (SECURITY.md)
--
--  · 표 권한 줄이기 — Supabase 는 새 표에 anon · authenticated 권한을 넉넉히 준다. RLS 가 막고 있지만
--    RLS 를 거치지 않는 권한(TRUNCATE 등)까지 남겨 둘 이유가 없다. 앱이 직접 읽는 것만 남긴다:
--      profiles = 내 행 읽기(RLS) + 정해진 열 고치기,  app_settings = 읽기,  user_presence = 없음(전부 RPC)
--  · 트리거 전용 함수는 누구도 직접 부를 수 없게 (트리거로 도는 데는 실행 권한이 필요 없다)
--  · 바깥 표를 쓰지 않는 함수들의 search_path 고정 (Supabase 점검기 경고)
--  · 푸시 구독: 알려진 푸시 서버 주소만 · 한 사람 10대까지 (save_push_subscription 에서)
-- ════════════════════════════════════════════════════════════════════
revoke all on public.profiles from anon;
revoke insert, delete, truncate, references, trigger on public.profiles from authenticated;
revoke all on public.user_presence from anon, authenticated;
revoke all on public.app_settings from anon;
revoke insert, update, delete, truncate, references, trigger on public.app_settings from authenticated;

revoke execute on function public.handle_new_user(), public.msg_rate_limit(), public.sync_verified()
  from public, anon, authenticated;
revoke execute on function public.random_alias() from public, anon, authenticated;

alter function public.random_alias() set search_path = '';
alter function private.letter_fmt_ok(jsonb, text) set search_path = '';
alter function private.letter_alias_candidate() set search_path = '';
alter function private.nickname_candidate() set search_path = '';
alter function private.email_student_no(text) set search_path = '';
alter function private.ai_day_start() set search_path = '';
alter function private.mod_max_suspend_days() set search_path = '';
alter function private.csv_cell(text) set search_path = '';

-- 예전 규칙(https 면 무엇이든)으로 저장된 구독 중 알려진 푸시 서버가 아닌 주소는 지운다
delete from public.push_subscriptions
 where endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|web\.push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)/';

-- ════════════════════════════════════════════════════════════════════
--  Phase 23 — 이름 편지 (익명편지 리뉴얼)
--
--  학생을 이름으로 찾아 → 익명으로 편지를 보내고 → 둘이 주고받는다.
--   · 받는 사람은 이름이 보인다(보낸 사람이 찾아서 골랐으니까). 보낸 사람은 편지마다 새로 붙는 익명 이름뿐.
--   · 이름은 명렬표(학교 이메일 앞자리 = 학번)에서 가져온다 — 학생이 고칠 수 없어 남의 이름으로 사칭할 수 없다.
--     명렬표에 없는 사람만 한 번 직접 적는다. 명렬표에 있는 이름은 적을 수 없다.
--   · 검색 · 받기는 profiles.letters_open(기본 켜짐)으로 끌 수 있다. 차단한 사이는 서로 검색 · 편지 불가.
--   · 괴롭힘 막기: 새 편지는 편지 한도(기본 하루 3통) · 한쪽이 답 없이 3개까지 · 받는 사람이 끝내면 그 사람에게 다시 못 보냄
--     · 규칙 필터(신상정보 · 금칙어) · AI 검토 · 신고(운영진은 보낸 사람을 기록과 함께 확인할 수 있다).
--   · 표는 전부 private — 학생은 아래 RPC 로만. 보낸 사람의 계정은 받는 사람에게 어떤 응답에도 나오지 않는다.
-- ════════════════════════════════════════════════════════════════════

-- ── 이름 ──
create table if not exists private.self_names (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 20),
  created_at timestamptz not null default now()
);
alter table private.self_names enable row level security;

-- 한 사람의 이름 · 학년 · 출처(roster = 명렬표, self = 직접 적음)
create or replace function private.person(p_user uuid)
returns table (name text, grade smallint, source text)
language sql security definer set search_path = '' stable as $fn$
  select coalesce(r.name, s.name), r.grade,
         case when r.name is not null then 'roster' when s.name is not null then 'self' end
    from auth.users u
    left join private.student_roster r on r.student_no = private.email_student_no(u.email)::int
    left join private.self_names s on s.user_id = u.id
   where u.id = p_user;
$fn$;
revoke all on function private.person(uuid) from public, anon, authenticated;


-- 명렬표에 없는 사람만 한 번 — 명렬표에 있는 이름은 쓸 수 없다(사칭 방지). 바꾸려면 운영진에게.
create or replace function public.set_my_name(p_name text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text := btrim(coalesce(p_name, '')); cur record;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into cur from private.person(me);
  if cur.source = 'roster' then return jsonb_build_object('status', 'roster'); end if;
  if cur.source = 'self' then return jsonb_build_object('status', 'already'); end if;
  if v !~ '^[가-힣A-Za-z]{2,20}$' then return jsonb_build_object('status', 'bad_name'); end if;
  if exists (select 1 from private.student_roster where name = v) then
    return jsonb_build_object('status', 'name_in_roster');
  end if;
  insert into private.self_names (user_id, name) values (me, v);
  return jsonb_build_object('status', 'ok');
end
$fn$;

-- ── 받기 설정 ──
alter table public.profiles add column if not exists letters_open boolean not null default true;
grant update (letters_open) on public.profiles to authenticated;

-- ── 편지 (대화 한 줄기 = thread) ──
create table if not exists private.dm_threads (
  id             bigint generated always as identity primary key,
  sender_id      uuid not null references public.profiles(id) on delete cascade,
  recipient_id   uuid not null references public.profiles(id) on delete cascade,
  sender_alias   text not null,                  -- 받는 사람에게 보이는 이름 ("익명 · 푸른 우표")
  status         text not null default 'open' check (status in ('open','closed','removed')),
  closed_by      text check (closed_by in ('sender','recipient','staff')),
  created_at     timestamptz not null default now(),
  last_at        timestamptz not null default now(),
  sender_read    bigint not null default 0,      -- 어디까지 읽었나 (dm_msgs.id)
  recipient_read bigint not null default 0,
  check (sender_id <> recipient_id)
);
create unique index if not exists dm_threads_pair_open on private.dm_threads (sender_id, recipient_id) where status = 'open';
create index if not exists dm_threads_sender    on private.dm_threads (sender_id, last_at desc);
create index if not exists dm_threads_recipient on private.dm_threads (recipient_id, last_at desc);
alter table private.dm_threads enable row level security;

create table if not exists private.dm_msgs (
  id          bigint generated always as identity primary key,
  thread_id   bigint not null references private.dm_threads(id) on delete cascade,
  from_sender boolean not null,
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  status      text not null default 'visible' check (status in ('visible','removed')),
  created_at  timestamptz not null default now()
);
create index if not exists dm_msgs_thread on private.dm_msgs (thread_id, id);
alter table private.dm_msgs enable row level security;
-- 차단/수신 거부도 발신자에게는 정상 발송으로 보인다. 전달되지 않은 편지는 수신자에게만 숨긴다.
alter table private.dm_threads add column if not exists recipient_refused boolean not null default false;
alter table private.dm_msgs add column if not exists delivered boolean not null default true;

-- 규칙 필터 (신상정보 · 금칙어) — 채팅 · 편지와 같은 함수
drop trigger if exists dm_msgs_rule_check on private.dm_msgs;
create trigger dm_msgs_rule_check before insert on private.dm_msgs
  for each row execute function public.content_rule_check();

-- AI 검토 대기열에 'dm'
alter table private.mod_queue drop constraint if exists mod_queue_kind_check;
alter table private.mod_queue add constraint mod_queue_kind_check check (kind in ('message','letter','comment','dm'));


revoke all on function public.mod_enqueue() from public, anon, authenticated;
drop trigger if exists dm_msgs_mod_enqueue on private.dm_msgs;
create trigger dm_msgs_mod_enqueue after insert on private.dm_msgs
  for each row execute function public.mod_enqueue();

-- 편지 한 줄기에서 나(me)의 자리 — 'sender' / 'recipient' / null(남의 것)
create or replace function private.dm_role(p_thread bigint, p_user uuid)
returns text language sql security definer set search_path = '' stable as $fn$
  select case when t.sender_id = p_user then 'sender' when t.recipient_id = p_user then 'recipient' end
    from private.dm_threads t where t.id = p_thread;
$fn$;
revoke all on function private.dm_role(bigint, uuid) from public, anon, authenticated;

-- 보낼 수 있는 사람인가 (학생 쪽 공통) — 정지 · 온보딩 · 이름
create or replace function private.dm_can_write(p_user uuid)
returns text language plpgsql security definer set search_path = public, private stable as $fn$
declare p public.profiles%rowtype;
begin
  if not coalesce((select is_open from public.app_settings where id), false) or private.in_maintenance() then
    return 'service_closed';
  end if;
  -- 익명편지 잠금 (Phase 44) — 가입한 학생이 적을 때는 누가 보냈는지 쉽게 짐작되므로 아무도 쓰지 못한다
  if private.letters_locked() then return 'letters_locked'; end if;
  select * into p from public.profiles where id = p_user;
  if not found or not p.onboarded or p.status <> 'active' or coalesce(p.suspended_until > now(), false) then
    return 'restricted';
  end if;
  if (select name from private.person(p_user)) is null then return 'no_name'; end if;
  return null;
end
$fn$;
revoke all on function private.dm_can_write(uuid) from public, anon, authenticated;

-- 한쪽이 답 없이 연달아 보낸 수
create or replace function private.dm_streak(p_thread bigint, p_from_sender boolean)
returns int language sql security definer set search_path = '' stable as $fn$
  select count(*)::int from private.dm_msgs m
   where m.thread_id = p_thread and m.from_sender = p_from_sender
     and m.id > coalesce((select max(o.id) from private.dm_msgs o
                           where o.thread_id = p_thread and o.from_sender <> p_from_sender and o.delivered), 0);
$fn$;
revoke all on function private.dm_streak(bigint, boolean) from public, anon, authenticated;

-- 학생 찾기 — 이름에 검색어가 들어간 사람 10명. 받기를 끈 사람 · 차단한 사이 · 이용 제한 · 나 자신은 빼고. 대표 뱃지도 (Phase 84)
create or replace function public.dm_search(p_q text)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare me uuid := auth.uid(); q text := btrim(coalesce(p_q, ''));
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if char_length(q) < 2 or private.letters_locked() then return '[]'::jsonb; end if;   -- 잠겨 있으면 찾기도 없다 (Phase 44)
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'grade', x.grade, 'no', x.no, 'checked', x.source = 'roster',
                                        'badges', private.featured_for(x.id, 'letter'))   -- 대표 뱃지 (Phase 84 — 순서는 그 사람이 정한 대로)
                     order by x.exact desc, x.grade nulls last, x.no nulls last, x.name)
      from (select p.id, n.name, n.grade, n.source, n.name = q as exact,
                   -- 학번 = 학교 이메일 앞자리 (Phase 35 — 같은 학년 동명이인 구분)
                   (select private.email_student_no(u.email) from auth.users u where u.id = p.id) as no
              from public.profiles p
              cross join lateral private.person(p.id) n
             where p.id <> me and p.letters_open and p.onboarded
               and n.name is not null and position(q in n.name) > 0
             order by (n.name = q) desc, n.grade nulls last, n.name
             limit 10) x), '[]'::jsonb);
end
$fn$;

-- 새 편지 — 받는 사람과 열린 편지가 있으면 거기에 이어 쓴다
create or replace function public.dm_send(p_to uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text; t private.dm_threads%rowtype; b jsonb; p public.profiles%rowtype; mid bigint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  v := private.dm_can_write(me);
  if v is not null then return jsonb_build_object('status', v); end if;
  if p_to is null or p_to = me then return jsonb_build_object('status', 'not_available'); end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then return jsonb_build_object('status', 'bad_text'); end if;

  select * into p from public.profiles where id = p_to;
  if not found or not p.letters_open or not p.onboarded or p.status <> 'active'
     or coalesce(p.suspended_until > now(), false) or private.blocked_between(me, p_to) then
    return jsonb_build_object('status', 'not_available');   -- 왜 안 되는지(차단 · 받기 끔)는 알려 주지 않는다
  end if;
  -- 받는 사람이 끝낸 적이 있으면 그 사람에게는 다시 못 보낸다
  if exists (select 1 from private.dm_threads where sender_id = me and recipient_id = p_to and closed_by = 'recipient') then
    return jsonb_build_object('status', 'not_available');
  end if;

  select * into t from private.dm_threads where sender_id = me and recipient_id = p_to and status = 'open' for update;
  if found then
    if private.dm_streak(t.id, true) >= 3 then return jsonb_build_object('status', 'wait_reply', 'thread_id', t.id); end if;
    b := private.letter_bucket_take(me, 'comment');
  else
    b := private.letter_bucket_take(me, 'letter');       -- 새 편지는 편지 한도 (기본 하루 3통)
  end if;
  if not (b->>'ok')::boolean then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_ms', (b->>'retry_after_ms')::int);
  end if;
  if t.id is null then
    insert into private.dm_threads (sender_id, recipient_id, sender_alias)
    values (me, p_to, private.letter_alias_candidate()) returning * into t;
  end if;
  insert into private.dm_msgs (thread_id, from_sender, body) values (t.id, true, btrim(p_body)) returning id into mid;
  update private.dm_threads set last_at = now(), sender_read = mid where id = t.id;
  return jsonb_build_object('status', 'ok', 'thread_id', t.id, 'msg_id', mid);
end
$fn$;

-- 답장 (보낸 사람 · 받는 사람 둘 다)
create or replace function public.dm_reply(p_thread bigint, p_body text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text; role text; t private.dm_threads%rowtype; b jsonb; mid bigint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into t from private.dm_threads where id = p_thread for update;
  role := case when t.sender_id = me then 'sender' when t.recipient_id = me then 'recipient' end;
  if role is null or t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  if t.status <> 'open' then return jsonb_build_object('status', 'closed'); end if;
  -- 편지로 주고받는 중이면 채팅은 못 쓴다 — 받은 사람이 "채팅하기"(dm_chat)를 골라야 채팅으로 바뀐다
  if t.mode <> 'chat' then return jsonb_build_object('status', 'letter_mode'); end if;
  v := private.dm_can_write(me);
  if v is not null then return jsonb_build_object('status', v); end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then return jsonb_build_object('status', 'bad_text'); end if;
  if private.blocked_between(t.sender_id, t.recipient_id) then return jsonb_build_object('status', 'closed'); end if;
  if private.dm_streak(p_thread, role = 'sender') >= 3 then return jsonb_build_object('status', 'wait_reply'); end if;
  b := private.letter_bucket_take(me, 'comment');
  if not (b->>'ok')::boolean then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_ms', (b->>'retry_after_ms')::int);
  end if;
  insert into private.dm_msgs (thread_id, from_sender, body) values (p_thread, role = 'sender', btrim(p_body)) returning id into mid;
  if role = 'sender' then update private.dm_threads set last_at = now(), sender_read = mid where id = p_thread;
  else update private.dm_threads set last_at = now(), recipient_read = mid where id = p_thread; end if;
  return jsonb_build_object('status', 'ok', 'msg_id', mid);
end
$fn$;

-- 받은 · 보낸 편지 목록. 받는 사람에게 보낸 사람은 익명 이름뿐.
create or replace function public.dm_inbox()
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  return jsonb_build_object('threads', coalesce((
    select jsonb_agg(x order by x.last_at desc) from (
      select t.id, t.status, t.last_at,
             case when t.sender_id = me then 'sent' else 'received' end as role,
             case when t.sender_id = me then (select name from private.person(t.recipient_id)) else t.sender_alias end as title,
             case when t.sender_id = me then (select grade from private.person(t.recipient_id)) end as grade,
             (select left(m.body, 80) from private.dm_msgs m where m.thread_id = t.id and m.status = 'visible' order by m.id desc limit 1) as last_body,
             (select count(*) from private.dm_msgs m
               where m.thread_id = t.id and m.status = 'visible'
                 and m.from_sender = (t.sender_id <> me)
                 and m.id > case when t.sender_id = me then t.sender_read else t.recipient_read end)::int as unread
        from private.dm_threads t
       where ((t.sender_id = me and not t.sender_hidden) or (t.recipient_id = me and not t.recipient_hidden))
         and t.status <> 'removed'
       order by t.last_at desc limit 100) x), '[]'::jsonb),
    'server_now', now());
end
$fn$;

-- 편지 한 줄기 — 열면 읽음으로
create or replace function public.dm_thread(p_thread bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); t private.dm_threads%rowtype; role text; last bigint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into t from private.dm_threads where id = p_thread;
  role := case when t.sender_id = me and not t.sender_hidden then 'sender'
               when t.recipient_id = me and not t.recipient_hidden then 'recipient' end;
  if role is null or t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  select max(id) into last from private.dm_msgs where thread_id = p_thread;
  if role = 'sender' then update private.dm_threads set sender_read = greatest(sender_read, coalesce(last, 0)) where id = p_thread;
  else update private.dm_threads set recipient_read = greatest(recipient_read, coalesce(last, 0)) where id = p_thread; end if;
  return jsonb_build_object(
    'status', 'ok', 'id', t.id, 'role', case when role = 'sender' then 'sent' else 'received' end,
    'title', case when role = 'sender' then (select name from private.person(t.recipient_id)) else t.sender_alias end,
    'grade', case when role = 'sender' then (select grade from private.person(t.recipient_id)) end,
    'thread_status', t.status, 'closed_by', t.closed_by,
    'their_read', case when role = 'sender' then t.recipient_read else t.sender_read end,
    'mode', t.mode,
    -- 편지지의 To. / From. — 보낸 사람 쪽 가명과 받는 사람 이름 (둘 다 이미 서로 아는 값: 보낸 사람은 받는 사람 이름을 골랐고,
    -- 받는 사람은 가명을 본다. 자기 가명 · 자기 이름을 자기에게 보여 줄 뿐 새로 드러나는 것은 없다)
    'alias', t.sender_alias,
    'recipient_name', (select name from private.person(t.recipient_id)),
    'wait_reply', t.status = 'open' and private.dm_streak(p_thread, role = 'sender') >= 3,
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', m.id, 'mine', m.from_sender = (role = 'sender'),
                   'body', case when m.status = 'visible' then m.body end,
                   'fmt', case when m.status = 'visible' then m.fmt end,
                   'removed', m.status = 'removed',
                   'letter', m.is_letter,
                   'created_at', m.created_at) order by m.id)
                 from private.dm_msgs m where m.thread_id = p_thread), '[]'::jsonb),
    'server_now', now());
end
$fn$;

-- 그만 주고받기 (둘 다 가능). 받는 사람이 끝내면 그 보낸 사람은 다시 편지를 보낼 수 없다.
create or replace function public.dm_close(p_thread bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); role text;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  role := private.dm_role(p_thread, me);
  if role is null then return jsonb_build_object('status', 'not_found'); end if;
  perform private.dm_leave(p_thread, role);
  return jsonb_build_object('status', 'ok');
end
$fn$;

-- 차단 — 상대 계정은 알려 주지 않고 blocks 에 넣는다 (채팅 · 검색에서도 서로 안 보인다)
create or replace function public.dm_block(p_thread bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); t private.dm_threads%rowtype; other uuid; role text;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into t from private.dm_threads where id = p_thread;
  role := case when t.sender_id = me then 'sender' when t.recipient_id = me then 'recipient' end;
  if role is null then return jsonb_build_object('status', 'not_found'); end if;
  other := case when role = 'sender' then t.recipient_id else t.sender_id end;
  insert into public.blocks (blocker_id, blocked_id) values (me, other) on conflict do nothing;
  -- 편지에서 차단해도 같은 두 사람의 이미 열린 랜덤채팅을 즉시 끝낸다.
  perform public.close_room(a.room_id, 'blocked')
    from public.room_members a join public.room_members b on b.room_id = a.room_id
   where a.user_id = me and b.user_id = other and a.open and b.open;
  perform private.dm_leave(p_thread, role);
  return jsonb_build_object('status', 'ok');
end
$fn$;

-- ── 신고 — 편지 신고함(letter_reports)에 target_type 'dm' 으로. letter_id = 편지 줄기 id, comment_id = 신고한 말 id
alter table private.letter_reports drop constraint if exists letter_reports_target_type_check;
alter table private.letter_reports add constraint letter_reports_target_type_check check (target_type in ('letter','comment','dm'));
drop index if exists private.letter_reports_once_letter;
create unique index if not exists letter_reports_once_letter
  on private.letter_reports (target_type, letter_id, reporter_id) where comment_id is null;
drop index if exists private.letter_reports_once_comment;
create unique index if not exists letter_reports_once_comment
  on private.letter_reports (target_type, comment_id, reporter_id) where comment_id is not null;

-- 증거: 그 줄기의 말 전부 (신고 순간의 사본). alias = 보낸 사람은 익명 이름, 받는 사람은 이름
create or replace function private.dm_copy_evidence(p_report uuid, p_thread bigint)
returns void language sql security definer set search_path = '' as $fn$
  insert into private.letter_report_evidence (report_id, ord, kind, alias, body, sent_at)
  select p_report, row_number() over (order by m.id),
         case when m.from_sender then 'dm_sender' else 'dm_recipient' end,
         case when m.from_sender then t.sender_alias else (select name from private.person(t.recipient_id)) end,
         m.body, m.created_at
    from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
   where m.thread_id = p_thread
  on conflict do nothing;
$fn$;
revoke all on function private.dm_copy_evidence(uuid, bigint) from public, anon, authenticated;

create or replace function public.dm_report(p_thread bigint, p_reason text, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); t private.dm_threads%rowtype; role text; other uuid; v_report uuid;
        cfg public.app_settings%rowtype; v_n int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_reason not in ('harassment','sexual','spam','personal_info','hate','impersonation','other') then
    raise exception 'invalid_reason';
  end if;
  select * into t from private.dm_threads where id = p_thread;
  role := case when t.sender_id = me then 'sender' when t.recipient_id = me then 'recipient' end;
  if role is null then return jsonb_build_object('status', 'not_found'); end if;
  other := case when role = 'sender' then t.recipient_id else t.sender_id end;
  if exists (select 1 from private.letter_reports where target_type = 'dm' and letter_id = p_thread and reporter_id = me and comment_id is null) then
    return jsonb_build_object('status', 'already');
  end if;
  insert into private.letter_reports (target_type, letter_id, comment_id, reporter_id, reported_id, reason, note)
  values ('dm', p_thread, null, me, other, p_reason, left(coalesce(p_note, ''), 1000))
  returning id into v_report;
  perform private.dm_copy_evidence(v_report, p_thread);
  -- 신고하면 차단 + 끝내고 내 목록에서 지운다 (증거는 위에서 복사해 뒀다)
  insert into public.blocks (blocker_id, blocked_id) values (me, other) on conflict do nothing;
  perform public.close_room(a.room_id, 'reported')
    from public.room_members a join public.room_members b on b.room_id = a.room_id
   where a.user_id = me and b.user_id = other and a.open and b.open;
  perform private.dm_leave(p_thread, role);

  -- 자동 정지 — 편지 신고와 같이 센다
  select * into cfg from public.app_settings where id;
  select count(distinct reporter_id) into v_n from private.letter_reports
   where reported_id = other and status <> 'dismissed' and created_at > now() - interval '30 days';
  if v_n >= cfg.letter_auto_suspend_reports then
    update public.profiles set status = 'suspended' where id = other and status = 'active';
    if found then
      insert into private.audit_log (staff_id, action, target_user, report_id, detail)
      values (null, 'auto_suspend_letters', other, v_report, jsonb_build_object('distinct_reporters', v_n));
      perform public.close_room(rm.room_id, 'admin') from public.room_members rm where rm.user_id = other and rm.open;
    end if;
  end if;
  return jsonb_build_object('status', 'ok');
end
$fn$;

-- AI 가 걸어 낸 편지 — 자동 신고 (줄기 하나에 하나)
create or replace function private.auto_report_dm(p_msg bigint, p_reason text, p_why text)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare m private.dm_msgs%rowtype; t private.dm_threads%rowtype; v_target uuid; v_report uuid;
begin
  select * into m from private.dm_msgs where id = p_msg;
  if not found then return; end if;
  select * into t from private.dm_threads where id = m.thread_id;
  v_target := case when m.from_sender then t.sender_id else t.recipient_id end;
  if exists (select 1 from private.letter_reports where source = 'auto' and target_type = 'dm' and letter_id = t.id
                and status in ('open','reviewing')) then return; end if;
  insert into private.letter_reports (target_type, letter_id, comment_id, reporter_id, reported_id, reason, note, source)
  values ('dm', t.id, p_msg, null, v_target, p_reason, '[자동 감지] ' || left(coalesce(p_why, ''), 200), 'auto')
  returning id into v_report;
  perform private.dm_copy_evidence(v_report, t.id);
end
$fn$;
revoke all on function private.auto_report_dm(bigint, text, text) from public, anon, authenticated;


-- 편지 줄기 내리기 (운영진) — 둘 다에게서 사라진다. 증거는 신고에 복사돼 있다.
create or replace function public.admin_remove_dm(p_thread bigint, p_staff uuid, p_report uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  update private.dm_threads set status = 'removed', closed_by = 'staff' where id = p_thread;
  if not found then raise exception 'thread_not_found'; end if;
  insert into private.audit_log (staff_id, action, report_id, detail)
  values (p_staff, 'remove_dm', p_report, jsonb_build_object('thread', p_thread));
end
$fn$;

-- ── 푸시 — 새 편지 · 답장. 받는 사람에게 보낸 사람은 "익명"으로만.
create table if not exists private.dm_push_log (
  msg_id     bigint primary key references private.dm_msgs(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.dm_push_log enable row level security;

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

do $do$
declare f text;
begin
  foreach f in array array['dm_search(text)', 'dm_send(uuid, text)', 'dm_reply(bigint, text)', 'dm_inbox()',
                           'dm_thread(bigint)', 'dm_close(bigint)', 'dm_block(bigint)', 'dm_report(bigint, text, text)',
                           'set_my_name(text)', 'my_account()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['dm_push_payload(bigint, uuid)', 'admin_remove_dm(bigint, uuid, uuid)',
                           'admin_letter_report(uuid)', 'mod_claim(int)', 'mod_verdict(bigint, boolean, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 24 — 이름 편지 서식 (편지 쓰기 편집기)
--
--  새 편지를 쓸 때 굵게 · 기울임 · 밑줄 · 취소선 · 형광펜 · 글자색 · 크기 · 정렬.
--  옛 공개 편지(Phase 14)와 같은 방식 — 본문은 순수 텍스트 그대로, 서식은 fmt 에 범위 목록으로.
--  종류 · 색 · 크기는 정해진 표에서만 (private.letter_fmt_ok). 화면도 HTML 을 넣지 않고 표로만 그린다.
--  답장은 지금처럼 글자만 (fmt 없음).
-- ════════════════════════════════════════════════════════════════════
alter table private.dm_msgs add column if not exists fmt jsonb;

-- 서식이 생기며 인자가 늘었다 — 옛 두 인자 버전을 지워 두 버전이 헷갈리지 않게
drop function if exists public.dm_send(uuid, text);
drop function if exists public.dm_send(uuid, text, jsonb);   -- Phase 35: 서명(p_nick)이 붙었다
-- p_nick = 받는 사람에게 보일 서명 (Phase 35). 비우면 "익명의 ○학생". 규칙 필터(신상정보 · 금칙어)를 거친다
create or replace function public.dm_send(p_to uuid, p_body text, p_fmt jsonb default null, p_nick text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text; t private.dm_threads%rowtype; b jsonb; p public.profiles%rowtype; mid bigint;
        v_delivery boolean;
        v_body text := btrim(coalesce(p_body, ''));
        v_fmt jsonb := case when p_fmt is null or p_fmt = '{}'::jsonb or jsonb_typeof(p_fmt) = 'null' then null else p_fmt end;
        v_nick text := private.dm_nick(p_nick);
begin
  if me is null then raise exception 'unauthenticated'; end if;
  v := private.dm_can_write(me);
  if v is not null then return jsonb_build_object('status', v); end if;
  if p_to is null or p_to = me then return jsonb_build_object('status', 'not_available'); end if;
  if char_length(v_body) not between 1 and 1000 then return jsonb_build_object('status', 'bad_text'); end if;
  -- 서식 위치는 본문 기준이라, 앞뒤 공백이 잘려 나가면 어긋난다 — 클라가 미리 잘라서 보낸다
  if v_fmt is not null and (v_body <> p_body or not private.letter_fmt_ok(v_fmt, v_body)) then
    return jsonb_build_object('status', 'bad_text');
  end if;
  if private.dm_nick_bad(v_nick) then return jsonb_build_object('status', 'bad_nick'); end if;

  select * into p from public.profiles where id = p_to;
  if not found or not p.letters_open or not p.onboarded then
    return jsonb_build_object('status', 'not_available');
  end if;
  -- 차단 · 수신 거부 · 정지는 계정별 전송 응답으로 익명 상대를 찾는 단서가 되지 않는다.
  -- 발신자 편지는 똑같이 저장하고 한도를 적용하되, 수신자에게 전달하지 않는다.
  v_delivery := p.status = 'active' and not coalesce(p.suspended_until > now(), false)
    and not private.blocked_between(me, p_to)
    and not exists (select 1 from private.dm_threads where sender_id = me and recipient_id = p_to and recipient_refused);

  select * into t from private.dm_threads where sender_id = me and recipient_id = p_to and status = 'open' for update;
  if found then
    if private.dm_streak(t.id, true) >= 3 then return jsonb_build_object('status', 'wait_reply', 'thread_id', t.id); end if;
    b := private.letter_bucket_take(me, 'comment');
  else
    b := private.letter_bucket_take(me, 'letter');       -- 새 편지는 편지 한도 (기본 하루 3통)
  end if;
  if not (b->>'ok')::boolean then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_ms', (b->>'retry_after_ms')::int);
  end if;
  if t.id is null then
    insert into private.dm_threads (sender_id, recipient_id, sender_alias)
    values (me, p_to, private.letter_alias_candidate()) returning * into t;
  end if;
  insert into private.dm_msgs (thread_id, from_sender, body, fmt, is_letter, from_nick, delivered)
  values (t.id, true, v_body, v_fmt, true, v_nick, v_delivery) returning id into mid;
  update private.dm_threads set last_at = now(), sender_read = mid where id = t.id;
  return jsonb_build_object('status', 'ok', 'thread_id', t.id, 'msg_id', mid);
end
$fn$;
revoke all on function public.dm_send(uuid, text, jsonb, text) from public, anon;
grant execute on function public.dm_send(uuid, text, jsonb, text) to authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 25 — 이름 편지: 나가면 내 목록에서 지우기 · 가명만
--
--  · 끝내기(나가기) · 차단 · 신고를 하면 그 편지가 "내" 목록에서 사라진다 (상대 목록에는 "끝남"으로 남고, 상대도 나가면 사라진다).
--    표에서 지우지는 않는다 — "받는 사람이 끝내면 다시 못 보냄" 규칙 · 신고 증거 · 운영자 확인에 필요하다.
--  · 그래서 끝낸 뒤 같은 사람에게 새로 보내도 목록에 같은 이름이 둘 뜨지 않는다.
--  · 받는 사람 쪽 이름 · 알림 제목은 "익명 · ○○" 대신 가명(○○)만.
-- ════════════════════════════════════════════════════════════════════
alter table private.dm_threads add column if not exists sender_hidden    boolean not null default false;
alter table private.dm_threads add column if not exists recipient_hidden boolean not null default false;
-- 이미 끝낸 편지는 끝낸 사람 목록에서 지운다 (Phase 25 전에 끝낸 것)
update private.dm_threads set sender_hidden = true    where closed_by = 'sender'    and not sender_hidden;
update private.dm_threads set recipient_hidden = true where closed_by = 'recipient' and not recipient_hidden;
-- 이미 수신자가 버린 줄기도 거부를 보존한다. 발신자가 먼저 버렸어도 별도 사실로 남는다.
update private.dm_threads set recipient_refused = true
 where not recipient_refused and (closed_by = 'recipient' or (recipient_hidden and status <> 'open'));

-- 끝내고(열려 있으면) 내 목록에서 지운다 — 나가기 · 차단 · 신고 공통
create or replace function private.dm_leave(p_thread bigint, p_role text)
returns void language sql security definer set search_path = '' as $fn$
  update private.dm_threads
     set status    = case when status = 'open' then 'closed' else status end,
         closed_by = case when status = 'open' then p_role else closed_by end,
         recipient_refused = recipient_refused or p_role = 'recipient',
         sender_hidden    = sender_hidden or p_role = 'sender',
         recipient_hidden = recipient_hidden or p_role = 'recipient'
   where id = p_thread;
$fn$;
revoke all on function private.dm_leave(bigint, text) from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 27 — 이름 편지: 편지로 주고받거나, 채팅으로 바꾸거나
--
--  편지지(To. · 내용 · From.)로 보내고, 받은 사람은 "편지로 답장하기" 또는 "채팅하기" 중 하나를 고른다.
--   · dm_threads.mode: 'letter'(편지로 주고받는 중) → 'chat'(받은 사람이 채팅하기를 고름). 한 번 채팅이 되면 채팅으로 이어진다.
--   · dm_msgs.is_letter: 편지(편지지로 그린다) / 채팅 한 줄(말풍선)
--   · dm_letter = 편지로 답장 (편지 모드에서만) · dm_chat = 채팅으로 바꾸기 (마지막 편지를 받은 사람만) · dm_reply = 채팅 (채팅 모드에서만)
--  이미 오간 편지(Phase 23~26)는 첫 말만 편지로 보고, 채팅처럼 주고받은 줄기는 채팅 모드로 둔다.
-- ════════════════════════════════════════════════════════════════════
alter table private.dm_threads add column if not exists mode text not null default 'letter';
alter table private.dm_threads drop constraint if exists dm_threads_mode_check;
alter table private.dm_threads add constraint dm_threads_mode_check check (mode in ('letter', 'chat'));
alter table private.dm_msgs add column if not exists is_letter boolean not null default false;
-- 예전 편지: 줄기의 첫 말 = 편지. 편지가 아닌 말이 하나라도 있으면(= 채팅처럼 주고받음) 채팅 모드.
update private.dm_msgs m set is_letter = true
 where not m.is_letter and m.id = (select min(o.id) from private.dm_msgs o where o.thread_id = m.thread_id);
update private.dm_threads t set mode = 'chat'
 where t.mode = 'letter' and exists (select 1 from private.dm_msgs m where m.thread_id = t.id and not m.is_letter);


-- 편지로 답장 (편지 모드에서만). 서식도 새 편지와 같이 받는다.
-- p_nick (Phase 35) = 서명 — 익명 쪽(처음 보낸 사람)만 쓴다. 이름으로 받은 쪽은 이미 이름이 알려져 있어 무시
drop function if exists public.dm_letter(bigint, text, jsonb);
create or replace function public.dm_letter(p_thread bigint, p_body text, p_fmt jsonb default null, p_nick text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text; role text; t private.dm_threads%rowtype; b jsonb; mid bigint;
        v_other uuid; v_delivery boolean;
        v_body text := btrim(coalesce(p_body, ''));
        v_fmt jsonb := case when p_fmt is null or p_fmt = '{}'::jsonb or jsonb_typeof(p_fmt) = 'null' then null else p_fmt end;
        v_nick text := private.dm_nick(p_nick);
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into t from private.dm_threads where id = p_thread for update;
  role := case when t.sender_id = me then 'sender' when t.recipient_id = me then 'recipient' end;
  if role is null or t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  if t.status <> 'open' then return jsonb_build_object('status', 'closed'); end if;
  v := private.dm_can_write(me);
  if v is not null then return jsonb_build_object('status', v); end if;
  if char_length(v_body) not between 1 and 1000 then return jsonb_build_object('status', 'bad_text'); end if;
  if v_fmt is not null and (v_body <> p_body or not private.letter_fmt_ok(v_fmt, v_body)) then
    return jsonb_build_object('status', 'bad_text');
  end if;
  v_other := case when role = 'sender' then t.recipient_id else t.sender_id end;
  v_delivery := not private.blocked_between(t.sender_id, t.recipient_id)
    and not exists (select 1 from public.profiles p where p.id = v_other
                     and (p.status <> 'active' or coalesce(p.suspended_until > now(), false)))
    and not exists (select 1 from private.dm_threads x
                     where x.sender_id = me and x.recipient_id = v_other and x.recipient_refused);
  if role <> 'sender' then v_nick := null; end if;
  if private.dm_nick_bad(v_nick) then return jsonb_build_object('status', 'bad_nick'); end if;
  if private.dm_streak(p_thread, role = 'sender') >= 3 then return jsonb_build_object('status', 'wait_reply'); end if;
  b := private.letter_bucket_take(me, 'comment');
  if not (b->>'ok')::boolean then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_ms', (b->>'retry_after_ms')::int);
  end if;
  insert into private.dm_msgs (thread_id, from_sender, body, fmt, is_letter, from_nick, delivered)
  values (p_thread, role = 'sender', v_body, v_fmt, true, v_nick, v_delivery) returning id into mid;
  if role = 'sender' then update private.dm_threads set last_at = now(), sender_read = mid where id = p_thread;
  else update private.dm_threads set last_at = now(), recipient_read = mid where id = p_thread; end if;
  return jsonb_build_object('status', 'ok', 'thread_id', p_thread, 'msg_id', mid);
end
$fn$;

-- 채팅으로 바꾸기 — 마지막 편지를 받은 사람만 (편지를 받은 사람이 "편지로 답장 / 채팅하기" 중에 고른다)
create or replace function public.dm_chat(p_thread bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); role text; t private.dm_threads%rowtype; last_from_sender boolean;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into t from private.dm_threads where id = p_thread for update;
  role := case when t.sender_id = me then 'sender' when t.recipient_id = me then 'recipient' end;
  if role is null or t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  if t.status <> 'open' then return jsonb_build_object('status', 'closed'); end if;
  if t.mode = 'chat' then return jsonb_build_object('status', 'ok'); end if;
  select from_sender into last_from_sender from private.dm_msgs where thread_id = p_thread order by id desc limit 1;
  if last_from_sender is null or last_from_sender = (role = 'sender') then
    return jsonb_build_object('status', 'not_your_turn');     -- 내가 마지막에 보냈으면 상대가 고를 차례
  end if;
  update private.dm_threads set mode = 'chat' where id = p_thread;
  return jsonb_build_object('status', 'ok');
end
$fn$;


do $do$
declare f text;
begin
  foreach f in array array['dm_letter(bigint, text, jsonb, text)', 'dm_chat(bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 28 — 랜덤 채팅: 메시지 삭제 · 둘 다 볼 때만 흐르는 시간 · 연장 힌트
--
--  1) 메시지 삭제 — 내가 보낸 말만, 대화가 끝나기 전까지. 둘 다에게 "삭제된 메시지입니다"로 보인다.
--     원문은 private.deleted_messages 에 남겨 신고 증거로만 쓴다 (학생은 읽을 수 없다). 방이 지워질 때 같이 지워진다.
--  2) 시간 — 둘 다 대화 화면을 보고 있을 때만 줄어든다. 화면을 보고 있는 동안 앱이 10초마다 room_view 를 부르고
--     (room_members.viewing_until), 한쪽이라도 끊기면 남은 시간을 rooms.paused_left 에 얼려 둔다 (그동안 expires_at = infinity
--     → "아직 안 끝남"으로 보이는 기존 판정이 그대로 맞는다). 둘 다 돌아오면 expires_at = now() + paused_left.
--     하루 넘게 멈춰 있던 대화는 스위퍼가 닫는다 (동시 대화 칸을 계속 차지하지 않게).
--  3) 연장 힌트 — 연장할 때마다 서로 하나씩: 학년 → 성씨 → 동아리 → 디플로마.
--     학년 · 성씨는 학교 명단에서, 동아리 · 디플로마는 그 차례에 "연장"을 누를 때 직접 적는다 (방마다 따로, private.room_hints).
-- ════════════════════════════════════════════════════════════════════

-- ── 1) 메시지 삭제 ──
alter table public.messages add column if not exists deleted_at timestamptz;
create table if not exists private.deleted_messages (
  message_id bigint primary key references public.messages(id) on delete cascade,
  body       text not null,
  deleted_at timestamptz not null default now()
);
alter table private.deleted_messages enable row level security;

create or replace function public.delete_message(p_msg bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare m public.messages%rowtype; s smallint;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select * into m from public.messages where id = p_msg for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  s := public.my_seat(m.room_id);
  if s is null or m.sender_seat <> s then return jsonb_build_object('status', 'not_found'); end if;
  if m.deleted_at is not null then return jsonb_build_object('status', 'ok'); end if;
  if (select status from public.rooms where id = m.room_id) = 'closed' then
    return jsonb_build_object('status', 'closed');
  end if;
  insert into private.deleted_messages (message_id, body) values (m.id, m.body) on conflict do nothing;
  update public.messages set body = '삭제된 메시지입니다', deleted_at = now() where id = p_msg;
  return jsonb_build_object('status', 'ok');
end
$fn$;


revoke all on function private.auto_report_message(bigint, text, text) from public, anon, authenticated;

-- ── 2) 둘 다 볼 때만 흐르는 시간 ──
alter table public.room_members add column if not exists viewing_until timestamptz;
alter table public.rooms add column if not exists paused_left  interval;
alter table public.rooms add column if not exists paused_since timestamptz;

-- 화면에 보여 줄 마감 — 멈춰 있으면 "지금 + 남은 시간" (바뀌지 않는 남은 시간을 그대로 보이게)
create or replace function private.room_deadline(p_expires timestamptz, p_left interval)
returns timestamptz language sql stable set search_path = '' as $fn$
  select case when p_left is not null then now() + p_left else p_expires end;
$fn$;

-- 방 시계 맞추기 — 둘 다 보고 있으면 흐르게, 아니면 멈추게
create or replace function private.room_clock(p_room uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare r public.rooms%rowtype; v_n int; v_stop timestamptz; v_left interval;
begin
  select * into r from public.rooms where id = p_room for update;
  if not found or r.status <> 'active' or r.pinned then return; end if;
  select count(*) filter (where viewing_until > now()), min(coalesce(viewing_until, now() - interval '90 seconds'))
    into v_n, v_stop
    from public.room_members where room_id = p_room;
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
revoke all on function private.room_clock(uuid) from public, anon, authenticated;

-- 대화 화면을 보고 있다(p_on) / 떠났다 — 앱이 화면을 보는 동안 20초마다 부른다 (보고 있음 = 45초, Phase 36)
create or replace function public.room_view(p_room uuid, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
begin
  if public.my_seat(p_room) is null then raise exception 'not_member'; end if;
  -- 돌아온 사람의 새 viewing_until 로 이전 이탈 시각을 덮기 전에 먼저 남은 시간을 보존한다.
  perform private.room_clock(p_room);
  update public.room_members
     set viewing_until = case when p_on then now() + interval '45 seconds' else now() end
   where room_id = p_room and user_id = auth.uid();
  perform private.room_clock(p_room);
  return public.room_snapshot(p_room);
end
$fn$;


-- ── 3) 연장 힌트 ──
create table if not exists private.room_hints (
  room_id uuid not null references public.rooms(id) on delete cascade,
  seat    smallint not null check (seat in (1, 2)),
  kind    text not null check (kind in ('club', 'diploma')),
  value   text not null check (char_length(value) between 1 and 20),
  primary key (room_id, seat, kind)
);
alter table private.room_hints enable row level security;

-- 연장 1번째 → 학년, 2번째 → 성씨, 3번째 → 동아리, 4번째 → 디플로마
create or replace function private.hint_kind(p_n int)
returns text language sql immutable set search_path = '' as $fn$
  select (array['grade', 'q1', 'diploma', 'q2', 'club'])[p_n];
$fn$;
create or replace function private.hint_label(p_kind text)
returns text language sql immutable set search_path = '' as $fn$
  select case p_kind when 'grade' then '학년' when 'surname' then '성씨' when 'club' then '동아리'
                     when 'diploma' then '디플로마' when 'q1' then '공통 질문' when 'q2' then '공통 질문' end;
$fn$;

-- 한 사람의 공개된 힌트들 (연장한 만큼)
create or replace function private.room_hints_of(p_room uuid, p_seat smallint, p_count int)
returns jsonb language plpgsql stable security definer set search_path = public, private as $fn$
declare v_user uuid; v_name text; v_grade smallint; k text; v text; out jsonb := '[]'::jsonb;
begin
  select user_id into v_user from public.room_members where room_id = p_room and seat = p_seat;
  select name, grade into v_name, v_grade from private.person(v_user);
  for i in 1 .. least(greatest(p_count, 0), 5) loop
    k := private.hint_kind(i);
    v := case k
           when 'grade' then case when v_grade is not null then v_grade || '학년' end
           else (select h.value from private.room_hints h where h.room_id = p_room and h.seat = p_seat and h.kind = k)
         end;
    out := out || jsonb_build_array(jsonb_build_object('kind', k, 'label', private.hint_label_in(p_room, k), 'value', coalesce(v, '비공개')));
  end loop;
  return out;
end
$fn$;
revoke all on function private.room_hints_of(uuid, smallint, int) from public, anon, authenticated;


-- 연장 투표 — 동아리 · 디플로마 차례면 "연장"을 누를 때 내 값을 같이 (p_hint)
drop function if exists public.vote_extension(uuid, boolean);
create or replace function public.vote_extension(p_room uuid, p_agree boolean, p_hint text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  r   public.rooms%rowtype;
  cfg public.app_settings%rowtype;
  s   smallint;
  v_yes int; v_no int; v_kind text; v_hint text; v_pin boolean;
begin
  s := public.my_seat(p_room);
  if s is null then raise exception 'not_member'; end if;
  select * into cfg from public.app_settings where id;
  select * into r from public.rooms where id = p_room for update;

  if r.status <> 'active' then
    return jsonb_build_object('result', 'closed', 'snap', public.room_snapshot(p_room));
  end if;
  if r.pinned then
    return jsonb_build_object('result', 'pinned', 'snap', public.room_snapshot(p_room));
  end if;
  if now() >= r.expires_at then
    perform public.close_room(p_room, 'expired');
    return jsonb_build_object('result', 'expired', 'snap', public.room_snapshot(p_room));
  end if;
  if now() < r.expires_at - make_interval(secs => cfg.vote_window_sec) then   -- 멈춰 있으면(infinity) 여기서 막힌다
    return jsonb_build_object('result', 'too_early', 'snap', public.room_snapshot(p_room));
  end if;
  if cfg.max_rounds > 0 and r.round >= cfg.max_rounds then
    return jsonb_build_object('result', 'max_rounds', 'snap', public.room_snapshot(p_room));
  end if;

  v_kind := private.hint_kind(r.round);
  v_pin  := private.pin_round(r);
  if p_agree and private.hint_typed(v_kind) then
    v_hint := btrim(coalesce(p_hint, ''));
    if char_length(v_hint) not between 1 and (case when v_kind in ('q1', 'q2') then 30 else 20 end)
       or private.rule_violation(v_hint) is not null
       or (v_kind = 'diploma' and not (v_hint = any (private.diplomas()))) then
      return jsonb_build_object('result', 'need_hint', 'snap', public.room_snapshot(p_room));
    end if;
    insert into private.room_hints (room_id, seat, kind, value) values (p_room, s, v_kind, v_hint)
    on conflict (room_id, seat, kind) do update set value = excluded.value;
  end if;

  insert into public.extension_votes (room_id, round, seat, agree)
  values (p_room, r.round, s, p_agree)
  on conflict (room_id, round, seat)
    do update set agree = excluded.agree, created_at = now();

  select count(*) filter (where agree), count(*) filter (where not agree)
    into v_yes, v_no
    from public.extension_votes where room_id = p_room and round = r.round;

  if v_no > 0 then
    perform public.close_room(p_room, 'declined');
    return jsonb_build_object('result', 'declined', 'snap', public.room_snapshot(p_room));
  elsif v_yes = 2 and v_pin then
    -- 고정 — 시간 제한 · 멈춤이 없어지고, 닫히지 않으니 지워지지도 않는다
    update public.rooms
       set pinned = true, pinned_at = now(), expires_at = 'infinity',
           paused_left = null, paused_since = null, round = r.round + 1
     where id = p_room;
    insert into public.messages (room_id, sender_seat, body, client_msg_id)
    values (p_room, 0, '둘 다 고정했어요. 이제 시간 제한 없이 이야기할 수 있어요.', gen_random_uuid());
    return jsonb_build_object('result', 'pinned', 'snap', public.room_snapshot(p_room));
  elsif v_yes = 2 then
    update public.rooms
       set expires_at = r.expires_at + make_interval(mins => cfg.extend_minutes),
           round      = r.round + 1
     where id = p_room;
    insert into public.messages (room_id, sender_seat, body, client_msg_id)
    values (p_room, 0, cfg.extend_minutes || '분 연장됨.'
                       || case when v_kind in ('q1', 'q2') then ' 공통 질문 답 공개!'
                               when v_kind is not null then ' 서로의 ' || private.hint_label(v_kind) || ' 공개!'
                               else '' end,
            gen_random_uuid());
    return jsonb_build_object('result', 'extended', 'snap', public.room_snapshot(p_room));
  end if;
  return jsonb_build_object('result', 'waiting', 'snap', public.room_snapshot(p_room));
end
$fn$;


revoke all on function public.sweep_rooms() from public, anon, authenticated;

do $do$
declare f text;
begin
  foreach f in array array['delete_message(bigint)', 'room_view(uuid, boolean)', 'vote_extension(uuid, boolean, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 29 — 랜덤 채팅: 연장 공개 순서 · 공통 질문 · 대화 고정
--
--  1) 연장할 때마다 공개하는 것 (성씨는 뺐다):
--       10분 째 학년 → 20분 공통 질문 → 30분 디플로마 → 40분 공통 질문 → 50분 동아리
--     공통 질문은 방마다 정해진 질문 하나(둘에게 같은 질문)에 "연장"을 누르면서 답을 적고, 연장되면 서로의 답이 공개된다.
--     디플로마 · 동아리 · 공통 질문 답은 직접 적는다 (private.room_hints). 학년은 학교 명단에서.
--  2) 동아리까지 연장한 뒤 10분이 더 지나면(60분 째) 연장 대신 "이 채팅을 고정하시겠습니까?".
--     둘 다 고정하면 rooms.pinned — 시간 제한이 없어지고(expires_at = infinity, 멈춤도 없음) 대화 목록 맨 위에 붙는다.
--     방이 닫히지 않으니 24시간 삭제(simbun-purge)에도 걸리지 않는다. 한쪽이라도 안 하면 연장 거절과 같이 끝난다.
--     고정한 대화는 동시 대화 개수(max_open_rooms)에 세지 않는다 — 새 대화를 찾는 걸 막지 않게.
--     고정한 대화도 나가기 · 신고 · 차단하면 닫히고, 그때부터는 보통 대화처럼 지워진다.
-- ════════════════════════════════════════════════════════════════════

-- ── 1) 공개 순서 · 공통 질문 ──
alter table private.room_hints drop constraint if exists room_hints_kind_check;
alter table private.room_hints add  constraint room_hints_kind_check check (kind in ('club', 'diploma', 'q1', 'q2'));
alter table private.room_hints drop constraint if exists room_hints_value_check;
alter table private.room_hints add  constraint room_hints_value_check check (char_length(value) between 1 and 30);


-- 연장할 때 직접 적는 것
create or replace function private.hint_typed(p_kind text)
returns boolean language sql immutable set search_path = '' as $fn$
  select coalesce(p_kind in ('club', 'diploma', 'q1', 'q2'), false);
$fn$;

-- 방의 공통 질문 — 둘에게 같은 질문, 방마다 다르게, 두 번째는 첫 번째와 겹치지 않게.
-- 신상(학년 · 반 · 이름 · SNS)을 묻지 않는 가벼운 것만 (첫마디 도우미 Starters 와 같은 약속)
create or replace function private.room_question(p_room uuid, p_kind text)
returns text language plpgsql immutable set search_path = '' as $fn$
declare
  pool text[] := array['요즘 빠져 있는 것', '제일 좋아하는 급식 메뉴', '주말에 주로 하는 일', '요즘 자주 듣는 노래',
                       '가 보고 싶은 여행지', '스트레스 푸는 방법', '인생 영화나 드라마', '시험 끝나면 하고 싶은 일',
                       '좋아하는 계절', '요즘 소소한 행복'];
  n int := array_length(pool, 1);
  h bigint := abs(hashtext(p_room::text)::bigint);
  i int := (h % n)::int;
begin
  if p_kind = 'q2' then i := ((i + 1 + (h / n) % (n - 1)) % n)::int; end if;
  return pool[i + 1];
end
$fn$;
revoke all on function private.room_question(uuid, text) from public, anon, authenticated;

-- 화면에 보일 이름 — 공통 질문이면 그 방의 질문 자체
create or replace function private.hint_label_in(p_room uuid, p_kind text)
returns text language sql immutable set search_path = '' as $fn$
  select case when p_kind in ('q1', 'q2') then private.room_question(p_room, p_kind) else private.hint_label(p_kind) end;
$fn$;
revoke all on function private.hint_label_in(uuid, text) from public, anon, authenticated;


revoke all on function private.room_hints_of(uuid, smallint, int) from public, anon, authenticated;

-- ── 2) 대화 고정 ──
alter table public.rooms add column if not exists pinned    boolean not null default false;
alter table public.rooms add column if not exists pinned_at timestamptz;

-- 고정 여부를 묻는 차례 — 힌트를 다 공개한 뒤의 다음 라운드
create or replace function private.pin_round(r public.rooms)
returns boolean language sql immutable set search_path = '' as $fn$
  select not r.pinned and r.round > 1 and private.hint_kind(r.round) is null;
$fn$;
revoke all on function private.pin_round(public.rooms) from public, anon, authenticated;


revoke all on function private.room_clock(uuid) from public, anon, authenticated;


revoke all on function public.sweep_rooms() from public, anon, authenticated;

-- 동시 대화 개수 — 고정한 대화는 세지 않는다
create or replace function private.open_rooms(p_user uuid)
returns int language sql stable security definer set search_path = public as $fn$
  select count(*)::int from public.room_members rm join public.rooms r on r.id = rm.room_id
   where rm.user_id = p_user and rm.open and not r.pinned;
$fn$;
revoke all on function private.open_rooms(uuid) from public, anon, authenticated;


revoke all on function public.request_match() from public, anon;
grant execute on function public.request_match() to authenticated;

-- ════════════════════════════════════════════════════════════════════
--  Phase 30 — 매너 온도
--
--  익명 상대가 얼마나 친절한지 보이는 숫자. 모두 40.0도에서 시작한다 (평균 40도).
--  대화가 끝난 뒤(24시간 안), 또는 고정이 성사된 대화에서 상대를 한 번 평가한다:
--    좋았어요 / 괜찮았어요 / 아쉬웠어요 + 이유 칩 (좋았을 때 · 아쉬울 때 따로).
--  ★ 평가는 바로 반영하지 않는다 — 매일 새벽(04:27 KST) 6시간 넘게 지난 평가를 모아 반영한다.
--    평가 직후 온도가 바뀌면 방금 대화한 상대가 누가 낮게 줬는지 알 수 있기 때문이다.
--  반영: 좋았어요 +0.3 · 괜찮았어요 +0.1 · 아쉬웠어요 −0.8, 아쉬운 이유 칩 하나에 −0.2 (2개까지). 0~99 로 자른다.
--  같은 사람이 같은 사람을 7일 안에 다시 평가하면 첫 평가만 센다 (다시 만나기로 몰아주기 · 몰아서 깎기 방지).
--  신고 · 차단 · 운영진이 끝낸 대화는 평가하지 않는다 (신고는 신고대로 처리된다).
-- ════════════════════════════════════════════════════════════════════

-- 학생은 이 열을 고칠 수 없다 (profiles 는 열 단위 update 권한만 있고, 여기엔 주지 않는다)
alter table public.profiles add column if not exists manner_temp numeric(4,1) not null default 40.0;

create table if not exists private.ratings (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  rater_id   uuid not null references public.profiles(id) on delete cascade,
  rated_id   uuid not null references public.profiles(id) on delete cascade,
  score      text not null check (score in ('good', 'ok', 'bad')),
  reasons    text[] not null default '{}'
             check (reasons <@ array['kind', 'fun', 'listen', 'fast', 'manner', 'rude', 'dry', 'uncomfy', 'spam']::text[]
                    and cardinality(reasons) <= 5),
  created_at timestamptz not null default now(),
  applied_at timestamptz,          -- 온도에 반영한 때 (null = 아직)
  counted    boolean,              -- 반영할 때 셈에 넣었는지 (7일 안 중복이면 false)
  primary key (room_id, rater_id),
  check (rater_id <> rated_id)
);
create index if not exists ratings_pending on private.ratings (created_at) where applied_at is null;
create index if not exists ratings_pair    on private.ratings (rater_id, rated_id, created_at);
create index if not exists ratings_rated   on private.ratings (rated_id);
alter table private.ratings enable row level security;

-- 평가할 수 있는 대화인가 — 둘 다 들어와 시작한 대화이고,
--   고정했거나 / 닫힌 지 24시간 안이면서 둘 다 말을 했고 (각자 2마디 이상이거나 3분 넘게 이어짐).
--   (메시지는 닫히고 24시간 뒤 지워지므로 판정은 그 안에서만 된다)
create or replace function private.rating_eligible(p_room uuid, p_me uuid)
returns boolean language plpgsql stable security definer set search_path = public as $fn$
declare r public.rooms%rowtype; n1 int; n2 int;
begin
  select * into r from public.rooms where id = p_room;
  if not found or r.armed_at is null or coalesce(r.close_reason, '') in ('reported', 'blocked', 'admin') then return false; end if;
  if not exists (select 1 from public.room_members where room_id = p_room and user_id = p_me) then return false; end if;
  if r.pinned then return true; end if;
  if r.status <> 'closed' or r.closed_at <= now() - interval '24 hours' then return false; end if;
  select count(*) filter (where sender_seat = 1), count(*) filter (where sender_seat = 2)
    into n1, n2 from public.messages where room_id = p_room;
  return n1 >= 1 and n2 >= 1 and ((n1 >= 2 and n2 >= 2) or r.closed_at - r.armed_at >= interval '3 minutes');
end
$fn$;
revoke all on function private.rating_eligible(uuid, uuid) from public, anon, authenticated;

create or replace function public.rate_partner(p_room uuid, p_score text, p_reasons text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me uuid := auth.uid();
  s smallint;
  v_other uuid;
  v_reasons text[];
begin
  if me is null then raise exception 'unauthenticated'; end if;
  s := public.my_seat(p_room);
  if s is null then return jsonb_build_object('status', 'not_eligible'); end if;
  if p_score is null or p_score not in ('good', 'ok', 'bad') then return jsonb_build_object('status', 'bad_input'); end if;
  select coalesce(array_agg(distinct x), '{}') into v_reasons from unnest(coalesce(p_reasons, '{}')) x;
  -- 이유 칩은 고른 쪽의 것만 (좋았는데 "무례해요" 같은 모순은 받지 않는다)
  if (p_score = 'bad' and not v_reasons <@ array['rude', 'dry', 'uncomfy', 'spam']::text[])
     or (p_score <> 'bad' and not v_reasons <@ array['kind', 'fun', 'listen', 'fast', 'manner']::text[]) then
    return jsonb_build_object('status', 'bad_input');
  end if;
  if not private.rating_eligible(p_room, me) then return jsonb_build_object('status', 'not_eligible'); end if;
  select user_id into v_other from public.room_members where room_id = p_room and seat <> s;
  insert into private.ratings (room_id, rater_id, rated_id, score, reasons)
  values (p_room, me, v_other, p_score, v_reasons)
  on conflict (room_id, rater_id) do nothing;
  if not found then return jsonb_build_object('status', 'already'); end if;
  return jsonb_build_object('status', 'ok');
end
$fn$;

-- 아직 평가하지 않은 대화 (홈의 "어땠어요?" 카드) — 최근 것부터 10개
create or replace function public.pending_ratings()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('room_id', x.id, 'partner_alias', x.alias, 'pinned', x.pinned) order by x.at desc), '[]'::jsonb)
  from (
    select r.id, case when rm.seat = 1 then r.alias2 else r.alias1 end as alias, r.pinned,
           coalesce(r.closed_at, r.pinned_at, r.created_at) as at
      from public.room_members rm join public.rooms r on r.id = rm.room_id
     where rm.user_id = auth.uid()
       and (r.pinned or (r.status = 'closed' and r.closed_at > now() - interval '24 hours'))
       and not exists (select 1 from private.ratings x where x.room_id = r.id and x.rater_id = auth.uid())
       and private.rating_eligible(r.id, auth.uid())
     order by coalesce(r.closed_at, r.pinned_at, r.created_at) desc
     limit 10
  ) x;
$fn$;

-- 모아서 반영 — 6시간 넘게 지난 평가만 (매일 새벽 pg_cron)
create or replace function private.apply_ratings()
returns int language plpgsql security definer set search_path = public, private as $fn$
declare v record; n int := 0; d numeric;
begin
  for v in select * from private.ratings
            where applied_at is null and created_at < now() - interval '6 hours'
            order by created_at
            for update skip locked
  loop
    if exists (select 1 from private.ratings o
                where o.rater_id = v.rater_id and o.rated_id = v.rated_id and o.counted
                  and o.room_id <> v.room_id and o.created_at > v.created_at - interval '7 days') then
      update private.ratings set applied_at = now(), counted = false where room_id = v.room_id and rater_id = v.rater_id;
    else
      d := (case v.score when 'good' then 0.3 when 'ok' then 0.1 else -0.8 end)
           - 0.2 * least(cardinality(array(select unnest(v.reasons) intersect select unnest(array['rude', 'dry', 'uncomfy', 'spam']))), 2);
      update public.profiles set manner_temp = least(99, greatest(0, manner_temp + d)) where id = v.rated_id;
      update private.ratings set applied_at = now(), counted = true where room_id = v.room_id and rater_id = v.rater_id;
    end if;
    n := n + 1;
  end loop;
  return n;
end
$fn$;
revoke all on function private.apply_ratings() from public, anon, authenticated;


do $do$
declare f text;
begin
  foreach f in array array['rate_partner(uuid, text, text[])', 'pending_ratings()']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;

-- 매일 새벽 04:27 (KST) 에 모아서 반영
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-ratings';
    perform cron.schedule('simbun-ratings', '27 19 * * *', 'select private.apply_ratings()');
  end if;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 31 — 업적 (동 · 은 · 금)
--
--  한 사람이 쌓아 온 것을 메달로 — 프로필에 명성처럼 보이고, 대화 상대에게는 대표 업적 3개가 보인다.
--  · 카운터: private.user_stats.counts (jsonb, 사람마다 한 줄). 메시지는 24시간 뒤 지워지므로 개수는 그때그때 쌓아 둔다.
--    가벼운 트리거가 올린다 — 메시지 · 공감 · 방(연장 · 고정 · 끝까지) · 공통 질문 답 · 편지 · 평가 · 접속(연속 일수).
--  · 카탈로그: private.achievement_defs — 업적 정의는 여기가 유일한 출처다 (화면은 RPC 로 받아서 그린다).
--  · 받은 등급: private.user_achievements — 올라가기만 하고 내려가지 않는다.
--  · 대표 업적: profiles.featured_badges (3개 · 금 뱃지 5개면 5개 — Phase 84, 비어 있으면 높은 등급 순으로 자동)
--  학생은 세 표 모두 직접 읽을 수 없다. 내 것은 my_achievements(), 상대 것은 partner_profile() 의 대표 뱃지뿐.
-- ════════════════════════════════════════════════════════════════════

create table if not exists private.user_stats (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  counts     jsonb not null default '{}'::jsonb,
  streak_day date,                 -- 마지막으로 연속 접속을 센 날 (KST)
  updated_at timestamptz not null default now()
);
alter table private.user_stats enable row level security;

create table if not exists private.achievement_defs (
  code         text primary key,
  title        text not null,
  description  text not null,
  icon         text not null,
  category     text not null check (category in ('chat', 'manner', 'letter', 'special')),
  stat         text not null,
  unit         text not null default '회',
  bronze       numeric not null,
  silver       numeric not null,
  gold         numeric not null,
  lower_better boolean not null default false,   -- 개척자처럼 작을수록 좋은 것
  sort         int not null
);
alter table private.achievement_defs enable row level security;

create table if not exists private.user_achievements (
  user_id   uuid not null references public.profiles(id) on delete cascade,
  code      text not null references private.achievement_defs(code) on delete cascade,
  tier      smallint not null check (tier between 1 and 3),
  earned_at timestamptz not null default now(),
  primary key (user_id, code)
);
create index if not exists user_achievements_new on private.user_achievements (user_id, earned_at desc);
create index if not exists user_achievements_code on private.user_achievements (code);
alter table private.user_achievements enable row level security;

alter table public.profiles add column if not exists featured_badges text[] not null default '{}';
alter table public.profiles add column if not exists ach_seen_at timestamptz;

-- 카탈로그 (24종) — 다시 실행하면 이름 · 기준을 최신으로
insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort) values
  ('warm',        '따뜻한 사람',   '매너 온도',                  '🌡️', 'manner',  'temp',        '도',    42,   45,    50,   false, 10),
  ('good',        '호평 수집가',   '"좋았어요" 평가 받기',        '👍', 'manner',  'good',        '번',    10,   50,   200,   false, 11),
  ('kind',        '친절왕',        '"친절해요" 받기',             '🤝', 'manner',  'kind',        '번',    10,   50,   200,   false, 12),
  ('fun',         '이야기꾼',      '"대화가 재밌어요" 받기',      '🎉', 'manner',  'fun',         '번',    10,   50,   200,   false, 13),
  ('listen',      '경청가',        '"잘 들어줘요" 받기',          '👂', 'manner',  'listen',      '번',    10,   50,   200,   false, 14),
  ('fast',        '번개 답장',     '"답이 빨라요" 받기',          '⚡', 'manner',  'fast',        '번',    10,   50,   200,   false, 15),
  ('manner',      '예의 바른 사람', '"예의 발라요" 받기',         '🎩', 'manner',  'manner',      '번',    10,   50,   200,   false, 16),
  ('rater',       '성실한 평가자', '대화 상대 평가 남기기',       '📝', 'manner',  'rated',       '번',    10,   50,   200,   false, 17),
  ('chats',       '대화 여행자',   '끝까지 이어간 대화',          '💬', 'chat',    'chats',       '번',     5,   25,   100,   false, 20),
  ('extend',      '연장의 달인',   '둘 다 원해서 연장한 횟수',    '⏳', 'chat',    'extends',     '번',     5,   20,    50,   false, 21),
  ('deep',        '속 깊은 대화',  '동아리까지 공개한 대화',      '🌊', 'chat',    'deep',        '번',     1,    5,    15,   false, 22),
  ('pin',         '고정 친구',     '둘 다 고정한 채팅',           '📌', 'chat',    'pins',        '명',     1,    3,    10,   false, 23),
  ('hello',       '먼저 인사하기', '대화의 첫마디를 건넨 횟수',   '👋', 'chat',    'hello',       '번',    10,   50,   200,   false, 24),
  ('talk',        '수다쟁이',      '보낸 메시지',                 '🗣️', 'chat',    'msgs',        '개',   300, 2000, 10000,   false, 25),
  ('heart',       '공감 부자',     '내 메시지에 받은 공감',       '❤️', 'chat',    'hearts',      '개',    30,  150,   500,   false, 26),
  ('question',    '솔직한 대답',   '공통 질문에 답한 횟수',       '❓', 'chat',    'answers',     '번',     5,   20,    50,   false, 27),
  ('owl',         '밤 올빼미',     '밤 10시~12시에 시작한 대화',  '🦉', 'chat',    'owl',         '번',     5,   20,    50,   false, 28),
  ('letter_got',  '인기 편지함',   '받은 편지',                   '💌', 'letter',  'letters_got', '통',     5,   20,    50,   false, 30),
  ('letter_sent', '편지 쓰는 사람', '보낸 편지',                  '✉️', 'letter',  'letters_sent','통',     5,   20,    50,   false, 31),
  ('reply',       '답장이 왔어요', '내 편지에 받은 답장',         '📬', 'letter',  'replies_got', '통',     3,   10,    30,   false, 32),
  ('deco',        '꾸미기 장인',   '글자를 꾸며 쓴 편지',         '🎨', 'letter',  'deco',        '통',     3,   10,    30,   false, 33),
  ('streak',      '개근상',        '며칠 연속으로 접속',          '📅', 'special', 'streak',      '일',     3,    7,    30,   false, 40),
  ('clean',       '깨끗한 기록',   '경고 없이 끝까지 이어간 대화', '🕊️', 'special', 'clean',       '번',    10,   30,   100,   false, 41),
  ('pioneer',     '개척자',        '가입한 순서',                 '🚩', 'special', 'pioneer',     '번째', 1000, 300,   100,   true,  42)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort;

-- 값 → 등급 (0 = 아직)
create or replace function private.ach_tier(d private.achievement_defs, v numeric)
returns smallint language sql immutable set search_path = '' as $fn$
  select case
    when v is null then 0
    when d.lower_better then case when v <= d.gold then 3 when v <= d.silver then 2 when v <= d.bronze then 1 else 0 end
    else case when v >= d.gold then 3 when v >= d.silver then 2 when v >= d.bronze then 1 else 0 end
  end::smallint;
$fn$;

-- 그 카운터를 쓰는 업적만 다시 본다 — 오르기만 한다
create or replace function private.award_stat(p_user uuid, p_stat text, p_value numeric)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare d private.achievement_defs%rowtype; t smallint;
begin
  for d in select * from private.achievement_defs where stat = p_stat loop
    t := private.ach_tier(d, p_value);
    if t > 0 then
      insert into private.user_achievements (user_id, code, tier) values (p_user, d.code, t)
      on conflict (user_id, code) do update set tier = excluded.tier, earned_at = now()
       where private.user_achievements.tier < excluded.tier;
      -- Landy 금 뱃지를 처음 따면 기본 CNSA 뱃지가 열린다 (Phase 84)
      if t = 3 and not d.granted and d.category <> 'cnsa' then
        insert into private.user_achievements (user_id, code, tier)
        select p_user, 'cnsa_student', 3 where exists (select 1 from private.achievement_defs where code = 'cnsa_student')
        on conflict (user_id, code) do nothing;
      end if;
    end if;
  end loop;
end
$fn$;

-- 카운터 올리기 / 값 두기
create or replace function private.bump(p_user uuid, p_stat text, p_n int default 1)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare v numeric;
begin
  if p_user is null then return; end if;
  insert into private.user_stats (user_id, counts) values (p_user, jsonb_build_object(p_stat, p_n))
  on conflict (user_id) do update
     set counts = private.user_stats.counts
                  || jsonb_build_object(p_stat, coalesce((private.user_stats.counts->>p_stat)::int, 0) + p_n),
         updated_at = now()
  returning (counts->>p_stat)::numeric into v;
  perform private.award_stat(p_user, p_stat, v);
end
$fn$;
create or replace function private.set_stat(p_user uuid, p_stat text, p_value numeric)
returns void language plpgsql security definer set search_path = public, private as $fn$
begin
  if p_user is null then return; end if;
  insert into private.user_stats (user_id, counts) values (p_user, jsonb_build_object(p_stat, p_value))
  on conflict (user_id) do update
     set counts = private.user_stats.counts || jsonb_build_object(p_stat, p_value), updated_at = now();
  perform private.award_stat(p_user, p_stat, p_value);
end
$fn$;

-- 방의 자리 → 사람
create or replace function private.seat_user(p_room uuid, p_seat smallint)
returns uuid language sql stable security definer set search_path = public as $fn$
  select user_id from public.room_members where room_id = p_room and seat = p_seat;
$fn$;

-- 경고 · 정지가 없는 사람만 "깨끗한 기록"
create or replace function private.bump_chat_done(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.bump(p_user, 'chats');
  if exists (select 1 from public.profiles where id = p_user and strikes = 0 and status = 'active'
               and (suspended_until is null or suspended_until <= now())) then
    perform private.bump(p_user, 'clean');
  end if;
end
$fn$;

-- ── 카운터 트리거 ──
-- 보낸 메시지 · 첫마디
create or replace function private.stats_on_message()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
declare u uuid;
begin
  if new.sender_seat not in (1, 2) then return null; end if;
  u := private.seat_user(new.room_id, new.sender_seat);
  perform private.bump(u, 'msgs');
  if not exists (select 1 from public.messages m where m.room_id = new.room_id and m.sender_seat in (1, 2) and m.id <> new.id) then
    perform private.bump(u, 'hello');
  end if;
  return null;
end
$fn$;
drop trigger if exists messages_stats on public.messages;
create trigger messages_stats after insert on public.messages
  for each row execute function private.stats_on_message();

-- 받은 공감 — 한 메시지에 한 사람이 처음 달 때만 (껐다 켜기로 불리지 못하게)
create or replace function private.stats_on_reaction()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
declare v_sender smallint;
begin
  if new.emoji is null then return null; end if;
  select sender_seat into v_sender from public.messages where id = new.message_id;
  if v_sender in (1, 2) and v_sender <> new.seat then
    perform private.bump(private.seat_user(new.room_id, v_sender), 'hearts');
  end if;
  return null;
end
$fn$;
drop trigger if exists message_reactions_stats on public.message_reactions;
create trigger message_reactions_stats after insert on public.message_reactions
  for each row execute function private.stats_on_reaction();

-- 방: 시작(밤 대화) · 연장 · 동아리까지 · 고정 · 끝까지
create or replace function private.stats_on_room()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
declare u uuid;
begin
  for u in select user_id from public.room_members where room_id = new.id loop
    if old.status = 'pending' and new.status = 'active'
       and extract(hour from now() at time zone 'Asia/Seoul') >= 22 then
      perform private.bump(u, 'owl');
    end if;
    if new.round > old.round and not new.pinned then
      perform private.bump(u, 'extends');
      if new.round >= 6 and old.round < 6 then perform private.bump(u, 'deep'); end if;
    end if;
    if new.pinned and not old.pinned then
      perform private.bump(u, 'pins');
      perform private.bump_chat_done(u);
    end if;
    if new.status = 'closed' and old.status <> 'closed' and not old.pinned and new.armed_at is not null
       and new.close_reason in ('expired', 'declined') then
      perform private.bump_chat_done(u);
    end if;
  end loop;
  return null;
end
$fn$;
drop trigger if exists rooms_stats on public.rooms;
create trigger rooms_stats after update on public.rooms
  for each row
  when (old.status is distinct from new.status or old.round is distinct from new.round or old.pinned is distinct from new.pinned)
  execute function private.stats_on_room();

-- 공통 질문에 답함
create or replace function private.stats_on_hint()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  if new.kind in ('q1', 'q2') then perform private.bump(private.seat_user(new.room_id, new.seat), 'answers'); end if;
  return null;
end
$fn$;
drop trigger if exists room_hints_stats on private.room_hints;
create trigger room_hints_stats after insert on private.room_hints
  for each row execute function private.stats_on_hint();

-- 편지: 보냄 · 받음 · 꾸밈 · 답장 받음 (편지만 — 예전 채팅 줄은 세지 않는다)
create or replace function private.stats_on_dm()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
declare t private.dm_threads%rowtype; v_from uuid; v_to uuid;
begin
  if not new.is_letter then return null; end if;
  select * into t from private.dm_threads where id = new.thread_id;
  v_from := case when new.from_sender then t.sender_id else t.recipient_id end;
  v_to   := case when new.from_sender then t.recipient_id else t.sender_id end;
  perform private.bump(v_from, 'letters_sent');
  if new.delivered then perform private.bump(v_to, 'letters_got'); end if;
  if new.fmt is not null then perform private.bump(v_from, 'deco'); end if;
  if new.delivered and exists (select 1 from private.dm_msgs o where o.thread_id = new.thread_id and o.id < new.id
               and o.is_letter and o.from_sender <> new.from_sender) then
    perform private.bump(v_to, 'replies_got');
  end if;
  return null;
end
$fn$;
drop trigger if exists dm_msgs_stats on private.dm_msgs;
create trigger dm_msgs_stats after insert on private.dm_msgs
  for each row execute function private.stats_on_dm();

-- 평가: 남김(평가자) · 반영될 때 받은 칭찬(평가받은 사람)
create or replace function private.stats_on_rating()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
declare r text;
begin
  if tg_op = 'INSERT' then
    perform private.bump(new.rater_id, 'rated');
  elsif new.counted and not coalesce(old.counted, false) then
    if new.score = 'good' then perform private.bump(new.rated_id, 'good'); end if;
    foreach r in array new.reasons loop
      if r in ('kind', 'fun', 'listen', 'fast', 'manner') then perform private.bump(new.rated_id, r); end if;
    end loop;
  end if;
  return null;
end
$fn$;
drop trigger if exists ratings_stats on private.ratings;
create trigger ratings_stats after insert or update of counted on private.ratings
  for each row execute function private.stats_on_rating();

-- 매너 온도가 바뀜 · 경고/정지를 받음(깨끗한 기록은 처음부터)
create or replace function private.stats_on_profile()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  if new.manner_temp is distinct from old.manner_temp then
    perform private.set_stat(new.id, 'temp', new.manner_temp);
  end if;
  if new.strikes > old.strikes or (new.status <> 'active' and old.status = 'active') then
    perform private.set_stat(new.id, 'clean', 0);
  end if;
  return null;
end
$fn$;
drop trigger if exists profiles_stats on public.profiles;
create trigger profiles_stats after update of manner_temp, strikes, status on public.profiles
  for each row execute function private.stats_on_profile();

-- 연속 접속 (KST 날짜) — 처음 세는 날엔 가입 순서(개척자)도 매긴다
create or replace function private.touch_streak(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare today date := (now() at time zone 'Asia/Seoul')::date; s private.user_stats%rowtype; n int; v_first boolean;
begin
  if p_user is null then return; end if;
  select * into s from private.user_stats where user_id = p_user;
  if found and s.streak_day = today then return; end if;
  v_first := not found or s.streak_day is null;
  n := case when s.streak_day = today - 1 then coalesce((s.counts->>'streak')::int, 0) + 1 else 1 end;
  insert into private.user_stats (user_id, counts, streak_day) values (p_user, jsonb_build_object('streak', n), today)
  on conflict (user_id) do update
     set counts = private.user_stats.counts || jsonb_build_object('streak', n), streak_day = today, updated_at = now();
  perform private.award_stat(p_user, 'streak', n);
  if v_first then
    perform private.award_stat(p_user, 'pioneer',
      (select count(*) from public.profiles o join public.profiles me on me.id = p_user where o.created_at <= me.created_at));
  end if;
end
$fn$;


-- ── 보이는 곳 ──
-- 대표 업적 — private.featured_for(사람, 어디에) (Phase 84: 칸 수 3 · 5, 랜덤채팅에서 숨긴 뱃지, 편지 찾기 무작위 순서).
-- 고른 것이 없거나 더는 없는 업적이면 높은 등급 · 최근 순으로 채운다

create or replace function public.my_achievements()
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); p public.profiles%rowtype; c jsonb; v_rank int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform private.touch_streak(me);
  select * into p from public.profiles where id = me;
  select coalesce(counts, '{}'::jsonb) into c from private.user_stats where user_id = me;
  select count(*) into v_rank from public.profiles o where o.created_at <= p.created_at;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
               'code', d.code, 'title', d.title, 'description', d.description, 'icon', d.icon,
               'category', d.category, 'unit', d.unit, 'lower_better', d.lower_better,
               'granted', d.granted,   -- 운영진이 주는 업적 (Phase 44, 베타 테스터) — 등급 기준이 없다
               'tiers', jsonb_build_array(d.bronze, d.silver, d.gold),
               'tier', coalesce(a.tier, 0), 'earned_at', a.earned_at,
               'value', case d.stat when 'temp' then p.manner_temp when 'pioneer' then v_rank
                                    else coalesce((c->>d.stat)::numeric, 0) end,
               'new', a.earned_at is not null and a.earned_at > coalesce(p.ach_seen_at, '-infinity'))
             order by d.sort)
             from private.achievement_defs d
             left join private.user_achievements a on a.user_id = me and a.code = d.code), '[]'::jsonb),
    'featured', private.featured_for(me, 'own'),
    'chosen', to_jsonb(p.featured_badges),
    -- Phase 84 — 대표 뱃지 칸(금 뱃지 5개면 5) · 금 뱃지 수 · 랜덤채팅에 보이는 뱃지 (정하지 않았으면 CNSA 는 숨김)
    'slots', private.badge_slots(me),
    'golds', private.badge_golds(me),
    'chat', coalesce((select jsonb_object_agg(d.code, private.badge_chat_visible(p.badge_chat, d.code, d.category))
                        from private.achievement_defs d join private.user_achievements a on a.code = d.code and a.user_id = me), '{}'::jsonb));
end
$fn$;

-- 새로 딴 업적만 (앱을 열 때 축하용 — 가볍게)
create or replace function public.new_achievements()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'title', d.title, 'icon', d.icon, 'tier', a.tier) order by a.earned_at), '[]'::jsonb)
    from private.user_achievements a
    join private.achievement_defs d on d.code = a.code
    join public.profiles p on p.id = a.user_id
   where a.user_id = auth.uid() and a.earned_at > coalesce(p.ach_seen_at, '-infinity');
$fn$;

create or replace function public.mark_achievements_seen()
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  update public.profiles set ach_seen_at = now() where id = auth.uid();
end
$fn$;

-- 대표 업적 고르기 — 가진 업적만, 칸 수까지(3 · 금 뱃지 5개면 5, Phase 84) (빈 배열 = 자동)
create or replace function public.set_featured_badges(p_codes text[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text[];
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select coalesce(array_agg(x order by o), '{}') into v
    from (select distinct on (x) x, o from unnest(coalesce(p_codes, '{}')) with ordinality as t(x, o) order by x, o) q;
  if cardinality(v) > private.badge_slots(me) then return jsonb_build_object('status', 'too_many'); end if;
  if exists (select 1 from unnest(v) x
              where not exists (select 1 from private.user_achievements a where a.user_id = me and a.code = x)) then
    return jsonb_build_object('status', 'not_owned');
  end if;
  update public.profiles set featured_badges = v where id = me;
  return jsonb_build_object('status', 'ok', 'featured', private.featured_for(me, 'own'));
end
$fn$;


do $do$
declare f text;
begin
  foreach f in array array['my_achievements()', 'new_achievements()', 'mark_achievements_seen()', 'set_featured_badges(text[])']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['ach_tier(private.achievement_defs, numeric)', 'award_stat(uuid, text, numeric)', 'bump(uuid, text, int)',
                           'set_stat(uuid, text, numeric)', 'seat_user(uuid, smallint)', 'bump_chat_done(uuid)', 'touch_streak(uuid)',
                           'stats_on_message()', 'stats_on_reaction()', 'stats_on_room()', 'stats_on_hint()',
                           'stats_on_dm()', 'stats_on_rating()', 'stats_on_profile()']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated', f);
  end loop;
end
$do$;

-- ── 지금까지 쌓인 것 채우기 (여러 번 실행해도 같은 값) ──
-- 방 기록은 남아 있다 (메시지만 24시간 뒤 지워짐). 남아 있는 메시지 · 편지도 센다.
do $do$
declare u record; c jsonb; d private.achievement_defs%rowtype; v numeric;
begin
  for u in select id, manner_temp from public.profiles loop
    select jsonb_strip_nulls(jsonb_build_object(
      'chats',   (select count(*) from public.room_members rm join public.rooms r on r.id = rm.room_id
                   where rm.user_id = u.id and r.armed_at is not null
                     and (r.pinned or (r.status = 'closed' and r.close_reason in ('expired', 'declined')))),
      'extends', (select coalesce(sum(greatest(case when r.pinned then r.round - 2 else r.round - 1 end, 0)), 0)
                    from public.room_members rm join public.rooms r on r.id = rm.room_id where rm.user_id = u.id),
      'deep',    (select count(*) from public.room_members rm join public.rooms r on r.id = rm.room_id
                   where rm.user_id = u.id and r.round >= 6),
      'pins',    (select count(*) from public.room_members rm join public.rooms r on r.id = rm.room_id
                   where rm.user_id = u.id and r.pinned),
      'owl',     (select count(*) from public.room_members rm join public.rooms r on r.id = rm.room_id
                   where rm.user_id = u.id and r.armed_at is not null
                     and extract(hour from r.armed_at at time zone 'Asia/Seoul') >= 22),
      'msgs',    (select count(*) from public.room_members rm join public.messages m on m.room_id = rm.room_id and m.sender_seat = rm.seat
                   where rm.user_id = u.id),
      'answers', (select count(*) from private.room_hints h join public.room_members rm on rm.room_id = h.room_id and rm.seat = h.seat
                   where rm.user_id = u.id and h.kind in ('q1', 'q2')),
      'letters_sent', (select count(*) from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
                        where m.is_letter and ((m.from_sender and t.sender_id = u.id) or (not m.from_sender and t.recipient_id = u.id))),
      'letters_got',  (select count(*) from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
                        where m.is_letter and m.delivered and ((m.from_sender and t.recipient_id = u.id) or (not m.from_sender and t.sender_id = u.id))),
      'deco',    (select count(*) from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
                   where m.is_letter and m.fmt is not null
                     and ((m.from_sender and t.sender_id = u.id) or (not m.from_sender and t.recipient_id = u.id)))
    )) into c;
    insert into private.user_stats (user_id, counts) values (u.id, c)
    on conflict (user_id) do update
       set counts = private.user_stats.counts || (
             select coalesce(jsonb_object_agg(k, greatest(coalesce((private.user_stats.counts->>k)::int, 0), (c->>k)::int)), '{}'::jsonb)
               from jsonb_object_keys(c) k);
    select counts into c from private.user_stats where user_id = u.id;
    for d in select * from private.achievement_defs loop
      v := case d.stat when 'temp' then u.manner_temp
                       when 'pioneer' then (select count(*) from public.profiles o join public.profiles me on me.id = u.id where o.created_at <= me.created_at)
                       else (c->>d.stat)::numeric end;
      if v is not null then perform private.award_stat(u.id, d.stat, v); end if;
    end loop;
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 32 — 익명편지 리뉴얼: 편지함 · 봉투 · 편지로만 답장
--
--  편지는 채팅이 아니다 — 한 통 = 봉투 하나. 받은 편지함 · 보낸 편지함을 따로 둔다 (스레드를 좌우로 쌓지 않는다).
--  · 받는 사람에게 모르는 사람(이름으로 나를 찾아 보낸 사람)은 "익명의 ○학생" — 성별만 보인다 (dm_msgs.from_gender, 보낼 때의 성별).
--    내가 이름으로 보낸 사람이 답장한 편지는 이미 아는 사이이므로 그 이름으로 보인다.
--  · 봉투를 열었는지(dm_msgs.opened_at) — 안 연 편지는 봉인된 채로, 보낸 쪽에는 "읽음".
--  · 채팅 모드(dm_reply · dm_chat)는 없앤다. 답장은 편지로만 (dm_reply_to = 받은 편지 한 통에 답장).
--    예전 채팅 줄(is_letter = false)은 표에 남기되(신고 증거) 편지함에는 보이지 않는다.
--  서버 규칙(답 없이 3통 · 하루 한도 · 규칙 필터 · 차단 · 끝내기)은 그대로.
-- ════════════════════════════════════════════════════════════════════

alter table private.dm_msgs add column if not exists from_gender text;
alter table private.dm_msgs drop constraint if exists dm_msgs_from_gender_check;
alter table private.dm_msgs add constraint dm_msgs_from_gender_check check (from_gender in ('m', 'f', 'x'));
alter table private.dm_msgs add column if not exists opened_at timestamptz;

-- 쓴 사람의 성별을 보낼 때 새겨 둔다 (나중에 바뀌어도 그 편지는 그대로)
create or replace function private.dm_fill_gender()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  if new.from_gender is null then
    select p.gender into new.from_gender
      from private.dm_threads t
      join public.profiles p on p.id = case when new.from_sender then t.sender_id else t.recipient_id end
     where t.id = new.thread_id;
  end if;
  return new;
end
$fn$;
revoke all on function private.dm_fill_gender() from public, anon, authenticated;
drop trigger if exists dm_msgs_gender on private.dm_msgs;
create trigger dm_msgs_gender before insert on private.dm_msgs
  for each row execute function private.dm_fill_gender();

-- 예전 편지 채우기: 성별 · 이미 읽은 편지는 열어 본 것으로
update private.dm_msgs m set from_gender = p.gender
  from private.dm_threads t, public.profiles p
 where t.id = m.thread_id and p.id = case when m.from_sender then t.sender_id else t.recipient_id end
   and m.from_gender is null;
update private.dm_msgs m set opened_at = m.created_at
  from private.dm_threads t
 where t.id = m.thread_id and m.opened_at is null
   and m.id <= case when m.from_sender then t.recipient_read else t.sender_read end;

-- 편지 한 통의 받는 사람 · 쓴 사람
create or replace function private.dm_writer(m private.dm_msgs, t private.dm_threads)
returns uuid language sql immutable set search_path = '' as $fn$
  select case when m.from_sender then t.sender_id else t.recipient_id end;
$fn$;
create or replace function private.dm_reader(m private.dm_msgs, t private.dm_threads)
returns uuid language sql immutable set search_path = '' as $fn$
  select case when m.from_sender then t.recipient_id else t.sender_id end;
$fn$;

-- 편지함 dm_mailbox — 받은 편지 / 보낸 편지, 최근 것부터 30통씩. 폴더를 알게 된 판은 Phase 47 (맨 아래)

-- 안 연 받은 편지 수 (하단 탭 빨간 점)
create or replace function public.dm_unread()
returns int language sql security definer set search_path = public, private stable as $fn$
  select count(*)::int
    from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
   where m.is_letter and m.delivered and m.status = 'visible' and m.opened_at is null and t.status <> 'removed'
     and ((m.from_sender and t.recipient_id = auth.uid() and not t.recipient_hidden)
       or (not m.from_sender and t.sender_id = auth.uid() and not t.sender_hidden));
$fn$;

-- 편지 한 통 열기 — 받은 사람이 열면 opened_at 을 남긴다 (보낸 쪽에 "읽음")
create or replace function public.dm_open(p_msg bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); m private.dm_msgs%rowtype; t private.dm_threads%rowtype; v_reader boolean; v_hidden boolean;
        v_first boolean := false;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into m from private.dm_msgs where id = p_msg;
  if not found or not m.is_letter then return jsonb_build_object('status', 'not_found'); end if;
  select * into t from private.dm_threads where id = m.thread_id;
  if t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  if private.dm_reader(m, t) = me then v_reader := true;
  elsif private.dm_writer(m, t) = me then v_reader := false;
  else return jsonb_build_object('status', 'not_found'); end if;
  if v_reader and not m.delivered then return jsonb_build_object('status', 'not_found'); end if;
  v_hidden := case when t.sender_id = me then t.sender_hidden else t.recipient_hidden end;
  if v_hidden then return jsonb_build_object('status', 'not_found'); end if;
  -- 내가 지운 편지 (Phase 69)
  if exists (select 1 from private.dm_hidden_msgs where owner_id = me and msg_id = p_msg) then return jsonb_build_object('status', 'not_found'); end if;
  if v_reader and m.opened_at is null then
    v_first := true;
    update private.dm_msgs set opened_at = now() where id = p_msg returning * into m;
    if t.sender_id = me then update private.dm_threads set sender_read = greatest(sender_read, p_msg) where id = t.id;
    else update private.dm_threads set recipient_read = greatest(recipient_read, p_msg) where id = t.id; end if;
  end if;
  return jsonb_build_object(
    'status', 'ok', 'id', m.id, 'thread_id', t.id,
    'role', case when v_reader then 'received' else 'sent' end,
    'body', case when m.status = 'visible' then m.body end,
    'fmt',  case when m.status = 'visible' then m.fmt end,
    'removed', m.status = 'removed',
    'created_at', m.created_at,
    -- From. / To. — 받은 편지: 모르는 사람이면 성별만, 아는 사람(내가 이름으로 보낸 사람)이면 이름
    'from_gender', m.from_gender,
    'from_name', case when not m.from_sender then (select name from private.person(t.recipient_id)) end,
    -- 서명 (Phase 35): 받은 편지의 From. · 답장의 To. · 내가 익명 쪽이면 지난번 내 서명 (답장 칸에 미리 채운다)
    'from_nick', case when m.from_sender then m.from_nick end,
    'to_nick',   case when not m.from_sender then
                   (select o.from_nick from private.dm_msgs o where o.thread_id = t.id and o.from_sender and o.id < m.id order by o.id desc limit 1) end,
    'my_nick',   case when t.sender_id = me then
                   (select o.from_nick from private.dm_msgs o where o.thread_id = t.id and o.from_sender order by o.id desc limit 1) end,
    'to_name',   case when m.from_sender then (select name from private.person(t.recipient_id)) end,
    'to_grade',  case when m.from_sender and not v_reader then (select grade from private.person(t.recipient_id)) end,
    'to_gender', case when not m.from_sender then
                   (select o.from_gender from private.dm_msgs o where o.thread_id = t.id and o.from_sender order by o.id desc limit 1) end,
    'is_reply', exists (select 1 from private.dm_msgs o where o.thread_id = t.id and o.id < m.id and o.is_letter and o.from_sender <> m.from_sender
                        and (o.delivered or private.dm_writer(o, t) = me)),
    'opened', m.opened_at is not null,
    'first_open', v_first,           -- 방금 처음 열었다 (봉투 여는 연출은 이때만)
    'replied', exists (select 1 from private.dm_msgs o where o.thread_id = t.id and o.id > m.id and o.is_letter and o.from_sender <> m.from_sender
                       and (o.delivered or private.dm_writer(o, t) = me)),
    'thread_status', t.status, 'closed_by', t.closed_by,
    -- 답장은 받은 편지에서만, 열린 편지 줄기에서, 답 없이 3통이면 상대 차례
    'can_reply', v_reader and t.status = 'open',
    'wait_reply', t.status = 'open' and private.dm_streak(t.id, t.sender_id = me) >= 3,
    'server_now', now());
end
$fn$;


-- 받은 편지 한 통에 답장 — 그 편지를 받은 사람만. p_nick = 서명 (Phase 35, 익명 쪽만)
drop function if exists public.dm_reply_to(bigint, text, jsonb);
create or replace function public.dm_reply_to(p_msg bigint, p_body text, p_fmt jsonb default null, p_nick text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); m private.dm_msgs%rowtype; t private.dm_threads%rowtype;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into m from private.dm_msgs where id = p_msg;
  if not found or not m.is_letter or not m.delivered then return jsonb_build_object('status', 'not_found'); end if;
  select * into t from private.dm_threads where id = m.thread_id;
  if private.dm_reader(m, t) is distinct from me then return jsonb_build_object('status', 'not_found'); end if;
  return public.dm_letter(m.thread_id, p_body, p_fmt, p_nick);
end
$fn$;

-- 채팅 모드는 없다
drop function if exists public.dm_reply(bigint, text);
drop function if exists public.dm_chat(bigint);


do $do$
declare f text;
begin
  foreach f in array array['dm_unread()', 'dm_open(bigint)', 'dm_reply_to(bigint, text, jsonb, text)', 'dm_letter(bigint, text, jsonb, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['dm_writer(private.dm_msgs, private.dm_threads)', 'dm_reader(private.dm_msgs, private.dm_threads)']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated', f);
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
--  Phase 34 — 점검 (DB 스키마 · 보안)
--
--  1) 스키마 정리: 같은 함수가 단계마다 여러 번 다시 정의돼 있던 것을, 처음 나오는 자리에 최종 정의 하나만 남겼다
--     (33개 함수 · 겹친 정의 43개 삭제). 정리 전후 PGlite 카탈로그(함수 정의 · 열 · 제약 · 색인 · 트리거 · 정책 · 권한)가 같음을 확인했다.
--     그래서 맨 위에서 함수 본문 검사를 끈다 (check_function_bodies = off) — 본문은 부를 때 검사된다.
--  2) 화면에서 더는 부르지 않는 학생용 RPC 의 실행 권한을 거둔다 (함수 · 표는 남긴다 — 신고 증거 · 운영자 화면용).
--     옛 공개 편지 게시판(Phase 10~15), 옛 대화 한 개 모델(my_room), 편지 줄기 화면(Phase 23~27: dm_inbox · dm_thread),
--     편지 답장은 dm_reply_to 안에서만 (dm_letter 는 직접 부를 수 없다).
--  3) 성능 (Supabase advisor): 학생 RLS 정책 5개의 auth.uid() 를 (select auth.uid()) 로 — 줄마다가 아니라 한 번만 계산 (각 정책 자리에서 고침),
--     private.user_achievements(code) 색인.
--  실DB 와 레포의 함수 171개를 본문 해시로 대조해 모두 같음을 확인했다 (주석 · 공백 제외).
-- ════════════════════════════════════════════════════════════════════

do $do$
declare f text;
begin
  foreach f in array array[
    'my_room()', 'dm_inbox()', 'dm_thread(bigint)', 'dm_letter(bigint, text, jsonb, text)']
  loop
    if to_regprocedure('public.' || f) is not null then
      execute format('revoke all on function public.%s from public, anon, authenticated', f);
    end if;
  end loop;
end
$do$;

-- 트리거 함수 두 개에 남아 있던 기본(PUBLIC) 실행 권한도 거둔다 — 트리거로만 돌고, 트리거 발동은 이 권한을 보지 않는다
revoke all on function private.enforce_school_domain() from public, anon, authenticated;
revoke all on function private.strip_unconfirmed_password() from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════
--  Phase 35 — 편지 서명 · 학번 검색 · 디플로마 목록 · 개인 공지 · 알림 정책
--
--  1) 편지 서명(닉네임): 익명으로 보내는 쪽이 받는 사람에게 보일 이름을 직접 적는다 (dm_msgs.from_nick, 1~12자).
--     비우면 지금처럼 "익명의 ○학생". 규칙 필터(신상정보 · 금칙어) · 운영자 사칭을 거르고,
--     AI 검토(검열봇)를 켜면 본문과 함께 검사된다 (mod_claim). dm_send · dm_letter · dm_reply_to 에 p_nick.
--  2) 편지 받을 사람 찾기에 학번 — 같은 학년 동명이인 구분 (dm_search 자리에서 고침).
--  3) 연장 때 적는 디플로마는 학교 디플로마 목록에서만 (private.diplomas, vote_extension 자리에서 고침).
--  4) 개인 공지: 운영진이 학생 한 명에게만 보내는 공지 (경고 · 개인 연락). 공지 목록 · 알림(하트) 화면에 뜨고 푸시도 간다.
--  5) 알림 정책: 앱이 켜져 있어도 푸시를 보낸다 — 그 대화 화면을 보고 있을 때만 건너뛴다 (private.viewing_room).
--     앱이 화면에 떠 있으면 서비스워커가 시스템 알림 대신 앱 안 알림(위에서 내려오는 띠)으로 보여 준다.
--  6) 실시간 현황의 "대화 중"은 둘 다 대화 화면을 보고 있을 때만 (admin_live_users.talking).
-- ════════════════════════════════════════════════════════════════════

-- ── 1) 편지 서명 ──
alter table private.dm_msgs add column if not exists from_nick text;
alter table private.dm_msgs drop constraint if exists dm_msgs_from_nick_check;
alter table private.dm_msgs add constraint dm_msgs_from_nick_check check (from_nick is null or char_length(from_nick) between 1 and 12);

-- 서명 다듬기 — 앞뒤 공백을 자르고 빈칸 여러 개는 하나로. 비었으면 null (= "익명의 ○학생")
create or replace function private.dm_nick(p_nick text)
returns text language sql immutable set search_path = '' as $fn$
  select nullif(regexp_replace(btrim(coalesce(p_nick, '')), '\s+', ' ', 'g'), '');
$fn$;

-- 쓸 수 없는 서명 — 12자 넘음 · 규칙 필터(신상정보 · 금칙어) · 운영자나 앱 이름 사칭
create or replace function private.dm_nick_bad(p_nick text)
returns boolean language plpgsql stable set search_path = '' as $fn$
begin
  if p_nick is null then return false; end if;
  return char_length(p_nick) > 12
      or private.rule_violation(p_nick) is not null
      or lower(replace(p_nick, ' ', '')) ~ '(운영|관리자|admin|landy|랜디|선생님)';
end
$fn$;
revoke all on function private.dm_nick(text), private.dm_nick_bad(text) from public, anon, authenticated;

-- ── 3) 디플로마 — 학교에 있는 것만 (화면도 이 목록에서 검색해 고른다: src/lib/chat/diplomas.ts)
create or replace function private.diplomas()
returns text[] language sql immutable set search_path = '' as $fn$
  select array['수학', '물리학', '화학', '생명과학', '공학', 'IT', '인문학', '국제어문', '사회과학', '경제경영', '예술', '체육', 'IB'];
$fn$;
revoke all on function private.diplomas() from public, anon, authenticated;

-- ── 4) 개인 공지 ──
create table if not exists private.personal_notices (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'message' check (kind in ('message', 'warning')),
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  body        text not null default '' check (char_length(body) <= 2000),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  removed_at  timestamptz
);
create index if not exists personal_notices_user on private.personal_notices (user_id, id desc) where removed_at is null;
alter table private.personal_notices enable row level security;
revoke all on private.personal_notices from public, anon, authenticated;

-- 학생: 개인 공지 한 통을 읽었다 (내 것만)
create or replace function public.read_personal_notice(p_id bigint)
returns void language sql security definer set search_path = '' as $fn$
  update private.personal_notices set read_at = coalesce(read_at, now())
   where id = p_id and user_id = (select auth.uid()) and removed_at is null;
$fn$;
revoke all on function public.read_personal_notice(bigint) from public, anon;
grant execute on function public.read_personal_notice(bigint) to authenticated;

-- 운영진: 보내기 (경고 · 개인 연락 — 운영진 누구나). 활동 기록에 남는다
create or replace function public.admin_send_personal_notice(p_staff uuid, p_user uuid, p_kind text, p_title text, p_body text)
returns bigint language plpgsql security definer set search_path = public, private as $fn$
declare v bigint;
begin
  perform private.require_staff(p_staff);
  if coalesce(p_kind, '') not in ('message', 'warning') then raise exception 'bad_kind'; end if;
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user_not_found'; end if;
  insert into private.personal_notices (user_id, kind, title, body, created_by)
  values (p_user, p_kind, btrim(p_title), btrim(coalesce(p_body, '')), p_staff)
  returning id into v;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, 'personal_notice', p_user, jsonb_build_object('notice', v, 'kind', p_kind, 'title', btrim(p_title)));
  return v;
end
$fn$;

-- 운영진: 한 사람에게 보낸 개인 공지 (사용자 상세 화면) — 읽었는지까지
create or replace function public.admin_personal_notices(p_staff uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_staff(p_staff);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'title', title, 'body', body,
                                        'created_at', created_at, 'read_at', read_at) order by id desc)
      from private.personal_notices where user_id = p_user and removed_at is null
  ), '[]'::jsonb);
end
$fn$;

-- 운영진: 거두기 (지우지 않고 숨긴다 — 기록은 남는다)
create or replace function public.admin_remove_personal_notice(p_staff uuid, p_id bigint)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare v_user uuid;
begin
  perform private.require_staff(p_staff);
  update private.personal_notices set removed_at = now() where id = p_id and removed_at is null returning user_id into v_user;
  if not found then raise exception 'notice_not_found'; end if;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, 'remove_personal_notice', v_user, jsonb_build_object('notice', p_id));
end
$fn$;

-- 서버 전용: 개인 공지 알림 — 막 보낸(2분 안) 공지 한 번만
create table if not exists private.personal_notice_push_log (
  notice_id  bigint primary key references private.personal_notices(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.personal_notice_push_log enable row level security;

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

do $do$
declare f text;
begin
  foreach f in array array['admin_send_personal_notice(uuid, uuid, text, text, text)', 'admin_personal_notices(uuid, uuid)',
                           'admin_remove_personal_notice(uuid, bigint)', 'personal_notice_push(bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;

-- ── 5) 알림 정책 — 그 대화 화면을 보고 있는가 (room_view 가 20초마다 viewing_until 을 45초 뒤로 민다)
create or replace function private.viewing_room(p_user uuid, p_room uuid)
returns boolean language sql stable security definer set search_path = '' as $fn$
  select exists (select 1 from public.room_members
                  where room_id = p_room and user_id = p_user and viewing_until > now());
$fn$;
revoke all on function private.viewing_room(uuid, uuid) from public, anon, authenticated;

-- 발송 기록 정리 — 개인 공지 알림 기록도 하루면 충분
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-purge-pn-push';
    perform cron.schedule('simbun-purge-pn-push', '49 4 * * *',
      $q$delete from private.personal_notice_push_log where created_at < now() - interval '1 day'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
-- Phase 36 — Supabase 사용량 줄이기
--   요청 하나하나가 로그(무료 1GB/월)가 된다. 앱이 보내는 주기 신호를 절반으로 줄이고 서버의 창을 그만큼 늘린다.
--   접속 신호 30초 → 60초 (온라인 창 70초 → 130초) · 대화 "보고 있음" 10초 → 20초 (창 25초 → 45초, 위에서 고침).
--   화면을 내리면 곧바로 오프라인 · 떠남을 알리므로, 늘어난 창은 앱이 갑자기 꺼졌을 때만 쓰인다.
-- ════════════════════════════════════════════════════════════════════
alter table public.app_settings alter column online_ttl_sec set default 130;
update public.app_settings set online_ttl_sec = 130 where online_ttl_sec = 70;

-- pg_cron 실행 기록(cron.job_run_details)은 스스로 지워지지 않는다 — 1분마다 도는 스위퍼 때문에 하루 1,440줄씩 쌓인다. 이틀치만 남긴다.
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-purge-cron-log';
    perform cron.schedule('simbun-purge-cron-log', '53 4 * * *',
      $q$delete from cron.job_run_details where end_time < now() - interval '2 days'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
-- Phase 37 — 운영진에게 문의하기
--   학생: 설정 › 운영진에게 문의하기 — 종류 하나 고르고 글을 보낸다. 내가 보낸 문의와 답변을 같은 화면에서 본다.
--   운영진: 운영 화면 "문의" 탭 — 답변을 적으면 그 학생에게 개인 공지로 가고(하트 · 공지 · 푸시), 문의에도 답변이 남는다.
--   남용 막기: 답을 못 받은 문의는 3개까지 · 하루 5개까지. 답변 180일 뒤(답이 없으면 보낸 지 180일 뒤) 지운다.
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.inquiries (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null check (kind in ('use', 'safety', 'account', 'bug', 'etc')),
  body         text not null check (char_length(btrim(body)) between 5 and 1000),
  created_at   timestamptz not null default now(),
  answer       text check (char_length(answer) <= 2000),
  answered_at  timestamptz,
  answered_by  uuid,
  notice_id    bigint
);
create index if not exists inquiries_user on private.inquiries (user_id, id desc);
create index if not exists inquiries_open on private.inquiries (id) where answered_at is null;
alter table private.inquiries enable row level security;
revoke all on private.inquiries from public, anon, authenticated;

-- 학생: 문의 보내기 → ok | bad_input | too_many(답 못 받은 문의 3개) | rate(하루 5개)
create or replace function public.send_inquiry(p_kind text, p_body text)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v bigint; b text := btrim(coalesce(p_body, ''));
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if coalesce(p_kind, '') not in ('use', 'safety', 'account', 'bug', 'etc') or char_length(b) not between 5 and 1000 then
    return jsonb_build_object('status', 'bad_input');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('inquiry:' || me::text, 0));
  if (select count(*) from private.inquiries where user_id = me and answered_at is null) >= 3 then
    return jsonb_build_object('status', 'too_many');
  end if;
  if (select count(*) from private.inquiries where user_id = me and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('status', 'rate');
  end if;
  insert into private.inquiries (user_id, kind, body) values (me, p_kind, b) returning id into v;
  return jsonb_build_object('status', 'ok', 'id', v);
end
$fn$;
revoke all on function public.send_inquiry(text, text) from public, anon;
grant execute on function public.send_inquiry(text, text) to authenticated;

-- 학생: 내가 보낸 문의 (최근 20개) · 답변
create or replace function public.my_inquiries()
returns jsonb language sql security definer set search_path = '' stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'kind', i.kind, 'body', i.body, 'created_at', i.created_at,
                                               'answer', i.answer, 'answered_at', i.answered_at) order by i.id desc), '[]'::jsonb)
    from (select * from private.inquiries where user_id = (select auth.uid()) order by id desc limit 20) i;
$fn$;
revoke all on function public.my_inquiries() from public, anon;
grant execute on function public.my_inquiries() to authenticated;

-- 운영진: 문의 목록 — 답을 기다리는 것 먼저(오래된 순), 그다음 답한 것(최근 순). 운영진 누구나
create or replace function public.admin_inquiries(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_perm(p_staff, 'inquiry'); -- 개발자도 (버그 문의, Phase 49)
  return jsonb_build_object(
    'open', (select count(*) from private.inquiries where answered_at is null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'user_id', i.user_id, 'kind', i.kind, 'body', i.body, 'created_at', i.created_at,
                                          'answer', i.answer, 'answered_at', i.answered_at) order by (i.answered_at is null) desc,
                                          case when i.answered_at is null then i.id end asc, i.id desc)
        from (select * from private.inquiries
               order by (answered_at is null) desc, case when answered_at is null then id end asc, id desc limit 100) i
    ), '[]'::jsonb));
end
$fn$;

-- 운영진: 답변 — 그 학생에게 개인 공지로 보내고(돌려주는 값 = 공지 번호, 알림은 personal_notice_push) 문의에 답을 남긴다. 기록에 남는다
create or replace function public.admin_answer_inquiry(p_staff uuid, p_id bigint, p_answer text)
returns bigint language plpgsql security definer set search_path = public, private as $fn$
declare q private.inquiries%rowtype; a text := btrim(coalesce(p_answer, '')); v bigint;
begin
  perform private.require_perm(p_staff, 'inquiry'); -- 개발자도 (버그 문의, Phase 49)
  if char_length(a) not between 1 and 2000 then raise exception 'bad_answer'; end if;
  select * into q from private.inquiries where id = p_id for update;
  if not found then raise exception 'inquiry_not_found'; end if;
  if q.answered_at is not null then raise exception 'already_answered'; end if;
  insert into private.personal_notices (user_id, kind, title, body, created_by)
  values (q.user_id, 'message', '문의하신 내용에 답변드려요', a, p_staff)
  returning id into v;
  update private.inquiries set answer = a, answered_at = now(), answered_by = p_staff, notice_id = v where id = p_id;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, 'answer_inquiry', q.user_id, jsonb_build_object('inquiry', p_id, 'notice', v));
  return v;
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['admin_inquiries(uuid)', 'admin_answer_inquiry(uuid, bigint, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;

-- 오래된 문의 지우기 — 답변 180일 뒤 (답이 없으면 보낸 지 180일 뒤)
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-purge-inquiries';
    perform cron.schedule('simbun-purge-inquiries', '57 4 * * *',
      $q$delete from private.inquiries where coalesce(answered_at, created_at) < now() - interval '180 days'$q$);
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
-- Phase 44 — 첫 대화 5분 · 특별 업적(베타 테스터) · 익명편지 잠금
--   · 첫 대화는 5분, 연장할 때마다 extend_minutes(10분) — 운영 설정에서 바꿀 수 있다
--   · 운영진이 주는 업적(granted) — 기준(동 · 은 · 금) 없이 운영자 화면에서 주고 거둔다. 첫 번째는 베타 테스터.
--     화면은 메달을 누르면 어떻게 얻는지 보여 준다 — 남의 메달도 설명은 카탈로그(achievement_catalog)에서
--   · 익명편지 잠금 — 가입한 학생이 적을 때는 누가 보냈는지 쉽게 짐작된다. letters_gate 를 켜 두면
--     가입(학교 인증 + 시작하기)한 학생이 letters_gate_min 명이 될 때까지 쓰기 · 찾기를 막는다 (dm_can_write · dm_search).
--     가입 인원은 한 줄 표(signup_stats)에 두고 앱이 Realtime 으로 지켜본다 (주기 요청 없이 실시간)
-- ════════════════════════════════════════════════════════════════════
alter table public.app_settings alter column room_minutes set default 5;
update public.app_settings set room_minutes = 5 where id and room_minutes = 10;

-- ── 운영진이 주는 업적 ──
alter table private.achievement_defs add column if not exists granted boolean not null default false;
insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted) values
  ('beta', '베타 테스터', '출시 전 베타 테스트에 함께한 사람', '🧪', 'special', 'beta', '', 1, 1, 1, false, 39, true)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort, granted = excluded.granted;

-- 업적 카탈로그 — 이름 · 설명 · 등급 기준 (누구의 것도 아닌 공개 정보). 남의 메달을 눌렀을 때 설명을 그린다
create or replace function public.achievement_catalog()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', code, 'title', title, 'description', description, 'icon', icon, 'category', category,
           'unit', unit, 'lower_better', lower_better, 'granted', granted,
           'tiers', jsonb_build_array(bronze, silver, gold)) order by sort), '[]'::jsonb)
    from private.achievement_defs;
$fn$;
revoke all on function public.achievement_catalog() from public, anon;
grant execute on function public.achievement_catalog() to authenticated;

-- 운영자: 한 학생이 가진 특별 업적 (주고 거둘 수 있는 것만)
create or replace function public.admin_user_badges(p_staff uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_staff(p_staff);
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', d.code, 'title', d.title, 'description', d.description,
                                        'has', a.user_id is not null, 'earned_at', a.earned_at) order by d.sort)
      from private.achievement_defs d
      left join private.user_achievements a on a.code = d.code and a.user_id = p_user
     where d.granted), '[]'::jsonb);
end
$fn$;

-- 운영자: 특별 업적 주기(p_on) · 거두기. 운영진 누구나, 기록에 남는다. 주면 학생 앱에 새 업적 축하가 뜬다
create or replace function public.admin_set_badge(p_staff uuid, p_user uuid, p_code text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'user_not_found'; end if;
  if not exists (select 1 from private.achievement_defs where code = p_code and granted) then raise exception 'not_grantable'; end if;
  if p_on then
    insert into private.user_achievements (user_id, code, tier) values (p_user, p_code, 3)
    on conflict (user_id, code) do nothing;
  else
    delete from private.user_achievements where user_id = p_user and code = p_code;
    update public.profiles set featured_badges = array_remove(featured_badges, p_code)
     where id = p_user and p_code = any(featured_badges);
  end if;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, case when p_on then 'grant_badge' else 'revoke_badge' end, p_user, jsonb_build_object('code', p_code));
  return public.admin_user_badges(p_staff, p_user);
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['admin_user_badges(uuid, uuid)', 'admin_set_badge(uuid, uuid, text, boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;

-- ── 익명편지 잠금 ──
alter table public.app_settings add column if not exists letters_gate     boolean not null default true;
alter table public.app_settings add column if not exists letters_gate_min int     not null default 100;
do $do$
begin
  alter table public.app_settings add constraint app_settings_letters_gate_min check (letters_gate_min between 1 and 10000);
exception when duplicate_object then null;
end
$do$;

-- 가입한 학생 수 (학교 인증 + 시작하기까지) — 한 줄. 누구나(로그인한 학생) 읽는다: 숫자 하나뿐이다
create table if not exists public.signup_stats (
  id         boolean primary key default true check (id),
  students   int not null default 0,
  updated_at timestamptz not null default now()
);
insert into public.signup_stats (id) values (true) on conflict (id) do nothing;
alter table public.signup_stats enable row level security;
drop policy if exists "signup_stats: read" on public.signup_stats;
create policy "signup_stats: read" on public.signup_stats for select to authenticated using (true);
revoke insert, update, delete on public.signup_stats from anon, authenticated;

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
revoke all on function private.refresh_signup_stats() from public, anon, authenticated;
drop trigger if exists profiles_signup_stats on public.profiles;
create trigger profiles_signup_stats after insert or delete or update of verified, onboarded on public.profiles
  for each statement execute function private.refresh_signup_stats();
update public.signup_stats set students = (select count(*) from public.profiles where verified and onboarded), updated_at = now() where id;
-- (바뀐 숫자는 Phase 55 방송으로 잠금 화면에 간다)

-- 지금 잠겨 있나 — 잠금을 켰고 가입한 학생이 기준보다 적으면
create or replace function private.letters_locked()
returns boolean language sql security definer set search_path = public stable as $fn$
  select coalesce((select s.letters_gate and st.students < s.letters_gate_min
                     from public.app_settings s cross join public.signup_stats st
                    where s.id and st.id), true);
$fn$;
revoke all on function private.letters_locked() from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════
-- Phase 47 — 편지 폴더
-- 보관함에서 편지를 여러 통 골라 이름 붙인 폴더에 넣는다 (내 것만 — 상대에게는 아무것도 안 보인다).
-- 폴더에 넣은 편지는 받은/보낸 편지 목록에서 빠지고 그 폴더에서만 보인다(진짜 폴더처럼). 한 편지는 한 폴더에만.
-- 받은 편지는 봉투를 열어 본 것만 넣는다 (안 연 편지가 새 편지 더미에서 사라지지 않게).
-- 폴더를 지우면 안에 있던 편지는 보관함으로 돌아온다 (편지는 지워지지 않는다).
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.dm_folders (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 20 and name = btrim(name)),
  created_at timestamptz not null default now()
);
create unique index if not exists dm_folders_owner_name on private.dm_folders (owner_id, lower(name));
alter table private.dm_folders enable row level security;

create table if not exists private.dm_folder_items (
  owner_id  uuid not null references public.profiles(id) on delete cascade,
  msg_id    bigint not null references private.dm_msgs(id) on delete cascade,
  folder_id bigint not null references private.dm_folders(id) on delete cascade,
  added_at  timestamptz not null default now(),
  primary key (owner_id, msg_id)
);
create index if not exists dm_folder_items_folder on private.dm_folder_items (folder_id);
create index if not exists dm_folder_items_msg on private.dm_folder_items (msg_id);
alter table private.dm_folder_items enable row level security;

-- 이 편지가 나에게 받은 편지인지 보낸 편지인지 (내가 버린 줄기 · 내가 지운 편지(Phase 69)면 null)
create or replace function private.dm_box_of(m private.dm_msgs, t private.dm_threads, p_me uuid)
returns text language sql stable set search_path = '' as $fn$
  select case when not m.delivered and private.dm_reader(m, t) = p_me then null
              when exists (select 1 from private.dm_hidden_msgs h where h.owner_id = p_me and h.msg_id = m.id) then null
              when (m.from_sender and t.recipient_id = p_me and not t.recipient_hidden)
                or (not m.from_sender and t.sender_id = p_me and not t.sender_hidden) then 'received'
              when (m.from_sender and t.sender_id = p_me and not t.sender_hidden)
                or (not m.from_sender and t.recipient_id = p_me and not t.recipient_hidden) then 'sent' end;
$fn$;
revoke all on function private.dm_box_of(private.dm_msgs, private.dm_threads, uuid) from public, anon, authenticated;

-- 폴더 하나의 편지 수 — 지금 볼 수 있는 것만. 전체 · 받은 편지 · 보낸 편지 (Phase 47-3 — 섞인 폴더에서 둘을 나눠 보이게)
create or replace function private.dm_folder_counts(p_folder bigint, p_me uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select jsonb_build_object('count', count(*), 'received', count(*) filter (where b.bx = 'received'), 'sent', count(*) filter (where b.bx = 'sent'))
    from private.dm_folder_items i
    join private.dm_msgs m on m.id = i.msg_id
    join private.dm_threads t on t.id = m.thread_id
    cross join lateral (select private.dm_box_of(m, t, p_me) as bx) b
   where i.folder_id = p_folder and i.owner_id = p_me and m.is_letter and t.status <> 'removed' and b.bx is not null;
$fn$;
revoke all on function private.dm_folder_counts(bigint, uuid) from public, anon, authenticated;

-- 내 폴더 목록 — 이름 · 들어 있는 편지 수(전체 · 받은 · 보낸), 만든 순서
create or replace function private.dm_folder_list(p_me uuid)
returns jsonb language sql stable security definer set search_path = '' as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) || private.dm_folder_counts(f.id, p_me)
           order by f.created_at, f.id), '[]'::jsonb)
    from private.dm_folders f where f.owner_id = p_me;
$fn$;
revoke all on function private.dm_folder_list(uuid) from public, anon, authenticated;

-- 편지함 — 폴더를 알게 (p_folder). 폴더 없이: 그 칸(받은/보낸)의 폴더에 안 넣은 편지 + 첫 쪽이면 내 폴더 목록.
-- 폴더를 주면: 그 폴더의 편지 전부(받은 · 보낸 섞어서, 편지마다 box) + 폴더 이름 · 편지 수(전체 · 받은 · 보낸, Phase 47-3).
drop function if exists public.dm_mailbox(text, bigint);
create or replace function public.dm_mailbox(p_box text, p_before bigint default null, p_folder bigint default null)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare
  me uuid := auth.uid();
  fname text;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_folder is null and p_box not in ('received', 'sent') then return jsonb_build_object('letters', '[]'::jsonb); end if;
  if p_folder is not null then
    select name into fname from private.dm_folders where id = p_folder and owner_id = me;
    if fname is null then return jsonb_build_object('letters', '[]'::jsonb, 'folder', null, 'server_now', now()); end if;
  end if;
  return jsonb_build_object('letters', coalesce((
    select jsonb_agg(x order by x.id desc) from (
      select m.id, m.thread_id, m.created_at, m.status = 'removed' as removed, t.status as thread_status, b.bx as box,
             -- 받은 편지: 모르는 사람이면 성별만, 내가 이름으로 보낸 사람의 답장이면 그 이름
             case when b.bx = 'received' then m.from_gender end as from_gender,
             case when b.bx = 'received' and not m.from_sender then (select name from private.person(t.recipient_id)) end as from_name,
             -- 서명 (Phase 35) — 익명 쪽이 적은 것. 받은 편지의 From. / 보낸 답장의 To. / 내가 익명 쪽이면 내 서명
             case when b.bx = 'received' and m.from_sender then m.from_nick end as from_nick,
             case when b.bx = 'sent' and not m.from_sender then
               (select o.from_nick from private.dm_msgs o where o.thread_id = m.thread_id and o.from_sender and o.id < m.id order by o.id desc limit 1) end as to_nick,
             case when t.sender_id = me then
               (select o.from_nick from private.dm_msgs o where o.thread_id = m.thread_id and o.from_sender and o.id <= m.id order by o.id desc limit 1) end as my_nick,
             m.opened_at is not null as opened,
             exists (select 1 from private.dm_msgs o where o.thread_id = m.thread_id and o.id < m.id
                      and o.is_letter and o.from_sender <> m.from_sender and (o.delivered or private.dm_writer(o, t) = me)) as is_reply,
             -- 보낸 편지: 이름으로 보낸 편지면 받는 사람 이름 · 학년, 답장이면 "익명의 ○학생"
             case when b.bx = 'sent' and m.from_sender then (select name from private.person(t.recipient_id)) end as to_name,
             case when b.bx = 'sent' and m.from_sender then (select grade from private.person(t.recipient_id)) end as to_grade,
             case when b.bx = 'sent' and not m.from_sender then
               (select o.from_gender from private.dm_msgs o where o.thread_id = m.thread_id and o.from_sender order by o.id desc limit 1) end as to_gender,
             case when b.bx = 'sent' then exists (select 1 from private.dm_msgs o where o.thread_id = m.thread_id and o.id > m.id
                      and o.is_letter and o.from_sender <> m.from_sender and (o.delivered or private.dm_writer(o, t) = me)) end as replied
        from private.dm_msgs m
        join private.dm_threads t on t.id = m.thread_id
        cross join lateral (select private.dm_box_of(m, t, me) as bx) b
        left join private.dm_folder_items fi on fi.owner_id = me and fi.msg_id = m.id
       where m.is_letter and t.status <> 'removed' and (t.sender_id = me or t.recipient_id = me) and b.bx is not null
         and (p_before is null or m.id < p_before)
         and case when p_folder is null then b.bx = p_box and fi.msg_id is null else fi.folder_id = p_folder end
       order by m.id desc limit 30) x), '[]'::jsonb),
    'folders', case when p_before is null and p_folder is null then private.dm_folder_list(me) end,
    'folder', case when p_folder is not null then jsonb_build_object('id', p_folder, 'name', fname) || private.dm_folder_counts(p_folder, me) end,
    'server_now', now());
end
$fn$;
revoke all on function public.dm_mailbox(text, bigint, bigint) from public, anon;
grant execute on function public.dm_mailbox(text, bigint, bigint) to authenticated;

-- 폴더 이름 — 앞뒤 공백을 자르고 가운데 공백은 하나로 (빈 이름은 null)
create or replace function private.dm_folder_name(p_name text)
returns text language sql immutable set search_path = '' as $fn$
  select nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
$fn$;
revoke all on function private.dm_folder_name(text) from public, anon, authenticated;

-- 편지 여러 통을 폴더에 — p_folder(있는 폴더) 또는 p_name(새 폴더 · 같은 이름이 있으면 그 폴더). 다른 폴더에 있던 편지는 옮겨 온다.
-- 내가 볼 수 있는 편지만, 받은 편지는 열어 본 것만. 이름은 20자 · 폴더는 30개까지.
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

-- 폴더에서 빼기 — 보관함(받은/보낸 편지)으로 돌아간다
create or replace function public.dm_folder_take(p_msgs bigint[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  delete from private.dm_folder_items where owner_id = me and msg_id = any(coalesce(p_msgs, '{}'));
  get diagnostics n = row_count;
  return jsonb_build_object('status', 'ok', 'moved', n);
end
$fn$;

-- 폴더 이름 바꾸기 — 같은 이름의 다른 폴더가 있으면 'exists'
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

-- 폴더 지우기 — 편지는 지우지 않고 보관함으로 돌아간다
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

do $do$
declare f text;
begin
  foreach f in array array['dm_folder_put(bigint[], bigint, text)', 'dm_folder_take(bigint[])', 'dm_folder_rename(bigint, text)', 'dm_folder_delete(bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$do$;

-- ════════════════════════════════════════════════════════════════════
-- Phase 49 — 운영자 · 개발자 · 관리자 역할 나누기 · 운영진 현황(오른쪽 판)
-- 역할: moderator(운영자) · developer(개발자, 새로) · admin(관리자). 권한표는 private.staff_can (위 require_staff 옆).
-- 현황: 운영자 화면은 원래 요청마다 역할을 확인한다(admin_staff_role). 그 한 번에 "마지막으로 본 시각 · 화면"을 적고
--       팀 목록을 같이 돌려준다(admin_staff_touch) — Supabase 요청 수는 그대로.
-- 역할 바꾸기: update private.staff set role = 'developer', display_name = '이름' where user_id = '...';
-- ════════════════════════════════════════════════════════════════════
alter table private.staff drop constraint if exists staff_role_check;
alter table private.staff add constraint staff_role_check check (role in ('moderator', 'developer', 'admin'));
alter table private.staff add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 20);
alter table private.staff add column if not exists last_seen timestamptz;
alter table private.staff add column if not exists last_path text;

-- 역할 확인 + 지금 보는 화면 적기 + 팀 현황. 명단에 없으면 null. p_path 가 null 이면 화면은 그대로(현황 새로고침)
create or replace function public.admin_staff_touch(p_uid uuid, p_path text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare v text;
begin
  update private.staff set last_seen = now(), last_path = coalesce(left(p_path, 80), last_path)
   where user_id = p_uid returning role into v;
  if v is null then return null; end if;
  -- owner = 최고 관리자 (Phase 50 — 운영진을 지정 · 해제할 수 있는 단 한 사람)
  -- perms = 내 역할의 권한(Phase 51 표, 관리자는 전부) — 서버 · 화면이 메뉴와 화면을 이걸로 가른다
  -- maintenance = 서버 점검 중인지 (Phase 52 — 운영 화면 위 띠)
  return jsonb_build_object('role', v, 'owner', (select owner from private.staff where user_id = p_uid),
    'maintenance', private.in_maintenance(),
    'maintenance_at', (select maintenance_at from public.app_settings where id and maintenance_at > now()), -- 예약 (Phase 53)
    'perms', case when v = 'admin' then '["live","moderate","identity","settings","service","inquiry","notice","audit"]'::jsonb
                  else (select coalesce(jsonb_agg(r.perm order by r.perm), '[]'::jsonb) from private.role_perms r where r.role = v) end,
    'team', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.user_id, 'name', coalesce(s.display_name, p.nickname, '이름 없음'), 'role', s.role, 'owner', s.owner,
             'last_seen', s.last_seen, 'path', s.last_path, 'me', s.user_id = p_uid)
           order by s.last_seen desc nulls last), '[]'::jsonb)
      from private.staff s left join public.profiles p on p.id = s.user_id), 'now', now());
end
$fn$;
revoke all on function public.admin_staff_touch(uuid, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Phase 50 — 최고 관리자(owner) · 운영진 관리
-- 최고 관리자는 딱 한 명(관리자 중에서). 운영진을 지정(학번으로) · 역할 바꾸기 · 표시 이름 · 빼기는 최고 관리자만.
-- 최고 관리자 자신은 여기서 바꾸거나 뺄 수 없다(잠겨 버리지 않게). 넘기려면 DB 에서:
--   update private.staff set owner = false where owner; update private.staff set owner = true where user_id = '…';
-- ════════════════════════════════════════════════════════════════════
alter table private.staff add column if not exists owner boolean not null default false;
create unique index if not exists staff_one_owner on private.staff (owner) where owner;
alter table private.staff drop constraint if exists staff_owner_admin;
alter table private.staff add constraint staff_owner_admin check (not owner or role = 'admin');

create or replace function private.require_owner(p_staff uuid)
returns void language plpgsql security definer set search_path = public, private stable as $fn$
begin
  if not exists (select 1 from private.staff where user_id = p_staff) then raise exception 'not_staff'; end if;
  if not exists (select 1 from private.staff where user_id = p_staff and owner) then raise exception 'owner_only'; end if;
end
$fn$;
revoke all on function private.require_owner(uuid) from public, anon, authenticated;

-- 운영진 명단 (최고 관리자만) — 학번(학교 이메일 앞부분) · 앱 닉네임 · 표시 이름 · 역할 · 지정한 날 · 마지막 접속
create or replace function public.admin_staff_list(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_owner(p_staff);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.user_id, 'no', split_part(u.email, '@', 1), 'nickname', p.nickname, 'display_name', s.display_name,
             'role', s.role, 'owner', s.owner, 'created_at', s.created_at, 'last_seen', s.last_seen)
           order by s.owner desc, case s.role when 'admin' then 0 when 'developer' then 1 else 2 end, s.created_at)
      from private.staff s left join auth.users u on u.id = s.user_id left join public.profiles p on p.id = s.user_id
  ), '[]'::jsonb);
end
$fn$;
revoke all on function public.admin_staff_list(uuid) from public, anon, authenticated;

-- 운영진 지정 · 역할 바꾸기 · 표시 이름 (최고 관리자만). p_no = 학번(학교 이메일 앞부분). p_role = null 이면 운영진에서 뺀다
create or replace function public.admin_staff_set(p_staff uuid, p_no text, p_role text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  target uuid;
  nm text := nullif(btrim(coalesce(p_name, '')), '');
  before text;
begin
  perform private.require_owner(p_staff);
  if p_role is not null and p_role not in ('moderator', 'developer', 'beta', 'admin') then raise exception 'bad_role'; end if;
  if nm is not null and char_length(nm) > 20 then raise exception 'bad_name'; end if;
  select id into target from auth.users where lower(email) = lower(btrim(coalesce(p_no, ''))) || '@cnsa.hs.kr';
  if target is null then raise exception 'user_not_found'; end if;
  if exists (select 1 from private.staff where user_id = target and owner) then raise exception 'owner_locked'; end if;
  select role into before from private.staff where user_id = target;
  if p_role is null then
    delete from private.staff where user_id = target;
  else
    insert into private.staff (user_id, role, display_name) values (target, p_role, nm)
    on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name;
  end if;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, 'set_staff', target, jsonb_build_object('from', before, 'to', p_role, 'name', nm));
  return public.admin_staff_list(p_staff);
end
$fn$;
revoke all on function public.admin_staff_set(uuid, text, text, text) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Phase 51 — 베타테스터 역할 · 역할별 권한을 최고 관리자가 정한다
-- 역할 넷: 운영자(moderator) · 개발자(developer) · 베타테스터(beta, 처음엔 실시간 현황만) · 관리자(admin, 늘 전부).
-- 권한 표 private.role_perms (위 staff_can 옆에서 만든다) — 운영진 관리 화면의 체크 표. 모든 DB 함수가 이 표를 따른다.
-- ════════════════════════════════════════════════════════════════════
alter table private.staff drop constraint if exists staff_role_check;
alter table private.staff add constraint staff_role_check check (role in ('moderator', 'developer', 'beta', 'admin'));

-- 역할별 권한 (최고 관리자만) — { moderator: [...], developer: [...], beta: [...] }
create or replace function public.admin_role_perms(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_owner(p_staff);
  return (select jsonb_object_agg(x.role, coalesce((select jsonb_agg(r.perm order by r.perm) from private.role_perms r where r.role = x.role), '[]'::jsonb))
            from (values ('moderator'), ('developer'), ('beta')) x(role));
end
$fn$;
revoke all on function public.admin_role_perms(uuid) from public, anon, authenticated;

-- 한 역할의 권한을 통째로 바꾼다 (최고 관리자만, 관리자 역할은 바꿀 수 없다). 기록에 남는다
create or replace function public.admin_set_role_perms(p_staff uuid, p_role text, p_perms text[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare before jsonb; clean text[];
begin
  perform private.require_owner(p_staff);
  if p_role not in ('moderator', 'developer', 'beta') then raise exception 'bad_role'; end if;
  select array(select distinct unnest(coalesce(p_perms, '{}'))) into clean;
  if exists (select 1 from unnest(clean) p where p not in ('live', 'moderate', 'identity', 'settings', 'service', 'inquiry', 'notice', 'audit')) then
    raise exception 'bad_perm';
  end if;
  select coalesce(jsonb_agg(perm order by perm), '[]'::jsonb) into before from private.role_perms where role = p_role;
  delete from private.role_perms where role = p_role and perm <> all(clean);
  insert into private.role_perms (role, perm) select p_role, unnest(clean) on conflict do nothing;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'set_role_perms', jsonb_build_object('role', p_role, 'from', before, 'to', to_jsonb(clean)));
  return public.admin_role_perms(p_staff);
end
$fn$;
revoke all on function public.admin_set_role_perms(uuid, text, text[]) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Phase 52 — 서버 점검
-- 운영자 화면에서 켜고 끈다(서비스 열고 닫기 권한). 켜면 학생 앱은 통째로 점검 화면(안내 문구 · 끝나는 시각), 새 대화 · 편지는 DB 도 막는다.
-- 학생 앱은 1분마다 보내는 heartbeat 의 대답(maintenance)과 앱을 열 때 읽는 설정으로 안다 — 요청을 따로 늘리지 않는다.
-- 운영자 화면은 점검 중에도 그대로.
-- ════════════════════════════════════════════════════════════════════
alter table public.app_settings add column if not exists maintenance boolean not null default false;
alter table public.app_settings add column if not exists maintenance_msg text not null default '' check (char_length(maintenance_msg) <= 300);
alter table public.app_settings add column if not exists maintenance_until timestamptz;

-- ════════════════════════════════════════════════════════════════════
-- Phase 53 — 점검 예약
-- maintenance_at 에 시각을 적어 두면 그 시각부터 저절로 점검 중(따로 도는 작업 없이 — 점검 여부를 물을 때마다 시각을 본다).
-- 학생 앱은 1분마다 보내는 heartbeat 로 알아서 1분 안에 점검 화면이 되고, 24시간 안의 예약은 홈에 미리 알린다.
-- 점검 끝내기 = maintenance · maintenance_at 둘 다 지운다.
-- ════════════════════════════════════════════════════════════════════
alter table public.app_settings add column if not exists maintenance_at timestamptz;

create or replace function private.in_maintenance()
returns boolean language sql stable security definer set search_path = '' as $fn$
  select coalesce((select s.maintenance or (s.maintenance_at is not null and s.maintenance_at <= now())
                     from public.app_settings s where s.id), false);
$fn$;
revoke all on function private.in_maintenance() from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- Phase 54 — 점검 (Supabase 성능 진단: 인덱스 없는 외래 키 5개)
-- 가리키는 행을 지우거나 고칠 때(on delete / 조인) 표 전체를 훑지 않게. 학교 인원 규모에선 당장 느리진 않지만 편지 · 댓글이 쌓일수록 차이가 난다.
-- ════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════
-- Phase 55 — 실시간 전달을 "표 변경 구독(postgres_changes)"에서 "DB 방송(Broadcast)"으로
--
-- 왜: 실DB 통계(pg_stat_statements, 9/20~9/29)에서 DB 가 가장 오래 쓴 일은 앱의 어떤 요청도 아니라
--     Realtime 이 표 변경 기록(WAL)을 끊임없이 훑는 일이었다 (16만 번 · 약 930초 — 앱 요청 전부를 합친 것보다 많다).
--     postgres_changes 는 변경 한 건마다 구독자마다 RLS 를 다시 돌리고, 채널을 붙일 때마다 발행 목록을 조회한다.
--     전달 보장도 없어(유실 · 구독 직후 몇 초 늦음) 앱은 이미 재연결 · 안전망으로 메우고 있었다.
-- 어떻게: 바뀐 행을 트리거가 필요한 채널에 직접 방송한다(realtime.send). 채널은 비공개(private)라
--     참여할 때 한 번만 아래 정책(rt_allowed)으로 권한을 본다 — 방송마다 RLS 를 돌리지 않는다. WAL 을 훑지 않는다.
--   · room:<방 id>   — 그 방 사람만. 메시지(msg) · 방 상태(room) · 연장 투표(vote) · 공감(reaction) · 입력 중(typing, 앱이 보냄) · 접속(presence)
--   · inbox:<내 id>  — 나만. 대화 목록이 다시 읽을 때(changed): 내 방의 새 메시지 · 방 상태 · 새로 잡힌 대화.
--                      (채널 이름에 내 id 가 있지만 이름은 나와 서버만 안다 — 페이로드엔 방 id 뿐)
--   · signups        — 로그인한 학생 누구나(읽기만). 익명편지 잠금의 가입 인원(students).
-- ★ 익명성: 페이로드는 예전 postgres_changes 가 보내던 열에서 앱이 쓰는 것만. 사용자 id 는 어디에도 없다.
-- ★ 방송이 실패해도 원래 쓰기(메시지 저장 등)는 그대로 된다 — 앱은 전처럼 재연결 · 안전망으로 메운다.
-- ════════════════════════════════════════════════════════════════════

-- 방송 한 건 — realtime 이 없는 곳(PGlite 등)에선 건너뛴다
create or replace function private.rt_send(p_topic text, p_event text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then return; end if;
  perform realtime.send(p_payload, p_event, p_topic, true);
exception when others then
  raise warning 'rt_send % %: %', p_topic, p_event, sqlerrm;
end
$fn$;

-- 이 방 사람들의 대화 목록에 "다시 읽어"
create or replace function private.rt_inbox(p_room uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare u uuid;
begin
  for u in select user_id from public.room_members where room_id = p_room loop
    perform private.rt_send('inbox:' || u, 'changed', jsonb_build_object('room_id', p_room));
  end loop;
end
$fn$;

-- 표마다 바뀐 행 → 방송 (트리거 하나로)
create or replace function private.rt_broadcast()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  case tg_table_name
  when 'messages' then
    perform private.rt_send('room:' || new.room_id, 'msg', jsonb_build_object(
      'id', new.id, 'room_id', new.room_id, 'sender_seat', new.sender_seat, 'body', new.body,
      'client_msg_id', new.client_msg_id, 'created_at', new.created_at, 'reply_to', new.reply_to, 'deleted_at', new.deleted_at));
    if tg_op = 'INSERT' then perform private.rt_inbox(new.room_id); end if;
  when 'rooms' then
    perform private.rt_send('room:' || new.id, 'room', jsonb_build_object(
      'id', new.id, 'status', new.status, 'round', new.round, 'expires_at', new.expires_at, 'close_reason', new.close_reason,
      'alias1', new.alias1, 'alias2', new.alias2, 'read1', new.read1, 'read2', new.read2,
      'paused_left', new.paused_left, 'pinned', new.pinned));
    -- 목록에 보이는 것이 바뀔 때만 (읽음 표시는 대화 화면의 "읽음"만 바꾼다)
    if (new.status, new.round, new.expires_at, new.paused_left, new.pinned)
       is distinct from (old.status, old.round, old.expires_at, old.paused_left, old.pinned) then
      perform private.rt_inbox(new.id);
    end if;
  when 'room_members' then
    perform private.rt_send('inbox:' || new.user_id, 'changed', jsonb_build_object('room_id', new.room_id));
  when 'extension_votes' then
    perform private.rt_send('room:' || new.room_id, 'vote', jsonb_build_object(
      'room_id', new.room_id, 'round', new.round, 'seat', new.seat, 'agree', new.agree));
  when 'message_reactions' then
    perform private.rt_send('room:' || new.room_id, 'reaction', jsonb_build_object(
      'message_id', new.message_id, 'room_id', new.room_id, 'seat', new.seat, 'emoji', new.emoji));
  when 'signup_stats' then
    perform private.rt_send('signups', 'students', jsonb_build_object('students', new.students));
  end case;
  return null;
end
$fn$;

drop trigger if exists messages_rt on public.messages;
create trigger messages_rt after insert or update of body, deleted_at on public.messages
  for each row execute function private.rt_broadcast();
drop trigger if exists rooms_rt on public.rooms;
create trigger rooms_rt after update on public.rooms
  for each row
  when ((old.status, old.round, old.expires_at, old.close_reason, old.read1, old.read2, old.paused_left, old.pinned)
        is distinct from (new.status, new.round, new.expires_at, new.close_reason, new.read1, new.read2, new.paused_left, new.pinned))
  execute function private.rt_broadcast();
drop trigger if exists room_members_rt on public.room_members;
create trigger room_members_rt after insert on public.room_members
  for each row execute function private.rt_broadcast();
drop trigger if exists extension_votes_rt on public.extension_votes;
create trigger extension_votes_rt after insert or update on public.extension_votes
  for each row execute function private.rt_broadcast();
drop trigger if exists message_reactions_rt on public.message_reactions;
create trigger message_reactions_rt after insert or update on public.message_reactions
  for each row execute function private.rt_broadcast();
drop trigger if exists signup_stats_rt on public.signup_stats;
create trigger signup_stats_rt after update on public.signup_stats
  for each row when (old.students is distinct from new.students)
  execute function private.rt_broadcast();

revoke all on function private.rt_send(text, text, jsonb), private.rt_inbox(uuid), private.rt_broadcast()
  from public, anon, authenticated;

-- 이 채널을 들을(p_write = false) · 이 채널에 보낼(true — 입력 중 표시 · 접속 표시) 수 있나.
-- 비공개 채널에 참여할 때 Realtime 이 아래 정책으로 한 번 묻는다. (정책 식은 학생 권한으로 돌므로 public 에 둔다 —
-- 불러 봐야 "내가 이 방 사람인가"만 알 수 있다)
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
revoke all on function public.rt_allowed(text, boolean) from public, anon;
grant execute on function public.rt_allowed(text, boolean) to authenticated;

do $do$
begin
  if to_regclass('realtime.messages') is null then return; end if;
  drop policy if exists "cnsa: listen" on realtime.messages;
  create policy "cnsa: listen" on realtime.messages for select to authenticated
    using (public.rt_allowed((select realtime.topic()), false));
  drop policy if exists "cnsa: send" on realtime.messages;
  create policy "cnsa: send" on realtime.messages for insert to authenticated
    with check (public.rt_allowed((select realtime.topic()), true));
end
$do$;

-- 표 변경 발행을 거둔다 — 구독할 앱이 없으면 Realtime 이 WAL 을 훑을 일도 없다.
-- (실DB 에서는 새 앱이 배포된 뒤에 — 옛 앱이 떠 있는 동안에는 재연결 · 안전망으로만 받게 된다)
do $do$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then return; end if;
  foreach t in array array['messages', 'rooms', 'room_members', 'extension_votes', 'message_reactions', 'signup_stats'] loop
    if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
-- Phase 69 — 편지 지우기 (나에게서만)
-- 보관함 · 폴더에서 편지를 여러 통 선택해 지운다. 내 편지함에서만 사라지고 상대의 편지는 그대로다.
-- 편지 줄기도 그대로 — 버리기 · 차단과 달리 상대는 계속 답장할 수 있고, 새로 온 편지는 다시 보인다.
-- 받은 편지는 봉투를 열어 본 것만 (폴더 넣기와 같은 규칙 — 안 연 편지가 새 편지 더미 · 안 읽은 수에서 몰래 사라지지 않게).
-- 지운 편지는 폴더에서도 빠진다. 편지함 · 폴더 수 · 폴더 넣기는 dm_box_of 가, 열기는 dm_open 이 지운 편지를 없는 것으로 본다
-- (두 함수는 제자리에서 고침). 되돌리기는 없다.
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.dm_hidden_msgs (
  owner_id  uuid not null references public.profiles(id) on delete cascade,
  msg_id    bigint not null references private.dm_msgs(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (owner_id, msg_id)
);
create index if not exists dm_hidden_msgs_msg on private.dm_hidden_msgs (msg_id);
alter table private.dm_hidden_msgs enable row level security;

-- 편지 여러 통 지우기 — 내가 볼 수 있는 편지만(받은 편지는 열어 본 것만). moved = 지운 수
create or replace function public.dm_letter_delete(p_msgs bigint[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_msgs is null or cardinality(p_msgs) = 0 or cardinality(p_msgs) > 200 then return jsonb_build_object('status', 'bad_request'); end if;
  insert into private.dm_hidden_msgs (owner_id, msg_id)
  select me, m.id
    from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
   where m.id = any(p_msgs) and m.is_letter and t.status <> 'removed'
     and case private.dm_box_of(m, t, me) when 'sent' then true when 'received' then m.opened_at is not null else false end
  on conflict (owner_id, msg_id) do nothing;
  get diagnostics n = row_count;
  delete from private.dm_folder_items fi
   where fi.owner_id = me and fi.msg_id = any(p_msgs)
     and exists (select 1 from private.dm_hidden_msgs h where h.owner_id = me and h.msg_id = fi.msg_id);
  return jsonb_build_object('status', 'ok', 'moved', n);
end
$fn$;
revoke all on function public.dm_letter_delete(bigint[]) from public, anon;
grant execute on function public.dm_letter_delete(bigint[]) to authenticated;


-- ════════════════════════════════════════════════════════════════════
-- Phase 70 — CNSA 뱃지 (학교 동아리 · 행사)
-- 새 업적 분류 cnsa — 실제 에나멜 핀을 그대로 그린 뱃지 (화면: src/lib/ui/pins). 운영진이 주고 거둔다 (granted, Phase 44 와 같은 길).
-- 첫 번째는 연극 동아리 극작소. 새 뱃지는 여기에 한 줄 + 그림 컴포넌트 하나.
-- ════════════════════════════════════════════════════════════════════
alter table private.achievement_defs drop constraint if exists achievement_defs_category_check;
alter table private.achievement_defs add constraint achievement_defs_category_check
  check (category in ('chat', 'manner', 'letter', 'special', 'cnsa'));

insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted) values
  ('club_geukjakso', '극작소', '연극 동아리 극작소 부원', '🎬', 'cnsa', 'club_geukjakso', '', 1, 1, 1, false, 60, true)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort, granted = excluded.granted;


-- ════════════════════════════════════════════════════════════════════
-- Phase 71 — CNSA 뱃지 셋 더 · 운영자 뱃지 화면 (뱃지마다 여러 학생에게 한 번에 주고 거두기)
--   · CNSA 뱃지(충남삼성고 학생) · MSMP 우수 금뱃지 · 동아리 Beatus — 실제 핀 그림은 src/lib/ui/pins
--   · 지금까지는 학생 한 명씩 상세 화면에 들어가 주고 거뒀다. 운영자 화면 "뱃지"에서 뱃지를 고르고
--     찾은 학생 여럿 · 학번 목록(관리자) · 학교 인증한 학생 모두에게 한 번에 주고, 가진 사람 여럿을 한 번에 거둔다.
--     바뀐 학생마다 grant_badge / revoke_badge 기록 (detail.bulk)
-- ════════════════════════════════════════════════════════════════════
insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted) values
  ('cnsa_student', 'CNSA 뱃지',          '충남삼성고 학생임을 증명하는 뱃지', '🏫', 'cnsa', 'cnsa_student', '', 1, 1, 1, false, 55, true),
  ('msmp_gold',   'MSMP 우수 금뱃지',  'MSMP 우수자에게 수여하는 뱃지',     '🥇', 'cnsa', 'msmp_gold',   '', 1, 1, 1, false, 56, true),
  ('club_beatus',  'Beatus', 'IT 동아리 Beatus의 뱃지',           '💻', 'cnsa', 'club_beatus',  '', 1, 1, 1, false, 58, true)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort, granted = excluded.granted;

-- 여러 명에게 주기(p_on) · 거두기 — 권한은 부르는 쪽이 본다. 이미 가진 사람에게 주거나 없는 사람에게서 거두면 건너뛴다.
-- 거두면 대표 업적에서도 뺀다. 바뀐 사람마다 기록하고 바뀐 수를 돌려준다
create or replace function private.badge_apply(p_staff uuid, p_code text, p_users uuid[], p_on boolean)
returns int language plpgsql security definer set search_path = public, private as $fn$
declare n int;
begin
  if not exists (select 1 from private.achievement_defs where code = p_code and granted) then raise exception 'not_grantable'; end if;
  if p_on then
    with ins as (
      insert into private.user_achievements (user_id, code, tier)
      select p.id, p_code, 3 from public.profiles p where p.id = any(p_users)
      on conflict (user_id, code) do nothing
      returning user_id)
    insert into private.audit_log (staff_id, action, target_user, detail)
    select p_staff, 'grant_badge', user_id, jsonb_build_object('code', p_code, 'bulk', true) from ins;
  else
    with del as (
      delete from private.user_achievements where code = p_code and user_id = any(p_users)
      returning user_id),
    unfeature as (
      update public.profiles set featured_badges = array_remove(featured_badges, p_code)
       where id in (select user_id from del) and p_code = any(featured_badges))
    insert into private.audit_log (staff_id, action, target_user, detail)
    select p_staff, 'revoke_badge', user_id, jsonb_build_object('code', p_code, 'bulk', true) from del;
  end if;
  get diagnostics n = row_count;
  return n;
end
$fn$;
revoke all on function private.badge_apply(uuid, text, uuid[], boolean) from public, anon, authenticated;

-- 운영자: 줄 수 있는 뱃지 (분류 · 가진 사람 수)
create or replace function public.admin_badges(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare v_role text;
begin
  v_role := private.require_perm(p_staff, 'any');
  if not (private.staff_can(v_role, 'moderate') or private.staff_can(v_role, 'identity')) then
    raise exception 'no_permission';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', d.code, 'title', d.title, 'description', d.description, 'icon', d.icon,
                                        'category', d.category,
                                        'holders', (select count(*) from private.user_achievements a where a.code = d.code))
                     order by d.sort)
      from private.achievement_defs d
     where d.granted), '[]'::jsonb);
end
$fn$;

-- 운영자: 한 뱃지를 가진 학생 (최근에 받은 순, 1000명까지)
create or replace function public.admin_badge_holders(p_staff uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_staff(p_staff);
  if not exists (select 1 from private.achievement_defs where code = p_code and granted) then raise exception 'not_grantable'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'nickname', p.nickname, 'status', p.status, 'earned_at', a.earned_at)
                     order by a.earned_at desc, p.id)
      from (select user_id, earned_at from private.user_achievements where code = p_code
             order by earned_at desc limit 1000) a
      join public.profiles p on p.id = a.user_id), '[]'::jsonb);
end
$fn$;

-- 운영자: 고른 학생 여럿에게 한 번에 주기 · 거두기 (한 번에 500명까지)
create or replace function public.admin_set_badge_many(p_staff uuid, p_code text, p_users uuid[], p_on boolean)
returns int language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  if coalesce(cardinality(p_users), 0) > 500 then raise exception 'too_many'; end if;
  return private.badge_apply(p_staff, p_code, coalesce(p_users, '{}'), p_on);
end
$fn$;

-- 운영자: 학번 목록으로 주기 — 학번은 학생 신원이라 관리자(identity)만, 열람 기록을 남긴다.
-- 학교 이메일 앞자리가 학번. 가입한 학생에게만 주고, 못 찾은 학번(아직 가입 안 함 · 잘못 적음)을 돌려준다
create or replace function public.admin_grant_badge_by_no(p_staff uuid, p_code text, p_nos int[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  v_users uuid[];
  v_found int[];
  n int;
begin
  perform private.require_staff(p_staff, true);
  if coalesce(cardinality(p_nos), 0) = 0 then raise exception 'bad_nos'; end if;
  if cardinality(p_nos) > 500 then raise exception 'too_many'; end if;
  if not exists (select 1 from private.achievement_defs where code = p_code and granted) then raise exception 'not_grantable'; end if;
  select coalesce(array_agg(x.id), '{}'), coalesce(array_agg(x.no), '{}') into v_users, v_found
    from (select p.id, private.email_student_no(u.email)::int as no
            from auth.users u join public.profiles p on p.id = u.id
           where private.email_student_no(u.email)::int = any(p_nos)) x;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'view_identity', jsonb_build_object('nos', p_nos, 'via', 'badge', 'code', p_code));
  n := private.badge_apply(p_staff, p_code, v_users, true);
  return jsonb_build_object('given', n, 'found', cardinality(v_users),
    'missing', (select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) from unnest(p_nos) x where not x = any(v_found)));
end
$fn$;

-- 운영자: 학교 인증 · 시작하기를 마친 학생 모두에게 (CNSA 뱃지처럼 누구나 받는 것)
create or replace function public.admin_grant_badge_all(p_staff uuid, p_code text)
returns int language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  return private.badge_apply(p_staff, p_code,
    (select coalesce(array_agg(id), '{}') from public.profiles where verified and onboarded), true);
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['admin_badges(uuid)', 'admin_badge_holders(uuid, text)', 'admin_set_badge_many(uuid, text, uuid[], boolean)',
                           'admin_grant_badge_by_no(uuid, text, int[])', 'admin_grant_badge_all(uuid, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
-- Phase 78 — 새 편지 한도: 하루 3통 → 하루 50통
--   새 편지(새 편지 줄기)는 토큰 버킷(letter_bucket_take 'letter') — 한 번에 50통까지 · 하루에 50통 분량이 다시 찬다.
--   한쪽이 답 없이 3통까지(wait_reply) · 받는 사람이 끝내면 다시 못 보냄 같은 괴롭힘 막기는 그대로.
--   새로 가입한 학생도 처음부터 50통. (지금 학생들의 토큰은 실DB 반영 때 한 번 50으로 채웠다 — 여기서는 다시 채우지 않는다)
-- ════════════════════════════════════════════════════════════════════
alter table public.app_settings alter column letter_burst set default 50;
alter table public.app_settings alter column letter_refill_per_sec set default 0.000578704; -- 하루에 50통 분량 (50 / 86400)
update public.app_settings set letter_burst = 50, letter_refill_per_sec = 0.000578704 where id and letter_burst = 3;
alter table public.user_presence alter column letter_tokens set default 50;


-- ════════════════════════════════════════════════════════════════════
-- Phase 84 — CNSA 뱃지 안내 · 뱃지 제출 · 어디에 보일지 · 대표 뱃지 5칸 · 편지 추천
--   · 기본 CNSA 뱃지(cnsa_student)는 Landy 금 뱃지를 처음 따면 저절로 (award_stat). 지금 금 뱃지가 있는 학생은 여기서 한 번 채운다.
--   · 대표 뱃지 칸: Landy 금 뱃지(운영진이 주는 것 · CNSA 빼고) 5개를 모으면 3칸 → 5칸 (badge_slots).
--   · 랜덤채팅에서 뱃지별로 숨기기(profiles.badge_chat — {코드: 보이기}). 정하지 않았으면 CNSA 뱃지는 숨김(나를 짐작하게 할 수 있다) · 나머지는 보임.
--   · 편지 찾기에 나오는 내 뱃지 순서 — 내 순서(mine) / 무작위(random) (profiles.letter_badge_order).
--   · 편지 쓰기 찾기 화면 아래 추천 5명 (dm_recommend) — 추천에 나오기 싫으면 profiles.letters_recommend 를 끈다 (기본 켜짐).
--   · 뱃지 제출 (private.badge_requests): 있는 CNSA 뱃지 인증(proof) · 동아리 기장이 부원까지 한 번에(club) · 앱에 없는 뱃지 추가 요청(new).
--     사진(뱃지 + 학번 · 이름)은 Storage 비공개 버킷 badge-proofs/{학생 id}/ 에 학생이 올리고, 학번 · 이름이 보이니 관리자(identity)만 본다.
--     결정하면 사진 경로를 지우고(파일은 운영 서버가 지운다) 결과를 개인 공지로 알린다. 기다리는 요청 3개 · 하루 5개까지.
--   · 인스타그램 제출 계정(app_settings.badge_instagram) — 비어 있으면 화면에 "준비 중".
--   (my_achievements · set_featured_badges · partner_profile · dm_search · award_stat 는 제자리에서 고쳤다)
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists badge_chat         jsonb   not null default '{}'::jsonb;
alter table public.profiles add column if not exists letter_badge_order text    not null default 'mine';
alter table public.profiles add column if not exists letters_recommend  boolean not null default true;
do $do$
begin
  alter table public.profiles add constraint profiles_badge_chat_obj check (jsonb_typeof(badge_chat) = 'object' and pg_column_size(badge_chat) < 4000);
exception when duplicate_object then null;
end
$do$;
do $do$
begin
  alter table public.profiles add constraint profiles_letter_badge_order check (letter_badge_order in ('mine', 'random'));
exception when duplicate_object then null;
end
$do$;
-- 학생이 직접 바꾸는 두 가지 (뱃지별 숨기기는 가진 뱃지만 — set_badge_chat 로)
grant update (letter_badge_order, letters_recommend) on public.profiles to authenticated;

alter table public.app_settings add column if not exists badge_instagram text check (badge_instagram is null or badge_instagram ~ '^[A-Za-z0-9._]{1,30}$');

-- Landy 금 뱃지 수 — 기준을 채워 딴 것만 (운영진이 주는 특별 · CNSA 뱃지는 빼고)
create or replace function private.badge_golds(p_user uuid)
returns int language sql stable security definer set search_path = '' as $fn$
  select count(*)::int
    from private.user_achievements a
    join private.achievement_defs d on d.code = a.code
   where a.user_id = p_user and a.tier = 3 and not d.granted and d.category <> 'cnsa';
$fn$;

-- 대표 뱃지 칸 — 금 뱃지 5개부터 5칸
create or replace function private.badge_slots(p_user uuid)
returns int language sql stable security definer set search_path = '' as $fn$
  select case when private.badge_golds(p_user) >= 5 then 5 else 3 end;
$fn$;

-- 랜덤채팅에 보이는 뱃지인가 — 정하지 않았으면 CNSA 뱃지는 숨김
create or replace function private.badge_chat_visible(p_pref jsonb, p_code text, p_category text)
returns boolean language sql immutable set search_path = '' as $fn$
  select coalesce((p_pref->>p_code)::boolean, p_category <> 'cnsa');
$fn$;

-- 대표 뱃지 (칸 수만큼) — 고른 순서대로, 남는 칸은 높은 등급 · 최근 순으로 채운다.
--   own    내 화면 (전부)
--   chat   랜덤채팅 상대에게 — 숨긴 뱃지는 빼고 다음 것으로 채운다
--   letter 편지 찾기 · 추천 — 순서를 무작위로 해 두었으면 섞는다
create or replace function private.featured_for(p_user uuid, p_ctx text default 'own')
returns jsonb language sql volatile security definer set search_path = public, private as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'title', x.title, 'icon', x.icon, 'tier', x.tier)
                            order by case when x.shuffle then random() else x.o end), '[]'::jsonb)
  from (
    select d.code, d.title, d.icon, a.tier,
           (p_ctx = 'letter' and p.letter_badge_order = 'random') as shuffle,
           row_number() over (order by coalesce(array_position(p.featured_badges, d.code), 99), a.tier desc, a.earned_at desc)::float8 as o
      from private.user_achievements a
      join private.achievement_defs d on d.code = a.code
      join public.profiles p on p.id = a.user_id
     where a.user_id = p_user
       and (p_ctx <> 'chat' or private.badge_chat_visible(p.badge_chat, d.code, d.category))
     order by o
     limit private.badge_slots(p_user)
  ) x;
$fn$;
drop function if exists private.featured(uuid);   -- featured_for 로 바뀜

-- 랜덤채팅에서 이 뱃지 보이기 · 숨기기 — 가진 뱃지만
create or replace function public.set_badge_chat(p_code text, p_show boolean)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if p_show is null or not exists (select 1 from private.user_achievements where user_id = me and code = p_code) then
    return jsonb_build_object('status', 'not_owned');
  end if;
  update public.profiles set badge_chat = badge_chat || jsonb_build_object(p_code, p_show) where id = me;
  return jsonb_build_object('status', 'ok');
end
$fn$;

-- 지금 Landy 금 뱃지가 있는 학생에게 기본 CNSA 뱃지 (앞으로는 award_stat 이 처음 금을 딸 때 준다)
insert into private.user_achievements (user_id, code, tier)
select distinct a.user_id, 'cnsa_student', 3::smallint
  from private.user_achievements a
  join private.achievement_defs d on d.code = a.code
 where a.tier = 3 and not d.granted and d.category <> 'cnsa'
   and exists (select 1 from private.achievement_defs where code = 'cnsa_student')
on conflict (user_id, code) do nothing;

-- ── 편지 추천 — 찾기 화면 아래 5명 (무작위). 추천을 끈 사람 · 받기를 끈 사람 · 차단한 사이 · 이용 제한 · 나 ·
--    이미 내가 편지를 보내고 있는 사람 · 나에게서 편지를 끝낸 사람은 빼고 ──
create or replace function public.dm_recommend()
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if private.letters_locked() then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'grade', x.grade, 'no', x.no, 'checked', x.source = 'roster',
                                        'badges', private.featured_for(x.id, 'letter')))
      from (select p.id, n.name, n.grade, n.source,
                   (select private.email_student_no(u.email) from auth.users u where u.id = p.id) as no
              from public.profiles p
              cross join lateral private.person(p.id) n
             where p.id <> me and p.letters_open and p.letters_recommend and p.onboarded
               and n.name is not null
               -- 한 번 내가 보낸 대상은 종료/차단과 무관하게 계속 제외해 결과 변화로 신원을 찾지 못하게 한다.
               and not exists (select 1 from private.dm_threads t
                                where t.sender_id = me and t.recipient_id = p.id)
             order by random()
             limit 5) x), '[]'::jsonb);
end
$fn$;

-- ── 뱃지 제출 ──
create table if not exists private.badge_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('proof', 'club', 'new')),
  code        text references private.achievement_defs(code) on delete set null,   -- 앱에 있는 뱃지
  title       text check (char_length(btrim(title)) between 2 and 40),              -- 앱에 없는 뱃지 · 동아리 이름
  note        text not null default '' check (char_length(note) <= 500),
  member_nos  int[] not null default '{}' check (cardinality(member_nos) <= 200),   -- 동아리 기장이 함께 올린 부원 학번
  photos      text[] not null default '{}' check (cardinality(photos) <= 3),        -- Storage badge-proofs 경로 (결정하면 비운다)
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled')),
  staff_note  text check (char_length(staff_note) <= 500),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid
);
create index if not exists badge_requests_user on private.badge_requests (user_id, id desc);
create index if not exists badge_requests_open on private.badge_requests (id) where status = 'pending';
alter table private.badge_requests enable row level security;
revoke all on private.badge_requests from public, anon, authenticated;

-- 학생: 제출 → ok | bad_input | not_club(동아리 뱃지는 기장 제출로) | already(이미 가진 뱃지) | too_many(기다리는 요청 3개) | rate(하루 5개)
--   proof — 앱에 있는 CNSA 뱃지(동아리 · 기본 CNSA 뱃지 빼고) 인증. 사진 1~3장
--   club  — 동아리 기장: 앱에 있는 동아리 뱃지(code) 또는 새 동아리 이름(title) + 부원 학번(나는 빼도 함께 받는다). 사진 1~3장
--   new   — 앱에 없는 뱃지 추가 요청: 이름(title) · 설명(note). 사진 1~3장
create or replace function public.badge_request_submit(p_kind text, p_code text, p_title text, p_note text, p_nos int[], p_photos text[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me uuid := auth.uid();
  d private.achievement_defs%rowtype;
  t text := nullif(btrim(coalesce(p_title, '')), '');
  n text := btrim(coalesce(p_note, ''));
  nos int[];
  v bigint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  if coalesce(p_kind, '') not in ('proof', 'club', 'new') or char_length(n) > 500
     or coalesce(cardinality(p_photos), 0) not between 1 and 3
     or exists (select 1 from unnest(p_photos) x where x !~ ('^' || me::text || '/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$')) then
    return jsonb_build_object('status', 'bad_input');
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into nos from unnest(coalesce(p_nos, '{}')) x where x is not null;
  if p_code is not null then
    select * into d from private.achievement_defs where code = p_code and granted and category = 'cnsa';
    if not found then return jsonb_build_object('status', 'bad_input'); end if;
  end if;
  if p_kind = 'proof' then
    if p_code is null or t is not null or cardinality(nos) > 0 or p_code = 'cnsa_student' then return jsonb_build_object('status', 'bad_input'); end if;
    if p_code like 'club\_%' then return jsonb_build_object('status', 'not_club'); end if;
    if exists (select 1 from private.user_achievements where user_id = me and code = p_code) then return jsonb_build_object('status', 'already'); end if;
  elsif p_kind = 'club' then
    if (p_code is null) = (t is null) or (p_code is not null and p_code not like 'club\_%')
       or cardinality(nos) > 200 or exists (select 1 from unnest(nos) x where x not between 1000 and 999999999) then
      return jsonb_build_object('status', 'bad_input');
    end if;
  else
    if p_code is not null or t is null or cardinality(nos) > 0 then return jsonb_build_object('status', 'bad_input'); end if;
  end if;
  if t is not null and char_length(t) not between 2 and 40 then return jsonb_build_object('status', 'bad_input'); end if;

  perform pg_advisory_xact_lock(hashtextextended('badge_request:' || me::text, 0));
  perform 1 from public.profiles where id = me and status = 'active'
    and not coalesce(suspended_until > now(), false) for share;
  if not found then return jsonb_build_object('status', 'restricted'); end if;
  if (select count(*) from private.badge_requests where user_id = me and status = 'pending') >= 3 then
    return jsonb_build_object('status', 'too_many');
  end if;
  if (select count(*) from private.badge_requests where user_id = me and created_at > now() - interval '1 day') >= 5 then
    return jsonb_build_object('status', 'rate');
  end if;
  -- 업로드된 실제 객체만 연결한다. 정리 작업이 이미 예약한 사진은 다시 사용하지 않는다.
  perform 1 from private.badge_photos where path = any(p_photos) order by path for update;
  if (select count(*) from private.badge_photos where path = any(p_photos) and user_id = me
        and deleted_at is null and lease is null and delete_after is not null) <> cardinality(p_photos)
     or exists (select 1 from unnest(p_photos) x where x is null) then
    return jsonb_build_object('status', 'bad_input');
  end if;
  insert into private.badge_requests (user_id, kind, code, title, note, member_nos, photos)
  values (me, p_kind, p_code, t, n, nos, p_photos) returning id into v;
  update private.badge_photos set delete_after = null where path = any(p_photos);
  return jsonb_build_object('status', 'ok', 'id', v);
end
$fn$;

-- 학생: 내가 보낸 요청 (최근 20개) — 사진 경로는 주지 않는다
create or replace function public.my_badge_requests()
returns jsonb language sql security definer set search_path = '' stable as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'code', r.code,
                                               'title', coalesce(r.title, (select d.title from private.achievement_defs d where d.code = r.code)),
                                               'members', cardinality(r.member_nos), 'status', r.status, 'staff_note', r.staff_note,
                                               'created_at', r.created_at, 'decided_at', r.decided_at) order by r.id desc), '[]'::jsonb)
    from (select * from private.badge_requests where user_id = (select auth.uid()) order by id desc limit 20) r;
$fn$;

-- 학생: 기다리는 요청 거두기 — 지울 사진 경로를 돌려준다 (학생이 자기 사진을 지운다)
create or replace function public.badge_request_cancel(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text[];
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select photos into v from private.badge_requests where id = p_id and user_id = me and status = 'pending' for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  update private.badge_requests set status = 'canceled', decided_at = now(), photos = '{}' where id = p_id;
  return jsonb_build_object('status', 'ok', 'photos', to_jsonb(v));
end
$fn$;

-- 운영진: 요청 목록 — 학번 · 이름 · 사진이 보이므로 관리자(identity)만, 열람을 기록한다
--   pending 이면 기다리는 것(오래된 순), 아니면 결정한 것(최근 순 50개)
create or replace function public.admin_badge_requests(p_staff uuid, p_pending boolean default true)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare v jsonb;
begin
  perform private.require_staff(p_staff, true);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'user_id', r.user_id, 'kind', r.kind, 'code', r.code, 'title', r.title,
           'badge', (select d.title from private.achievement_defs d where d.code = r.code),
           'note', r.note, 'member_nos', to_jsonb(r.member_nos), 'photos', to_jsonb(r.photos),
           'status', r.status, 'staff_note', r.staff_note, 'created_at', r.created_at, 'decided_at', r.decided_at,
           'name', n.name, 'grade', n.grade,
           'no', (select private.email_student_no(u.email) from auth.users u where u.id = r.user_id),
           'has', exists (select 1 from private.user_achievements a where a.user_id = r.user_id and a.code = r.code))
         order by case when p_pending then r.id end asc, r.id desc), '[]'::jsonb) into v
    from (select * from private.badge_requests
           where (status = 'pending') = p_pending and status <> 'canceled'
           order by case when p_pending then id end asc, id desc limit case when p_pending then 200 else 50 end) r
    left join lateral private.person(r.user_id) n on true;
  if jsonb_array_length(v) > 0 then
    insert into private.audit_log (staff_id, action, detail)
    values (p_staff, 'view_identity', jsonb_build_object('via', 'badge_requests', 'count', jsonb_array_length(v)));
  end if;
  return v;
end
$fn$;

-- 운영진: 결정 — 승인하면 뱃지를 준다 (proof: 그 학생 / club: 기장 + 부원 학번 — 동아리 뱃지 code 는 운영진이 고를 수 있다 /
--   new: 주지 않고 "추가할게요"). 결과는 학생에게 개인 공지로. 사진 경로는 비우고 돌려준다(운영 서버가 파일을 지운다). 기록에 남는다
create or replace function public.admin_badge_request_decide(p_staff uuid, p_id bigint, p_ok boolean, p_note text default '', p_code text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  q private.badge_requests%rowtype;
  v_code text;
  v_users uuid[];
  v_found int[];
  v_given int := 0;
  v_missing jsonb := '[]'::jsonb;
  v_title text;
  v_body text;
  v_notice bigint;
  a text := btrim(coalesce(p_note, ''));
begin
  perform private.require_staff(p_staff, true);
  if char_length(a) > 500 or p_ok is null then raise exception 'bad_input'; end if;
  select * into q from private.badge_requests where id = p_id for update;
  if not found then raise exception 'request_not_found'; end if;
  if q.status <> 'pending' then raise exception 'already_decided'; end if;

  if p_ok and q.kind in ('proof', 'club') then
    v_code := coalesce(p_code, q.code);
    if v_code is null or not exists (select 1 from private.achievement_defs where code = v_code and granted and category = 'cnsa') then
      raise exception 'need_code';
    end if;
    if q.kind = 'club' and v_code not like 'club\_%' then raise exception 'need_code'; end if;
    if q.kind = 'proof' then
      v_given := private.badge_apply(p_staff, v_code, array[q.user_id], true);
    else
      select coalesce(array_agg(x.id), '{}'), coalesce(array_agg(x.no), '{}') into v_users, v_found
        from (select p.id, private.email_student_no(u.email)::int as no
                from auth.users u join public.profiles p on p.id = u.id
               where private.email_student_no(u.email)::int = any(q.member_nos)) x;
      v_given := private.badge_apply(p_staff, v_code, array_append(v_users, q.user_id), true);
      v_missing := (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from unnest(q.member_nos) x where not x = any(v_found));
    end if;
  end if;

  update private.badge_requests
     set status = case when p_ok then 'approved' else 'rejected' end, staff_note = nullif(a, ''),
         code = coalesce(v_code, code), decided_at = now(), decided_by = p_staff, photos = '{}'
   where id = p_id;

  v_title := case when p_ok then '뱃지 요청을 승인했어요' else '뱃지 요청을 반려했어요' end;
  v_body := coalesce((select d.title from private.achievement_defs d where d.code = coalesce(v_code, q.code)), q.title, '뱃지')
            || case
                 when not p_ok then ' 요청을 이번에는 받지 못했어요.'
                 when q.kind = 'new' then ' — 앱에 추가할게요. 추가되면 다시 알려 드려요.'
                 when q.kind = 'club' then ' — 기장님과 부원들에게 달아 드렸어요.'
                 else ' — 교복에 달아 드렸어요.'
               end
            || case when a <> '' then E'\n\n' || a else '' end;
  insert into private.personal_notices (user_id, kind, title, body, created_by)
  values (q.user_id, 'message', v_title, v_body, p_staff) returning id into v_notice;

  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, case when p_ok then 'approve_badge_request' else 'reject_badge_request' end, q.user_id,
          jsonb_build_object('request', p_id, 'kind', q.kind, 'code', coalesce(v_code, q.code), 'given', v_given));
  return jsonb_build_object('status', case when p_ok then 'approved' else 'rejected' end, 'given', v_given, 'missing', v_missing,
                            'photos', to_jsonb(q.photos), 'notice', v_notice);
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['set_badge_chat(text, boolean)', 'dm_recommend()',
                           'badge_request_submit(text, text, text, text, int[], text[])', 'my_badge_requests()', 'badge_request_cancel(bigint)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['admin_badge_requests(uuid, boolean)', 'admin_badge_request_decide(uuid, bigint, boolean, text, text)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['badge_golds(uuid)', 'badge_slots(uuid)', 'badge_chat_visible(jsonb, text, text)', 'featured_for(uuid, text)']
  loop
    execute format('revoke all on function private.%s from public, anon, authenticated', f);
  end loop;
end
$do$;

-- 결정한 지 180일 뒤 요청 기록을 지운다 (사진은 결정할 때 이미 지웠다)
do $do$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'simbun-purge-badge-requests';
    perform cron.schedule('simbun-purge-badge-requests', '53 4 * * *',
      $q$delete from private.badge_requests where status <> 'pending' and decided_at < now() - interval '180 days'$q$);
  end if;
end
$do$;

-- 사진 버킷 (비공개) — 학생은 자기 폴더(badge-proofs/{학생 id}/)에만 올리고 지운다. 운영진은 운영 서버(service_role)의 서명 주소로만 본다.
-- 한 장 5MB · 사진 형식만. Storage 가 없는 곳(테스트용 DB 등)에서는 건너뛴다
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('badge-proofs', 'badge-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    execute 'drop policy if exists "badge-proofs: upload own" on storage.objects';
    execute $p$create policy "badge-proofs: upload own" on storage.objects for insert to authenticated
      with check (bucket_id = 'badge-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    -- 지우려면 읽기 권한도 있어야 한다 (Storage 규칙) — 자기 사진만
    execute 'drop policy if exists "badge-proofs: read own" on storage.objects';
    execute $p$create policy "badge-proofs: read own" on storage.objects for select to authenticated
      using (bucket_id = 'badge-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute 'drop policy if exists "badge-proofs: delete own" on storage.objects';
    execute $p$create policy "badge-proofs: delete own" on storage.objects for delete to authenticated
      using (bucket_id = 'badge-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end
$do$;


-- ════════════════════════════════════════════════════════════════════
--  Phase 85 — 옛 공개 편지 게시판(Phase 10~15) 걷어내기
--
--  학생 화면에서 내린 지 오래고(Phase 23) 학생 실행 권한도 거뒀다(Phase 34). 실DB 의 표는 전부 비어 있었다.
--  정의는 위에서 지웠고, 여기서는 이미 설치된 DB 에 남아 있는 것을 치운다 — 새 DB 에서는 아무 일도 하지 않는다.
--  남기는 것(이름 편지가 같이 쓴다): private.letter_reports · letter_report_evidence, letter_bucket_take,
--  letter_alias_candidate, blocked_between, letter_fmt_ok, admin_*_letter_report*.
-- ════════════════════════════════════════════════════════════════════
drop function if exists public.letter_feed(bigint, int), public.letter_detail(bigint), public.post_letter(text, jsonb),
  public.post_comment(bigint, bigint, text, uuid), public.delete_my_letter(bigint), public.delete_my_comment(bigint),
  public.request_letter_reply_task(), public.report_letter(bigint, bigint, text, text),
  public.block_letter_author(bigint, bigint), public.set_letter_like(bigint, boolean), public.letter_notify(bigint, uuid),
  public.admin_remove_letter_content(bigint, bigint, uuid, uuid), public.admin_letter_post(bigint, uuid),
  public.admin_user_letters(uuid, uuid), private.assign_letter_alias(bigint, uuid, boolean), private.letter_eligible(uuid),
  private.letter_author(bigint), private.letter_visible_to(bigint, uuid), private.letter_target_user(bigint, bigint),
  private.auto_report_letter(text, bigint, text, text);
drop table if exists private.letter_likes, private.letter_push_log, public.letter_reply_assignments,
  public.letter_reply_cooldown, public.letter_comments, public.letter_participants, public.letters;
delete from private.mod_queue where kind in ('letter', 'comment');
alter table public.app_settings
  drop column if exists letter_task_burst, drop column if exists letter_task_refill_sec,
  drop column if exists letter_reply_cooldown_days, drop column if exists letter_reply_deadline_hours,
  drop column if exists letter_feed_page_size;
alter table public.user_presence drop column if exists task_tokens, drop column if exists task_at;


-- ════════════════════════════════════════════════════════════════════
--  Phase 88 — 뱃지 코드 msmsp_gold → msmp_gold (이름이 MSMP 인데 코드에 s 가 하나 더 있었다)
--
--  정의는 Phase 71 의 insert 에서 새 코드로 만든다. 여기서는 이미 설치된 DB 에서 옛 코드를 가리키던 것을 옮긴다:
--  가진 학생 · 뱃지 요청 · 대표 업적 · 랜덤채팅 숨김 설정. 다 옮긴 뒤 옛 정의를 지운다. 새 DB 에서는 아무 일도 하지 않는다.
--  활동 기록(audit_log)의 옛 코드는 그때의 기록이라 고치지 않는다.
-- ════════════════════════════════════════════════════════════════════
update private.user_achievements set code = 'msmp_gold' where code = 'msmsp_gold';
update private.badge_requests set code = 'msmp_gold' where code = 'msmsp_gold';
update public.profiles set featured_badges = array_replace(featured_badges, 'msmsp_gold', 'msmp_gold') where 'msmsp_gold' = any(featured_badges);
update public.profiles set badge_chat = (badge_chat - 'msmsp_gold') || jsonb_build_object('msmp_gold', badge_chat -> 'msmsp_gold') where badge_chat ? 'msmsp_gold';
delete from private.achievement_defs where code = 'msmsp_gold';

-- Phase 89 — 사진 업로드 총량 · 삭제 재시도 (Storage API로 파일을 삭제한다; 메타데이터 직접 삭제 금지)
create table if not exists private.badge_photos (
  path text primary key,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  delete_after timestamptz default now() + interval '1 hour',
  lease uuid,
  lease_until timestamptz,
  deleted_at timestamptz
);
create index if not exists badge_photos_user on private.badge_photos (user_id, created_at);
create index if not exists badge_photos_cleanup on private.badge_photos (delete_after) where deleted_at is null;
alter table private.badge_photos enable row level security;
revoke all on private.badge_photos from public, anon, authenticated;

create or replace function private.badge_photo_insert()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare me uuid := auth.uid(); owner_id uuid;
begin
  if new.bucket_id <> 'badge-proofs' then return new; end if;
  -- 다른 사람 폴더는 기존 RLS가 거절한다.
  if me is not null and split_part(new.name, '/', 1) <> me::text then return new; end if;
  if new.name !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$' then
    raise exception 'badge_photo_bad_path';
  end if;
  owner_id := split_part(new.name, '/', 1)::uuid;
  perform pg_advisory_xact_lock(hashtextextended('badge_request:' || owner_id::text, 0));
  if me is not null then
    perform 1 from public.profiles where id = me and status = 'active'
      and not coalesce(suspended_until > now(), false) for share;
    if not found then raise exception 'badge_photo_restricted'; end if;
    -- 대기 신청 3개 × 3장 + 제출 중 3장. 삭제해도 하루 업로드 수는 되돌리지 않는다.
    if (select count(*) from private.badge_photos where user_id = me and deleted_at is null) >= 12 then
      raise exception 'badge_photo_storage_limit';
    end if;
    if (select count(*) from private.badge_photos where user_id = me and created_at > now() - interval '1 day') >= 15 then
      raise exception 'badge_photo_daily_limit';
    end if;
  end if;
  insert into private.badge_photos (path, user_id) values (new.name, owner_id);
  return new;
end
$fn$;

create or replace function private.badge_photo_deleted()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if old.bucket_id = 'badge-proofs' then
    update private.badge_photos set deleted_at = now(), lease = null, lease_until = null where path = old.name;
  end if;
  return old;
end
$fn$;

-- 신청 종료와 삭제 예약은 같은 DB 트랜잭션. 실패해도 경로를 잃지 않는다.
create or replace function private.badge_request_photo_cleanup()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  update private.badge_photos p set delete_after = now()
   where p.path = any(old.photos) and p.deleted_at is null
     and not exists (select 1 from private.badge_requests r where r.status = 'pending' and p.path = any(r.photos));
  return null;
end
$fn$;
drop trigger if exists badge_request_photo_cleanup on private.badge_requests;
create trigger badge_request_photo_cleanup after update of photos or delete on private.badge_requests
for each row execute function private.badge_request_photo_cleanup();

do $do$
begin
  if to_regclass('storage.objects') is not null then
    -- 기존 사진도 복구 가능한 원장에 올린다. 참조 없는 옛 사진은 1시간 뒤 정리한다.
    insert into private.badge_photos (path, user_id, delete_after)
    select o.name, split_part(o.name, '/', 1)::uuid,
           case when exists (select 1 from private.badge_requests r where r.status = 'pending' and o.name = any(r.photos))
                then null else now() + interval '1 hour' end
      from storage.objects o where o.bucket_id = 'badge-proofs'
       and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    on conflict (path) do nothing;
    execute 'drop trigger if exists badge_photo_insert on storage.objects';
    execute 'create trigger badge_photo_insert before insert on storage.objects for each row execute function private.badge_photo_insert()';
    execute 'drop trigger if exists badge_photo_deleted on storage.objects';
    execute 'create trigger badge_photo_deleted after delete on storage.objects for each row execute function private.badge_photo_deleted()';
  end if;
end
$do$;

-- 예약 작업 전용. 학생에게 경로 · 삭제 작업 권한을 주지 않는다.
create or replace function public.admin_badge_photo_claim()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare token uuid := gen_random_uuid(); result jsonb;
begin
  delete from private.badge_photos where deleted_at < now() - interval '30 days';
  with claimed as (
    update private.badge_photos p set lease = token, lease_until = now() + interval '5 minutes'
     where p.path in (
       select q.path from private.badge_photos q
        where q.deleted_at is null and q.delete_after <= now()
          and (q.lease_until is null or q.lease_until < now())
          and not exists (select 1 from private.badge_requests r where r.status = 'pending' and q.path = any(r.photos))
        order by q.delete_after, q.path limit 100 for update skip locked
     ) returning p.path, p.lease
  ) select coalesce(jsonb_agg(jsonb_build_object('path', path, 'lease', lease)), '[]'::jsonb) into result from claimed;
  return result;
end
$fn$;

create or replace function public.admin_badge_photo_complete(p_paths text[], p_lease uuid)
returns void language sql security definer set search_path = '' as $fn$
  update private.badge_photos set deleted_at = now(), lease = null, lease_until = null
   where path = any(p_paths) and lease = p_lease;
$fn$;

revoke all on function private.badge_photo_insert(), private.badge_photo_deleted(), private.badge_request_photo_cleanup() from public, anon, authenticated;
revoke all on function public.admin_badge_photo_claim(), public.admin_badge_photo_complete(text[], uuid) from public, anon, authenticated;
grant execute on function public.admin_badge_photo_claim(), public.admin_badge_photo_complete(text[], uuid) to service_role;


-- 2026-10-03 review upgrade — migration과 동등한 신규 설치 snapshot
-- PROJECT-REVIEW R10/R24/R25/R26/R27/R28/R29. 운영 반영 전 staging 검증.
begin;

drop trigger if exists signup_stats_insert_rt on public.signup_stats;
create trigger signup_stats_insert_rt after insert on public.signup_stats
  for each row execute function private.rt_broadcast();
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
  select * into r from private.ai_requests where chat_id=p_chat and request_id=p_request;
  if found then
    if r.input_hash <> encode(sha256(convert_to(p_text,'UTF8')),'hex') then return jsonb_build_object('status','bad_text'); end if;
    if r.state='succeeded' then
      if r.reply is null or r.completed_at < now()-interval '15 minutes' then return jsonb_build_object('status','expired'); end if;
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

commit;

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
-- 관리자 전용: 실제 Auth/Storage 삭제는 서버 API, 준비/결과는 복구 가능한 원장.
-- 사용자/문의 FK를 두지 않아 계정 cascade 뒤에도 실행 결과를 확인할 수 있다.
create table if not exists private.account_deletions (
  user_id uuid primary key,
  inquiry_id bigint not null,
  staff_id uuid not null,
  note text not null check (char_length(note) between 5 and 1000),
  status text not null check (status in ('processing','failed','deleted')),
  lease uuid,
  lease_until timestamptz,
  failure_stage text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists account_deletions_recent on private.account_deletions(updated_at desc);
alter table private.account_deletions enable row level security;
revoke all on private.account_deletions from public, anon, authenticated;

create or replace function private.account_delete_assets(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb := '[]'::jsonb;
begin
  if to_regclass('storage.objects') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name)), '[]'::jsonb)
      into result from storage.objects o
     where coalesce(nullif(to_jsonb(o)->>'owner_id',''),to_jsonb(o)->>'owner') = p_user::text
        or (o.bucket_id = 'badge-proofs' and split_part(o.name,'/',1) = p_user::text);
  end if;
  return result;
end
$fn$;
revoke all on function private.account_delete_assets(uuid) from public, anon, authenticated;

create or replace function public.admin_account_delete_prepare(p_staff uuid,p_id bigint,p_user uuid,p_confirm text,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare q private.inquiries%rowtype; job private.account_deletions%rowtype; token uuid := gen_random_uuid(); room uuid;
begin
  if private.require_perm(p_staff,'any') <> 'admin' then raise exception 'admin_only'; end if;
  if p_user = p_staff or exists(select 1 from private.staff where user_id=p_user) then raise exception 'staff_delete_forbidden'; end if;
  if p_id is null or p_user is null or p_confirm is distinct from ('삭제 ' || p_id::text)
    or char_length(btrim(coalesce(p_note,''))) not between 5 and 1000 then raise exception 'bad_delete_confirmation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_delete:' || p_user::text,0));
  select * into job from private.account_deletions where user_id=p_user for update;
  if found then
    if job.inquiry_id <> p_id then raise exception 'deletion_target_mismatch'; end if;
    if job.status='deleted' then raise exception 'already_deleted'; end if;
    if job.status='processing' and job.lease_until > now() then raise exception 'deletion_busy'; end if;
  else
    select * into q from private.inquiries where id=p_id for update;
    if not found then raise exception 'inquiry_not_found'; end if;
    if q.user_id <> p_user then raise exception 'deletion_target_mismatch'; end if;
    if q.kind <> 'account' or left(q.body,char_length('[계정 삭제 요청]' || chr(10))) <> '[계정 삭제 요청]' || chr(10)
      then raise exception 'not_deletion_request'; end if;
    if not exists(select 1 from public.profiles where id=p_user) then raise exception 'user_not_found'; end if;
  end if;
  insert into private.account_deletions(user_id,inquiry_id,staff_id,note,status,lease,lease_until)
    values(p_user,p_id,p_staff,btrim(p_note),'processing',token,now()+interval '10 minutes')
    on conflict(user_id) do update set staff_id=excluded.staff_id,note=excluded.note,status='processing',
      lease=token,lease_until=excluded.lease_until,failure_stage=null,updated_at=now();
  -- 신규 매칭·메시지·사진 업로드를 제한하고 기존 대화를 닫는다. 실패 시 제한 상태에서 재시도한다.
  update public.profiles set status='banned',suspended_until=null where id=p_user;
  update public.user_presence set online_until=now(),seeking_until=null,seeking_since=null where user_id=p_user;
  for room in select room_id from public.room_members where user_id=p_user and open loop
    perform public.close_room(room,'admin');
  end loop;
  insert into private.audit_log(staff_id,action,target_user,detail)
    values(p_staff,'account_delete_started',p_user,jsonb_build_object('inquiry',p_id,'note',btrim(p_note)));
  return jsonb_build_object('user_id',p_user,'lease',token,'auth_exists',exists(select 1 from auth.users where id=p_user),
    'assets',private.account_delete_assets(p_user));
end
$fn$;

create or replace function public.admin_account_delete_finish(p_staff uuid,p_user uuid,p_lease uuid,p_stage text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
declare job private.account_deletions%rowtype;
begin
  if private.require_perm(p_staff,'any') <> 'admin' then raise exception 'admin_only'; end if;
  select * into job from private.account_deletions where user_id=p_user for update;
  if not found or job.status <> 'processing' or job.lease is distinct from p_lease or job.staff_id <> p_staff then
    raise exception 'deletion_lease_invalid'; end if;
  if p_stage is not null then
    if p_stage not in ('auth_lock','storage','auth','record') then raise exception 'bad_delete_stage'; end if;
    update private.account_deletions set status='failed',failure_stage=p_stage,lease=null,lease_until=null,updated_at=now() where user_id=p_user;
    insert into private.audit_log(staff_id,action,target_user,detail)
      values(p_staff,'account_delete_failed',p_user,jsonb_build_object('inquiry',job.inquiry_id,'stage',p_stage));
    return;
  end if;
  if exists(select 1 from auth.users where id=p_user) or jsonb_array_length(private.account_delete_assets(p_user)) <> 0 then
    raise exception 'deletion_not_complete'; end if;
  update private.account_deletions set status='deleted',completed_at=now(),updated_at=now(),lease=null,lease_until=null where user_id=p_user;
  insert into private.audit_log(staff_id,action,target_user,detail)
    values(p_staff,'account_delete_complete',p_user,jsonb_build_object('inquiry',job.inquiry_id));
end
$fn$;

create or replace function public.admin_account_deletions(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $fn$
begin
  if private.require_perm(p_staff,'any') <> 'admin' then raise exception 'admin_only'; end if;
  return coalesce((select jsonb_agg(to_jsonb(d) - 'lease' order by updated_at desc)
    from (select * from private.account_deletions order by updated_at desc limit 50) d),'[]'::jsonb);
end
$fn$;
revoke all on function public.admin_account_delete_prepare(uuid,bigint,uuid,text,text),
  public.admin_account_delete_finish(uuid,uuid,uuid,text),public.admin_account_deletions(uuid) from public,anon,authenticated;
grant execute on function public.admin_account_delete_prepare(uuid,bigint,uuid,text,text),
  public.admin_account_delete_finish(uuid,uuid,uuid,text),public.admin_account_deletions(uuid) to service_role;

-- 뱃지 사진 한 장 (2026-10-04 리뷰 수정)
create or replace function public.admin_badge_request_photo(p_staff uuid, p_id bigint, p_index int)
returns text language plpgsql security definer set search_path = '' stable as $fn$
declare v text;
begin
  perform private.require_staff(p_staff, true);
  if p_id is null or p_index is null or p_index not between 0 and 2 then return null; end if;
  select r.photos[p_index + 1] into v from private.badge_requests r where r.id = p_id and r.status = 'pending';
  return v;
end
$fn$;
revoke all on function public.admin_badge_request_photo(uuid,bigint,int) from public,anon,authenticated;
grant execute on function public.admin_badge_request_photo(uuid,bigint,int) to service_role;
notify pgrst, 'reload schema';
