-- ════════════════════════════════════════════════════════════════════
--  Phase 103 — 연장: 시간이 다 된 뒤 "연장할까요?" · 공개할 것을 각자 고르기 · 운영진이 닉네임 변경권 주기
--
--  1) 시간이 다 되면 바로 닫지 않고 vote_grace(60초) 동안 연장을 고를 수 있다 (그동안 대화는 막힌다).
--  2) 연장할 때 공개할 것을 각자 하나씩 고른다: 학년 · 디플로마 · 동아리(한 번씩) · 랜덤 질문(매번).
--     private.room_hints 는 라운드마다 한 줄 (room_id, seat, round).
--  3) 관리자 › 사용자에서 닉네임 랜덤 변경권을 몇 장 줄 수 있다.
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists nickname_tickets_granted int not null default 0;

create or replace function private.vote_grace(p_round int)
returns interval language sql stable security definer set search_path = '' as $fn$
  select case when c.max_rounds > 0 and p_round >= c.max_rounds then interval '0' else interval '60 seconds' end
    from public.app_settings c where c.id;
$fn$;
revoke all on function private.vote_grace(int) from public, anon, authenticated;

alter table private.room_hints add column if not exists round smallint;
alter table private.room_hints add column if not exists label text;
alter table private.room_hints drop constraint if exists room_hints_kind_check;
alter table private.room_hints add  constraint room_hints_kind_check check (kind in ('grade', 'club', 'diploma', 'question', 'q1', 'q2'));
-- 예전 줄은 예전 순서의 라운드 (학년 1 · 질문 2 · 디플로마 3 · 질문 4 · 동아리 5)
update private.room_hints set round = case kind when 'q1' then 2 when 'diploma' then 3 when 'q2' then 4 when 'club' then 5 end
 where round is null;
-- 예전엔 학년을 적어 두지 않고 명단에서 읽었다 — 아직 열린(고정 포함) 대화만 적어 둔다 (닫힌 대화는 힌트를 보이지 않는다)
insert into private.room_hints (room_id, seat, round, kind, value)
select r.id, m.seat, 1, 'grade', p.grade || '학년'
  from public.rooms r
  join public.room_members m on m.room_id = r.id
  cross join lateral private.person(m.user_id) p
 where r.status <> 'closed' and r.round > 1 and p.grade is not null
   and not exists (select 1 from private.room_hints h where h.room_id = r.id and h.seat = m.seat and (h.round = 1 or h.kind = 'grade'));
alter table private.room_hints alter column round set not null;
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'room_hints_pkey'
                    and pg_get_constraintdef(oid) = 'PRIMARY KEY (room_id, seat, round)') then
    alter table private.room_hints drop constraint if exists room_hints_pkey;
    alter table private.room_hints add constraint room_hints_pkey primary key (room_id, seat, round);
  end if;
end
$do$;

create or replace function private.round_question(p_room uuid, p_round int)
returns text language sql immutable set search_path = '' as $fn$
  select (array['요즘 빠져 있는 것', '제일 좋아하는 급식 메뉴', '주말에 주로 하는 일', '요즘 자주 듣는 노래',
                '가 보고 싶은 여행지', '스트레스 푸는 방법', '인생 영화나 드라마', '시험 끝나면 하고 싶은 일',
                '좋아하는 계절', '요즘 소소한 행복'])[1 + ((h + (p_round - 1) * (array[1, 3, 7, 9])[1 + (h / 10) % 4]) % 10)::int]
    from (select abs(hashtext(p_room::text)::bigint) h) x;
$fn$;
revoke all on function private.round_question(uuid, int) from public, anon, authenticated;

