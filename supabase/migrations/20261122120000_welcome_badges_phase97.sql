-- ═══════════════════════════════════════
--  Phase 97 — 첫 뱃지는 가입할 때가 아니라 뱃지 안내가 끝난 뒤에
--
--  · 첫 접속(touch_streak)은 개척자 뱃지를 주지 않는다 — 금 등급이면 기본 CNSA 뱃지까지 가입하자마자 열렸다.
--  · claim_welcome_badges() — 프로필 · 뱃지 안내가 끝나면 앱이 부른다. 가입 순서대로 개척자를 계정당 한 번.
--  · welcome_badges_at 은 서버만 쓴다 (profiles 는 열 단위 update 권한이라 학생이 고칠 수 없다).
--  여러 번 실행해도 같다.
-- ═══════════════════════════════════════
alter table public.profiles add column if not exists welcome_badges_at timestamptz;

create or replace function private.touch_streak(p_user uuid)
returns void language plpgsql security definer set search_path = public, private as $fn$
declare today date := (now() at time zone 'Asia/Seoul')::date; s private.user_stats%rowtype; n int;
begin
  if p_user is null then return; end if;
  select * into s from private.user_stats where user_id = p_user;
  if found and s.streak_day = today then return; end if;
  n := case when s.streak_day = today - 1 then coalesce((s.counts->>'streak')::int, 0) + 1 else 1 end;
  insert into private.user_stats (user_id, counts, streak_day) values (p_user, jsonb_build_object('streak', n), today)
  on conflict (user_id) do update
     set counts = private.user_stats.counts || jsonb_build_object('streak', n), streak_day = today, updated_at = now();
  perform private.award_stat(p_user, 'streak', n);
end
$fn$;

create or replace function public.claim_welcome_badges()
returns jsonb language plpgsql security definer set search_path = public, private as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  update public.profiles set welcome_badges_at = now() where id = me and welcome_badges_at is null;
  if not found then return jsonb_build_object('status', 'already'); end if;
  perform private.award_stat(me, 'pioneer',
    (select count(*) from public.profiles o join public.profiles p on p.id = me where o.created_at <= p.created_at));
  return jsonb_build_object('status', 'ok');
end
$fn$;
revoke all on function public.claim_welcome_badges() from public, anon;
grant execute on function public.claim_welcome_badges() to authenticated;
notify pgrst, 'reload schema';
