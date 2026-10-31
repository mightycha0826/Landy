# Landy 최종 종합 점검 — 2026-10-31

기준 커밋 `3576fca` + 이번 작업의 미커밋 변경. 이번 작업은 **로컬 점검 · 수정 · 검증까지**이며 커밋 · 푸시 · 배포 · 운영 DB 조회/변경은 하지 않았다.

이 문서의 상태 표기:

| 상태 | 뜻 |
|---|---|
| 통과 | 이번에 실제로 실행한 검사(단위 · PGlite · 가짜 Supabase 브라우저)로 확인 |
| 수정 후 통과 | 이번에 발견 → 수정 → 같은 방법으로 다시 실행해 확인 |
| 코드 확인 | 코드만 읽고 판단 (실행 근거 없음) — **통과로 세지 않는다** |
| 차단 | 계정 · 실기기 · 운영 환경이 없어 이번에 검증할 수 없음 |
| 해당 없음 | 현재 제품 범위에 없음 |

> **검증 환경의 한계** — `npm run test:ui` 는 가짜 Supabase(Playwright 요청 가로채기 · 로컬 HTTP 목)와 `vite dev`, `/dev/*` 미리보기로 돈다. 실제 Supabase Auth · RLS · Realtime · Storage · Workers AI · 푸시 서버 · Cloudflare 런타임을 검증한 것이 아니다. DB 로직은 PGlite(단일 연결)에서 검증했고 동시 트랜잭션은 재현하지 않는다. 모바일은 Chrome 데스크톱의 화면 크기 에뮬레이션(360×740 · 390×844 등)이며 iOS · Android 실기기, 설치 · 가상 키보드 · OS 뒤로가기 · 푸시 · 백그라운드 동작은 검증하지 않았다.

---

## 1. 결론

- **출시를 막는 문제(P0 · P1)는 이번 점검에서 찾지 못했다.** 익명성 경계(messages · room_members · presence · 상대 프로필 · 편지 발신자)는 PGlite 권한 검사로 통과했고, 이번 변경은 이 경계를 건드리지 않는다. 단, 실제 Supabase · 실기기 · 동시성은 검증하지 못했으므로(8절) "출시 가능"이 아니라 "로컬에서 확인한 범위에서 막는 문제 없음"이다.
- 찾은 것은 **앱 21건(P2 13 · P3 8)** 과 **테스트 하네스 6건**, 문서 불일치 몇 건이다. 가장 많은 유형은 **못 불러온 것을 "없음"이나 끝없는 "불러오는 중"으로 보이는 것(UX G4)** 으로 7개 화면(문의 · 뱃지 제출 · 편지 찾기/추천 · 편지 열기/답장 · 공지 · 알림)에 같은 원인이 있었고 모두 고쳤다.
- 그 밖에: 학교 메일 붙여넣기가 학생 · 운영자 로그인을 막던 것(F01), 틀린 인증 코드를 "만료"로 안내(F02), 기본 테마 버튼 · 말풍선의 흰 글자 대비 4.12:1(F07a), 편지 잠금의 화면/서버 불일치(F12), 당겨서 새로고침이 찾기를 끊던 것(F20), 운영 빌드에 열려 있던 `/dev/pins`(F07).
- 최종 검사: `npm run check` 0 오류 · `npm test` 전부 통과(schema 1149) · `npm run build` 성공 · `npm run test:ui` 28 스위트 중 26 은 한 번의 전체 실행에서 통과, 나머지 2(hit · react)는 원인 확인 뒤 따로 다시 돌려 통과(6절). DB 마이그레이션 · 새 설정 없음.

---

## 2. 작업 환경과 기준선

- Windows 11 · Node 22.18 · npm 10 · Chrome 156 (Playwright `playwright-core` 1.55 에 `CHROMIUM_PATH` 로 연결).
- 저장소 안에서 사용자의 `vite dev`(5173 · 5175, 10-28부터 실행 중)가 `.svelte-kit` 을 쓰고 있어 `npm run build` 가 `EBUSY`(`.svelte-kit/cloudflare`)로 실패했다. 사용자 프로세스는 건드리지 않고, **저장소를 임시 폴더로 미러링(node_modules 는 junction)** 해서 build · test:ui 를 돌렸다. 미러에는 `.env` · 명렬표 · `.git` 을 복사하지 않았다.
- 이 PC 는 TCP 54390–54489 를 Windows(Hyper-V)가 예약해 두어, 가짜 서버를 5439x 에 띄우는 e2e 9개 스위트가 `EACCES` 로 시작도 못 했다. **미러 안에서만** 포트를 5479x 로 바꿔 실행했다(저장소의 테스트 파일은 그대로 — 리눅스 CI 에는 문제가 없다).
- 미러의 `node_modules` 를 저장소로 잇는 junction 은 두 가지 부작용이 있어 고쳤다: ① Vite 의존성 캐시(`node_modules/.vite`)를 사용자의 dev 서버와 함께 쓰게 됨 → 미러는 패키지별 junction 으로 바꾸고 `.vite` 는 미러 안에 따로. (첫 실행 동안 저장소의 `.vite` 캐시가 다시 만들어졌다 — 지워도 되는 캐시이고 다음 실행 때 다시 생긴다.) ② 글꼴 파일이 Vite 허용 경로 밖으로 풀려 403 → 손글씨 글꼴이 안 실려 letters 의 "글줄마다 줄 위에 앉는다"가 실패 → 글꼴 패키지 두 개만 미러에 실제로 복사. 그 뒤 측정: 줄 위치 5/5/5px · 높이 24px(통과 조건).
- `npm run test:e2e` · `npm run test:match` · `dev-user` · `cleanup-test-users` 는 실제 Supabase 프로젝트에 계정을 만들고 지우므로 **실행하지 않았다** (격리된 Supabase 프로젝트가 필요).

| 검사 | 기준선(수정 전) | 비고 |
|---|---|---|
| `npm run check` | 0 errors · 0 warnings (742 files) | |
| `npm test` | 전부 통과 (`test:schema` 1149 passed) | PGlite |
| `npm run build` | 저장소: EBUSY (환경) / 미러: 성공 | 클라이언트 번들에 서버 비밀 이름 없음 확인 |
| `npm run test:ui` (28 스위트) | 아래 표 | |

기준선 test:ui 실패 (수정 전 미러):

