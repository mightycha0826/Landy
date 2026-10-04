-- 2026-10-04 코드 리뷰 수정.
-- 1) 답변한 계정 삭제 요청도 처리한다. 학생은 삭제 뒤 앱에서 답변을 볼 수 없으므로 안내를 먼저 보내고 삭제하는 순서를 허용한다.
-- 2) AI 요청 승인에서 매 요청 테이블 전체 UPDATE를 뺀다. 15분 응답 정리는 review_cleanup(매분)이 맡고, 만료는 완료 시각으로 판단한다.
-- 3) 뱃지 사진 한 장의 경로만 돌려준다. 열람 기록은 목록을 열 때(admin_badge_requests) 한 번 남긴다.
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
create or replace function public.ai_chat_claim(p_chat uuid, p_user uuid, p_request uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare c private.ai_chats%rowtype; r private.ai_requests%rowtype; cfg public.app_settings%rowtype;
  result jsonb; lease_id uuid := gen_random_uuid(); day_start timestamptz := private.ai_day_start(); spent bigint;
begin
  if p_request is null or p_user is null or p_chat is null then return jsonb_build_object('status','bad_text'); end if;
  select * into cfg from public.app_settings where id;
  if not found or private.in_maintenance() or not cfg.ai_chat or not cfg.is_open then return jsonb_build_object('status','off'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_model_attempt_budget', 0));
  perform 1 from public.profiles where id=p_user and verified and onboarded and status='active'
    and not coalesce(suspended_until > now(),false) for share;
  if not found then return jsonb_build_object('status','restricted'); end if;
  select * into c from private.ai_chats where id=p_chat and user_id=p_user for update;
  if not found then return jsonb_build_object('status','not_found'); end if;
  if c.expires_at <= now() then return jsonb_build_object('status','expired'); end if;
  if char_length(btrim(coalesce(p_text,''))) not between 1 and 10019 then return jsonb_build_object('status','bad_text'); end if;
  select * into r from private.ai_requests where chat_id=p_chat and request_id=p_request;
  if found then
    if r.input_hash <> encode(sha256(convert_to(p_text,'UTF8')),'hex') then return jsonb_build_object('status','bad_text'); end if;
    if r.state='succeeded' then
      if r.reply is null or r.completed_at < now()-interval '15 minutes' then return jsonb_build_object('status','expired'); end if;
      return jsonb_build_object('status','ok','cached',true,'reply',r.reply,'turns',c.turns,'max_turns',cfg.ai_chat_max_turns);
    end if;
    if r.state='pending' and r.leased_until > clock_timestamp() then return jsonb_build_object('status','pending'); end if;
    if r.attempts >= 2 then return jsonb_build_object('status','ai_unavailable'); end if;
  end if;
  if (select count(*) from private.ai_requests req join private.ai_chats chat on chat.id=req.chat_id
    where chat.user_id=p_user and req.state='pending' and req.leased_until > clock_timestamp()) >= 2 then
    return jsonb_build_object('status','pending');
  end if;
  select attempts into spent from private.ai_attempt_budget where day=day_start;
  if coalesce(spent,0) >= cfg.ai_chat_daily_cap::bigint * cfg.ai_chat_max_turns * 2 then return jsonb_build_object('status','off'); end if;
  if r.request_id is null then
    result := public.ai_chat_turn(p_chat,p_user,p_text);
    if result->>'status' <> 'ok' then return result; end if;
    insert into private.ai_requests(chat_id,request_id,input_hash,state,lease,leased_until)
    values(p_chat,p_request,encode(sha256(convert_to(p_text,'UTF8')),'hex'),'pending',lease_id,clock_timestamp()+interval '90 seconds');
    c.turns := c.turns+1;
  else
    update private.ai_requests set state='pending', attempts=attempts+1, lease=lease_id,
      leased_until=clock_timestamp()+interval '90 seconds' where chat_id=p_chat and request_id=p_request;
  end if;
  insert into private.ai_attempt_budget(day,attempts) values(day_start,1)
    on conflict(day) do update set attempts=private.ai_attempt_budget.attempts+1;
  return jsonb_build_object('status','ok','lease',lease_id,'turns',c.turns,'max_turns',cfg.ai_chat_max_turns);
end
$fn$;

create or replace function public.admin_badge_request_photo(p_staff uuid, p_id bigint, p_index int)
returns text language plpgsql security definer set search_path = '' stable as $fn$
declare v text;
begin
  perform private.require_staff(p_staff, true);
  if p_id is null or p_index is null or p_index not between 0 and 2 then return null; end if;
  select r.photos[p_index + 1] into v from private.badge_requests r where r.id = p_id and r.status = 'pending';
  return v;
end
$fn$;
revoke all on function public.admin_badge_request_photo(uuid,bigint,int) from public,anon,authenticated;
grant execute on function public.admin_badge_request_photo(uuid,bigint,int) to service_role;
notify pgrst, 'reload schema';
