-- ════════════════════════════════════════════════════════════════════
--  Phase 102 — 닉네임 랜덤 변경권: 가입 선물 1장 + 처음 딴 뱃지 1장 + 금 뱃지마다 1장
--
--  · 변경권 = 1(가입) + 1(Landy 뱃지를 하나라도 땄으면) + Landy 금 뱃지 수 - 쓴 장수 (private.nickname_tickets).
--    Landy 뱃지 = 운영진이 주는 특별 · CNSA 뱃지 · 개척자(가입 순서 — 가입 선물과 겹친다)를 뺀 것.
--    따로 지급하지 않고 그때그때 센다 — 지금 쓰는 학생도 바로 받고, 이미 딴 뱃지도 센다.
--  · reroll_nickname() — 서버가 무작위로 새 이름을 정한다. 학생이 이름을 고르거나 쓴 장수를 고칠 수 없다.
--  · 이미 만들어진 대화방의 이름(rooms.alias1 · alias2)은 그대로 — 새 이름과 예전 대화가 이어져 보이지 않는다.
--  · 이용 제한 중에는 쓸 수 없다 (제재를 받은 뒤 이름을 바꿔 숨지 못하게).
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles add column if not exists nickname_rerolls_used int not null default 0;

-- 남은 변경권
create or replace function private.nickname_tickets(p_user uuid)
returns int language sql stable security definer set search_path = '' as $fn$
  select greatest(0, 1
    + (select (count(*) > 0)::int + (count(*) filter (where a.tier = 3))::int
         from private.user_achievements a join private.achievement_defs d on d.code = a.code
        where a.user_id = p_user and not d.granted and d.category <> 'cnsa' and d.code <> 'pioneer')
    - coalesce((select p.nickname_rerolls_used from public.profiles p where p.id = p_user), 0));
$fn$;
revoke all on function private.nickname_tickets(uuid) from public, anon, authenticated;

create or replace function public.my_achievements()
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); p public.profiles%rowtype; c jsonb; v_rank int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform private.touch_streak(me);
  select * into p from public.profiles where id = me;
  select coalesce(counts, '{}'::jsonb) into c from private.user_stats where user_id = me;
  select count(*) into v_rank from public.profiles o where o.created_at <= p.created_at;
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
               'code', d.code, 'title', d.title, 'description', d.description, 'icon', d.icon,
               'category', d.category, 'unit', d.unit, 'lower_better', d.lower_better,
               'granted', d.granted,   -- 운영진이 주는 업적 (Phase 44, 베타 테스터) — 등급 기준이 없다
               'tiers', jsonb_build_array(d.bronze, d.silver, d.gold),
               'tier', coalesce(a.tier, 0), 'earned_at', a.earned_at,
               'value', case d.stat when 'temp' then p.manner_temp when 'pioneer' then v_rank
                                    else coalesce((c->>d.stat)::numeric, 0) end,
               'new', a.earned_at is not null and a.earned_at > coalesce(p.ach_seen_at, '-infinity'))
             order by d.sort)
             from private.achievement_defs d
             left join private.user_achievements a on a.user_id = me and a.code = d.code), '[]'::jsonb),
    'featured', private.featured_for(me, 'own'),
    'chosen', to_jsonb(p.featured_badges),
    -- Phase 84 — 대표 뱃지 칸(금 뱃지 5개면 5) · 금 뱃지 수 · 랜덤채팅에 보이는 뱃지 (정하지 않았으면 CNSA 는 숨김)
    'slots', private.badge_slots(me),
    'golds', private.badge_golds(me),
    'nickname_tickets', private.nickname_tickets(me), -- Phase 102
    'chat', coalesce((select jsonb_object_agg(d.code, private.badge_chat_visible(p.badge_chat, d.code, d.category))
                        from private.achievement_defs d join private.user_achievements a on a.code = d.code and a.user_id = me), '{}'::jsonb));
end
$fn$;

create or replace function public.new_achievements()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  -- ticket = 이 뱃지로 변경권을 받았다 (Phase 102) — Landy 금 뱃지, 또는 처음 딴 Landy 뱃지(동)
  select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'title', d.title, 'icon', d.icon, 'tier', a.tier,
                                               'ticket', not d.granted and d.category <> 'cnsa' and d.code <> 'pioneer'
                                                 and (a.tier = 3 or (a.tier = 1 and not exists (
                                                   select 1 from private.user_achievements o join private.achievement_defs od on od.code = o.code
                                                    where o.user_id = a.user_id and o.code <> a.code
                                                      and not od.granted and od.category <> 'cnsa' and od.code <> 'pioneer'))))
                     order by a.earned_at), '[]'::jsonb)
    from private.user_achievements a
    join private.achievement_defs d on d.code = a.code
    join public.profiles p on p.id = a.user_id
   where a.user_id = auth.uid() and a.earned_at > coalesce(p.ach_seen_at, '-infinity');
$fn$;

-- 변경권 한 장으로 닉네임을 무작위로 바꾼다
create or replace function public.reroll_nickname()
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me     uuid := auth.uid();
  p      public.profiles%rowtype;
  v_left int;
  v      text;
  i      int := 0;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into p from public.profiles where id = me for update;
  if not found or not p.verified or not p.onboarded or p.status <> 'active'
     or (p.suspended_until is not null and p.suspended_until > now()) then
    return jsonb_build_object('status', 'not_eligible');
  end if;
  v_left := private.nickname_tickets(me);
  if v_left <= 0 then return jsonb_build_object('status', 'no_ticket', 'tickets', 0); end if;
  loop
    i := i + 1;
    v := private.nickname_candidate();
    -- 조합이 붐비면 숫자를 붙인다 (assign_nickname 과 같다)
    if i > 5 then v := v || (floor(random() * 900) + 100)::int::text; end if;
    if v is distinct from p.nickname then
      begin
        update public.profiles set nickname = v, nickname_rerolls_used = nickname_rerolls_used + 1 where id = me;
        return jsonb_build_object('status', 'ok', 'nickname', v, 'tickets', v_left - 1);
      exception when unique_violation then
        null;
      end;
    end if;
    if i >= 40 then return jsonb_build_object('status', 'retry', 'tickets', v_left); end if;
  end loop;
end
$fn$;
revoke all on function public.reroll_nickname() from public, anon;
grant execute on function public.reroll_nickname() to authenticated;
notify pgrst, 'reload schema';
