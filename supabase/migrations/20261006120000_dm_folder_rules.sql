-- ════════════════════════════════════════════════════════════════════
-- 2026-10-06 — 편지 폴더 자동 넣기
-- 한 사람(편지 줄기)에게서 받은 편지를 모두 한 폴더에 넣으면 화면이 "앞으로 ○○님의 모든 편지를 이 폴더 안에 넣을까요?"를 묻는다
-- (dm_folder_put 의 offer). 그러겠다고 하면(dm_folder_rule) 그 사람에게서 온 편지는 봉투를 열어 볼 때 그 폴더로 들어간다 (dm_open —
-- 안 연 편지는 폴더에 못 넣는 규칙 그대로). 그 사람의 편지를 폴더에서 빼거나 다른 폴더로 옮기면 · 폴더를 지우면 꺼진다.
-- schema.sql 에서는 dm_open · dm_folder_put · dm_folder_take 를 제자리에서 고쳤다 — 여기에는 고친 전체 정의.
-- ════════════════════════════════════════════════════════════════════
create table if not exists private.dm_folder_rules (
  owner_id  uuid not null references public.profiles(id) on delete cascade,
  thread_id bigint not null references private.dm_threads(id) on delete cascade,
  folder_id bigint not null references private.dm_folders(id) on delete cascade,
  primary key (owner_id, thread_id)
);
create index if not exists dm_folder_rules_thread on private.dm_folder_rules (thread_id);
create index if not exists dm_folder_rules_folder on private.dm_folder_rules (folder_id);
alter table private.dm_folder_rules enable row level security;
revoke all on private.dm_folder_rules from public, anon, authenticated;

create or replace function public.dm_open(p_msg bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); m private.dm_msgs%rowtype; t private.dm_threads%rowtype; v_reader boolean; v_hidden boolean;
        v_first boolean := false;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into m from private.dm_msgs where id = p_msg;
  if not found or not m.is_letter then return jsonb_build_object('status', 'not_found'); end if;
  select * into t from private.dm_threads where id = m.thread_id;
  if t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  if private.dm_reader(m, t) = me then v_reader := true;
  elsif private.dm_writer(m, t) = me then v_reader := false;
  else return jsonb_build_object('status', 'not_found'); end if;
  if v_reader and not m.delivered then return jsonb_build_object('status', 'not_found'); end if;
  v_hidden := case when t.sender_id = me then t.sender_hidden else t.recipient_hidden end;
  if v_hidden then return jsonb_build_object('status', 'not_found'); end if;
  -- 내가 지운 편지 (Phase 69)
  if exists (select 1 from private.dm_hidden_msgs where owner_id = me and msg_id = p_msg) then return jsonb_build_object('status', 'not_found'); end if;
  if v_reader and m.opened_at is null then
    v_first := true;
    update private.dm_msgs set opened_at = now() where id = p_msg returning * into m;
    if t.sender_id = me then update private.dm_threads set sender_read = greatest(sender_read, p_msg) where id = t.id;
    else update private.dm_threads set recipient_read = greatest(recipient_read, p_msg) where id = t.id; end if;
    -- 이 사람의 편지를 폴더에 넣기로 했으면 (dm_folder_rule, 2026-10-06) 열어 본 편지가 그 폴더로
    insert into private.dm_folder_items (owner_id, msg_id, folder_id)
    select me, p_msg, r.folder_id from private.dm_folder_rules r where r.owner_id = me and r.thread_id = t.id
    on conflict (owner_id, msg_id) do nothing;
  end if;
  return jsonb_build_object(
    'status', 'ok', 'id', m.id, 'thread_id', t.id,
    'role', case when v_reader then 'received' else 'sent' end,
    'body', case when m.status = 'visible' then m.body end,
    'fmt',  case when m.status = 'visible' then m.fmt end,
    'removed', m.status = 'removed',
    'created_at', m.created_at,
    -- From. / To. — 받은 편지: 모르는 사람이면 성별만, 아는 사람(내가 이름으로 보낸 사람)이면 이름
    'from_gender', m.from_gender,
    'from_name', case when not m.from_sender then (select name from private.person(t.recipient_id)) end,
    -- 서명 (Phase 35): 받은 편지의 From. · 답장의 To. · 내가 익명 쪽이면 지난번 내 서명 (답장 칸에 미리 채운다)
    'from_nick', case when m.from_sender then m.from_nick end,
    'to_nick',   case when not m.from_sender then
                   (select o.from_nick from private.dm_msgs o where o.thread_id = t.id and o.from_sender and o.id < m.id order by o.id desc limit 1) end,
    'my_nick',   case when t.sender_id = me then
                   (select o.from_nick from private.dm_msgs o where o.thread_id = t.id and o.from_sender order by o.id desc limit 1) end,
    'to_name',   case when m.from_sender then (select name from private.person(t.recipient_id)) end,
    'to_grade',  case when m.from_sender and not v_reader then (select grade from private.person(t.recipient_id)) end,
    'to_gender', case when not m.from_sender then
                   (select o.from_gender from private.dm_msgs o where o.thread_id = t.id and o.from_sender order by o.id desc limit 1) end,
    'is_reply', exists (select 1 from private.dm_msgs o where o.thread_id = t.id and o.id < m.id and o.is_letter and o.from_sender <> m.from_sender
                        and (o.delivered or private.dm_writer(o, t) = me)),
    'opened', m.opened_at is not null,
    'first_open', v_first,           -- 방금 처음 열었다 (봉투 여는 연출은 이때만)
    'replied', exists (select 1 from private.dm_msgs o where o.thread_id = t.id and o.id > m.id and o.is_letter and o.from_sender <> m.from_sender
                       and (o.delivered or private.dm_writer(o, t) = me)),
    'thread_status', t.status, 'closed_by', t.closed_by,
    -- 답장은 받은 편지에서만, 열린 편지 줄기에서, 답 없이 3통이면 상대 차례
    'can_reply', v_reader and t.status = 'open',
    'wait_reply', t.status = 'open' and private.dm_streak(t.id, t.sender_id = me) >= 3,
    'server_now', now());
