-- ════════════════════════════════════════════════════════════════════
--  Phase 99 — "누군가 매칭을 돌리고 있어요" · 익명편지가 열리면 푸시
--
--  · my_rooms 대답에 others_seeking — 나와 실제로 이어질 수 있는 사람(request_match 와 같은 조건)이 지금 찾고 있나.
--    홈이 이미 60초마다 읽는 대답에 실어서 요청 · Realtime 방송이 늘지 않는다.
--  · 익명편지가 열리면(가입 인원이 기준에 닿거나 운영자가 잠금을 끄면) 한 번만 모든 기기에 푸시.
--    Worker 의 1분 예약 작업이 이미 부르는 push_retry_jobs() 가 30대씩 돌려준다. 설정 › 알림의 "편지"를 끈 기기는 뺀다.
--  · 이 파일을 적용할 때 이미 열려 있으면 보내지 않는다 (예전에 연 편지를 새삼 알리지 않게).
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.letters_open_push (
  id         boolean primary key default true check (id),
  started_at timestamptz not null default now(),
  sent_to    text not null default '',                -- 여기(endpoint 순)까지 보냈다
  done       boolean not null default false
);
alter table private.letters_open_push enable row level security;
revoke all on private.letters_open_push from public, anon, authenticated;

-- 이번 분에 보낼 "편지가 열렸어요" 한 묶음 (없으면 null)
create or replace function private.letters_open_push_batch()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  c       private.letters_open_push%rowtype;
  v_subs  jsonb;
  v_last  text;
begin
  select * into c from private.letters_open_push where id for update;
  if not found then
    if private.letters_locked() or private.in_maintenance()
       or not coalesce((select s.is_open from public.app_settings s where s.id), false) then
      return null;
    end if;
    insert into private.letters_open_push (id) values (true) on conflict (id) do nothing returning * into c;
    if not found then return null; end if;
  end if;
  if c.done then return null; end if;

  with b as (
    select s.endpoint, s.p256dh, s.auth, s.mute from public.push_subscriptions s
     where s.endpoint > c.sent_to and not ('letter' = any(s.mute))
     order by s.endpoint limit 30)
  select max(b.endpoint), jsonb_agg(jsonb_build_object('endpoint', b.endpoint, 'p256dh', b.p256dh, 'auth', b.auth, 'mute', b.mute))
    into v_last, v_subs from b;
  update private.letters_open_push set sent_to = coalesce(v_last, sent_to), done = v_last is null where id;
  if v_last is null then return null; end if;
  return jsonb_build_object('kind', 'letter', 'title', 'Landy', 'body', '익명편지가 열렸어요! 지금 편지를 보내 보세요',
                            'url', '/letters', 'tag', 'letters-open', 'subs', v_subs);
end
$fn$;
revoke all on function private.letters_open_push_batch() from public, anon, authenticated;

-- 나와 이어질 수 있는 사람이 지금 찾고 있나 — request_match 의 상대 조건과 같다
create or replace function private.someone_seeking(p_me uuid)
returns boolean language plpgsql stable security definer set search_path = public, private as $fn$
declare
  cfg public.app_settings%rowtype;
  m   public.profiles%rowtype;
begin
  select * into cfg from public.app_settings where id;
  select * into m from public.profiles where id = p_me;
  if not found then return false; end if;
  return exists (
    select 1
      from public.user_presence c
      join public.profiles p on p.id = c.user_id
     where c.user_id <> p_me
       and c.seeking_until > now()
       and private.open_rooms(c.user_id) < cfg.max_open_rooms
       and not exists (select 1 from public.room_members x
                         join public.room_members y on y.room_id = x.room_id
                        where x.user_id = p_me and x.open and y.user_id = c.user_id)
       and p.status = 'active' and p.verified and p.onboarded
       and (p.suspended_until is null or p.suspended_until <= now())
       and (m.want = 'any' or m.want = p.gender)
       and (p.want = 'any' or p.want = m.gender)
       and not exists (select 1 from public.blocks b
                        where (b.blocker_id = p_me and b.blocked_id = c.user_id)
                           or (b.blocker_id = c.user_id and b.blocked_id = p_me))
       and ((coalesce(m.allow_rematch, false) and coalesce(p.allow_rematch, false))
            or not exists (select 1 from public.pair_history h
                            where h.user_lo = least(p_me, c.user_id)
                              and h.user_hi = greatest(p_me, c.user_id)
                              and h.last_matched_at > now() - make_interval(days => cfg.rematch_cooldown_days))));
