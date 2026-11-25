-- ════════════════════════════════════════════════════════════════════
--  Phase 107 — 연장은 네 번까지 공개 · "솔직한 대답" 업적 없애기
--
--  1) 공개 차례는 네 번(학년 · 남자/여자 · 디플로마 · 동아리, 각자 고르는 순서). 다섯 번째 차례는 연장 대신 고정 여부.
--     옛 앱(p_kind 없음)은 hint_kind 순서로 공개한다.
--  2) "속 깊은 대화"는 넷 다 공개한 대화 (round 5 가 되면).
--  3) 랜덤 질문이 없어져 "솔직한 대답"(공통 질문 답) 업적을 없앤다 — 딴 기록 · 대표 뱃지 · 랜덤채팅 표시에서도.
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
drop trigger if exists room_hints_stats on private.room_hints;
drop function if exists private.stats_on_hint();
update public.profiles set featured_badges = array_remove(featured_badges, 'question') where 'question' = any(featured_badges);
update public.profiles set badge_chat = badge_chat - 'question' where badge_chat ? 'question';
update private.user_stats set counts = counts - 'answers' where counts ? 'answers';
delete from private.achievement_defs where code = 'question';
update private.achievement_defs set description = '넷 다 공개한 대화' where code = 'deep';

create or replace function private.hint_kind(p_n int)
returns text language sql immutable set search_path = '' as $fn$
  select (array['grade', 'gender', 'diploma', 'club'])[p_n];
$fn$;

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
      if new.round >= 5 and old.round < 5 then perform private.bump(u, 'deep'); end if;   -- 넷 다 공개 (Phase 107)
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

notify pgrst, 'reload schema';
