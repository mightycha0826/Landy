# 운영 DB 반영 — 2026-10-04

운영 로그인에서 표시된 `서버 오류 (99b06aff)`를 조사했다. 배포된 공개 로그인 페이지가 연결하는 Supabase `LOVE`에서 `admin_session_issue`, `admin_session_valid`, `admin_session_revoke`와 `private.admin_sessions`가 누락돼 있었다. 해당 계정은 운영진으로 등록되어 있었다. 오류 번호에 해당하는 Cloudflare 원본 로그는 확보하지 못했다.

사용자의 DB 변경 요청에 따라 Supabase 플러그인의 마이그레이션 도구로 아래 파일을 순서대로 적용했다. 기존 DB에 `schema.sql` 전체를 실행하지 않았다.

| 저장소 파일 | 운영 이력의 이름 | 운영 이력의 버전 |
|---|---|---|
| [10월 2일 보안 변경](../supabase/migrations/20261004020711_security_hardening_20261002.sql) | `security_hardening_20261002` | `20261004020711` |
| [10월 3일 업그레이드](../supabase/migrations/20261004020721_project_review_upgrade.sql) | `project_review_upgrade` | `20261004020721` |

운영 버전은 도구가 실행 시점에 생성했다. 이후 저장소 파일명을 운영 이력의 버전·이름에 맞춰 바꿨다(2026-10-04 리뷰 수정). 그래서 같은 SQL이 다른 버전으로 다시 적용되지 않는다. 단, 10월 2일 보안 변경 이전의 운영 이력은 저장소에 사본이 없으므로(0950e25에서 정리) CLI `db push` 전에는 원격 이력과 로컬 파일 차이를 먼저 확인한다. 두 도구 실행 모두 성공했고 운영 마이그레이션 목록에서도 확인했다.

## 확인 결과

- 운영자 세션 함수 3개와 세션 테이블 생성 완료. 함수는 `service_role`만 실행할 수 있으며 `anon`, `authenticated`에는 실행 권한이 없다.
- 추가된 private 테이블 7개 모두 RLS가 활성화되어 있고 `anon`, `authenticated`의 직접 조회 권한이 없다.
- AI 요청·예약 정리·푸시 재시도·CSV 내보내기에 필요한 RPC 8개가 존재한다.
- 실제 운영진 계정의 기존 Auth 세션을 DB 내부에서 사용해 발급 → 검증 → 폐기를 검사했다. 다른 사용자, 만료된 세션, 폐기한 세션, 잘못된 Auth 세션도 거부되는 것을 확인했다. 테스트는 트랜잭션을 롤백해 테스트용 운영자 세션을 남기지 않았다. 토큰·비밀번호·사용자 ID를 결과에 출력하지 않았다.
- 보안 Advisor에는 기존 경고 2종이 유지됐다: 학생용 SECURITY DEFINER 함수 실행 권한, 유출 비밀번호 차단 비활성화. 새 운영자 세션 함수는 학생에게 노출되지 않았다. private 테이블의 정책 없음 안내는 직접 접근을 거부하고 서버 함수로만 접근하는 설계에 해당한다.

기존 경고 참고: [SECURITY DEFINER 실행 권한 안내](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [유출 비밀번호 차단 설정](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

이번 작업은 운영 DB 변경이다. Cloudflare 재배포와 브라우저 비밀번호 로그인을 수행하지 않았다. DB에서 로그인 경로의 누락을 해소하고 세션 기능을 검증했으며, 사용자는 운영 페이지에서 다시 로그인해 전체 로그인 흐름을 확인할 수 있다.

## 리뷰 수정 반영 — 2026-10-04

[리뷰 수정](../supabase/migrations/20261004150534_review_fixes_20261004.sql)을 운영 DB에 `review_fixes_20261004`(버전 `20261004150534`)으로 적용했다. 데이터는 바꾸지 않고 함수 셋만 바꾼다.

- `admin_account_delete_prepare`: 답변한 계정 삭제 요청도 삭제를 시작할 수 있다.
- `ai_chat_claim`: 요청마다 하던 `ai_requests` 전체 UPDATE를 뺐다. 15분이 지난 응답은 완료 시각으로 만료 처리하고, 지우는 일은 매분 도는 `review_cleanup`이 맡는다.
- `admin_badge_request_photo`(새 함수): 운영진방 사진 한 장의 경로만 돌려준다. 예전처럼 사진마다 목록 RPC를 불러 열람 기록이 사진 수만큼 쌓이는 일이 없다. `service_role`만 실행할 수 있다.

적용 뒤 운영 DB의 세 함수 본문 해시가 `schema.sql`과 같은지, 새 함수를 `anon`·`authenticated`가 실행할 수 없는지 확인했다. 새 사진 엔드포인트가 이 함수를 쓰므로 DB를 먼저 반영하고 앱을 배포했다.
