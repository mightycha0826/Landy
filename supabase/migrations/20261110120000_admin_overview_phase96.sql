-- ════════════════════════════════════════════════════════════════════
--  Phase 96 — 운영 콘솔 개요: 첫 화면에 할 일 · 지금 · 14일 추이 · 시스템 상태, 메뉴에 밀린 일 수
--
--  · admin_overview(staff) — 운영 콘솔 첫 화면(/admin) 한 번의 요청. 운영진이면 누구나 부르지만 칸마다 내 권한만큼만 채운다:
--      할 일(todo): 신고 = moderate · 문의 = inquiry · 뱃지 요청 = identity — 권한이 없으면 null
--      지금(live) · 누적(totals) · 추이의 가입 · 대화 · 편지: 운영진 누구나 (세는 수뿐, 누구인지는 없다)
--      추이의 신고 수: moderate · 시스템(AI 검토 · 푸시): settings
--    추이는 한국 날짜로 오늘까지 14일. 메시지 수는 없다 — 끝난 대화의 메시지는 24시간 뒤 지워져서 지난날을 셀 수 없다.
--    오늘 접속(active_today)은 접속 신호(user_presence.online_until)가 오늘 0시 뒤까지 닿은 학생 수.
--  · admin_staff_touch — 화면을 여는 요청(p_path 가 있을 때)에만 메뉴에 붙일 밀린 일 수(todo)를 같이 준다.
--    역할 확인과 같은 요청이라 요청이 늘지 않는다. 현황 새로고침(p_path = null)에는 세지 않는다.
--  실DB 는 이 파일을 SQL Editor 에서 실행한다 (schema.sql 의 같은 구역과 같다, 여러 번 실행해도 같다).
--  적용 전에도 운영 콘솔은 열린다 — 개요의 새 칸은 "DB 업데이트 뒤에 보여요", 메뉴의 수는 비어 있다.
-- ════════════════════════════════════════════════════════════════════

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
  -- todo = 메뉴에 붙일 밀린 일 수 (Phase 96) — 화면을 여는 요청에만, 내 권한으로 처리할 수 있는 것만
  return jsonb_build_object('role', v, 'owner', (select owner from private.staff where user_id = p_uid),
    'maintenance', private.in_maintenance(),
    'maintenance_at', (select maintenance_at from public.app_settings where id and maintenance_at > now()), -- 예약 (Phase 53)
    'perms', case when v = 'admin' then '["live","moderate","identity","settings","service","inquiry","notice","audit"]'::jsonb
                  else (select coalesce(jsonb_agg(r.perm order by r.perm), '[]'::jsonb) from private.role_perms r where r.role = v) end,
    'todo', case when p_path is not null then jsonb_build_object(
      'reports', case when private.staff_can(v, 'moderate') then
                   (select count(*) from private.reports where status = 'open')
                 + (select count(*) from private.letter_reports where status = 'open') end,
      'inquiries', case when private.staff_can(v, 'inquiry') then
                   (select count(*) from private.inquiries where answered_at is null) end,
      'badge_requests', case when private.staff_can(v, 'identity') then
                   (select count(*) from private.badge_requests where status = 'pending') end) end,
    'team', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.user_id, 'name', coalesce(s.display_name, p.nickname, '이름 없음'), 'role', s.role, 'owner', s.owner,
             'last_seen', s.last_seen, 'path', s.last_path, 'me', s.user_id = p_uid)
           order by s.last_seen desc nulls last), '[]'::jsonb)
      from private.staff s left join public.profiles p on p.id = s.user_id), 'now', now());
end
$fn$;
revoke all on function public.admin_staff_touch(uuid, text) from public, anon, authenticated;

create or replace function public.admin_overview(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare
  v_role text;
  -- 오늘 0시 (한국 시간) — 추이의 하루는 한국 날짜로 끊는다
  v_day0 timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  v_mod boolean; v_inq boolean; v_id boolean; v_set boolean;
begin
  select role into v_role from private.staff where user_id = p_staff;
  if v_role is null then raise exception 'not_staff'; end if;
  v_mod := private.staff_can(v_role, 'moderate');
  v_inq := private.staff_can(v_role, 'inquiry');
  v_id  := private.staff_can(v_role, 'identity');
  v_set := private.staff_can(v_role, 'settings');
  return jsonb_build_object(
    'now', now(),
    'todo', jsonb_build_object(
      'chat_reports',   case when v_mod then (select count(*) from private.reports where status = 'open') end,
      'letter_reports', case when v_mod then (select count(*) from private.letter_reports where status = 'open') end,
      'reviewing',      case when v_mod then (select count(*) from private.reports where status = 'reviewing')
                                           + (select count(*) from private.letter_reports where status = 'reviewing') end,
      'inquiries',      case when v_inq then (select count(*) from private.inquiries where answered_at is null) end,
      'badge_requests', case when v_id  then (select count(*) from private.badge_requests where status = 'pending') end),
    'live', jsonb_build_object(
      'online',       (select count(*) from public.user_presence where online_until > now()),
      'seeking',      (select count(*) from public.user_presence where seeking_until > now()),
      'active_rooms', (select count(*) from public.rooms where status <> 'closed' and now() < expires_at),
      'is_open',      (select is_open from public.app_settings where id),
      'maintenance',  private.in_maintenance()),
    'totals', jsonb_build_object(
      'students',     (select count(*) from public.profiles where verified and onboarded),
      'active_today', (select count(*) from public.user_presence where online_until >= v_day0),
      'restricted',   (select count(*) from public.profiles where status <> 'active' or suspended_until > now())),
    'days', (
      select jsonb_agg(jsonb_build_object(
               'd', to_char(d.day at time zone 'Asia/Seoul', 'YYYY-MM-DD'),
               'signups', (select count(*) from public.profiles p where p.created_at >= d.day and p.created_at < d.day + interval '1 day'),
               'rooms',   (select count(*) from public.rooms r where r.created_at >= d.day and r.created_at < d.day + interval '1 day'),
               'letters', (select count(*) from private.dm_msgs m where m.is_letter and m.created_at >= d.day and m.created_at < d.day + interval '1 day'),
               'reports', case when v_mod then
                            (select count(*) from private.reports x where x.created_at >= d.day and x.created_at < d.day + interval '1 day')
                          + (select count(*) from private.letter_reports x where x.created_at >= d.day and x.created_at < d.day + interval '1 day') end)
             order by d.day)
        from generate_series(v_day0 - interval '13 days', v_day0, interval '1 day') as d(day)),
    'system', case when v_set then jsonb_build_object(
      'mod_pending',       (select count(*) from private.mod_queue where status in ('pending', 'working')),
      'mod_errors_24h',    (select count(*) from private.mod_queue where status = 'error' and created_at > now() - interval '24 hours'),
      'mod_checked_today', (select coalesce(sum(tries), 0) from private.mod_queue where claimed_at >= private.ai_day_start()),
      'ai_chats_today',    (select count(*) from private.ai_chats where created_at >= private.ai_day_start()),
      'push_sent_24h',     (select coalesce(sum(sent), 0) from private.push_outbox where created_at > now() - interval '24 hours'),
      'push_failed_24h',   (select coalesce(sum(failed), 0) from private.push_outbox where created_at > now() - interval '24 hours'),
      'push_devices',      (select count(*) from public.push_subscriptions)) end);
end
$fn$;
revoke all on function public.admin_overview(uuid) from public, anon, authenticated;
grant execute on function public.admin_overview(uuid) to service_role;
notify pgrst, 'reload schema';
