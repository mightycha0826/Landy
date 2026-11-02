-- ════════════════════════════════════════════════════════════════════
--  Phase 91 — CNSA 뱃지: MSMP 우수 은뱃지 · 자율위원 · 창의위원 · 도서부 코드 club_library → library
--
--  · 은뱃지(msmp_silver)는 금뱃지와 같은 핀에 색만 은 (MsmpSilver.svelte) · 자율위원(jayul) · 창의위원(changui)은
--    품격위원과 같은 판에 글자만 自律 · 創意 (Jayul · Changui.svelte). 모두 운영진이 준다 (granted).
--  · 도서부는 학생이 "내 뱃지 인증"으로 직접 보낸다 — 동아리(club_)가 아니게 코드를 library 로 바꾼다
--    (badge_request_submit 의 proof 는 club_ 을 not_club 으로 돌려보낸다). Phase 88 과 같이 가진 학생 · 뱃지 요청 ·
--    대표 업적 · 랜덤채팅 숨김 설정을 새 코드로 옮긴 뒤 옛 정의를 지운다. 활동 기록(audit_log)의 옛 코드는 그대로.
--  · 동아리 뱃지(club_)는 관리자 설정 "동아리 뱃지 출시"(app_settings.club_badges, 처음엔 꺼짐)를 켜기 전까지 학생 화면에서 숨긴다
--    — 화면에서 거른다 (lib/achievements.ts noClubs), 뱃지 데이터는 그대로. 켜고 끄는 것은 admin_update_settings (아래에 다시 만든다).
--  실DB 는 supabase/migrations/20261101120000_cnsa_badges_phase91.sql (이 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
alter table public.app_settings add column if not exists club_badges boolean not null default false;

insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted) values
  ('msmp_silver', 'MSMP 우수 은뱃지', 'MSMP 우수자에게 수여하는 은뱃지',           '🥈', 'cnsa', 'msmp_silver', '', 1, 1, 1, false, 57, true),
  ('library',     '도서부',           '도서부 부원',                               '📚', 'cnsa', 'library',     '', 1, 1, 1, false, 61, true),
  ('jayul',       '자율위원',         '자율위원으로 활동하는 학생에게 주는 뱃지',  '🎖️', 'cnsa', 'jayul',       '', 1, 1, 1, false, 64, true),
  ('changui',     '창의위원',         '창의위원으로 활동하는 학생에게 주는 뱃지',  '🎖️', 'cnsa', 'changui',     '', 1, 1, 1, false, 65, true)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort, granted = excluded.granted;

update private.user_achievements set code = 'library' where code = 'club_library';
update private.badge_requests set code = 'library' where code = 'club_library';
update public.profiles set featured_badges = array_replace(featured_badges, 'club_library', 'library') where 'club_library' = any(featured_badges);
update public.profiles set badge_chat = (badge_chat - 'club_library') || jsonb_build_object('library', badge_chat -> 'club_library') where badge_chat ? 'club_library';
delete from private.achievement_defs where code = 'club_library';

-- 설정 바꾸기에 club_badges 를 더한다 (schema.sql 의 admin_update_settings 와 같다)
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
    maintenance_at        = case when p_patch ? 'maintenance_at' then nullif(p_patch->>'maintenance_at', '')::timestamptz else maintenance_at end,
    -- Phase 91 — 동아리 뱃지 출시 (컬럼은 Phase 91 에서 추가. 실행 시점엔 있다)
    club_badges           = coalesce((p_patch->>'club_badges')::boolean, club_badges)
  where id;
  insert into private.audit_log (staff_id, action, detail) values (p_staff, 'update_settings', p_patch);
  return public.admin_get_settings();
end
$fn$;


notify pgrst, 'reload schema';
