-- ════════════════════════════════════════════════════════════════════
--  Phase 105 — 익명편지: 다른 성별인 척 못 하게
--
--  익명 쪽(처음 보낸 사람)은 서명 · 본문에 자기와 다른 성별의 "익명의 ○학생"을 적지 못한다
--  (남학생 → "익명의 여학생", 여학생 → "익명의 남학생", 성별 미정 → 둘 다). 띄어쓰기 · 문장부호를 끼워도 한글만 남겨 본다.
--  막히면 dm_send · dm_letter 가 'gender_word'. 이름으로 받은 쪽의 답장은 상대를 "익명의 ○학생"이라 부를 수 있어 보지 않는다.
--  봉투 색(쓴 사람 성별)은 화면에서 — 받은 편지는 보낸 사람, 보낸 편지는 내 성별 색.
--  실DB 는 이 파일을 실행한다 (schema.sql 의 같은 함수와 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
create or replace function private.dm_fake_gender(p_me uuid, p_text text)
returns boolean language sql stable set search_path = '' as $fn$
  select coalesce(regexp_replace(p_text, '[^가-힣]', '', 'g')
           ~ ('익명의' || case p.gender when 'm' then '여' when 'f' then '남' else '[남여]' end || '학생'), false)
    from public.profiles p where p.id = p_me;
$fn$;
revoke all on function private.dm_fake_gender(uuid, text) from public, anon, authenticated;

create or replace function public.dm_send(p_to uuid, p_body text, p_fmt jsonb default null, p_nick text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text; t private.dm_threads%rowtype; b jsonb; p public.profiles%rowtype; mid bigint;
        v_delivery boolean;
        v_body text := btrim(coalesce(p_body, ''));
        v_fmt jsonb := case when p_fmt is null or p_fmt = '{}'::jsonb or jsonb_typeof(p_fmt) = 'null' then null else p_fmt end;
        v_nick text := private.dm_nick(p_nick);
begin
  if me is null then raise exception 'unauthenticated'; end if;
  v := private.dm_can_write(me);
  if v is not null then return jsonb_build_object('status', v); end if;
  if p_to is null or p_to = me then return jsonb_build_object('status', 'not_available'); end if;
  if char_length(v_body) not between 1 and 1000 then return jsonb_build_object('status', 'bad_text'); end if;
  -- 서식 위치는 본문 기준이라, 앞뒤 공백이 잘려 나가면 어긋난다 — 클라가 미리 잘라서 보낸다
  if v_fmt is not null and (v_body <> p_body or not private.letter_fmt_ok(v_fmt, v_body)) then
    return jsonb_build_object('status', 'bad_text');
  end if;
  if private.dm_nick_bad(v_nick) then return jsonb_build_object('status', 'bad_nick'); end if;
  if private.dm_fake_gender(me, v_nick) or private.dm_fake_gender(me, v_body) then return jsonb_build_object('status', 'gender_word'); end if;

  select * into p from public.profiles where id = p_to;
  if not found or not p.letters_open or not p.onboarded then
    return jsonb_build_object('status', 'not_available');
  end if;
  -- 차단 · 수신 거부 · 정지는 계정별 전송 응답으로 익명 상대를 찾는 단서가 되지 않는다.
  -- 발신자 편지는 똑같이 저장하고 한도를 적용하되, 수신자에게 전달하지 않는다.
  v_delivery := p.status = 'active' and not coalesce(p.suspended_until > now(), false)
    and not private.blocked_between(me, p_to)
    and not exists (select 1 from private.dm_threads where sender_id = me and recipient_id = p_to and recipient_refused);

  select * into t from private.dm_threads where sender_id = me and recipient_id = p_to and status = 'open' for update;
  if found then
    if private.dm_streak(t.id, true) >= 3 then return jsonb_build_object('status', 'wait_reply', 'thread_id', t.id); end if;
    b := private.letter_bucket_take(me, 'comment');
  else
    b := private.letter_bucket_take(me, 'letter');       -- 새 편지는 편지 한도 (기본 하루 3통)
  end if;
  if not (b->>'ok')::boolean then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_ms', (b->>'retry_after_ms')::int);
  end if;
  if t.id is null then
    insert into private.dm_threads (sender_id, recipient_id, sender_alias)
    values (me, p_to, private.letter_alias_candidate()) returning * into t;
  end if;
  insert into private.dm_msgs (thread_id, from_sender, body, fmt, is_letter, from_nick, delivered)
  values (t.id, true, v_body, v_fmt, true, v_nick, v_delivery) returning id into mid;
  update private.dm_threads set last_at = now(), sender_read = mid where id = t.id;
  return jsonb_build_object('status', 'ok', 'thread_id', t.id, 'msg_id', mid);
end
$fn$;

create or replace function public.dm_letter(p_thread bigint, p_body text, p_fmt jsonb default null, p_nick text default null)
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid(); v text; role text; t private.dm_threads%rowtype; b jsonb; mid bigint;
        v_other uuid; v_delivery boolean;
        v_body text := btrim(coalesce(p_body, ''));
        v_fmt jsonb := case when p_fmt is null or p_fmt = '{}'::jsonb or jsonb_typeof(p_fmt) = 'null' then null else p_fmt end;
        v_nick text := private.dm_nick(p_nick);
begin
  if me is null then raise exception 'unauthenticated'; end if;
  select * into t from private.dm_threads where id = p_thread for update;
  role := case when t.sender_id = me then 'sender' when t.recipient_id = me then 'recipient' end;
  if role is null or t.status = 'removed' then return jsonb_build_object('status', 'not_found'); end if;
  if t.status <> 'open' then return jsonb_build_object('status', 'closed'); end if;
  v := private.dm_can_write(me);
  if v is not null then return jsonb_build_object('status', v); end if;
  if char_length(v_body) not between 1 and 1000 then return jsonb_build_object('status', 'bad_text'); end if;
  if v_fmt is not null and (v_body <> p_body or not private.letter_fmt_ok(v_fmt, v_body)) then
    return jsonb_build_object('status', 'bad_text');
  end if;
  v_other := case when role = 'sender' then t.recipient_id else t.sender_id end;
  v_delivery := not private.blocked_between(t.sender_id, t.recipient_id)
    and not exists (select 1 from public.profiles p where p.id = v_other
                     and (p.status <> 'active' or coalesce(p.suspended_until > now(), false)))
    and not exists (select 1 from private.dm_threads x
                     where x.sender_id = me and x.recipient_id = v_other and x.recipient_refused);
  if role <> 'sender' then v_nick := null; end if;
  if private.dm_nick_bad(v_nick) then return jsonb_build_object('status', 'bad_nick'); end if;
  if role = 'sender' and (private.dm_fake_gender(me, v_nick) or private.dm_fake_gender(me, v_body)) then
    return jsonb_build_object('status', 'gender_word');
  end if;
  if private.dm_streak(p_thread, role = 'sender') >= 3 then return jsonb_build_object('status', 'wait_reply'); end if;
  b := private.letter_bucket_take(me, 'comment');
  if not (b->>'ok')::boolean then
    return jsonb_build_object('status', 'rate_limited', 'retry_after_ms', (b->>'retry_after_ms')::int);
  end if;
  insert into private.dm_msgs (thread_id, from_sender, body, fmt, is_letter, from_nick, delivered)
  values (p_thread, role = 'sender', v_body, v_fmt, true, v_nick, v_delivery) returning id into mid;
  if role = 'sender' then update private.dm_threads set last_at = now(), sender_read = mid where id = p_thread;
  else update private.dm_threads set last_at = now(), recipient_read = mid where id = p_thread; end if;
  return jsonb_build_object('status', 'ok', 'thread_id', p_thread, 'msg_id', mid);
end
$fn$;

notify pgrst, 'reload schema';