end
$fn$;
revoke all on function private.someone_seeking(uuid) from public, anon, authenticated;

create or replace function public.my_rooms()
returns jsonb language sql security definer set search_path = public, private stable as $fn$
  select jsonb_build_object(
    'rooms', coalesce(jsonb_agg(to_jsonb(x) - 'sort_at' order by x.pinned desc, x.sort_at desc), '[]'::jsonb),
    'others_seeking', private.someone_seeking(auth.uid()),
    'server_now', now())
  from (
    select r.id as room_id, r.status, rm.seat as my_seat,
           case when rm.seat = 1 then r.alias2 else r.alias1 end as partner_alias,
           private.room_deadline(r.expires_at, r.paused_left) as expires_at, r.round,
           r.paused_left is not null as paused,
           r.pinned,
           rm.joined_at is not null as joined,
           coalesce(up.online_until > now(), false) as partner_online,
           lm.body as last_body, lm.sender_seat as last_seat, lm.created_at as last_at,
           (select count(*) from public.messages m
             where m.room_id = r.id and m.sender_seat not in (0, rm.seat)
               and m.id > coalesce(case when rm.seat = 1 then r.read1 else r.read2 end, 0))::int as unread,
           coalesce(lm.created_at, r.created_at) as sort_at
      from public.room_members rm
      join public.rooms r on r.id = rm.room_id
      join public.room_members o on o.room_id = r.id and o.seat <> rm.seat
      left join public.user_presence up on up.user_id = o.user_id
      left join lateral (select body, sender_seat, created_at from public.messages
                          where room_id = r.id order by id desc limit 1) lm on true
     where rm.user_id = auth.uid() and rm.open
       and r.status <> 'closed' and now() < r.expires_at
  ) x;
$fn$;

create or replace function public.push_retry_jobs()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare job private.push_outbox%rowtype; payload jsonb; out jsonb := '[]'::jsonb;
begin
  -- 아래 payload 함수가 자기 job을 원자적으로 임대한다. 병렬 소비자는 already를 받고 건너뛴다.
  for job in select * from private.push_outbox where attempts < 3 and created_at > now()-interval '10 minutes'
    and ((state='failed' and next_attempt <= now()) or (state='pending' and leased_until <= clock_timestamp()))
    order by next_attempt limit 20 loop
    payload := case job.kind
      when 'chat' then public.push_payload(job.ref_id,job.actor)
      when 'reaction' then public.reaction_push_payload(job.ref_id,job.actor)
      when 'letter' then public.dm_push_payload(job.ref_id,job.actor)
      when 'notice' then public.personal_notice_push(job.ref_id) end;
    if payload ? 'skip' then
      if payload->>'skip' <> 'already' then update private.push_outbox set state='skipped' where job_key=job.job_key and lease=job.lease; end if;
    else out := out || jsonb_build_array(payload || jsonb_build_object('kind',job.kind)); end if;
  end loop;
  -- 한 번 실행에 대량 발송은 한 묶음만 (Worker 하위 요청 한도) — 편지 열림(Phase 99)이 먼저, 없으면 접속자 알림(Phase 92)
  payload := coalesce(private.letters_open_push_batch(), private.crowd_push_batch());
  if payload is not null then out := out || jsonb_build_array(payload); end if;
  return out;
end
$fn$;

-- 이미 열려 있는 곳에서는 보내지 않는다
insert into private.letters_open_push (id, done)
select true, true where not private.letters_locked()
on conflict (id) do nothing;
notify pgrst, 'reload schema';
