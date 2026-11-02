-- ════════════════════════════════════════════════════════════════════
--  Phase 93 — 익명 친구들 보기: 대화가 없는 홈에서 "익명 친구들 보기"를 펼치면 무작위 학생 몇 명의 익명 프로필
--
--  · ★ "상대 프로필은 같은 방 멤버에게만"(partner_profile)의 예외는 이 함수 하나다 (운영 결정).
--  · 내보내는 것은 대화 상대 프로필 시트(PartnerCard)와 같은 소개 · 관심사 · MBTI · 매너 온도 · 랜덤채팅용 대표 뱃지 · 접속 여부뿐.
--    실명 · 학번 · 이메일 · uuid · 계정 별명은 없다 — 이름 자리는 부를 때마다 새로 뽑는 임의 별명(random_alias).
--    대표 뱃지로 누구인지 짐작될 수 있다는 점은 알고 정했다 (랜덤채팅에서 숨긴 뱃지는 여기서도 빠진다).
--  · 로그인한 학생만 · 한 번에 10명까지. 나 · 정지 · 가입을 마치지 않은 학생 · 서로 차단한 학생 · 소개가 비어 있는 학생은 뺀다.
--    (탈퇴하면 프로필이 지워진다. 따로 비공개 설정은 없다)
--  · 앱은 화살표를 펼칠 때 한 번만 부른다.
--  실DB 는 supabase/migrations/20261102130000_anon_friends_phase93.sql (이 구역과 같다, 여러 번 실행해도 같다).
-- ════════════════════════════════════════════════════════════════════
create or replace function public.anon_friends()
returns jsonb language plpgsql volatile security definer set search_path = '' as $fn$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'unauthenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'nickname',    public.random_alias(),
             'bio',         x.bio,
             'interests',   to_jsonb(x.interests),
             'mbti',        x.mbti,
             'manner_temp', x.manner_temp,
             'badges',      private.featured_for(x.id, 'chat'),
             'online',      coalesce((select up.online_until > now() from public.user_presence up where up.user_id = x.id), false)))
      from (select p.id, p.bio, p.interests, p.mbti, p.manner_temp
              from public.profiles p
             where p.id <> me and p.verified and p.onboarded
               and p.status = 'active' and (p.suspended_until is null or p.suspended_until <= now())
               and (p.bio <> '' or p.mbti is not null or cardinality(p.interests) > 0)
               and not private.blocked_between(me, p.id)
             order by random()
             limit 10) x
  ), '[]'::jsonb);
end
$fn$;
revoke all on function public.anon_friends() from public, anon;
grant execute on function public.anon_friends() to authenticated;
notify pgrst, 'reload schema';
