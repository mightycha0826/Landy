-- ════════════════════════════════════════════════════════════════════
--  Phase 92 — 접속자가 많을 때 알림: "많은 사람들이 Landy를 이용중이에요!"
--
--  · 가입한 학생(signup_stats.students)의 30% 이상이 접속 중(user_presence.online_until > now())이면
--    지금 앱을 켜 두지 않은 학생들의 기기로 보낸다.
--  · 하루(한국 날짜) 한 번 — private.crowd_push 에 그날 줄이 생기면 그날은 다시 시작하지 않는다.
--  · 요청을 늘리지 않는다 — Worker 의 1분 예약 작업이 이미 부르는 push_retry_jobs() 가 판단하고 받을 기기를 같이 돌려준다.
--  · 한 번에 30대씩 (Worker 한 번 실행의 하위 요청 한도) — 나머지는 다음 분에 이어서. 시작하고 1시간이 지나면 멈춘다.
--  · 설정 › 알림에서 끌 수 있다 (mute 'crowd').
--  실DB 는 supabase/migrations/20261102120000_crowd_push_phase92.sql (이 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.crowd_push (
  day        date primary key,                       -- 한국 날짜
  started_at timestamptz not null default now(),
  sent_to    text not null default '',                -- 여기(endpoint 순)까지 보냈다
  done       boolean not null default false
);
alter table private.crowd_push enable row level security;
revoke all on private.crowd_push from public, anon, authenticated;

-- 이번 분에 보낼 알림 한 묶음 (없으면 null)
create or replace function private.crowd_push_batch()
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_day   date := (now() at time zone 'Asia/Seoul')::date;
  c       private.crowd_push%rowtype;
  v_total int;
  v_subs  jsonb;
  v_last  text;
begin
  select * into c from private.crowd_push where day = v_day for update;
  if not found then
    v_total := coalesce((select students from public.signup_stats where id), 0);
    if v_total = 0 or (select count(*) from public.user_presence up join public.profiles p on p.id = up.user_id
                        where up.online_until > now() and p.verified and p.onboarded) * 10 < v_total * 3 then
      return null;
    end if;
    insert into private.crowd_push (day) values (v_day) on conflict (day) do nothing returning * into c;
    if not found then return null; end if;
  end if;
  if c.done then return null; end if;
  if c.started_at < now() - interval '1 hour' then
    update private.crowd_push set done = true where day = v_day;
    return null;
  end if;

  -- 지금 접속 중인 학생 · 이 알림을 끈 기기는 건너뛴다
  with b as (
    select s.endpoint, s.p256dh, s.auth, s.mute from public.push_subscriptions s
     where s.endpoint > c.sent_to and not ('crowd' = any(s.mute))
       and not exists (select 1 from public.user_presence up where up.user_id = s.user_id and up.online_until > now())
     order by s.endpoint limit 30)
  select max(b.endpoint), jsonb_agg(jsonb_build_object('endpoint', b.endpoint, 'p256dh', b.p256dh, 'auth', b.auth, 'mute', b.mute))
    into v_last, v_subs from b;
  update private.crowd_push set sent_to = coalesce(v_last, sent_to), done = v_last is null where day = v_day;
  if v_last is null then return null; end if;
  return jsonb_build_object('kind', 'crowd', 'title', 'Landy', 'body', '많은 사람들이 Landy를 이용중이에요!',
                            'url', '/', 'tag', 'crowd', 'subs', v_subs);
end
$fn$;
revoke all on function private.crowd_push_batch() from public, anon, authenticated;

-- 재시도할 알림 + 접속자 알림 한 묶음 (schema.sql 의 push_retry_jobs 와 같다)
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
  -- 접속자가 많을 때 알림 한 묶음 (Phase 92)
  payload := private.crowd_push_batch();
  if payload is not null then out := out || jsonb_build_array(payload); end if;
  return out;
end
$fn$;

-- 끌 수 있는 알림 종류에 crowd 를 더한다 (schema.sql 의 set_push_mute 와 같다)
create or replace function public.set_push_mute(p_endpoint text, p_mute text[])
returns void language plpgsql security definer set search_path = public as $fn$
declare m text[];
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select coalesce(array_agg(distinct k order by k), '{}') into m
    from unnest(coalesce(p_mute, '{}')) k
   where k in ('chat', 'reaction', 'letter', 'crowd');
  update public.push_subscriptions set mute = m where endpoint = p_endpoint and user_id = auth.uid();
end
$fn$;
notify pgrst, 'reload schema';