| 스위트 | 결과 | 판단 |
|---|---|---|
| admin · admin-ai · admin-deletion · admin-notices · audit | 시작 못 함 (EACCES 5439x) | 환경 — 포트 바꿔 재실행 (6절) |
| features | 75/76 — "✕ 로 답장 취소" | 테스트 경합 (T04) |
| hit | 12/13 — chat-vote(390×844) 겹침 6 > 2 | 닫힌 접기 안 링크 · 측정 시점 (T03) |
| intro | `page.goto /dev/chat` 30초 시간 초과 → 재실행 땐 strict mode 오류 | 낡은 선택자 (T02) · 첫 실행은 공유 `.vite` 캐시 재생성으로 느린 시동 |
| letters | "글줄마다 줄 위에 앉는다" 실패 · 이어서 대기 시간 초과 | 미러의 글꼴 403 (위 ②) — 앱 결함 아님 |
| wrap | `page.goto /install` 시간 초과 | 첫 실행의 느린 시동 — 6절 재실행 |
| 그 밖 18개 | 모두 통과 | |

---

## 3. 화면 · 기능 검증표

역할 표기: 학생(미가입 / 가입 · 미온보딩 / 온보딩 완료), 운영(moderator · developer · beta · admin · owner 속성).
"검증" 칸의 스위트 이름은 `scripts/e2e/<이름>.mjs`, `unit` 은 `npm run test:unit` 묶음, `schema` 는 `npm run test:schema`.

### A. 첫 방문 · 설치 · 인증

| ID | 화면 · 기능 (파일) | 역할 · 조건 | 정상 · 예외 경로와 검증 근거 | 발견 → 수정 | 미검증 · 이유 | 상태 |
|---|---|---|---|---|---|---|
| A1 | 설치 전 소개 `/welcome` (`routes/welcome`) | 누구나 | 샘플 대화 · 편지, 요청 0건, 320/390/560px 가로 넘침 없음 (product) | F13 머리글의 자기 자신 링크 · 36px "시작하기"(하단 고정 버튼과 중복) 제거 | 실기기 | 수정 후 통과 |
| A2 | 설치 안내 `/install` (`routes/install`, `lib/platform.ts`) | 일반 · 인앱 · 삼성 인터넷 | UA 판별(platform), 소개 진입(product) | F14 설치 창 오류 시 버튼이 처리 중에 머묾 → catch | 실제 설치 · 인앱 브라우저 · iOS 홈 화면 추가 | 수정 후 통과(코드) |
| A3 | 설치 게이트 · 부팅 가드 (`routes/+layout.svelte`, `state.svelte.ts`) | 비설치/설치 | `?gate` · 로그인 · 온보딩 가드 · 부팅 오류 재시도 (ux, login, account) | — | standalone 실기기 | 통과 |
| A4 | 로그인 `/login` 학번 + 비밀번호 | 가입 학생 | 성공 · 실패 · 학번 형식 · 선생님 안내 (login) | **F01** 학교 메일 전체 붙여넣기 · 자동 완성이 "선생님이신가요?"로 막힘 → 도메인 떼기(UX G6.2) · `enterkeyhint` | 실제 Auth 한도 | 수정 후 통과 |
| A5 | 가입 · 인증 코드 (OtpInput) | 미가입 | 코드 요청 · 6칸 · 붙여넣기 · 재전송 60초 (login) | **F02** 틀린 코드를 "만료 · 다시 받기"로 안내 → 문구 분리 | 실제 메일 발송 · OTP 길이/만료 Auth 설정 | 수정 후 통과(unit) |
| A6 | 비밀번호 찾기 → `/settings#password` | 가입 학생 | 새 계정 미생성 · 가입 여부 비노출 · 이동 (login) | — | 실제 Auth 재인증 설정(R08) | 통과 |
| A7 | 온보딩 `/onboarding` | 가입 · 미온보딩 | 선호 자동 선택 없음 · 공개 범위 안내 (product) | **F08** 꺼진 시작 버튼에 남은 조건 없음(G6.3) · 선택 버튼 `aria-pressed` 없음 → 추가 | 실제 명렬표 · 이름 저장 | 수정 후 통과 |
| A8 | 세션 복원 · 계정 전환 · 늦은 응답 (`accountScope`, `state`) | 두 계정 | A→B 전환 시 캐시 · 초안 · 알림 · 응답 격리 (account, letters-state) | — | 실제 Supabase 토큰 갱신 | 통과 |
| A9 | 점검 · 이용 정지 · 서비스 닫힘 | 학생 | 점검 화면 · 박동 해제 (server, schema), 정지 시 찾기 중단 (코드) | — | 실서버 점검 예약 | 통과 |
| A10 | 운영자 로그인 `/admin/login` | 운영 | 쿠키 위조 · 만료 · 명단 해제 (admin-session, admin) | F01 같은 원인(`schoolEmail` 이 `x@cnsa.hs.kr@cnsa.hs.kr` 생성) → 공용 함수에서 해결 · Enter 연타 중복 요청 방지 | 실제 Auth | 수정 후 통과 |

### B. 홈 · 매칭 · 채팅

| ID | 화면 · 기능 | 역할 · 조건 | 정상 · 예외 경로와 검증 근거 | 발견 → 수정 | 미검증 · 이유 | 상태 |
|---|---|---|---|---|---|---|
| B1 | 홈 대화 목록 `/` (`RoomList`, `inbox.svelte.ts`) | 온보딩 완료 | 목록 · 고정 · 실패 시 다시 시도 (ux, back, requests) | — | 실제 Realtime `inbox:` | 통과 |
| B2 | 상대 찾기 · 취소 · 탭 이동 유지 (`seeker`, `pollSeeker`, `(app)/+layout`) | 학생 | 폴링 간격 · 백그라운드 정지 · 탭 유지 · 탭 밖 취소 (requests, ux, back, chat) | **F20** 찾는 중 당겨서 새로고침이 찾기를 말없이 끊음 · 10초 제한 없음 → 찾는 동안 끄고 10초 제한 (탭별 로더는 D1) | 실서버 동시 매칭(`test:match` 미실행) | 수정 후 통과 |
| B3 | 대화방 입장 · 메시지 · 낙관적 병합 · 재전송 (`room.svelte.ts`, `message-ledger`) | 방 멤버 | 순서 역전 · 중복 · 유실 · 재연결 · 늦은 실패 (chat 45KB 회귀 묶음) | — | 실제 Realtime 전달 | 통과 |
| B4 | 공감 · 답장 · 삭제 · 밀어서 답장 (`ReactionPicker`, `gestures`) | 방 멤버 | react, features | 테스트 경합 T04 (앱 결함 아님) | 실기기 제스처 | 통과 |
| B5 | 시간 · 정지 · 연장 투표 · 공개 순서 · 고정 (`VoteBanner`) | 방 멤버 | chat, schema, hit(chat-vote) | 측정 시점 문제 T03 · T06 (앱 결함 아님) | 실서버 동시 투표 | 통과 |
| B6 | 나가기 · 차단 · 신고 · 평가 (`RoomActions`, `RateQueue`) | 방 멤버 | sheet, chat, schema (성공 후에만 이동 · 실패 시 시트 유지) | — | | 통과 |
| B7 | 대화 봇 (`bot/*`, `/api/ai-chat`) | 찾는 중 20초 | bot, admin-ai, aichat, schema (직접 누르기 전 세션 없음, 점검 · 정지 차단) | — | 실제 Workers AI | 통과 |
| B8 | 상대 프로필 시트 (`PartnerCard`) | 방 멤버 | 실패 문구 있음 (코드), uuid 없음 (schema) | P3 다시 시도 버튼 없음(시트를 다시 열면 재요청) — 유지 | | 코드 확인 |

