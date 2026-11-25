-- ════════════════════════════════════════════════════════════════════
-- 2026-11-25 — CNSA 뱃지: 영상 제작 동아리 CTN (Phase 104)
-- 실제 핀 그림은 src/lib/ui/pins/Ctn.svelte. 운영진이 주고 거둔다 (granted).
-- 동아리라 코드가 club_ — 학생 제출은 기장 제출로만 · "동아리 뱃지 출시"(app_settings.club_badges)를 켜기 전엔 학생 화면에서 숨김.
-- schema.sql 에서는 Phase 70 의 insert 에 한 줄을 더했다 — 여기에는 같은 한 줄. 여러 번 실행해도 같다.
-- ════════════════════════════════════════════════════════════════════
insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted) values
  ('club_ctn', 'CTN', '영상 제작 동아리 CTN 부원', '🎥', 'cnsa', 'club_ctn', '', 1, 1, 1, false, 59, true)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort, granted = excluded.granted;
