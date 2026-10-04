-- 2026-10-02 보안 수정. 앱 배포 전에 SQL Editor에서 한 번 실행한다.

begin;

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
  if not cfg.ai_chat or not cfg.is_open then return jsonb_build_object('status', 'off'); end if;
  select * into p from public.profiles where id = me;
  if not found or p.status <> 'active' or coalesce(p.suspended_until > now(), false) then
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
  perform 1 from public.profiles where id = p_user and status = 'active'
    and not coalesce(suspended_until > now(), false) for share;
  if not found then return jsonb_build_object('status', 'restricted'); end if;
  select * into c from private.ai_chats where id = p_chat and user_id = p_user for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not cfg.ai_chat or not cfg.is_open then return jsonb_build_object('status', 'off'); end if;
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


commit;