### C. 익명편지

| ID | 화면 · 기능 | 역할 · 조건 | 정상 · 예외 경로와 검증 근거 | 발견 → 수정 | 미검증 · 이유 | 상태 |
|---|---|---|---|---|---|---|
| C1 | 편지 잠금 (`gate.svelte.ts`, `LettersGate`) | 잠금 켬 | 잠금 · 실시간 인원 (audit, back) | **F12** 통계를 못 읽거나 행이 없으면 화면은 열고 서버는 잠가(R24) 다 쓴 편지가 거절됨 → 서버와 같은 쪽(잠김/판단 보류)으로 | 실제 `signups` 방송 | 수정 후 통과(코드·check) |
| C2 | 받는 사람 찾기 · 추천 `/letters/new` | 편지 열림 | 2글자 · 동명이인 학번 · 추천 3명 (letters, product) | **F05** 검색 실패를 토스트만 + "두 글자 이상" 안내로 · **F06** 추천 실패를 빈 화면으로 → 그 자리에 이유 · 다시 시도. 낡은 주석(차단하면 검색에서 빠짐) 정정 | 실서버 `dm_search` | 수정 후 통과(check) |
| C3 | 편지 쓰기 · 서식 · 서명 · 초안 (`EnvelopeCompose`, `LetterEditor`, `drafts.ts`) | 편지 열림 | 초안 계정별 · 24시간 · 전송 실패 시 연출 중단 (letters, account, letters-state) | — | 실기기 IME 조합 | 통과 |
| C4 | 편지함 · 우체통 · 봉투 열기 `/letters`, `/letters/m/[id]` | 받은 · 보낸 사람 | 연출 · 건너뛰기 · 읽음 (letters, motion) | **F09** 열기 요청이 네트워크 오류면 토스트만 남기고 "봉투를 가져오는 중…"(우체통을 눌러 왔으면 연출)에 머묾 → 이유 · 다시 시도 | | 수정 후 통과 |
| C5 | 답장 `/letters/m/[id]/reply` | 받은 사람 | letters | **F09** 같은 원인으로 빈 화면 → 이유 · 다시 시도 · 가져오는 중 표시 | | 수정 후 통과(check) |
| C6 | 보관함 · 폴더 · 자동 분류 · 선택 · 삭제 `/letters/archive`, `/letters/f/[id]` | 본인 | 오류 · 더보기 · 선택 완료 순서 (letters, letters-state, schema) | — | 실서버 동시 폴더 생성(R28) | 통과 |
| C7 | 버리기 · 차단 · 신고 (`LetterMenu`) | 받은 사람 | 전달 차단과 발신 응답 분리 · 신원 비노출 (schema, letters) | — | | 통과 |
| C8 | 스토리 이미지 공유 (`story.ts`) | 받은 사람 | letters | — | 실기기 공유 시트 | 통과 |

### D. 프로필 · 설정 · 지원

| ID | 화면 · 기능 | 역할 · 조건 | 정상 · 예외 경로와 검증 근거 | 발견 → 수정 | 미검증 · 이유 | 상태 |
|---|---|---|---|---|---|---|
| D1 | 프로필 `/me` · 소개 · 관심사 · 초안 | 학생 | achievements, back, account | — | | 통과 |
| D2 | 업적 · 대표 뱃지 · 교복 `/me/achievements` | 학생 | achievements (76) | — | | 통과 |
| D3 | 뱃지 제출 `/me/achievements/submit` · 증빙 사진 | 학생 | badge-photo-cleanup, schema | **F04** 뱃지 목록 · 보낸 요청을 못 불러오면 "뱃지 없음 · 요청 없음"처럼 보여 거두기 불가 · 중복 제출 유도 → 이유 · 다시 시도. **F15** 거두기 토스트 "사진도 지웠어요"(실패 시 예약 재시도인데 단정) → "곧 지워져요" | 실제 Storage | 수정 후 통과(check) |
| D4 | 알림 `/activity` | 학생 | notices, back | **F11** 세 목록을 다 못 불러오면 뼈대가 끝나지 않거나 "새 알림을 모두 확인했어요" → 이유 · 다시 시도 | | 수정 후 통과 |
| D5 | 공지 하나 `/notices/[id]` | 학생 | notices, ux | **F10** 못 불러오면 뼈대가 끝나지 않음 · **F16** 앱이 기억한 목록에 없는 새 공지(알림으로 들어옴)를 다시 읽지 않고 "찾을 수 없어요" → 열 때 한 번 새로 읽기 | | 수정 후 통과 |
| D6 | 설정 `/settings` · 테마 · 글자 · 움직임 · 알림 | 학생 | back, motion, a11y, push | **F07a** 기본 테마 그라데이션 첫 점 `#e5402a` 가 흰 글자와 4.12:1 (주 버튼 · 내 말풍선, WCAG AA 미달 — app.css 주석은 4.5 이상이라 적힘) → `#d33b27`(4.75) · 회귀 단위 테스트 | 실기기 푸시 권한 | 수정 후 통과 |
| D7 | 문의 `/settings/contact` | 학생 | (ux 추가) | **F03** 내 문의를 못 불러오면 "아직 보낸 문의가 없어요" → 이유 · 다시 시도 | | 수정 후 통과 |
| D8 | 계정 삭제 요청 `/settings/delete` · 운영 삭제 | 학생 · admin | account-deletion, admin-deletion, deletion | — | 실제 Auth/Storage 삭제 | 통과 |
| D9 | 약관 · 개인정보 · 운영정책 `/legal/*`, `/settings/[doc]` | 누구나 | product, server(정책 렌더링) | — | | 통과 |
| D10 | 개발 미리보기 `/dev/*` | 개발 | — | **F07** `/dev/pins` 는 운영 빌드에서도 열림(나머지 4개는 화면마다 따로 막음) → `dev/+layout.ts` 하나로 404, 중복 redirect 4개 삭제 | | 수정 후 통과(build) |

