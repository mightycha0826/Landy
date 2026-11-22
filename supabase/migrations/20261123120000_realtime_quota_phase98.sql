-- ════════════════════════════════════════════════════════════════════
--  Phase 98 — 화면이 바뀌지 않는 실시간 방송을 보내지 않는다 (Realtime 월 한도 · 메시지 저장 시간)
--
--  실DB 30분 기록: 메시지 851개에 방송 5,450건(메시지 하나에 6.4건). 절반이 대화 목록 신호, 읽음 방송의 44%는 아무것도 안 바꿨다.
--  · 읽음 위치는 상대 메시지까지만 — 내가 보낸 메시지를 "읽음"으로 올려도 안 읽은 수 · 상대의 "읽음" 표시는 그대로라 방송만 나갔다.
--    (덤으로 아직 없는 메시지 번호를 보내 앞으로 올 메시지를 미리 읽음으로 만들 수 없다)
--  · 대화 목록 신호(inbox)는 그 대화를 보고 있지 않은 사람에게만 — 대화방 안에서는 목록을 듣지 않고, 나올 때 한 번 새로 읽는다.
--    단 방 상태 · 라운드 · 고정이 바뀌면 전처럼 둘 다에게. 놓쳐도 홈은 60초마다 다시 읽는다.
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════

create or replace function public.mark_read(p_room uuid, p_last_id bigint)
returns void language plpgsql security definer set search_path = public as $fn$
declare
  s smallint := public.my_seat(p_room);
  v bigint;
begin
  if s is null then raise exception 'not_member'; end if;
  select id into v from public.messages
   where room_id = p_room and id <= p_last_id and sender_seat = 3 - s
   order by id desc limit 1;
  if v is null then return; end if;
  if s = 1 then
    update public.rooms set read1 = v where id = p_room and coalesce(read1, 0) < v;
  else
    update public.rooms set read2 = v where id = p_room and coalesce(read2, 0) < v;
  end if;
end
$fn$;

-- 이 방을 지금 보고 있지 않은 사람의 대화 목록에만 "다시 읽어"
create or replace function private.rt_inbox_away(p_room uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare u uuid;
begin
  for u in select user_id from public.room_members
            where room_id = p_room and (viewing_until is null or viewing_until <= now()) loop
    perform private.rt_send('inbox:' || u, 'changed', jsonb_build_object('room_id', p_room));
  end loop;
end
$fn$;
revoke all on function private.rt_inbox_away(uuid) from public, anon, authenticated;

create or replace function private.rt_broadcast()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  case tg_table_name
  when 'messages' then
    perform private.rt_send('room:' || new.room_id, 'msg', jsonb_build_object(
      'id', new.id, 'room_id', new.room_id, 'sender_seat', new.sender_seat, 'body', new.body,
      'client_msg_id', new.client_msg_id, 'created_at', new.created_at, 'reply_to', new.reply_to, 'deleted_at', new.deleted_at));
    if tg_op = 'INSERT' then perform private.rt_inbox_away(new.room_id); end if;
  when 'rooms' then
    perform private.rt_send('room:' || new.id, 'room', jsonb_build_object(
      'id', new.id, 'status', new.status, 'round', new.round, 'expires_at', new.expires_at, 'close_reason', new.close_reason,
      'alias1', new.alias1, 'alias2', new.alias2, 'read1', new.read1, 'read2', new.read2,
      'paused_left', new.paused_left, 'pinned', new.pinned));
    -- 목록에 보이는 것이 바뀔 때만 (읽음 표시는 대화 화면의 "읽음"만 바꾼다)
    if (new.status, new.round, new.pinned) is distinct from (old.status, old.round, old.pinned) then
      perform private.rt_inbox(new.id);
    elsif (new.expires_at, new.paused_left) is distinct from (old.expires_at, old.paused_left) then
      perform private.rt_inbox_away(new.id);
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
