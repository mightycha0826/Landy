-- ════════════════════════════════════════════════════════════════════
-- 2026-10-12 — CNSA 뱃지 셋 더 (Phase 90): 도서부 · 1500m 인증제 · 품격위원
-- 실제 핀 그림은 src/lib/ui/pins (Library · Ssc1500 · Pumgyeok). 운영진이 주고 거둔다 (granted).
-- 도서부는 동아리라 코드가 club_ — 학생 제출은 기장 제출로만 (submit_badge_request 의 not_club).
-- schema.sql 에서는 Phase 70 의 insert 에 세 줄을 더했다 — 여기에는 같은 세 줄. 여러 번 실행해도 같다.
-- ════════════════════════════════════════════════════════════════════
insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted) values
  ('club_library', '도서부',       '도서부 부원',                                '📚', 'cnsa', 'club_library', '', 1, 1, 1, false, 61, true),
  ('cert_1500m',   '1500m 인증제', '1500m 인증제를 통과한 학생에게 주는 뱃지',   '🏃', 'cnsa', 'cert_1500m',   '', 1, 1, 1, false, 62, true),
  ('pumgyeok',     '품격위원',     '품격위원으로 활동하는 학생에게 주는 뱃지',   '🎖️', 'cnsa', 'pumgyeok',     '', 1, 1, 1, false, 63, true)
on conflict (code) do update
  set title = excluded.title, description = excluded.description, icon = excluded.icon, category = excluded.category,
      stat = excluded.stat, unit = excluded.unit, bronze = excluded.bronze, silver = excluded.silver, gold = excluded.gold,
      lower_better = excluded.lower_better, sort = excluded.sort, granted = excluded.granted;