### E. 운영자

| ID | 화면 · 기능 | 역할 · 조건 | 정상 · 예외 경로와 검증 근거 | 발견 → 수정 | 미검증 · 이유 | 상태 |
|---|---|---|---|---|---|---|
| E1 | 세션 · 매 요청 명단 재확인 (`hooks.server.ts`, `adminSession`) | 운영 | 위조 · 만료 · 폐기 (admin-session, server) | — | 실제 `auth.sessions` | 통과 |
| E2 | 역할 · 권한 · owner (`adminRoles`, `guard`, `private.require_perm`) | 역할별 | 직접 주소 403 · DB 거절 (admin, audit, schema) | **F17** `/admin/live/status` 는 화면 guard 없이 DB 에만 맡겨 권한이 없으면 403 대신 500 → `guard()` | | 수정 후 통과(check) |
| E3 | 신고 · 제재 · 해제 · 편지 신고 | moderate | admin, audit, schema | — | | 통과 |
| E4 | 신원 · 이메일 열람 · 대화 export · 감사 | identity | 기록 실패 시 열람 안 함 · CSV 범위 (admin, server, schema) | — | 실제 CSV 크기 | 통과 |
| E5 | 확인창 취소 = 요청 취소 (`admin/confirm.ts`) | 운영 | 모든 위험 폼이 `confirmed()` (코드 전수) · 취소 시 요청 없음 (admin) | — | | 통과 |
| E6 | 공지 · 개인 공지 · 문의 답변 · 뱃지 심사 · 계정 삭제 | 권한별 | admin-notices, admin-deletion, badge-photo-cleanup | — | | 통과 |
| E7 | 운영 설정 · 서비스 열고 닫기 · 점검 · AI | settings/service | admin-ai, server | — | 실제 Worker cron | 통과 |
| E8 | 운영진 관리 `/admin/staff` | owner | audit, schema | — | | 통과 |
| E9 | 학생 세션과 운영 세션 독립 | 같은 기기 | 저장하지 않는 임시 클라이언트 (코드), 운영 화면은 학생 부팅 안 함 (코드) | — | | 코드 확인 |

### F. 공통 · 비기능

| ID | 항목 | 검증 | 발견 → 수정 | 상태 |
|---|---|---|---|---|
| F-1 | 누름 영역 44px (G1) | hit (360×740 · 390×844, 13 화면) | 측정 시점 · 닫힌 접기 (T03 · T06) | 통과 |
| F-2 | 줄바꿈 · 폭 280–520 | wrap | — | 통과 |
| F-3 | 동작 줄이기 · 낭독기 | a11y, motion | — | 통과 |
| F-4 | 요청 예산 (G13) | requests | F16 공지 하나 화면이 열 때 1회 새로 읽음(이전 0~1회) — 알림을 눌러 들어오는 드문 화면이라 허용 | 통과 |
| F-5 | CSP · 보안 헤더 | security | — | 통과 |
| F-6 | 서비스워커 캐시 · 업데이트 | sw | — | 통과 |
| F-7 | 선택 · 복사 | select | — | 통과 |
| F-8 | 비밀값 노출 | 클라이언트 빌드 결과에서 `service_role` · `ADMIN_SESSION_SECRET` · `VAPID_PRIVATE_KEY` 문자열 검색 0건 | — | 통과 |
| F-9 | 익명성 경계 (messages 식별 컬럼 없음 · room_members 본인 행 · presence seat · 편지 발신자) | schema (권한 · 응답 키 검사) | 이번 변경은 이 경계를 건드리지 않음 | 통과 |

---

## 4. 발견 목록

우선순위: P0 익명성 · 권한 침해 / 데이터 유실 / 전면 중단 · P1 주요 흐름 실패 · P2 불편 · 접근성 · 낭비 · 유지보수 위험 · P3 문구 · 정리.
이번 점검에서 **P0 · P1 은 찾지 못했다**(찾지 못했다는 뜻이지 없다는 보증이 아니다 — 8절).