create or replace function private.hint_options(p_room uuid, p_seat smallint, p_round int)
returns jsonb language plpgsql stable security definer set search_path = public, private as $fn$
declare v_user uuid; v_grade smallint; v_used text[]; out jsonb := '[]'::jsonb;
begin
  select user_id into v_user from public.room_members where room_id = p_room and seat = p_seat;
  select p.grade into v_grade from private.person(v_user) p;
  select coalesce(array_agg(kind), '{}') into v_used from private.room_hints
   where room_id = p_room and seat = p_seat and round < p_round;
  if v_grade is not null and not ('grade' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'grade', 'label', '학년', 'typed', false, 'value', v_grade || '학년'));
  end if;
  if not ('diploma' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'diploma', 'label', '디플로마', 'typed', true));
  end if;
  if not ('club' = any (v_used)) then
    out := out || jsonb_build_array(jsonb_build_object('kind', 'club', 'label', '동아리', 'typed', true));
  end if;
  return out || jsonb_build_array(jsonb_build_object('kind', 'question', 'label', '랜덤 질문', 'typed', true,
                                                     'question', private.round_question(p_room, p_round)));
end
$fn$;
revoke all on function private.hint_options(uuid, smallint, int) from public, anon, authenticated;

create or replace function private.hint_typed(p_kind text)
returns boolean language sql immutable set search_path = '' as $fn$
  select coalesce(p_kind in ('club', 'diploma', 'q1', 'q2', 'question'), false);
$fn$;
create or replace function private.room_hints_of(p_room uuid, p_seat smallint, p_count int)
returns jsonb language plpgsql stable security definer set search_path = public, private as $fn$
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind,
                                                      'label', coalesce(h.label, private.hint_label_in(p_room, h.kind)),
                                                      'value', h.value) order by h.round), '[]'::jsonb)
            from private.room_hints h
           where h.room_id = p_room and h.seat = p_seat and h.round <= p_count);
end
$fn$;
revoke all on function private.room_hints_of(uuid, smallint, int) from public, anon, authenticated;

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
  if v_next in ('q1', 'q2') then v_next := 'question'; end if;
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
    -- 다음 연장 때 공개할 것 — 각자 고른다 (Phase 103). next_hint 는 "공개 차례가 있다"는 표시 · 옛 앱용 (질문 = 이 라운드의 질문)
    'next_hint',       case when v_next is not null then jsonb_build_object(
                         'kind', v_next,
                         'label', case when v_next = 'question' then private.round_question(p_room, r.round) else private.hint_label(v_next) end,
                         'typed', private.hint_typed(v_next)) end,
    'next_options',    case when v_next is not null then private.hint_options(p_room, s, r.round) end,
    -- 시간이 다 된 뒤에도 이만큼은 연장을 고를 수 있다 (Phase 103) — 그 사이 대화는 막히고 앱은 "연장할까요?" 화면
    'vote_grace_sec',  extract(epoch from private.vote_grace(r.round))::int,
    'can_rate',        v_can_rate,
    'rated',           v_rated,
    'server_now',      now());
