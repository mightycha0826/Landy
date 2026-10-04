-- 관리자 전용: 실제 Auth/Storage 삭제는 서버 API, 준비/결과는 복구 가능한 원장.
-- 사용자/문의 FK를 두지 않아 계정 cascade 뒤에도 실행 결과를 확인할 수 있다.
create table if not exists private.account_deletions (
  user_id uuid primary key,
  inquiry_id bigint not null,
  staff_id uuid not null,
  note text not null check (char_length(note) between 5 and 1000),
  status text not null check (status in ('processing','failed','deleted')),
  lease uuid,
  lease_until timestamptz,
  failure_stage text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists account_deletions_recent on private.account_deletions(updated_at desc);
alter table private.account_deletions enable row level security;
revoke all on private.account_deletions from public, anon, authenticated;

create or replace function private.account_delete_assets(p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare result jsonb := '[]'::jsonb;
begin
  if to_regclass('storage.objects') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('bucket',o.bucket_id,'path',o.name)), '[]'::jsonb)
      into result from storage.objects o
     where coalesce(nullif(to_jsonb(o)->>'owner_id',''),to_jsonb(o)->>'owner') = p_user::text
        or (o.bucket_id = 'badge-proofs' and split_part(o.name,'/',1) = p_user::text);
  end if;
  return result;
end
$fn$;
revoke all on function private.account_delete_assets(uuid) from public, anon, authenticated;

create or replace function public.admin_account_delete_prepare(p_staff uuid,p_id bigint,p_user uuid,p_confirm text,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare q private.inquiries%rowtype; job private.account_deletions%rowtype; token uuid := gen_random_uuid(); room uuid;
begin
  if private.require_perm(p_staff,'any') <> 'admin' then raise exception 'admin_only'; end if;
  if p_user = p_staff or exists(select 1 from private.staff where user_id=p_user) then raise exception 'staff_delete_forbidden'; end if;
  if p_id is null or p_user is null or p_confirm is distinct from ('삭제 ' || p_id::text)
    or char_length(btrim(coalesce(p_note,''))) not between 5 and 1000 then raise exception 'bad_delete_confirmation'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account_delete:' || p_user::text,0));
  select * into job from private.account_deletions where user_id=p_user for update;
  if found then
    if job.inquiry_id <> p_id then raise exception 'deletion_target_mismatch'; end if;
    if job.status='deleted' then raise exception 'already_deleted'; end if;
    if job.status='processing' and job.lease_until > now() then raise exception 'deletion_busy'; end if;
  else
    select * into q from private.inquiries where id=p_id for update;
    if not found then raise exception 'inquiry_not_found'; end if;
    if q.user_id <> p_user then raise exception 'deletion_target_mismatch'; end if;
    if q.kind <> 'account' or left(q.body,char_length('[계정 삭제 요청]' || chr(10))) <> '[계정 삭제 요청]' || chr(10)
      then raise exception 'not_deletion_request'; end if;
    if q.answered_at is not null then raise exception 'already_answered'; end if;
    if not exists(select 1 from public.profiles where id=p_user) then raise exception 'user_not_found'; end if;
  end if;
  insert into private.account_deletions(user_id,inquiry_id,staff_id,note,status,lease,lease_until)
    values(p_user,p_id,p_staff,btrim(p_note),'processing',token,now()+interval '10 minutes')
    on conflict(user_id) do update set staff_id=excluded.staff_id,note=excluded.note,status='processing',
      lease=token,lease_until=excluded.lease_until,failure_stage=null,updated_at=now();
  -- 신규 매칭·메시지·사진 업로드를 제한하고 기존 대화를 닫는다. 실패 시 제한 상태에서 재시도한다.
  update public.profiles set status='banned',suspended_until=null where id=p_user;
  update public.user_presence set online_until=now(),seeking_until=null,seeking_since=null where user_id=p_user;
  for room in select room_id from public.room_members where user_id=p_user and open loop
    perform public.close_room(room,'admin');
  end loop;
  insert into private.audit_log(staff_id,action,target_user,detail)
    values(p_staff,'account_delete_started',p_user,jsonb_build_object('inquiry',p_id,'note',btrim(p_note)));
  return jsonb_build_object('user_id',p_user,'lease',token,'auth_exists',exists(select 1 from auth.users where id=p_user),
    'assets',private.account_delete_assets(p_user));
end
$fn$;

create or replace function public.admin_account_delete_finish(p_staff uuid,p_user uuid,p_lease uuid,p_stage text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
declare job private.account_deletions%rowtype;
begin
  if private.require_perm(p_staff,'any') <> 'admin' then raise exception 'admin_only'; end if;
  select * into job from private.account_deletions where user_id=p_user for update;
  if not found or job.status <> 'processing' or job.lease is distinct from p_lease or job.staff_id <> p_staff then
    raise exception 'deletion_lease_invalid'; end if;
  if p_stage is not null then
    if p_stage not in ('auth_lock','storage','auth','record') then raise exception 'bad_delete_stage'; end if;
    update private.account_deletions set status='failed',failure_stage=p_stage,lease=null,lease_until=null,updated_at=now() where user_id=p_user;
    insert into private.audit_log(staff_id,action,target_user,detail)
      values(p_staff,'account_delete_failed',p_user,jsonb_build_object('inquiry',job.inquiry_id,'stage',p_stage));
    return;
  end if;
  if exists(select 1 from auth.users where id=p_user) or jsonb_array_length(private.account_delete_assets(p_user)) <> 0 then
    raise exception 'deletion_not_complete'; end if;
  update private.account_deletions set status='deleted',completed_at=now(),updated_at=now(),lease=null,lease_until=null where user_id=p_user;
  insert into private.audit_log(staff_id,action,target_user,detail)
    values(p_staff,'account_delete_complete',p_user,jsonb_build_object('inquiry',job.inquiry_id));
end
$fn$;

create or replace function public.admin_account_deletions(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = '' stable as $fn$
begin
  if private.require_perm(p_staff,'any') <> 'admin' then raise exception 'admin_only'; end if;
  return coalesce((select jsonb_agg(to_jsonb(d) - 'lease' order by updated_at desc)
    from (select * from private.account_deletions order by updated_at desc limit 50) d),'[]'::jsonb);
end
$fn$;
revoke all on function public.admin_account_delete_prepare(uuid,bigint,uuid,text,text),
  public.admin_account_delete_finish(uuid,uuid,uuid,text),public.admin_account_deletions(uuid) from public,anon,authenticated;
grant execute on function public.admin_account_delete_prepare(uuid,bigint,uuid,text,text),
  public.admin_account_delete_finish(uuid,uuid,uuid,text),public.admin_account_deletions(uuid) to service_role;
notify pgrst, 'reload schema';