| ID | 우선 | 증상 (사용자) | 재현 | 원인 · 파일 | 수정 | 검증 |
|---|---|---|---|---|---|---|
| F01 | P2 | 로그인 · 가입 칸에 학교 메일 전체(`20101@cnsa.hs.kr`)를 붙여 넣거나 자동 완성하면 "선생님이신가요?" 경고가 뜨고 버튼이 꺼진다. 운영자 로그인은 `…@cnsa.hs.kr@cnsa.hs.kr` 로 보내져 "비밀번호가 맞지 않아요" | `/login` → 칸에 전체 주소 붙여넣기 | 입력값을 그대로 학번 검사 · 영어 검사(`teacher`)에 넣었고, `schoolEmail()` 이 도메인을 한 번 더 붙였다. UX G6.2 미구현 · `routes/login`, `routes/admin/login`, `lib/state.svelte.ts` | 공용 `schoolLocal()` — 학교 도메인이면 앞부분만, 다른 도메인이면 그대로 두고 칸 아래 안내. `schoolEmail()` 도 이것을 거쳐 모든 호출부가 같이 고쳐짐. `enterkeyhint` 추가 | e2e login(+2) · 운영 빌드 미리보기에서 붙여넣기 → `29999` · 토큰 요청 이메일 확인 |
| F02 | P2 | 인증 코드를 한 자리 틀려도 "유효 시간 만료. 다시 받아 주세요" → 불필요한 재발송(메일 한도 소모) | 틀린 코드 입력 | Supabase 는 틀린 코드 · 만료 모두 `Token has expired or is invalid` — `errMsg` 가 'expired' 를 먼저 잡음 · `lib/errors.ts` | 합친 문구 "맞지 않거나 만료됐어요 · 숫자를 확인하고…" | unit(core-refactor +1) |
| F03 | P2 | 문의 화면에서 목록을 못 불러오면 "아직 보낸 문의가 없어요" | 오프라인으로 `/settings/contact` | `.catch(() => {})` 후 빈 목록 · `settings/contact` | 이유 + 다시 시도 | e2e ux(+1) |
| F04 | P2 | 뱃지 제출에서 목록을 못 불러오면 "인증할 뱃지가 없어요", 보낸 요청이 통째로 사라져 거두기 불가 · 같은 요청을 또 보내게 됨 | 오프라인으로 `/me/achievements/submit` | `.catch(() => [])` · `me/achievements/submit` | 두 목록 각각 이유 + 다시 시도, 보낸 요청은 이전 목록 유지 | check |
| F05 | P2 | 편지 받는 사람 검색 실패 시 토스트만 뜨고 화면은 "이름을 두 글자 이상 적어 주세요"(이미 적었는데) · 첫 검색 응답 전에도 같은 문구 | 오프라인 검색 | 결과 `null` 을 "아직 안 적음"과 구분하지 않음 · `letters/new` | 찾는 중 · 이유 + 다시 찾기 | check |
| F06 | P3 | 추천을 못 불러오면 추천 칸이 말없이 사라짐 | 오프라인 진입 | `recs = []` · `letters/new` | 이유 + 다시 불러오기 | check |
| F07 | P3 | `/dev/pins` 미리보기가 운영 빌드에서도 열림(설치 · 로그인한 학생). 다른 4개는 화면마다 따로 막아 중복 | 운영 빌드에서 `/dev/pins` | 화면별 가드 누락 · `routes/dev/*` | `routes/dev/+layout.ts` 하나로 404, 화면별 redirect 4개 삭제 | 운영 빌드 미리보기: 3개 주소 모두 404 · 내용 0 |
| F07a | P2 | 기본 테마의 주 버튼 · 내 말풍선 왼쪽(주황) 위 흰 글자 대비 4.12:1 (WCAG AA 4.5 미달). 코드 주석은 "세 점 모두 4.5:1"이라 적혀 있었다 | 기본 테마 | 10-28 테마 변경(`4cd5785`)의 첫 색 `#e5402a` · `app.css`, `themeColor.svelte.ts` | `#d33b27`(4.75:1, 같은 색상) · `app.css` 기본값을 읽어 세 점 모두 4.7:1 이상인지 보는 단위 테스트 | unit(core-refactor +1) · e2e back |
| F08 | P2 | 온보딩 시작 버튼이 왜 꺼져 있는지 모름(G6.3) · 남자/여자/상관없어요 선택 상태를 낭독기가 모름 | `/onboarding` | 남은 조건 안내 · `aria-pressed` 없음 | 버튼 아래 남은 조건 한 줄(`aria-describedby`) · `aria-pressed` · `enterkeyhint` | e2e product |
| F09 | P2 | 편지를 열 때 네트워크가 끊기면 토스트만 남고 "봉투를 가져오는 중…"(우체통에서 왔으면 연출)이 끝나지 않음. 답장 화면은 빈 화면 | 오프라인으로 `/letters/m/5` | catch 에서 상태를 남기지 않음 · `letters/m/[id]`, `.../reply` | 이유 + 다시 시도, 답장 화면에 가져오는 중 표시 | e2e ux(+1) |
| F10 | P2 | 공지를 못 불러오면 뼈대가 끝나지 않음(알림을 눌러 오프라인으로 들어온 경우) | 오프라인 `/notices/1` | `loadNotices` 가 실패를 알리지 않음 · `notices.svelte.ts` | `loadNotices()` 가 성공 여부를 돌려주고 화면이 다시 시도를 보임 | e2e notices(+2) |
| F11 | P2 | 알림 화면이 세 목록을 모두 못 불러오면 뼈대가 끝나지 않거나 "새 알림을 모두 확인했어요" | 오프라인 `/activity` | 편지함은 실패해도 `loaded=true` → 빈 목록 · `activity` | 하나라도 실패하면 위에 이유 + 다시 시도, "모두 확인" 문구 숨김 | e2e ux(+1) |
| F12 | P2 | 편지 잠금이 켜진 상태에서 가입 통계를 못 읽거나 행이 없으면 화면은 편지를 열어 주고, 다 쓴 편지를 서버가 "잠겨 있어요"로 거절 | 잠금 켬 + `signup_stats` 오류/행 없음 | 클라이언트는 열림(fail-open), 서버 `private.letters_locked` 는 `coalesce(…, true)`(잠김, R24) · `letters/gate.svelte.ts` | 오류면 판단 보류(복귀 시 재조회), 행 없음 = 0명 = 잠김 — 서버와 같은 쪽 | check · e2e audit(잠금 화면) |
| F13 | P3 | `/welcome` 머리글에 자기 자신으로 가는 로고 링크 · 36px "시작하기"(44px 미만, 아래 고정 버튼과 같은 일) | `/welcome` | 디자인 변경 때 남은 중복 | 둘 다 제거 — 시작은 하단 고정 버튼 하나 | e2e product(가로 넘침 · 진입) |
| F14 | P3 | 설치 창(prompt)을 이미 쓴 뒤 다시 누르면 버튼이 "처리 중"에 머묾 | Android Chrome 설치 버튼 두 번 | `promptInstall()` 예외 미처리 · `routes/install` | 실패를 취소로 처리 | 코드 확인 (실기기 필요) |
| F15 | P3 | 뱃지 요청을 거두면 "사진도 지웠어요" — 실제로는 즉시 삭제 실패 시 예약 재시도 (PRD 7 "즉시 완전히 삭제" 표현 금지) · 이미 처리된 요청이면 아무 안내 없음 | 거두기 | 문구 · `submit` | "사진은 곧 지워져요" · "이미 처리된 요청이에요" | check |
| F16 | P2 | 앱이 공지 목록을 기억하는 동안(1분 안) 새 공지 알림을 눌러 들어가면 "공지를 찾을 수 없어요" | 공지 목록 로드 → 새 공지 등록 → 앱 안 이동으로 `/notices/<새 id>` | 상세 화면이 목록이 이미 있으면 다시 읽지 않음 · `notices/[id]` | 열 때 한 번 새로 읽고, 그 뒤에만 "없음" 판정 | e2e notices(+1) |
| F17 | P3 | 실시간 권한을 뺀 역할이 `/admin/live/status` 를 부르면 403 이 아니라 "서버 오류" | 권한표에서 live 해제 | 화면 load 의 `guard()` 를 상태 API 만 빠뜨림(DB 는 막고 있었음) · `admin/live/status` | `guard(locals, url)` | check (DB 거절은 schema) |
| F19 | P3 | 로그인 학번 칸이 타이핑 중에도 빨간 "학번 5자리를…"로 다그친다 (G6.4 위반). 그런데 같은 문장이 G6.3 의 "꺼진 버튼이 왜 꺼졌는지"이기도 해서 **가이드 두 규칙이 부딪혔다** | `/login` 에 `2010` 입력 | 가이드 공백 | 가이드 G6.4 에 "겸하는 문장은 입력 중 회색, blur · 제출 뒤 빨강" 추가 · 화면도 그렇게 | e2e login(문구 그대로 · 색만 바뀜) |
| F20 | P2 | 탭 화면 맨 위에서 당겨 새로고침하면 앱 전체를 다시 부팅한다(요청 약 8–10개). ① 상대를 찾는 중에 당기면 찾기가 말없이 끊긴다(P3) ② 연달아 당겨도 제한이 없다 (G13.3 "10초에 한 번까지") | 홈에서 찾기 → 당겨서 놓기 | `PullRefresh` 가 `location.reload()` — Phase 37 구현이 그 뒤 Phase 39 가이드(G13.3)를 따르지 않음 | 찾는 동안은 당겨서 새로고침을 내린다 · 10초 안의 두 번째는 부르지 않고 "방금 새로 불러왔어요". 탭별 로더로 바꾸는 것은 **D1 제안** | e2e letters(당겨서 새로고침) |
| F18 | P3 | 문서가 현재 값과 다름 — README 첫 줄 "10분"(현재 기본 5분), SECURITY 2-1 "편지 하루 3통"(현재 기본 50 · 하루 약 50통), README `/dev/ai`(실제 `/dev/bot`) | — | 문서 미갱신 | 고침. SQL 함수 본문의 주석("기본 하루 3통")은 운영 DB 와 본문 해시 대조를 깨지 않으려고 손대지 않음 | — |

