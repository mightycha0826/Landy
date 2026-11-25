-- ════════════════════════════════════════════════════════════════════
--  Phase 106 — 연장 공개: 랜덤 질문 대신 남자/여자
--
--  연장할 때 고르는 것: 학년 · 남자/여자 · 디플로마 · 동아리 — 넷 다 한 번씩.
--  남자/여자는 프로필 성별(m · f)에서 — 적지 않는다, 성별이 정해지지 않았으면 고를 수 없다.
--  다 공개했으면(다섯 번째 연장) 고를 것 없이 연장. 옛 앱(p_kind 없음)이 고를 수 없는 차례면 공개 없이.
--  예전에 공개한 질문 답(question · q1 · q2)은 그대로 보인다.
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
alter table private.room_hints drop constraint if exists room_hints_kind_check;
alter table private.room_hints add  constraint room_hints_kind_check check (kind in ('grade', 'club', 'diploma', 'question', 'q1', 'q2', 'gender'));

create or replace function private.hint_label(p_kind text)
returns text language sql immutable set search_path = '' as $fn$
  select case p_kind when 'grade' then '학년' when 'surname' then '성씨' when 'club' then '동아리'
                     when 'diploma' then '디플로마' when 'q1' then '공통 질문' when 'q2' then '공통 질문' when 'gender' then '성별' end;
$fn$;

create or replace function private.hint_options(p_room uuid, p_seat smallint, p_round int)
returns jsonb language plpgsql stable security definer set search_path = public, private as $fn$
declare v_user uuid; v_grade smallint; v_gender text; v_used text[]; out jsonb := '[]'::jsonb;
begin
  select user_id into v_user from public.room_members where room_id = p_room and seat = p_seat;
  select p.grade into v_grade from private.person(v_user) p;
  select case gender when 'm' then '남자' when 'f' then '여자' end into v_gender from public.profiles where id = v_user;
  select coalesce(array_agg(kind), '{}') into v_used from private.room_hints
   where room_id = p_room and seat = p_seat and round < p_round;
  if v_grade is not null and not ('grade' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'grade', 'label', '학년', 'typed', false, 'value', v_grade || '학년'));
  end if;
  if v_gender is not null and not ('gender' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'gender', 'label', '남자/여자', 'typed', false, 'value', v_gender));
  end if;
  if not ('diploma' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'diploma', 'label', '디플로마', 'typed', true));
  end if;
  if not ('club' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'club', 'label', '동아리', 'typed', true));
  end if;
  return out;
end
$fn$;
revoke all on function private.hint_options(uuid, smallint, int) from public, anon, authenticated;

create or replace function public.vote_extension(p_room uuid, p_agree boolean, p_hint text default null, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  r   public.rooms%rowtype;
  cfg public.app_settings%rowtype;
  s   smallint;
  v_yes int; v_no int; v_kind text; v_hint text; v_pin boolean; v_opts jsonb; v_opt jsonb; v_msg text;
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
  -- 시간이 다 된 뒤에도 vote_grace 동안은 고를 수 있다 (Phase 103)
  if now() >= r.expires_at + private.vote_grace(r.round) then
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
  if p_agree and v_kind is not null then
    v_opts := private.hint_options(p_room, s, r.round);
    v_kind := coalesce(p_kind, v_kind);
    -- 고를 수 있는 것만 (학년은 명단에 있을 때, 성별은 남 · 여일 때, 넷 다 한 번씩)
    select o into v_opt from jsonb_array_elements(v_opts) o where o->>'kind' = v_kind;
    if jsonb_array_length(v_opts) = 0 then
      v_kind := null;   -- 다 공개했다 — 공개 없이 연장 (Phase 106)
    elsif v_opt is null and p_kind is null then
      v_kind := null;   -- 옛 앱(고를 줄 모른다)의 차례가 고를 수 없는 것 — 공개 없이 (명단에 학년이 없을 때 · 예전 질문 차례)
    elsif v_opt is null then
      return jsonb_build_object('result', 'need_hint', 'snap', public.room_snapshot(p_room));
    end if;
  end if;
  if p_agree and v_kind is not null and v_opt is not null then
    if not (v_opt->>'typed')::boolean then
      v_hint := v_opt->>'value';   -- 학년 · 성별은 적지 않는다
    else
      v_hint := btrim(coalesce(p_hint, ''));
      if char_length(v_hint) not between 1 and 20
         or private.rule_violation(v_hint) is not null
         or (v_kind = 'diploma' and not (v_hint = any (private.diplomas()))) then
        return jsonb_build_object('result', 'need_hint', 'snap', public.room_snapshot(p_room));
      end if;
    end if;
    insert into private.room_hints (room_id, seat, round, kind, label, value) values (p_room, s, r.round, v_kind, null, v_hint)
    on conflict (room_id, seat, round) do update set kind = excluded.kind, label = excluded.label, value = excluded.value;
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
    -- 시간이 다 된 뒤(vote_grace)에 연장했으면 지금부터 (Phase 103)
    update public.rooms
       set expires_at = greatest(r.expires_at, now()) + make_interval(mins => cfg.extend_minutes),
           round      = r.round + 1
     where id = p_room;
    -- 둘이 같은 걸 골랐으면 그 이름으로, 다르면 "고른 정보"
    select case when count(distinct kind) = 1 then ' 서로의 ' || private.hint_label(min(kind)) || ' 공개!'
                when count(*) > 0 then ' 서로 고른 정보 공개!' else '' end
      into v_msg
      from private.room_hints where room_id = p_room and round = r.round;
    insert into public.messages (room_id, sender_seat, body, client_msg_id)
    values (p_room, 0, cfg.extend_minutes || '분 연장됨.' || coalesce(v_msg, ''), gen_random_uuid());
    return jsonb_build_object('result', 'extended', 'snap', public.room_snapshot(p_room));
  end if;
  return jsonb_build_object('result', 'waiting', 'snap', public.room_snapshot(p_room));
end
$fn$;

notify pgrst, 'reload schema';
