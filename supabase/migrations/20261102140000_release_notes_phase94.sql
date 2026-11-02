-- ════════════════════════════════════════════════════════════════════
--  Phase 94 — 관리자가 눌러야 반영되는 업데이트 · 밀린 업데이트 공지를 한 번에
--
--  · main 에 푸시하면 Cloudflare 는 새 Worker 버전을 올려만 둔다(배포 명령 `npx wrangler versions upload`).
--    학생 화면은 관리자가 운영 화면 "업데이트"(/admin/update)를 눌러 그 버전을 배포할 때 바뀐다 — 배포는 앱 서버가 Cloudflare API 로.
--  · 업데이트하며 쓴 공지는 보통 공지(private.notices)에 release = true 로 남는다 — 알림 화면 · 하트 점은 그대로 쓴다.
--  · 학생이 앱에 들어오면 아직 안 본 업데이트 공지를 한 창에 모아(오래된 것부터) 한 번 보여 준다.
--    어디까지 봤는지는 notice_reads.last_update_id. 가입하기 전에 올라온 업데이트 공지는 보여 주지 않는다.
--  · 업데이트(배포)는 관리자 역할만 — 활동 기록에 'release'(버전 · 공지 번호)로 남는다.
--  실DB 는 supabase/migrations/20261102140000_release_notes_phase94.sql (이 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
alter table private.notices add column if not exists release boolean not null default false;
alter table private.notice_reads add column if not exists last_update_id bigint not null default 0;

-- Phase 16 의 my_notices + 공지마다 release, 어디까지 본 업데이트 공지인지(update_seen)
create or replace function public.my_notices()
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  return jsonb_build_object(
    'notices', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'created_at', n.created_at, 'release', n.release)
                       order by n.id desc)
        from (select * from private.notices where removed_at is null order by id desc limit 30) n
    ), '[]'::jsonb),
    'last_seen', coalesce((select last_id from private.notice_reads where user_id = me), 0),
    'update_seen', greatest(
      coalesce((select last_update_id from private.notice_reads where user_id = me), 0),
      coalesce((select max(n.id) from private.notices n where n.created_at <= (select p.created_at from public.profiles p where p.id = me)), 0)),
    'personal', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body,
                                          'created_at', n.created_at, 'read', n.read_at is not null) order by n.id desc)
        from (select * from private.personal_notices where user_id = me and removed_at is null order by id desc limit 30) n
    ), '[]'::jsonb)
  );
end
$fn$;

-- 학생: 업데이트 공지를 여기까지 봤다. 그 사이에 안 본 보통 공지가 없으면 하트 점(last_id)도 함께 넘긴다 — 창에서 이미 읽었다.
-- 돌려주는 값 = 새 last_id
create or replace function public.mark_updates_seen(p_id bigint)
returns bigint language plpgsql security definer set search_path = public, private as $fn$
declare
  me  uuid := auth.uid();
  v   bigint := greatest(least(coalesce(p_id, 0), coalesce((select max(id) from private.notices where release), 0)), 0);
  old bigint;
  r   bigint;
begin
  if me is null then raise exception 'unauthenticated'; end if;
  old := coalesce((select last_id from private.notice_reads where user_id = me), 0);
  insert into private.notice_reads (user_id, last_id, last_update_id) values (me, old, v)
  on conflict (user_id) do update
     set last_update_id = greatest(private.notice_reads.last_update_id, excluded.last_update_id), updated_at = now();
  update private.notice_reads set last_id = greatest(last_id, v)
   where user_id = me
     and not exists (select 1 from private.notices where removed_at is null and not release and id > old and id <= v)
  returning last_id into r;
  return coalesce(r, old);
end
$fn$;
revoke all on function public.mark_updates_seen(bigint) from public, anon;
grant execute on function public.mark_updates_seen(bigint) to authenticated;

-- 운영자 목록에도 release
create or replace function public.admin_notices(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public, private stable as $fn$
begin
  perform private.require_perm(p_staff, 'any');
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'created_at', created_at, 'release', release)
                     order by id desc)
      from private.notices where removed_at is null
  ), '[]'::jsonb);
end
$fn$;

-- 관리자: 업데이트를 반영했다 (배포는 앱 서버가 Cloudflare 에 먼저 한다). 공지 내용이 있으면 업데이트 공지로 올린다.
-- 돌려주는 값 = 올린 공지 번호 (공지 없이 업데이트만 했으면 null)
create or replace function public.admin_release(p_staff uuid, p_version text, p_title text, p_body text)
returns bigint language plpgsql security definer set search_path = public, private as $fn$
declare v bigint;
begin
  if private.require_perm(p_staff, 'any') <> 'admin' then raise exception 'admin_only'; end if;
  if coalesce(p_version, '') !~ '^[0-9a-f-]{8,64}$' then raise exception 'bad_version'; end if;
  if btrim(coalesce(p_body, '')) <> '' then
    insert into private.notices (title, body, created_by, release)
    values (coalesce(nullif(btrim(p_title), ''), '업데이트 소식'), btrim(p_body), p_staff, true)
    returning id into v;
  end if;
  insert into private.audit_log (staff_id, action, detail)
  values (p_staff, 'release', jsonb_build_object('version', p_version, 'notice', v));
  return v;
end
$fn$;
revoke all on function public.admin_release(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_release(uuid, text, text, text) to service_role;
notify pgrst, 'reload schema';