### 테스트 자체의 결함 (앱 결함 아님 — 근거를 확인하고 고침, 단언은 약하게 하지 않음)

| ID | 스위트 | 증상 | 원인 | 수정 |
|---|---|---|---|---|
| T01 | 5개 운영 스위트 · bot · live · sw · push-route | 이 PC 에서 시작 못 함 (`EACCES`) | Windows 가 TCP 54390–54489 를 예약 (Hyper-V). 리눅스 CI 는 문제없음 | 저장소는 그대로, 검증 미러에서만 5479x 로 |
| T02 | intro | `.intro p` 가 5개 → strict mode 오류로 스위트 중단 | 10-04 `60e93ed` 가 소개 카드 안에 공개 범위 안내(`PrivacySummary`)를 넣었는데 테스트 선택자를 안 고침. 기준선에서는 앞의 시간 초과에 가려 보이지 않았다 | 카드의 둘째 줄만 `:scope > p` 로 |
| T03 | hit | "개인정보 처리방침 보기"가 실행마다 겹침으로 잡혔다 안 잡혔다(0 ↔ 1) | 닫힌 `<details>` 안 링크에도 Chrome 156 이 상자 크기를 준다 — 누를 수 없는 요소 | 닫힌 접기 안(요약 줄 제외)은 검사에서 뺌. 열린 접기는 그대로 검사 |
| T04 | features | "✕ 로 답장 취소" · "입력창에 글이 있으면 도우미 숨김"이 가끔 실패 | 누르자마자 `count()===0` — 닫히는 연출(`out:expand`, G7.1 필수)이 끝나기 전 | 사라질 때까지(`detached`, 3초 안) 기다린 뒤 같은 단언 |
| T06 | hit | 같은 화면이 실행마다 0 ~ 6개로 달랐다 | 고정 1.6초 뒤에 잼 — 이 PC 에서는 미리보기가 아직 그려지는 중이거나 들어오는 연출 중 (따로 재 보니 다 그려진 뒤에는 아무것도 가리지 않음) | 네트워크가 조용해지고 들어오는 연출이 끝날 때까지(최대 6초) 기다린 뒤 같은 기준으로 잼. 연속 2회 13/13 |
| T07 | a11y | "들어올 때 지난 대화는 읽지 않는다"가 가끔 실패 | 미리보기가 1.2초 뒤 새 메시지를 보내는데, 느린 PC 에서는 첫 말풍선이 늦게 그려져 새 메시지 안내가 이미 나와 있다(맞는 동작) | 지난 대화가 안내되지 않는지(비었거나 새 메시지 한 줄)만 본다 |
| T05 | admin-notices | 메뉴 이동 직후 확인이 가끔 실패 | `networkidle` 이 이동 시작 전에 끝날 수 있다 | 주소가 바뀔 때까지 기다린 뒤 같은 단언 |

### 수정하지 않은 관찰 (근거와 함께 유지)

| 관찰 | 판단 |
|---|---|
| 채팅 상대 프로필 시트는 실패 시 "프로필을 불러오지 못함"만 있고 다시 시도 버튼이 없다 | P3 유지 — 시트를 닫았다 열면 다시 요청한다 |
| 로그인 실패 오류가 칸 옆이 아니라 토스트(G4 · G11 권장과 다름) | P3 유지 — 비밀번호 칸을 비우고 원인을 알려 다음 행동은 분명하다. 바꾸려면 로그인 화면 배치 결정이 필요 |
| `errMsg` 는 모르는 오류의 원문(영어일 수 있음)을 그대로 보여 준다 | 유지 — 원문이 문의 · 디버깅의 유일한 단서. 서버 오류는 이미 짧은 번호로 바뀐다 |
| 홈 "다른 추천" 3회 제한은 기기(localStorage) 단위이고 실패한 새로고침도 1회로 센다 | 유지 — 비용 · 남용 방지 장치가 아니라 화면 안내용(서버는 추천 결과만 준다) |
| SQL 함수 주석 일부가 과거 기본값 | 유지 — 함수 본문을 바꾸면 운영 DB 와의 본문 해시 대조 절차(마이그레이션)가 필요. 문서에서 바로잡음 |

---

## 5. 삭제 · 통합 · 단순화 · 유지