end
$fn$;

create or replace function public.dm_folder_put(p_msgs bigint[], p_folder bigint default null, p_name text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare
  me uuid := auth.uid();
  nm text := private.dm_folder_name(p_name);
  fid bigint;
  fname text;
  n int;
  v_offer jsonb;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dm_folder:' || me::text,0));
  if p_msgs is null or cardinality(p_msgs) = 0 or cardinality(p_msgs) > 200 then return jsonb_build_object('status', 'bad_request'); end if;
  if p_folder is not null then
    select id, name into fid, fname from private.dm_folders where id = p_folder and owner_id = me;
    if fid is null then return jsonb_build_object('status', 'not_found'); end if;
  else
    if nm is null or char_length(nm) > 20 then return jsonb_build_object('status', 'bad_name'); end if;
    select id, name into fid, fname from private.dm_folders where owner_id = me and lower(name) = lower(nm);
    if fid is null then
      if (select count(*) from private.dm_folders where owner_id = me) >= 30 then return jsonb_build_object('status', 'too_many'); end if;
      insert into private.dm_folders (owner_id, name) values (me, nm)
        on conflict (owner_id, lower(name)) do nothing returning id, name into fid, fname;
      if fid is null then
        select id, name into fid, fname from private.dm_folders where owner_id = me and lower(name) = lower(nm);
      end if;
    end if;
  end if;
  insert into private.dm_folder_items (owner_id, msg_id, folder_id)
  select me, m.id, fid
    from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
   where m.id = any(p_msgs) and m.is_letter and t.status <> 'removed'
     and case private.dm_box_of(m, t, me) when 'sent' then true when 'received' then m.opened_at is not null else false end
  on conflict (owner_id, msg_id) do update set folder_id = excluded.folder_id, added_at = now();
  get diagnostics n = row_count;
  -- 자동 넣기 (2026-10-06): 다른 폴더로 옮긴 사람의 규칙은 끈다
  delete from private.dm_folder_rules r
   where r.owner_id = me and r.folder_id <> fid
     and r.thread_id in (select m.thread_id from private.dm_msgs m where m.id = any(p_msgs));
  -- offer = 이번에 넣어서 받은 편지가 모두 이 폴더에 들어간 사람 (열린 줄기 · 아직 규칙 없음) — 화면이 "앞으로도 여기에 넣을까요?"를 묻는다
  select coalesce(jsonb_agg(jsonb_build_object('thread_id', x.thread_id, 'from_gender', l.from_gender,
           'from_name', case when not l.from_sender then (select name from private.person(x.recipient_id)) end,
           'from_nick', case when l.from_sender then l.from_nick end)), '[]'::jsonb)
    into v_offer
    from (select t.id as thread_id, t.recipient_id, max(m.id) as last_id
            from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id
            left join private.dm_folder_items fi on fi.owner_id = me and fi.msg_id = m.id
           where t.id in (select o.thread_id from private.dm_msgs o where o.id = any(p_msgs))
             and t.status = 'open' and m.is_letter and private.dm_box_of(m, t, me) = 'received'
             and not exists (select 1 from private.dm_folder_rules r where r.owner_id = me and r.thread_id = t.id)
           group by t.id, t.recipient_id
          having bool_and(coalesce(fi.folder_id = fid, false))) x
    join private.dm_msgs l on l.id = x.last_id;
  return jsonb_build_object('status', 'ok', 'folder', jsonb_build_object('id', fid, 'name', fname), 'moved', n, 'offer', v_offer);
end
$fn$;

create or replace function public.dm_folder_take(p_msgs bigint[])
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); n int;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  delete from private.dm_folder_items where owner_id = me and msg_id = any(coalesce(p_msgs, '{}'));
  get diagnostics n = row_count;
  -- 자동 넣기 (2026-10-06): 폴더에서 뺀 사람의 규칙은 끈다
  delete from private.dm_folder_rules r
   where r.owner_id = me and r.thread_id in (select m.thread_id from private.dm_msgs m where m.id = any(coalesce(p_msgs, '{}')));
  return jsonb_build_object('status', 'ok', 'moved', n);
end
$fn$;

-- 앞으로 이 사람(줄기)의 편지는 이 폴더에 — 내 폴더 · 내가 낀 줄기만
create or replace function public.dm_folder_rule(p_thread bigint, p_folder bigint)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('dm_folder:' || me::text,0));
  if not exists (select 1 from private.dm_folders where id = p_folder and owner_id = me)
     or not exists (select 1 from private.dm_threads where id = p_thread and status <> 'removed' and me in (sender_id, recipient_id)) then
    return jsonb_build_object('status', 'not_found');
  end if;
  insert into private.dm_folder_rules (owner_id, thread_id, folder_id) values (me, p_thread, p_folder)
  on conflict (owner_id, thread_id) do update set folder_id = excluded.folder_id;
  return jsonb_build_object('status', 'ok');
end
$fn$;
revoke all on function public.dm_folder_rule(bigint, bigint) from public, anon;
grant execute on function public.dm_folder_rule(bigint, bigint) to authenticated;
notify pgrst, 'reload schema';
