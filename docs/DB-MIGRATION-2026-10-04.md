# 운영 DB 반영 — 2026-10-04

운영 로그인에서 표시된 `서버 오류 (99b06aff)`를 조사했다. 배포된 공개 로그인 페이지가 연결하는 Supabase `LOVE` (`nweugmldhugosrrcdhkh`)에서 `admin_session_issue`, `admin_session_valid`, `admin_session_revoke`와 `private.admin_sessions`가 누락돼 있었다. 해당 계정은 운영진으로 등록되어 있었다. 오류 번호에 해당하는 Cloudflare 원본 로그는 확보하지 못했다.

사용자의 DB 변경 요청에 따라 Supabase 플러그인의 마이그레이션 도구로 아래 파일을 순서대로 적용했다. 기존 DB에 `schema.sql` 전체를 실행하지 않았다.

| 저장소 파일 | 운영 이력의 이름 | 운영 이력의 버전 |
|---|---|---|
| [10월 2일 보안 변경](../supabase/migrations/20261002_security_hardening.sql) | `security_hardening_20261002` | `20261004020711` |
| [10월 3일 업그레이드](../supabase/migrations/20261003063750_project_review_upgrade.sql) | `project_review_upgrade` | `20261004020721` |

운영 버전은 도구가 실행 시점에 생성했다. 파일명 날짜와 운영 버전이 다르므로 이후 CLI 배포 시 이 대응 관계를 확인해 이미 반영된 SQL을 중복 적용하지 않는다. 두 도구 실행 모두 성공했고 운영 마이그레이션 목록에서도 확인했다.

## 확인 결과

- 운영자 세션 함수 3개와 세션 테이블 생성 완료. 함수는 `service_role`만 실행할 수 있으며 `anon`, `authenticated`에는 실행 권한이 없다.
- 추가된 private 테이블 7개 모두 RLS가 활성화되어 있고 `anon`, `authenticated`의 직접 조회 권한이 없다.
- AI 요청·예약 정리·푸시 재시도·CSV 내보내기에 필요한 RPC 8개가 존재한다.
- 실제 운영진 계정의 기존 Auth 세션을 DB 내부에서 사용해 발급 → 검증 → 폐기를 검사했다. 다른 사용자, 만료된 세션, 폐기한 세션, 잘못된 Auth 세션도 거부되는 것을 확인했다. 테스트는 트랜잭션을 롤백해 테스트용 운영자 세션을 남기지 않았다. 토큰·비밀번호·사용자 ID를 결과에 출력하지 않았다.
- 보안 Advisor에는 기존 경고 2종이 유지됐다: 학생용 SECURITY DEFINER 함수 실행 권한, 유출 비밀번호 차단 비활성화. 새 운영자 세션 함수는 학생에게 노출되지 않았다. private 테이블의 정책 없음 안내는 직접 접근을 거부하고 서버 함수로만 접근하는 설계에 해당한다.

기존 경고 참고: [SECURITY DEFINER 실행 권한 안내](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [유출 비밀번호 차단 설정](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

이번 작업은 운영 DB 변경이다. Cloudflare 재배포와 브라우저 비밀번호 로그인을 수행하지 않았다. DB에서 로그인 경로의 누락을 해소하고 세션 기능을 검증했으며, 사용자는 운영 페이지에서 다시 로그인해 전체 로그인 흐름을 확인할 수 있다.