| 대상 | 분류 | 근거 · 바뀌는 동작 · 확인 |
|---|---|---|
| `/dev/*` 화면별 운영 가드 4개 (`goto('/')` effect + `goto` import) | **통합** | `routes/dev/+layout.ts` 한 곳에서 404. 운영 빌드에서 홈으로 튕기던 것이 404 로 바뀜 · `/dev/pins` 도 막힘. 개발 서버는 그대로(e2e 미리보기 스위트) |
| `/chat` 예전 주소 화면(`+page.svelte` effect 리디렉트) | **단순화** | 형제 예전 주소(`/notices`, `/letters/[id]`)와 같은 `+page.ts` `load` 리디렉트로. 화면이 한 번 그려졌다 튕기지 않음. 외부 알림 · 옛 북마크 호환을 위해 **삭제는 안 함** |
| `/welcome` 로고 자기 링크 · 머리글 "시작하기" | **삭제** | 하단 고정 "설치하고 시작하기"가 같은 일. 44px 미만 누름 영역도 함께 사라짐 |
| "못 불러옴 · 다시 시도" 표시 11곳 (편지함 · 폴더 · 알림 · 공지 · 문의 · 받는 사람 찾기 · 추천 · 뱃지 목록 · 보낸 요청 · 편지 열기 · 답장) | **통합** | 화면마다 다르던 마크업 · 스타일 · role(status/alert)을 `src/lib/ui/LoadError.svelte` 하나로. 문구와 동작은 그대로, 모양만 한 가지(가운데 정렬 · 회색 한 줄 + 글자 단추)로 맞춤. 홈 · 대화방 · 삭제 요청 · 부팅 오류처럼 화면 전체를 쓰는 큰 오류 화면은 디자인이 달라 그대로 |
| 화면마다 따로 쓰던 "학교 도메인 붙이기" | **통합** | `schoolLocal()`/`schoolEmail()` 하나 — 학생 · 운영 로그인이 같은 규칙 |
| `/notices` 예전 주소 | **유지** | 현재 개인 공지 푸시가 여전히 `/notices` 로 보낸다 (`schema.sql` `url: '/notices'`) |
| `/letters/[id]` 예전 주소 · `/chat` | **유지** | 이전 알림 · 기록에 남은 주소. 비용이 거의 없고 지우면 404 — 사용처가 0 이라는 근거 부족 |
| 내부에서만 쓰는 export(`kindLabel`, `tourSeen`, `luminance`, `DELETION_*`, 타입 몇 개) | **유지** | 파일 안에서 쓰이고 테스트가 불러가기도 한다. export 를 떼는 것은 변경만 늘린다 |
| 의존성 (`dependencies` 16 · `devDependencies` 11) | **유지** | 전부 import 사용처 확인 (`@types/node` 는 `checkJs` 스크립트 타입) · 사용 안 하는 파일 0 (src/lib 전수, 동적 import 포함) |
| 폰트 `LOTTERIACHAB`(324KB) · `PartialSans`(308KB) | **유지** | 로고 · 큰 제목에 사용. 쓰는 글자가 있을 때만 받는다 |
| 신고 · 차단 · 감사 기록 · 권한 검사 · 재시도 경로 | **유지** | 지침대로 코드량 절감 대상에서 제외 |
| 학생 화면의 "다른 추천 3회" 제한 · 연출(봉투 · 매칭) | **판단 근거 부족** | 제품 경험 결정. 건너뛰기 · 동작 줄이기는 이미 지원(motion · a11y 통과) |

### 결정이 필요한 제안 (이번에 바꾸지 않음)

| ID | 제안 | 이유 · 영향 |
|---|---|---|
| D1 | 당겨서 새로고침을 "앱 재부팅" 대신 **그 탭의 로더만**(홈 `INBOX.load` · 편지 `reloadMailbox` · 프로필 업적/프로필) 부르게 | G13.3 · P5(요청 예산)와 맞고 화면 · 입력 · 스크롤이 유지된다. 대신 "새 버전 받기" 역할이 사라지므로 설정의 "앱 새로고침"과 업데이트 띠로 충분한지 결정 필요. 현재 테스트(letters)도 "앱을 다시 불러온다"를 요구한다 |
| D2 | UX 가이드 G15 검토 매트릭스가 비어 있다 | 이 문서 3절이 화면별 상태를 대신한다. 매트릭스를 유지할지(갱신 담당) 이 문서로 옮길지 결정 |

---

## 6. 실행한 검사와 결과

모두 2026-10-31, 이 PC(2절 환경)에서. 최종 코드 기준.

| 검사 | 결과 | 비고 |
|---|---|---|
| `npm run check` | 0 errors · 0 warnings (744 files) | 미러 · 저장소 모두 |
| `npm test` | 전부 통과 — unit 묶음 13개 + `test:schema` 1149 passed | `core-refactor` 에 회귀 2건 추가(인증 코드 문구 · 기본 테마 대비) |
| `npm run build` | 성공 (가짜 공개 env · 빈 env 둘 다) | 클라이언트 산출물에서 `service_role` · `ADMIN_SESSION_SECRET` · `VAPID_PRIVATE_KEY` 0건 |
| 운영 빌드 미리보기 (`vite preview` + 가짜 Supabase, 설치 · 로그인 학생) | 붙여넣은 `29999@cnsa.hs.kr` → 칸에 `29999` · 토큰 요청 이메일 `29999@cnsa.hs.kr` · `/dev/pins` · `/dev/chat` · `/dev/achievements` → 404(미리보기 내용 0) · `/chat` → `/` | 스크립트는 작업 폴더 밖 임시 폴더(저장소에 넣지 않음) |
| `npm run test:ui` 전체 1회 (최종 코드) | **26/28 통과** — a11y 13 · achievements 76 · admin 16 · admin-ai 31 · admin-deletion 17 · admin-notices 15 · audit 138 · back 113 · bot 36 · design-shots · features 76 · intro 13 · letters 202 · live 15 · login 22 · motion 9 · notices 28 · product 44 · push-route 7 · requests 10 · security 17 · select 10 · sheet 11 · sw 19 · ux 36 · wrap 2 | 실패 2: hit(측정 시점 → T06 으로 고침) · react(첫 화면 30초 시간 초과) |
| `hit` · `react` 따로 2회 | hit 13/13 · 13/13 · react 0(첫 화면 시간 초과) · 26/26 | |
| 정리 리팩토링(`LoadError` 통합) 뒤 전체 1회 | **26/28** — 실패 a11y(T07, 고침) · react | 나머지 26 은 위와 같은 수 그대로 통과 |
| `a11y` · `react` 따로 3회 | a11y 13/13 ×3 · react 26/26 ×3 | **react 는 전체 실행의 22번째쯤에서만 실패(최근 전체 3회 중 2회, 같은 단계: 두 번째 길게 누르기 600ms 가 450ms 타이머를 못 넘김)** — 따로는 매번 통과, 채팅 코드는 바꾸지 않음. 부하 아래 타이밍으로 보지만 확정하지 못했다 → CI 에서 확인, 계속되면 테스트의 누름 시간을 늘리는 것을 검토 |
| 새로 넣은 e2e 단언 | login +2 (붙여넣기 · 다른 도메인) · notices +3 (새 공지 다시 읽기 · 못 불러옴 · 다시 시도) · ux +3 (문의 · 알림 · 편지 열기 실패) · product +2 (남은 조건 · aria-pressed) | 모두 통과 |
| 실행하지 않음 | `test:e2e` · `test:match` · `dev-user` · `cleanup-test-users` · `review-postgres` | 실제 Supabase 계정 생성 · 부하 / 로컬 PostgreSQL 없음 |