end
$fn$;
create or replace function public.close_if_expired(p_room uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare r public.rooms%rowtype;
begin
  if public.my_seat(p_room) is null then raise exception 'not_member'; end if;
  perform private.room_clock(p_room);
  select * into r from public.rooms where id = p_room for update;
  -- 대화 중이던 방은 시간이 다 된 뒤 연장을 고르는 동안(vote_grace)은 닫지 않는다 (Phase 103)
  if r.status <> 'closed'
     and now() >= r.expires_at + (case when r.status = 'active' then private.vote_grace(r.round) else interval '0' end) then
    perform public.close_room(p_room, case when r.status = 'pending' then 'no_show' else 'expired' end);
  end if;
  return public.room_snapshot(p_room);   -- 언제나 최신 스냅샷 + server_now
end
$fn$;
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
              and now() >= expires_at + case when status = 'active' then private.vote_grace(round) else interval '0' end
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

drop function if exists public.vote_extension(uuid, boolean, text);
create or replace function public.vote_extension(p_room uuid, p_agree boolean, p_hint text default null, p_kind text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  r   public.rooms%rowtype;
  cfg public.app_settings%rowtype;
  s   smallint;
  v_yes int; v_no int; v_kind text; v_hint text; v_pin boolean; v_label text; v_opt jsonb; v_msg text;
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
    v_kind := coalesce(p_kind, case when v_kind in ('q1', 'q2') then 'question' else v_kind end);
    -- 고를 수 있는 것만 (학년은 명단에 있을 때, 학년 · 디플로마 · 동아리는 한 번씩, 질문은 매번)
    select o into v_opt from jsonb_array_elements(private.hint_options(p_room, s, r.round)) o where o->>'kind' = v_kind;
    if v_opt is null and p_kind is null and v_kind = 'grade' then
      v_kind := null;   -- 옛 앱의 학년 차례인데 명단에 학년이 없다 — 예전처럼 공개 없이 ("비공개")
    elsif v_opt is null then
      return jsonb_build_object('result', 'need_hint', 'snap', public.room_snapshot(p_room));
    end if;
  end if;
  if p_agree and v_kind is not null and v_opt is not null then
    if v_kind = 'grade' then
      v_hint := v_opt->>'value';
    else
      v_hint := btrim(coalesce(p_hint, ''));
      if char_length(v_hint) not between 1 and (case when v_kind = 'question' then 30 else 20 end)
         or private.rule_violation(v_hint) is not null
         or (v_kind = 'diploma' and not (v_hint = any (private.diplomas()))) then
        return jsonb_build_object('result', 'need_hint', 'snap', public.room_snapshot(p_room));
      end if;
    end if;
    v_label := case when v_kind = 'question' then private.round_question(p_room, r.round) end;
    insert into private.room_hints (room_id, seat, round, kind, label, value) values (p_room, s, r.round, v_kind, v_label, v_hint)
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
    select case when count(distinct kind) = 1 and min(kind) = 'question' then ' 질문 답 공개!'
                when count(distinct kind) = 1 then ' 서로의 ' || private.hint_label(min(kind)) || ' 공개!'
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
revoke all on function public.vote_extension(uuid, boolean, text, text) from public, anon;
grant execute on function public.vote_extension(uuid, boolean, text, text) to authenticated;

create or replace function private.stats_on_hint()
returns trigger language plpgsql security definer set search_path = public, private as $fn$
begin
  if new.kind in ('q1', 'q2', 'question') then perform private.bump(private.seat_user(new.room_id, new.seat), 'answers'); end if;
  return null;
end
$fn$;
create or replace function private.nickname_tickets(p_user uuid)
returns int language sql stable security definer set search_path = '' as $fn$
  select greatest(0, 1
    + (select (count(*) > 0)::int + (count(*) filter (where a.tier = 3))::int
         from private.user_achievements a join private.achievement_defs d on d.code = a.code
        where a.user_id = p_user and not d.granted and d.category <> 'cnsa' and d.code <> 'pioneer')
    - coalesce((select p.nickname_rerolls_used - p.nickname_tickets_granted from public.profiles p where p.id = p_user), 0));
$fn$;
revoke all on function private.nickname_tickets(uuid) from public, anon, authenticated;

create or replace function public.admin_nickname_tickets(p_staff uuid, p_user uuid)
returns int language plpgsql stable security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  return private.nickname_tickets(p_user);
end
$fn$;

create or replace function public.admin_grant_nickname_tickets(p_staff uuid, p_user uuid, p_n int)
returns int language plpgsql security definer set search_path = public, private as $fn$
begin
  perform private.require_staff(p_staff);
  if p_n is null or p_n not between 1 and 20 then raise exception 'bad_count'; end if;
  update public.profiles set nickname_tickets_granted = nickname_tickets_granted + p_n where id = p_user;
  if not found then raise exception 'user_not_found'; end if;
  insert into private.audit_log (staff_id, action, target_user, detail)
  values (p_staff, 'grant_nickname_tickets', p_user, jsonb_build_object('n', p_n));
  return private.nickname_tickets(p_user);
end
$fn$;

do $do$
declare f text;
begin
  foreach f in array array['admin_nickname_tickets(uuid, uuid)', 'admin_grant_nickname_tickets(uuid, uuid, int)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$do$;
notify pgrst, 'reload schema';
