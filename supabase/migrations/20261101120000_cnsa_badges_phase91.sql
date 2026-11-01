-- ════════════════════════════════════════════════════════════════════
--  Phase 91 — CNSA 뱃지: MSMP 우수 은뱃지 · 자율위원 · 창의위원 · 도서부 코드 club_library → library
--
--  · 은뱃지(msmp_silver)는 금뱃지와 같은 핀에 색만 은 (MsmpSilver.svelte) · 자율위원(jayul) · 창의위원(changui)은
--    품격위원과 같은 판에 글자만 自律 · 創意 (Jayul · Changui.svelte). 모두 운영진이 준다 (granted).
--  · 도서부는 학생이 "내 뱃지 인증"으로 직접 보낸다 — 동아리(club_)가 아니게 코드를 library 로 바꾼다
--    (badge_request_submit 의 proof 는 club_ 을 not_club 으로 돌려보낸다). Phase 88 과 같이 가진 학생 · 뱃지 요청 ·
--    대표 업적 · 랜덤채팅 숨김 설정을 새 코드로 옮긴 뒤 옛 정의를 지운다. 활동 기록(audit_log)의 옛 코드는 그대로.
--  · 동아리 뱃지(club_)는 출시판 학생 화면에서 숨긴다 — 화면에서 거른다 (lib/achievements.ts noClubs), DB 는 그대로.
--  실DB 는 supabase/migrations/20261101120000_cnsa_badges_phase91.sql (이 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
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