두 사용자 교차 확인은 가짜 전송 계층(chat 묶음 — 두 자리의 낙관적 메시지 · 실시간 에코 · 순서 역전 · 재연결)과 운영 역할별 직접 요청 거절(audit · admin · schema)로만 했다. 실제 두 기기 · 두 계정의 Realtime 은 하지 않았다.

화면 · 접근성: 360×740 · 390×844 누름 영역(hit), 폭 280–520 줄바꿈(wrap), 동작 줄이기 · 낭독기 이름(a11y · motion), 라이트 · 다크 스크린샷(design-shots, 저장소 밖 임시 폴더). 데스크톱 운영 화면은 admin · audit 묶음(기본 창 크기)으로만 봤다.

---

## 7. 운영 반영이 필요한 것

- **DB 마이그레이션: 없음.** 이번 변경은 화면 · 클라이언트 코드 · 서버 라우트(`admin/live/status` 의 guard) · 문서 · 테스트뿐이다. `supabase/schema.sql` 과 `migrations/` 는 바꾸지 않았다.
- **배포:** 일반 배포(빌드 → Cloudflare Worker)로 반영된다. 새 환경 변수 · 비밀 값 없음. 서비스워커 캐시 버전은 빌드 해시로 바뀌므로 학생은 "새 버전이 준비됐어요 → 업데이트"를 한 번 누르게 된다.
- **배포 전 확인 (운영 · 실기기, 이번에 못 한 것):**
  1. iOS 설치 앱 · Android Chrome 설치 앱에서 로그인 칸 자동 완성(학교 메일 전체) → 학번만 남는지.
  2. 기본 테마 버튼 · 내 말풍선 색(`#d33b27` 시작점)이 의도한 인상인지 디자인 확인.
  3. 편지 잠금을 켠 운영 설정에서 잠금 화면이 가입 인원에 맞게 열리는지 (`signup_stats` 행 존재 — R24 복구 경로).
  4. UX 가이드 실기기 체크리스트(키보드 · OS 뒤로가기 · 알림 → 대화방 → 뒤로) — 이번 점검 범위 밖.
- 이전 문서에 남은 운영 확인(Auth 비밀번호 규칙 · 유출 비밀번호 차단 · SMTP · 메일 템플릿 · pg_cron · R04/R06/R09/R17/R26/R29 운영 관측)은 이번 작업이 바꾸지 않았고 그대로 남아 있다 — [UPGRADE](./UPGRADE-2026-10-03.md), [README 배포 전 체크리스트](../README.md).

---

## 8. 남은 위험 · 미해결

| 위험 | 왜 남았나 | 확인 조건 |
|---|---|---|
| 실제 Supabase(Auth · RLS · Realtime · Storage)와의 통합 | 운영 DB 조회 · 계정 생성 금지(사용자 규칙), 격리된 Supabase 프로젝트 없음 | 별도 staging 프로젝트에서 `npm run test:e2e` · `test:match` (일회용 계정 생성 · 삭제) |
| 두 사람 실시간 대화 · 동시 매칭 · 동시 투표 · 폴더 동시 생성 | PGlite 단일 연결, 가짜 전송 계층 | staging + `scripts/review-postgres.test.mjs` 의 실제 PostgreSQL CI(로컬 Docker 없음) |
| iOS · Android 설치 · 키보드 · 뒤로가기 · 푸시 · 백그라운드 | 실기기 없음 (데스크톱 Chrome 크기 에뮬레이션만) | UX 가이드 실기기 체크리스트 |
| Workers AI · 푸시 서버 실제 발송 · Worker cron | 유료/외부 서비스, 발송 금지 | 운영 미리보기 배포에서 관측 |
| 남은 큰 화면(`ChatView` 49KB · `Envelope` 38KB)의 세부 상태 | 이번에는 테스트(chat · features · letters · react)와 위험 패턴 검색으로만 봄 | 다음 점검에서 화면별 상태표로 |
| 운영 계정 · 권한표의 실제 값 | 운영 DB 를 읽지 않았다 | owner 가 `/admin/staff` 에서 확인 |

---

## 9. 주요 변경 파일

- 공용: `src/lib/ui/LoadError.svelte`(새로) · `src/lib/state.svelte.ts`(schoolLocal) · `errors.ts` · `notices.svelte.ts`(성공 여부 반환) · `letters/gate.svelte.ts` · `themeColor.svelte.ts` · `app.css`(기본 그라데이션) · `ui/TopbarMe.svelte` · `ui/PullRefresh.svelte`
- 학생 화면: `routes/login` · `onboarding` · `welcome` · `install` · `(app)/+layout` · `(app)/activity` · `(app)/notices/[id]` · `(app)/settings/contact` · `(app)/me/achievements/submit` · `(app)/letters/new` · `(app)/letters/m/[id]`(+ `reply`) · `(app)/chat/+page.ts`(예전 `+page.svelte` 대체)
- 운영: `routes/admin/login` · `routes/admin/live/status/+server.ts`
- 개발 미리보기: `routes/dev/+layout.ts`(새로) · `routes/dev/{achievements,bot,chat,letters}/+page.svelte`(중복 가드 삭제)
- 테스트: `scripts/core-refactor.test.mjs` · `scripts/e2e/{login,notices,ux,product,back,intro,hit,features,admin-notices}.mjs`
- 문서: 이 파일 · `docs/README.md` · `docs/UX-GUIDELINES.md`(G6.4) · `README.md` · `SECURITY.md`
