# Landy

충남삼성고 교내 익명 대화 앱. 모르는 사람과 10분, 둘 다 원할 때만 연장.

- 전체 설계: `~/.claude/plans/dynamic-purring-acorn.md`
- 스택: SvelteKit 2 + Svelte 5 (runes) + Supabase + Cloudflare Pages
- **UX 가이드라인: [`docs/UX-GUIDELINES.md`](docs/UX-GUIDELINES.md)** — 화면을 만들거나 고칠 때의 기준 (누름 영역 44px · 누름 반응 · 네 가지 상태 · 뒤로가기 · 입력 보존 · 요청 예산 · 검토 매트릭스)
- **제품 문서: [PRD](docs/PRD.md) · [유저 플로우](docs/USER-FLOWS.md) · [문서 안내](docs/README.md)** — 제품 목적·기능 요구사항·운영 정책과 학생/운영자 과업별 정상·예외 경로

## 설계 원칙 (코드를 고칠 때 반드시 지킬 것)

1. **`messages` 에 식별 컬럼을 두지 않는다.** `sender_seat`(0=시스템, 1, 2)만 쓴다.
   컬럼이 없으면 유출될 수가 없다.
2. **`room_members` 는 '내 행만' 읽힌다.** 상대 `user_id` 가 클라이언트에 닿으면
   방을 건너뛰며 수집한 UUID 로 과거 대화 전부가 소급 추적된다.
3. **`private` 스키마는 PostgREST 에 노출하지 않는다.** Dashboard > Settings > API >
   Exposed schemas 에 `private` 를 넣지 말 것.
4. **실명·학번을 수집하지 않는다.** 이메일은 `auth.users` 에만 존재한다.
5. **`select('*')` 를 쓰지 않는다.** 항상 명시 컬럼.
6. **Realtime presence 에 `seat` 외의 값을 track 하지 않는다.**
7. **상대 정보는 room_id 로만 묻는다.** 상대 프로필(`partner_profile`)·대화 목록(`my_rooms`)은
   같은 방 멤버에게만, uuid 없이 돌려준다. 익명 이름은 계정에 고정이므로(재회 시 알아볼 수 있음)
   소개·관심사에 학번·전화번호·@아이디는 서버가 거절한다.
8. **이름 편지는 받는 사람만 이름이 보이고, 보낸 사람은 익명.** (Phase 23) 이름은 명렬표에서 자동으로 붙어 학생이 고칠 수 없고
   (명렬표에 없는 학생만 한 번 적는다 — 명렬표 이름은 쓸 수 없음), 검색에는 이름·학년·학번이 나온다 (설정 > 편지 받기 끄면 안 나옴).
   편지 표 `private.dm_threads`/`dm_msgs` 는 RPC 로만 읽히고, 받는 사람에게 보낸 사람은 편지마다 새로 뽑은 익명 이름뿐이다.
   차단·수신 거부·수신자 정지는 이름 검색 및 발신 응답을 바꾸지 않고 실제 전달을 막는다. 발신자의 보낸 편지는 남지만 수신자 편지함·알림·수신 업적에는 들어가지 않는다.
   옛 공개 편지 게시판(Phase 10~15, `letters`/`letter_comments`)은 Phase 85 에서 표 · 함수째 걷어냈다.
9. **학생끼리의 익명성은 구조로, 관리자 열람은 기록으로.** 관리자(admin)는 대화 내용·편지 작성자·이메일을 볼 수 있지만
   전부 service_role 전용 `admin_*` RPC 를 거치고 `private.audit_log` 에 남는다. 학생 쪽 RPC·RLS 경계(1~8)는 그대로다.

## 처음 설정하기

### 1. Supabase 프로젝트

새 프로젝트를 만들고 `supabase/schema.sql` 을 SQL Editor 에 통째로 붙여넣어 실행한다.
여러 번 실행해도 안전하다.

학교 도메인이 `cnsa.hs.kr` 이 아니라면 실행 후 한 줄 더:

```sql
update private.auth_config set allowed_domains = array['우리학교.hs.kr'];
```

`src/lib/state.svelte.ts` 의 `SCHOOL_DOMAIN` 도 같이 바꾼다(입력창 표시용).

### 2. Dashboard 설정 — 이게 빠지면 도메인 제한이 무의미해진다

Authentication > Sign In / Providers

- **Email 만 켜고 나머지 provider 는 전부 끈다**
- **Anonymous sign-ins 끈다**
- **Confirm email 켠다**
- Email OTP 를 사용한다 (매직링크가 아니라 6자리 코드).
  링크 방식은 브라우저에서 열리고, 그 브라우저는 PWA 설치 게이트에 막힌다.

Authentication > URL Configuration

- Redirect URLs 를 실제 배포 도메인만 남긴다

Settings > API

- **Exposed schemas 에 `private` 가 없는지 확인한다** (기본값: `public`, `graphql_public`)

### 3. 환경변수

```bash
cp .env.example .env
```

`PUBLIC_SUPABASE_URL` 과 `PUBLIC_SUPABASE_PUBLISHABLE_KEY` 를 채운다.
(`SUPABASE_SERVICE_ROLE_KEY` 는 Phase 6 운영자 대시보드에서 쓴다. 클라이언트 번들에
들어갈 경로가 없어야 한다.)

### 4. 실행

```bash
npm install
npm run dev
```

## 운영자 대시보드 (/admin)

1. `.env` 에 `SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`(앱과 **같은 프로젝트**)와 `ADMIN_SESSION_SECRET`(32자 이상) 설정
2. 운영진 지정 (SQL Editor):
   ```sql
   insert into private.staff (user_id, role)
   select id, 'admin' from auth.users where email = '담당자@cnsa.hs.kr';   -- 'moderator' 도 가능
   ```
3. 브라우저에서 `/admin` → 학교 이메일 + 비밀번호로 로그인 (가입·인증 코드 경로 없음 — 운영진은 이미 있는 계정을 위 SQL 로 지정)

- **실시간 현황**(`/admin/live`): 전체 사용자와 지금 상태(대화 중 · 매칭 대기 · 접속 중 · 오프라인), 10초마다 자동 갱신.
  어느 대화인지(열기 링크)는 관리자만. 상태만 보는 것이라 새로고침마다 기록하지 않고, 학번·이름은 페이지를 열 때 한 번 기록된다.
- **공지사항**(`/admin/notices`): 올리면 학생 앱 종 아이콘에 빨간 점이 뜨고, 학생이 공지 화면을 열면 꺼진다.
  올리기·내리기는 관리자만 (운영진은 목록만). 운영 설정의 "홈 배너"는 채팅 홈 맨 위 한 줄로 따로 남아 있다.
- **moderator(운영진)**: 신고 처리, 경고, 7일 이하 정지, 사용자 검색(익명 이름·ID)·상세, 서비스 열고 닫기
- **admin(관리자)**: 위 전부 + 영구 정지·영구정지 해제, 이메일 열람·이메일 검색, **모든 대화 열람**(`/admin/rooms`),
  신고된 편지의 보낸 사람 확인, 운영 수치 변경
- 역할 검사는 서버 라우트(`$lib/server/adminAuth.ts`)와 DB 함수(`private.require_staff`) 양쪽에서 한다.
  (신고 처리·글 내리기·운영 설정까지 전부 — 운영진은 설정 중 서비스 열고 닫기만)
- 확인창이 있는 조치(제재·이메일 확인·글 내리기·서비스 닫기)는 `$lib/admin/confirm.ts` 의 `confirmed()` 를 쓴다.
  `onsubmit` 에서 `preventDefault()` 로 막으면 SvelteKit `enhance` 가 그대로 요청을 보내므로 쓰지 말 것.
- 예상 못 한 서버 오류는 화면에 `서버 오류 (번호)` 로 뜬다. 같은 번호로 Cloudflare Workers 로그에서 원인을 찾는다.
- 운영자 로그인은 저장하지 않는 임시 Supabase 클라이언트로 한다 — 같은 기기의 학생 앱 로그인을 건드리지 않는다.
- 목록·상세에는 이메일이 없다. "이메일 확인"·대화 열기·편지 작성자 확인·이메일 검색은 **누가 언제 했는지 활동 기록에 남는다.**
- 운영진 명단에서 지우면 로그인 쿠키가 살아 있어도 다음 요청부터 차단된다.
- `ADMIN_SESSION_SECRET` 을 바꾸면 운영진 전원이 즉시 로그아웃된다 (비상시).
- **학번-이름 명렬표**: 관리자에게는 운영자 화면의 익명 이름 옆에 `(학번 이름)`, "이메일 확인" 옆에 실명이 보인다.
  운영진(moderator)에게는 보이지 않는다. 화면을 열 때마다 "신원 열람"으로 활동 기록에 남는다.
  `node scripts/import-roster.mjs <학번,이름 CSV>` 로 반영 — 여러 학년을 한 파일에 섞어도 되고(학년은 학번 첫 자리),
  엑셀 CSV(CP949)·CSV UTF-8 둘 다 읽는다. `--dry-run` 으로 학년별 인원만 먼저 확인할 수 있다.
  원본 xlsx/csv 는 절대 커밋하지 않는다 — `.gitignore` 에 `*roster*` 패턴으로 막아둠.

## 배포 전 체크리스트

- [x] **Auth 요청 한도 올리기** — sign-ins · token verifications · token refreshes 를 1000/5분으로 (2026-09-21 완료).
      한도는 **IP 단위**이고 학교 와이파이는 공인 IP 를 공유한다. Supabase 는 이 한도를 초당 흐름(≈3.3회/초)
      + 순간 허용량으로 적용한다 → 한 IP 에서 몇 초 안에 50명 이상이 동시에 누르면 일부가 잠깐 막힌다
      (실측: 동시 60명 중 50명 성공, 0.35초 간격 60명은 전원 성공). 막히면 "몇 초 뒤 다시"로 안내된다.
- [x] **인증 코드 8자리 + 10분 만료** — 코드 확인 한도를 올린 만큼 찍어 맞히기 방어를 보완 (2026-09-21 완료).
- [x] **계정 선점 방지** — 이메일 확인 전 계정의 비밀번호를 DB 트리거가 지운다 (실서버에서 공격 재현 → 차단 확인).
- [x] **Phase 8 ~ 20 · 운영자 점검 DB 반영** — 2026-09-25 Supabase 커넥터로 실DB(LOVE)에 16~20 패치를 적용하고
      최신 `schema.sql` 의 함수·열·트리거가 모두 있는지 대조했다 (8~15 · 운영자 점검은 이미 들어가 있었음, 명렬표 1,093명).
      AI 검토 · AI 대화는 여전히 꺼진 상태 — 켜기 전 아래 Phase 19 안내대로.
- [x] **Phase 8 적용** — `schema.sql` 을 SQL Editor 에서 다시 실행 (익명 이름·프로필·여러 대화). 안 하면 새 화면이 프로필을 못 읽는다.
- [x] **Phase 11 적용** — `schema.sql` 을 다시 실행 (관리자 권한 확장 RPC). 안 하면 사용자·전체 대화 화면이 오류.
- [x] **Phase 10 적용** — `schema.sql` 을 다시 실행 (익명편지 테이블·RPC). 안 하면 익명편지 탭이 비어 보인다.
- [x] **Phase 12 적용** — `schema.sql` 을 다시 실행 (학번-이름 명렬표 RPC). 이어서
      `node scripts/import-roster.mjs <1~3학년 합친 CSV>` 로 명단 반영.
- [x] **Phase 13 적용** — `schema.sql` 을 다시 실행 (실시간 현황 RPC). 안 하면 `/admin/live` 가 오류.
- [x] **Phase 14 적용** — `schema.sql` 을 다시 실행 (편지 서식 `letters.fmt`·`post_letter(text, jsonb)`). 안 하면 편지 올리기가 실패한다.
- [x] **Phase 15 적용** — `schema.sql` 을 다시 실행 (편지 하트 `private.letter_likes`·`set_letter_like`). 안 하면 편지 목록·상세가 오류.
- [x] **Phase 16 적용** — `schema.sql` 을 다시 실행 (공지사항 `private.notices`·`my_notices`). 안 하면 종 아이콘에 점이 뜨지 않고 `/admin/notices` 가 오류.
- [x] **Phase 17 적용** — `schema.sql` 을 다시 실행 (메시지 공감 `public.message_reactions`·`react_message`·공감 알림 `reaction_push_payload`, Realtime 발행 포함).
- [x] **Phase 18 적용** — `schema.sql` 을 다시 실행 (답장 `messages.reply_to`·`msg_reply_check`). 안 해도 채팅은 되고 답장만 안 된다.
- [x] **Phase 19 적용** — `schema.sql` 을 다시 실행 (검열봇 규칙 필터 · AI 검토 대기열 · AI 대화 한도). 실행하는 즉시 신상정보·금칙어 차단이
      채팅·편지·댓글에 적용된다. AI 두 기능은 꺼진 채로 시작 — **개인정보 처리방침에 "Cloudflare Workers AI 로 글을 검토"를 적은 뒤**
      운영 설정에서 켠다. 배포에 `wrangler.jsonc` 의 `"ai"` 바인딩이 들어가 있어야 한다 (API 키 불필요).
      안 하면 공감을 눌러도 되돌아간다 (대화 자체는 정상).
- [x] **Phase 37 적용** — 2026-09-28 Supabase 커넥터로 실DB 에 적용 (문의 `private.inquiries` · `send_inquiry` · `my_inquiries` ·
      `admin_inquiries` · `admin_answer_inquiry`, 정리 예약 `simbun-purge-inquiries`). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 36 적용** — 2026-09-28 Supabase 커넥터로 실DB 에 적용 (`room_view`/`ack_room` 보고 있음 창 45초, `online_ttl_sec` 130,
      pg_cron 실행 기록 정리 `simbun-purge-cron-log`). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 35 적용** — 2026-09-28 Supabase 커넥터로 실DB 에 적용 (편지 서명 `dm_msgs.from_nick` · `dm_send`/`dm_reply_to` 에 `p_nick`,
      찾기에 학번, 디플로마 목록 `private.diplomas`, 개인 공지 `private.personal_notices` · `read_personal_notice` · `admin_send_personal_notice`,
      알림 정책 `private.viewing_room`, 실시간 현황 `talking`). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 34 적용** — 2026-09-27 Supabase 커넥터로 실DB 에 적용 (쓰지 않는 학생 RPC 14개 실행 권한 회수, 학생 RLS 정책 5개 `(select auth.uid())`,
      `private.user_achievements(code)` 색인, 트리거 함수 2개 PUBLIC 권한 회수). 실DB 함수 171개 본문이 레포와 같음을 확인. 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 32 적용** — 2026-09-27 Supabase 커넥터로 실DB 에 적용 (편지함 `dm_mailbox` · `dm_open` · `dm_reply_to` · `dm_unread`,
      `dm_msgs.from_gender` · `opened_at`, 채팅 모드 `dm_reply` · `dm_chat` 삭제, 알림 제목 "익명의 ○학생에게서 편지가 왔어요"). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 31 적용** — 2026-09-27 Supabase 커넥터로 실DB 에 적용 (업적 `private.user_stats` · `achievement_defs` · `user_achievements`,
      카운터 트리거, `my_achievements` · `new_achievements` · `set_featured_badges`, 지금까지의 기록으로 채움). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 30 적용** — 2026-09-27 Supabase 커넥터로 실DB 에 적용 (매너 온도 `profiles.manner_temp` · `private.ratings` · `rate_partner` · `pending_ratings`,
      pg_cron `simbun-ratings` 매일 04:27 KST 반영). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 29 적용** — 2026-09-27 Supabase 커넥터로 실DB 에 적용 (연장 공개 순서 · 공통 질문 · 대화 고정 `rooms.pinned`).
      새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 28 적용** — 2026-09-26 Supabase 커넥터로 실DB 에 적용 (메시지 삭제 · 둘 다 볼 때만 흐르는 시간 · 연장 힌트).
- [x] **Phase 27 적용** — 2026-09-26 Supabase 커넥터로 실DB 에 적용 (편지 모드 `dm_threads.mode` · `dm_msgs.is_letter` · `dm_letter` · `dm_chat`).
      이미 채팅처럼 주고받던 편지는 채팅 모드로 옮김. 안 하면 편지는 예전처럼 채팅으로만 이어진다.
- [x] **Phase 26 적용** — 2026-09-26 Supabase 커넥터로 실DB 에 적용 (편지 읽음 `dm_thread.their_read`). 안 해도 편지는 되고 "읽음"만 안 뜬다.
- [x] **Phase 25 적용** — 2026-09-26 Supabase 커넥터로 실DB 에 적용 (편지 나가기 · `dm_threads.sender_hidden/recipient_hidden` · 가명 알림).
      이미 끝낸 편지는 끝낸 사람 목록에서 숨김 처리됨.
- [x] **Phase 24 적용** — 2026-09-26 Supabase 커넥터로 실DB 에 적용 (이름 편지 서식 `dm_msgs.fmt` · `dm_send(uuid, text, jsonb)`).
      안 하면 편지 보내기가 실패한다.
- [x] **Phase 23 적용** — 2026-09-26 Supabase 커넥터로 실DB 에 적용 (이름 편지 · 이름 확인). 새 DB 는 `schema.sql` 을 다시 실행.
      안 하면 익명편지 탭의 검색·목록이 오류.
- [x] **Phase 22 적용** — 2026-09-25 Supabase 커넥터로 실DB 에 적용 (보안 점검). 남은 일: 대시보드에서 유출 비밀번호 차단 켜기 (`SECURITY.md`).
- [x] **Phase 21 적용** — 2026-09-25 Supabase 커넥터로 실DB 에 적용 (`profiles.allow_rematch` · `request_match`). 새 DB 는 `schema.sql` 을 다시 실행.
- [x] **Phase 20 적용** — `schema.sql` 을 다시 실행 (대화 백업 `admin_export_messages`). 백업을 쓸 거면 개인정보 처리방침에
      "지워지기 전 관리자가 파일로 보관할 수 있음"을 적고 학교 승인을 받는다 (학생 화면 문구는 이미 바꿔 둠).
- [x] **운영자 점검 반영** — `schema.sql` 을 다시 실행 (신고 처리·글 내리기·운영 설정 RPC 의 역할 검사, 탈퇴 계정 제재 오류).
- [ ] **비밀번호 규칙** — Authentication > Providers > Email: Minimum password length **8**,
      Password requirements **Letters and digits**. (앱도 같은 규칙을 검사하지만 서버 설정이 권위)
- [ ] **푸시 알림 키** — `.env` 의 `PUBLIC_VAPID_KEY`·`VAPID_PRIVATE_KEY`(Secret)·`VAPID_SUBJECT` 를 Cloudflare Variables and Secrets 에도.
      없으면 알림만 조용히 꺼진다(대화는 정상). 키를 바꾸면 모든 기기의 알림 구독이 무효가 된다.
- [ ] **외부 SMTP 연결** — 기본 메일 서버는 시간당 몇 통뿐. SMTP 를 연결해야 발송 한도를 올릴 수 있다.
- [ ] **메일 템플릿** — Magic Link · Confirm signup 둘 다 `{{ .Token }}` 만 (링크 없이).
- [ ] **pg_cron** — `select jobname from cron.job;` 에 simbun-sweep / simbun-purge / simbun-purge-evidence 3개.
- [ ] 운영진 지정 (`private.staff`), 배포용 `ADMIN_SESSION_SECRET` 새로 생성.
- [ ] 개발용 테스트 계정 삭제.
- [ ] 학생회·담당 선생님 승인, 개인정보 처리방침 게시.

## 개발용 테스트 계정

**대시보드의 Add user 로 비밀번호 계정을 만들지 말 것.** 계정 선점 방지 트리거 때문에 비밀번호가 지워진다
(Supabase 가 Auto Confirm 을 '미확인 생성 → 확인' 순서로 처리하기 때문). 대신:

```bash
node scripts/dev-user.mjs simbun-test3@cnsa.hs.kr 비밀번호 m      # 성별까지 주면 온보딩 완료 상태로
```

테스트 스크립트가 중간에 죽어 남긴 계정 확인·정리: `node scripts/cleanup-test-users.mjs [--delete]`

## 코드 구조

| 위치 | 내용 |
|---|---|
| `src/lib/state.svelte.ts` | 학생 앱 전역 상태 · 로그인 · 접속 신호 · 본인 프로필 저장 |
| `src/lib/accountTypes.ts` · `errors.ts` · `schemaCompatibility.ts` | 계정·설정 타입 / 오류 안내 / 구형 DB의 선택 열 조회 호환성. 기존 `state.svelte.ts`의 타입·오류 import도 유지 |
| `src/lib/chat/message-ledger.svelte.ts` | 낙관적 메시지·서버 응답·실시간 방송의 병합과 전송 상태. 방 구독·타이머는 `room.svelte.ts`에서 관리 |
| `src/lib/letters/mailbox.svelte.ts` · `folder.svelte.ts` · `selection.svelte.ts` | 편지함 캐시 / 폴더 조회·더보기·오류 / 선택·폴더 이동·삭제 완료 순서. 늦은 응답은 계정·화면 수명으로 걸러 냄 |
| `src/lib/server/adminForms.ts` · `adminSettings.ts` · `request.ts` · `moderationBatch.ts` | 운영 폼·점검 설정 / API 본문·토큰 파싱 / 검열 배치. 권한·감사 기록·RPC 호출은 기존 서버 경계에서 유지 |
| `scripts/lib/env.mjs` | 운영 스크립트 공용 설정 읽기. 실제 서비스에 접근하는 스크립트는 `npm test`에 포함하지 않음 |
| `src/lib/ui/` | 학생 앱 공용 화면 조각 — `Sheet`(아래 시트) · `ReportPicker`(신고 사유) · `BackButton` · `TopbarMe`(공지 종 + 설정 톱니) · `Avatar` · `PasswordFields` |
| `src/lib/notices.svelte.ts` | 공지사항 목록 · 안 본 공지(빨간 점) · 본 것으로 저장 |
| `src/lib/pollSeeker.svelte.ts` | "찾는 중" 폴링 상태 기계 — 채팅 `Seeker` 가 물려받는다 |
| `src/lib/nav.ts` | 앱 안의 "뒤로" — 기록을 쌓지 않고 돌아가기(`goBack`), 대화 끝나고 홈에서 바로 찾기(`backToSeek`) |
| `src/lib/visible.ts` | `whileVisible` — 화면이 보이는 동안만 주기적으로 새로 읽기 (대화 목록·피드·편지·실시간 현황) |
| `src/lib/motion.ts` | 기기의 "동작 줄이기" 설정 — JS 스크롤을 부드럽게 할지 (CSS 애니메이션은 `app.css` 에서 한꺼번에 끈다) |
| `src/lib/time.ts` · `restriction.ts` | 상대 시간·`mm:ss` 표시 / 이용 제한 판정 (학생 앱·운영자 화면 공용) |
| `src/lib/chat/` | 채팅방 — `ChatView`(화면) · `room.svelte.ts`(상태·동기화) · `ChatIntro`(맨 위 소개) · `PartnerCard`(상대 프로필) · `ReactionPicker`·`ReactionBadge`·`reactions.ts`(공감) · `ReplyQuote`(답장 인용) · `Starters`(첫마디 도우미) · `MatchScreen`(연결 화면) · `gestures.ts`(길게 누르기·두 번 톡·밀어서 답장) |
| `src/lib/letters/` | 익명편지 — `api.ts`(검색 · 편지함 · 봉투 열기 · 보내기 · 답장 · 끝내기 · 차단 · 신고 RPC, 이름표), `unread.svelte.ts`(탭 빨간 점), `Envelope`(봉투 앞 · 뒤) · `MailboxItem` · `EnvelopeCompose`(쓰기 연출) · `LetterSheet`(편지지) · `stage.ts`(연출 단계), `LetterEditor.svelte`(서식 편집기) · `rich.ts` · `RichText.svelte`(서식 그리기) |
| `src/lib/tabBack.svelte.ts` | 탭 첫 화면 뒤로가기 — 익명편지·프로필 → 홈, 홈에서 두 번 누르면 종료 |
| `src/lib/themeColor.svelte.ts` | 테마 색상(앱 전체 포인트 색 — 로고 · 버튼 · 링크 · 내 말풍선) — 설정 화면에서 고르고 이 기기에만 저장 |
| `src/lib/admin/` | 운영자 화면 공용 조각 — 신고 상세 카드(`ReportHeader` · `ReportedCard` · `ReporterCard` · `IdentityCard`), `AccountStatus`, `FormMsg`, `SanctionForm` |
| `src/lib/server/` | 서버 전용 — 운영자 세션·권한, `reports.ts`(채팅·편지 신고 공용 로드·액션), 푸시 (`/api/push` 는 요청 키 → DB 판단 함수 표, 받을 기기는 DB `private.push_target`), `ai.ts`(Workers AI 호출) · `moderation.ts`(검열 판정 프롬프트) · `aiChat.ts`(AI 대화 프롬프트) |
| `src/lib/ai/` · `src/lib/moderation.ts` | AI 대화 상대 화면(`AiChat`, 홈 위에 덮어 띄움) · 글을 올린 뒤 검열봇 부르기(`/api/moderate`) |
| `src/params/` | 라우트 주소 검사 — `[id=uuid]`, `[id=int]` (모양이 틀린 주소는 곧바로 404) |

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run check` | 타입 검사 |
| `npm test` | 단위 테스트 전부 + DB 스키마 검증. 실제 Supabase·운영 계정·비밀키 없이 실행 |
| `npm run test:unit` | DB 스키마를 제외한 단위·상태·서버 회귀 검사 |
| `npm run test:core` | 선택 열 호환 조회·오류 안내·운영 스크립트 설정 파싱 |
| `npm run test:account` | 계정 전환·늦은 응답·개인정보 캐시·프로필 저장 수명 |
| `npm run test:letters` | 편지함·폴더의 조회 경쟁·실패 재시도·선택 완료 순서 |
| `npm run test:server` | 운영 폼·한국 시각 점검 예약·검열 배치·관리자 인증과 공지 동작 |
| `npm run test:schema` | PGlite 로 스키마·트리거·RLS 검증 (Supabase 불필요) |
| `npm run test:chat` | 채팅 클라이언트 로직 — 가짜 전송 계층으로 경쟁 상황 재현 |
| `npm run test:e2e` | 실서버 Realtime E2E. 일회용 계정 3개 생성→검증→삭제. 서버 키가 앱과 **같은 프로젝트**여야 실행됨 |
| `npm run test:match` | 실서버 매칭 동시성 스트레스 (기본 20명 동시 폴링 → 중복 배정·선호 위반 검사 → 삭제) |
| `npm run test:aichat` | AI 대화 상대 — 모델에 보내는 대화 모양 (사용자로 시작 · 번갈아 · system 접기), 답 가리기 |
| `npm run test:toast` | 알림 — Svelte 브라우저 모드로 컴파일해 $state proxy 관련 버그까지 검증 |
| `npm run test:platform` | 설치 안내 — 실제 UA 로 iOS/안드로이드·카카오톡 등 인앱 브라우저 판별 검증 |
| `npm run test:push` | 푸시 알림 암호화(RFC 8291)·VAPID 서명(RFC 8292) — 받는 브라우저 입장에서 복호화·검증 |
| `node scripts/vapid-keys.mjs` | 푸시 알림용 VAPID 키를 만들어 `.env` 에 추가 (이미 있으면 그대로) |
| `node scripts/import-roster.mjs <csv> [--dry-run]` | 학번-이름 명렬표를 DB 에 반영 (관리자 화면의 이메일 확인 옆 이름 표시용) |
| `npm run test:admin` | 운영자 세션 쿠키 — 위조·변조·만료·키 교체가 거부되는지 |
| `npm run test:ui [-- 이름…]` | 화면(브라우저) 테스트 24묶음 — `scripts/e2e/`. `hit`(누름 영역 44px) · `ux`(흐름이 말없이 끊기지 않는지)는 UX 가이드라인 검사. 가짜 Supabase·`/dev` 미리보기로 돌아 계정 불필요. 이름을 주면 그것만 (`-- react sheet`). 스크린샷은 OS 임시 폴더 `landy-e2e/` |
| `node scripts/generate-badge.mjs` | 알림 배지(`static/badge-96.png`) 재생성 — 앱 아이콘의 로고(보라)만 남기고 흰 바탕은 투명 (안드로이드는 배지의 투명도만 써서 컬러 아이콘이면 흰 네모가 된다) |
| `node scripts/generate-crest.mjs` | 교표(`static/school-crest.png`) 재생성 — 원본 `branding/school-crest-source.jpg` 의 가장자리에서 이어진 흰 바탕만 투명하게 (교복 프로필, Phase 60) |
| `node scripts/generate-icons.mjs` | PWA 아이콘 재생성 — 원본은 `branding/icon-source.*`(png/webp/jpg 아무거나) (헤드리스 Chrome 사용) |

> **자동 검사 (GitHub Actions, `.github/workflows/ci.yml`)** — main 에 푸시할 때마다 타입 검사 · 단위 테스트 전부 ·
> DB 스키마 · 빌드, 그리고 화면 테스트 전부를 돌린다. 실서버가 필요한 `test:e2e` · `test:match` 는 빼고.
> 결과는 GitHub 저장소의 Actions 탭, 커밋 옆 ✓/✗.

> `npm run test:schema` 는 PGlite 단일 커넥션이라 **동시 트랜잭션을 재현하지 못한다.**
> 매칭 advisory lock 과 연장 투표 경쟁은 `supabase start`(로컬 Docker Postgres)에서
> 따로 검증해야 한다.

## 개발용 훅

- `/dev/chat?s=chat|fresh|vote|waiting|pending|ended|paused|hints|question|pin|pinned|rate|pinrate` — 대화방 화면 미리보기 (Supabase 불필요, 개발 모드 전용).
  `&matched` 연결 화면, `&incoming` 상대 새 메시지, `&sheet=menu|report|block|profile` 시트
- `/dev/ai?s=ok|limit|full|off` — AI 대화 상대 화면 미리보기 (`&turns=2` 턴 한도, `&short` 20초 뒤 끝, `&down` AI 오류)
- `AI_FAKE=1 npm run dev` — Workers AI 대신 정해진 답 (검열: 글에 `[flag:harassment]` 가 있으면 걸림 / 대화: "AI 답: …").
  개발 서버는 원격 바인딩을 붙이지 않는다 — 진짜 AI 는 `npx wrangler login` 뒤 `CF_REMOTE=1 npm run dev`. 모델은 `AI_MODEL` 로 맨 앞에 둘 수 있다 (기본: Gemma 4 26B A4B → GLM 4.7 Flash 순서로, 되는 것을 쓴다)
- `?gate` — 개발 모드에서 PWA 설치 게이트 화면을 강제로 띄운다
  (평소 DEV 에서는 게이트가 꺼져 있다)

## 진행 상황

- [x] **Phase 1 — 인증 + 신원 분리**
      `private` 스키마, `profiles`, `app_settings`, 도메인 강제 트리거(INSERT + UPDATE OF email),
      디자인 토큰, PWA 설치 게이트, OTP 로그인, 온보딩
- [x] **Phase 2 — 채팅 코어** — 스키마·RLS·Realtime 클라이언트·대화방 화면. 테스트 방은 SQL Editor 에서
      `select private.dev_open_room('a@cnsa.hs.kr','b@cnsa.hs.kr', 60);`
- [x] **Phase 3 — 타임박스** — pending→active 입장 확인, 연장 투표(무제한), 만료 판정(서버 기준), 나가기,
      1분 스위퍼 + 24시간 purge(pg_cron). 짧은 타이머로 테스트하려면 `dev_open_room(a, b, 2)`
- [x] **Phase 4 — 랜덤 매칭** — request_match 폴링(대기자는 웹소켓 없음), 선호 성별·차단·7일 쿨다운·공정성,
      백그라운드 시 자동 이탈, 상대 이탈 45초 감지 후 넘기기
- [x] **Phase 5 — 안전장치** — 신고(대화 사본 보존 + 자동 차단), 차단, 30일 내 서로 다른 신고자 3명 → 자동 정지,
      메시지 도배 제한(토큰 버킷), 넘기기 연타 제한, 신고 증거 180일 보존
- [x] **Phase 6 — 운영자 대시보드** (`/admin`) — 신고 큐·상세·조치, 신원 열람(기록 필수), 운영 설정·킬 스위치, 활동 기록
- [x] **Phase 8 — 계정·프로필·여러 대화** — 첫 가입은 인증 코드, 이후 학교 이메일 + 비밀번호 로그인,
      계정마다 고유 익명 이름(바꿀 수 없음), 소개·관심사·MBTI 프로필, 온라인 표시(heartbeat),
      대화 동시 최대 5개(운영 설정) + 대화 목록 화면, 대화방에서 상대 프로필 보기
- [x] **Phase 9 — 푸시 알림** — 처음 한 번 권한 안내, 상대가 앱을 안 보고 있을 때만 발송(서버 판단),
      본문 종단 암호화, 같은 메시지 한 번만, 로그아웃 시 기기 구독 삭제, 알림 누르면 그 대화로
- [x] **Phase 10 — 익명편지** — 하단 탭(익명편지·채팅), 공개 피드 + 댓글·대댓글(2단계), "답장할 편지 받기"로
      편지마다 지정 답장자 1명 배정(큐, for update skip locked, 48시간 마감), 편지마다 새 임시 이름,
      도배 제한(편지 3통/일·댓글·배정), 신고·차단(차단은 채팅과 공유, 재배정 쿨다운은 따로), 댓글 알림, 운영자 편지 신고 큐
- [x] **Phase 11 — 관리자 권한 확장** — 운영진/관리자 역할 분리, 사용자 검색·상세·직접 제재,
      관리자의 전체 대화 열람·편지 작성자 확인(전부 활동 기록), 학생 화면 개인정보 안내 문구 갱신
- [x] **Phase 12 — 학번-이름 명렬표** — 관리자 화면의 익명 이름 옆 `(학번 이름)`·"이메일 확인" 옆 실명
      (CSV 반입 스크립트). 관리자만, 열 때마다 활동 기록
- [x] **Phase 13 — 실시간 현황** — 전체 사용자 + 대화 중·매칭 대기·접속 중·오프라인, 10초 자동 갱신
- [x] **Phase 14 — 편지 서식** — 굵게·기울임·밑줄·취소선·형광펜(5색)·글자색(6색)·크기·정렬·되돌리기 (Tiptap).
      본문은 순수 텍스트 그대로, 서식은 `letters.fmt` 에 범위 목록으로. 화면은 HTML 을 넣지 않고 정해진 표로만 그린다
- [x] **Phase 15 — 편지 하트** — 목록·상세에서 하트 누르기/취소. 개수와 "내가 눌렀는지"만 보이고 누가 눌렀는지는
      `private.letter_likes` 에만 (작성자도 모름). 알림 없음
- [x] **Phase 16 — 공지사항** — 채팅·익명편지 상단 프로필 왼쪽에 종 아이콘, 안 본 공지가 있으면 오른쪽 위 빨간 점.
      어디까지 봤는지는 계정에 저장(`private.notice_reads`). 올리기·내리기는 관리자만(`/admin/notices`), 활동 기록에 남음
- [x] **Phase 17 — 메시지 공감** — ❤️ 😂 😮 😢 👍 🔥. 말풍선 두 번 톡 = ❤️, 길게 누르기(데스크톱 오른쪽 클릭) = 고르기 + 복사.
      자리(seat)마다 하나, 대화 중에만. `messages` 는 그대로 두고 별도 표에 자리로만 남긴다(사용자 식별자 없음).
      취소는 행 삭제가 아니라 emoji = null (Realtime DELETE 는 방 필터·RLS 가 안 걸려서). 관리자 대화 열람에도 보인다.
      상대 메시지에 처음 단 공감은 푸시 알림("❤️ 공감: …") — 메시지 하나 × 사람 하나에 한 번(`private.reaction_push_log`)
- [x] **Phase 18 — 답장 · 첫마디 · 대화 디자인** — 말풍선 길게 누르기 → "답장", 또는 말풍선을 옆(왼쪽·오른쪽 아무 쪽)으로 밀었다 놓기. 말풍선 위에 원래 메시지를 흐리게 인용,
      누르면 그 메시지로 스크롤 + 반짝. `messages.reply_to` 는 같은 방·시스템 메시지 아닌 것만(`msg_reply_check`), 관리자 열람에도 표시.
      내가 아직 말을 안 했으면 입력창 위에 첫마디 질문 3개(신상 묻는 질문 없음, 겹치는 관심사가 있으면 그 얘기부터, 누르면 채우기만).
      5분 넘게 끊기면 시간 구분선, 매칭 직후 "○○님과 연결됐어요" 화면(1.6초)
- [x] **접근성** — 기기에서 "동작 줄이기"를 켜면 나타나기·튀기·깜빡임 애니메이션과 부드러운 스크롤을 끈다
      (답장 이동 반짝임은 커지지 않고 어두워지기만). 화면 낭독기: 말풍선마다 "나:"/"상대 이름:" 을 숨은 글로,
      상대의 새 메시지는 따로 된 안내 칸(`aria-live`)에서 하나씩 읽는다 — 들어올 때 지난 대화는 읽지 않는다
- [x] **보안 헤더** — 모든 화면에 콘텐츠 보안 정책(CSP, `vite.config.ts`): 스크립트는 SvelteKit nonce 가 붙은 것만,
      연결은 우리 사이트와 `*.supabase.co` 만, 다른 사이트의 틀(iframe) 안에서는 안 열림. 그리고 `X-Frame-Options` ·
      `nosniff` · `Referrer-Policy` · `Permissions-Policy`(카메라·마이크·위치 안 씀) (`hooks.server.ts`).
      ★ Supabase 주소를 사용자 도메인으로 바꾸면 `vite.config.ts` 의 connect-src 에 추가
- [x] **Phase 19 — 검열봇 · AI 대화 상대**
      · 1단 규칙 필터 (무료, 보내기 전): 전화번호 · 학번(학년1~3·반01~12·번호01~39) · "N학년 N반" · SNS 아이디/주소 · 금칙어
        (`private.banned_terms`, 운영 설정에서 관리자가 편집 — 틀린 정규식은 저장 전에 거른다). 채팅·편지·댓글 insert 트리거.
        막힌 채팅은 말풍선을 지우고 글을 입력창에 돌려놓는다
      · 2단 AI 검토 (보낸 뒤): 글이 올라가면 `private.mod_queue` 에 쌓이고, 학생 앱이 `/api/moderate` 를 부르면 서버가 쌓인 순서대로
        Cloudflare Workers AI(Gemma 4 26B A4B, 안 되면 GLM 4.7 Flash)에 판정을 받는다. 걸리면 신고함에 "자동" 표시로(`source = auto`, 신고자 없음) — 판단은 사람이.
        위기 신호(자해·자살)도 분류한다. 자동 신고는 자동 정지 횟수에 세지 않는다. 하루 한도(`ai_mod_daily_cap`)
      · AI 대화 상대: 상대를 찾는 동안 홈에서 "AI 와 얘기하기". 늘 "AI" 표시, 신상정보는 AI 에게도 못 보냄(같은 규칙 필터),
        사람당·앱 전체 하루 한도 · 한 번에 N분 · N턴. 대화 내용은 어디에도 저장하지 않는다(횟수만). 위기 신호엔 109 · 1388 안내
      · Workers AI 무료 몫은 하루 10,000 Neuron(UTC 00:00 = 한국 오전 9시 초기화) — 두 기능이 나눠 쓴다. 기본 한도: 검토 250건 · AI 대화 3번
        (어림값: 검토 1건 ≈ 17 Neuron, AI 대화 30턴 ≈ 1,600 Neuron). 한도를 넘기면 검토는 규칙 필터만, AI 대화는 "오늘 끝" 안내
- [x] **Phase 20 — 대화 백업 (CSV)** — 운영자 "전체 대화" 화면에서 날짜(한국 시간)를 골라 서버에서 지워지기 전 대화를 CSV 로.
      관리자만 · 받을 때마다 활동 기록(`export_messages`) · 계정 정보 없이 방 번호 · 방 안 익명 이름 · 시각 · 내용만.
      DB 가 5,000줄씩 CSV 를 만들어 주고 화면이 이어 붙인다 (Workers CPU 한도). 엑셀 수식 주입 방지(= + - @ 앞에 '), 엑셀용 BOM.
      하루 한 번 받으면 빠짐없이 남는다 (지우기는 방이 닫히고 24시간 뒤, 매일 04:17)
- [x] **요청 줄이기 (과부하 대비)** — 화면별로 나가는 요청을 실제로 세어 보고(`npm run test:ui -- requests`) 불필요한 것을 뺐다.
      · 앱을 열 때 부팅 요청(ensure_self · profiles · app_settings · my_account)이 두 번씩 나가던 것 → 한 번 (INITIAL_SESSION 중복)
      · 탭을 오갈 때마다 공지를 다시 부르던 것 → 1분 안이면 건너뜀, 주기 확인 1분 → 5분
      · 상대 찾는 중 4초마다 → 30초 뒤 8초, 2분 뒤 10초 (서버 풀 TTL 15초 안쪽. 새 사람이 들어오면 그쪽이 바로 잡아간다)
      · 대화방 안전망 30초마다 요청 4개 → 45초마다 2개 (공감 전체 · tail sweep 은 재연결 · 화면 복귀 때만)
      · 상대가 같은 방에 있으면 푸시 요청(/api/push)을 보내지 않음 — 서버도 어차피 안 보내지만 Workers 요청 한도(무료 하루 10만)를 쓴다
      · 검열봇 호출은 20초에 한 번, "가져갈 게 없음"이면 2분 쉼 · 대화 목록 안전망 20초 → 30초 · 편지 상세 30초 → 45초
      · 사진 업로드 · 웹폰트가 없고, 큰 편집기(Tiptap)는 편지 쓰기 화면에서만 불러온다
- [x] **뒤로가기 (설치된 앱)** — 홈(채팅)에서 뒤로 → "뒤로가기를 한 번 더 누르면 종료됩니다", 2초 안에 또 누르면 앱 종료.
      익명편지·프로필 탭에서 뒤로 → 채팅 홈. 탭 첫 화면에 얕은 기록(`pushState` guard)을 하나 쌓아 두고 그게 걷히는 순간을 잡는다
      (`(app)/+layout.svelte`). 홈이 기록 맨 아래여야 하므로 탭 전환은 기록을 바꿔 끼우고, 다른 화면에서 홈으로는
      뒤로 간다(`lib/nav.ts` goBack). 상단 로고 = 홈 링크
- [x] **드래그 복사 제한** — 학생 앱의 버튼·안내 문구·제목은 드래그·길게 눌러도 선택되지 않는다(`app.css` 의 `body:not(.admin)`).
      사람이 쓴 글(채팅·편지·댓글·공지·홈 배너·상대 소개)과 입력칸만 `.selectable` 로 예외. 채팅 말풍선은 폰에서 길게 누르기가
      공감이라 복사는 고르기 줄의 "복사", 마우스 기기에서는 드래그로. 운영자 화면은 그대로
- [x] **대화 소개 카드** — 대화 맨 위에 상대의 큰 아바타 · 익명 이름 · MBTI·관심사 한 줄 · "프로필 보기" (인스타 DM 첫 화면)
- [x] **하단 탭 3개 · 설정 · 아이폰 상태바** — 하단 탭 익명편지(왼쪽) · 채팅(가운데) · 프로필(오른쪽).
      상단 오른쪽의 프로필 사진 자리에 설정 톱니. 프로필 = 상대에게 보이는 것(소개 · 관심사 · MBTI)과 이야기하고 싶은 상대,
      설정 = 채팅 색상 · 새 메시지 알림 · 비밀번호 · 계정 상태 · 개인정보 안내 · 로그아웃.
      채팅 색상은 내 말풍선 색 6가지(색 동그라미만, 이름은 화면 낭독기에만). 이 기기에만 저장되고 상대 화면은 그대로.
      아이폰 홈 화면 앱(`black-translucent`)에서 머리글이 상태바(시계·배터리)와 겹치던 것 → 모든 머리글(`.topbar`)이
      `env(safe-area-inset-top)` 만큼 내려온다 (`--safe-top`). 긴 화면에서 머리글이 눌려 줄던 것도 고침(`flex: none`)
- [x] **설정 · 프로필 디자인 (아이폰 설정 앱 참고)** — 회색 바탕 위 둥근 흰 카드, 카드 위 작은 회색 제목 · 아래 설명,
      줄마다 왼쪽 이름 · 오른쪽 값/›/스위치(알림), 줄 사이 선은 왼쪽을 들여서. 머리글은 선 없이 제목 가운데 · 뒤로는 둥근 단추.
      비밀번호는 줄을 누르면 카드 안에서 펼쳐지고, 로그아웃은 빨간 글자 카드. 프로필은 맨 위 큰 아바타 · 이름,
      상대 고르기는 체크 표시 줄. 공용 스타일은 `app.css` 의 `.grouped` · `.g-card` · `.g-row` · `.switch` (다크 모드 색 포함)
- [x] **AI 모델 교체 (Gemma 3 → Gemma 4)** — "AI 연결 확인"에서 `5018: This account is not allowed to access @cf/google/gemma-3-12b-it`.
      Cloudflare 가 2026-05 에 Gemma 3 12B 폐기를 공지하고 대체로 Gemma 4 26B A4B · GLM 4.7 Flash 를 권했다.
      기본 모델을 Gemma 4 로(생각하기 끔 — 켜면 답 글자 수를 생각에 쓴다), 그게 막혀 있으면 GLM 4.7 Flash 로 자동으로 넘어간다
      (`lib/server/aiFold.ts` callModels, 된 모델은 기억). 권한 · 폐기 오류는 system 접기 없이 바로 다음 모델로
- [x] **AI 대화 "지금 답할 수 없어요" 대응** — 모델에 보내는 대화가 화면 첫 줄(AI 인사)부터 시작해 사용자 · AI 가 번갈아 가지 않았다.
      Gemma 대화 틀은 사용자로 시작해 번갈아 가야 하므로, 인사는 지시문 뒤로 옮기고 같은 쪽 말은 합친다(`aiChat.ts` chatPrompt).
      그래도 거절되면 system 지시문을 첫 사용자 말에 붙여 한 번 더 보낸다(`aiFold.ts`). 실패 이유는 Workers 로그에 남기고,
      운영 설정의 **"AI 연결 확인"** 버튼(관리자)이 짧은 질문을 보내 연결됨 / 바인딩 없음 / Cloudflare 오류 원문을 보여 준다
- [x] **Phase 21 — 만났던 사람 다시 만나기** — 설정 > 매칭 스위치 (`profiles.allow_rematch`, 기본 꺼짐).
      꺼져 있으면 지금처럼 최근(`rematch_cooldown_days`, 기본 7일)에 대화한 상대는 다시 안 잡힌다. **둘 다 켰을 때만** 다시 잡히고
      (한쪽이라도 끄면 제외 — 다시 만나기 싫은 쪽의 뜻이 우선), 켜도 처음 보는 사람이 기다리면 그쪽이 먼저. 차단한 사이는 언제나 제외
- [x] **채팅 색상 정리** — 파랑만 단색, 나머지(기본 주황→핑크 · 보라→자주 · 초록→청록 · 회색)는 그라데이션.
      기본과 겹치던 '베리'(핑크→보라)는 뺐다 (저장해 둔 기기는 기본 색으로)
- [x] **Phase 22 — 보안 점검** (`SECURITY.md`) — 푸시 구독은 알려진 푸시 서버 주소만(DB + 서버 두 겹) · 한 사람 10대까지,
      `profiles` · `user_presence` · `app_settings` 의 남는 표 권한 회수, 트리거 함수 실행 권한 회수, 함수 8개 `search_path` 고정,
      검열 프롬프트 구분선 막기. 권한 시험은 Supabase 기본 권한을 흉내 낸 위에서 돈다. 실DB 적용 · Advisor 확인 (2026-09-25)
- [x] **답장 모양 다듬기** — 인용 상자가 답장 말풍선 뒤로 겹쳐 들어가던 것 → 틈을 두고 위에. 입력창 위 "○○에게 답장" 막대의
      세로줄은 설정의 채팅 색상(`--bubble-fill`)을 따른다
- [x] **밀어서 답장** — 채팅 말풍선(또는 그 줄의 빈자리)을 손가락으로 옆으로 밀면 따라오고, 드러난 자리에 답장 화살표. 64px 넘게 밀면 진동 한 번,
      놓으면 그 메시지에 답장. 위아래가 더 크면 스크롤 · 짧게 밀면 취소 · 마우스 드래그는 글자 고르기 그대로(`touch-action: pan-y`)
- [x] **Phase 23 — 이름 편지 (익명편지 리뉴얼)** — 학생 검색 → 그 학생에게 편지 → 둘이 주고받기. 받는 사람은 이름이 보이고
      보낸 사람은 익명 이름. 처음 가입할 때 이름 확인 (명렬표에서 자동, 없으면 한 번 입력 · `private.self_names`), 설정 > 편지 받기(기본 켜짐).
      괴롭힘 막기: 새 편지 하루 몇 통(편지 버킷) · 답 없이 3개까지 · 받는 사람이 끝내면 그 사람은 다시 못 보냄 · 차단(채팅과 공유) ·
      신고 = 자동 차단 + 끝내기 + 누적 정지 · 규칙 필터 · AI 검토. 운영자는 신고된 편지의 보낸 사람을 확인하고(기록 남음) 내릴 수 있다.
      새 편지·답장은 푸시 알림, 익명편지 탭에 안 읽은 빨간 점. 옛 공개 피드·편집기·하트 화면은 뺐다 (데이터는 DB 에 그대로)
- [x] **Phase 24 — 편지 쓰기 편집기** — 새 편지를 쓸 때 서식 도구 막대 (굵게 · 기울임 · 밑줄 · 취소선 · 형광펜 5색 · 글자색 6색 · 크기 · 정렬 · 되돌리기, Tiptap).
      Phase 14 와 같은 방식 — 본문은 순수 텍스트, 서식은 `dm_msgs.fmt` 에 범위 목록으로, DB 가 `letter_fmt_ok` 로 검사. 받는 쪽 말풍선도 표로만 그린다(HTML 없음). 답장은 글자만
- [x] **화면 모드** — 설정 맨 위 한 줄 "화면" + 오른쪽 아이콘 셋(기기 · 해 · 달): 기기 설정 따르기 / 라이트 모드 / 다크 모드. 이 기기에만 저장(`localStorage` `theme-v1`, `lib/theme.svelte.ts`),
      `<html data-theme>` 로 app.css 색을 바꾸고 안드로이드 상단 바 색(`theme-color`)도 맞춘다. 첫 화면이 번쩍이지 않게 `app.html` 의
      짧은 스크립트(CSP nonce)가 먼저 입힌다
- [x] **공지사항 목록 · 내용 나누기** — `/notices` 는 제목 · 시각 · "새" 표시만, 누르면 `/notices/[id]` 에서 내용.
      내용을 보고 뒤로 와도 "새" 표시는 그대로 (SvelteKit snapshot)
- [x] **편지 화면 키보드** — 키보드가 올라오면 최근 말이 가려지던 것 → 채팅 화면처럼 보이는 영역(visualViewport)에 맞추고 맨 아래를 지킨다
- [x] **알림 고침** — 안드로이드에서 흰 네모로 보이던 알림 아이콘 → 흰 로고 + 투명 배지(`badge-96.png`).
      알림을 누르면 브라우저 탭 대신 설치한 앱으로: 앱 창이 뜰 때 서비스워커에 알려 두고(`landy-meta` 캐시),
      앱 창이 있으면 그 창을, 앱을 써 온 기기면 새로 열어 안드로이드가 앱으로 열게 한다
- [x] **테마 색상** — 설정의 "채팅 색상"을 "테마 색상"으로. 고른 색이 말풍선만이 아니라 앱 전체 포인트 색
      (`--g-*`→로고 `--brand`, 채운 버튼 `--accent-fill`, 글자·아이콘 `--accent`, 내 말풍선 `--bubble-fill`)을 바꾼다. 미리보기 대화는 그대로.
      저장 키(`chat-color-v1`)는 그대로라 이미 고른 색은 유지
- [x] **Phase 25 — 편지 나가기 · 길게 누르기 메뉴 · 가명** — 편지에서 나가기 · 차단 · 신고를 하면 그 편지가 내 목록에서 사라진다
      (표에는 남음 — "다시 못 보냄" 규칙 · 신고 증거용). 끝낸 뒤 같은 사람에게 다시 보내도 목록에 같은 이름이 둘 뜨지 않는다.
      편지 목록 · 대화 목록에서 줄을 길게 누르면(마우스는 오른쪽 클릭) 신고 · 차단 · 나가기 (`lib/longpress.ts`, `LetterMenu`, `RoomMenu`).
      받는 쪽 목록 · 편지 화면 · 알림 제목은 "익명 · ○○" 대신 가명(○○)만
- [x] **Phase 26 — 편지 읽음 · 시간 한 줄** — 편지 화면에서 말마다 달던 시간을 없애고, 가장 최근 말 아래에만 한 줄
      ("방금" / 내 말이고 상대가 읽었으면 "읽음 · 방금"). 같은 쪽이 연달아 보낸 말은 붙이고, 말하는 쪽이 바뀔 때만 띄운다
- [x] **Phase 27 — 편지지 · 편지로 답장 / 채팅하기** — 익명편지를 채팅처럼 쓰지 않는다. 편지 쓰기 = 편지지 화면
      (To. 받는 사람 · 서식 편집기 · From. 익명 — 보내면 가명). 받은 사람은 편지 화면 아래에서 "편지로 답장하기"(편지지, To. 가명 · From. 내 이름)
      또는 "채팅하기"(그때부터 말풍선 채팅)를 고른다. 편지는 편지지 카드(`LetterPaper`)로, 채팅 한 줄은 말풍선으로.
      보낸 쪽은 "답장을 기다리고 있어요"(+ 한 통 더 쓰기, 답 없이 3통까지). 편지 목록은 보던 탭을 기억하고, 편지를 열면 그 쪽(보낸/받은) 탭으로 맞춘다
      → 보낸 편지에서 들어갔다 뒤로 오면 보낸 편지 목록
- [x] **약관 및 정책** — 설정 맨 아래 "약관 및 정책" 카드에 이용약관 · 개인정보 처리방침 · 운영정책 (`/settings/terms` · `/settings/privacy` · `/settings/policy`).
      내용은 `src/lib/legal.ts` — 앱이 실제로 하는 일(보관 기간 · 위탁 업체 · 자동 정지 기준 등)에 맞춰 적었으니 기능을 바꾸면 같이 고친다.
      예전 설정의 "개인정보" 안내 문단은 개인정보 처리방침 맨 위 요약으로 옮김
- [x] **문구 줄이기** — 화면 곳곳의 긴 설명(홈 "이름도 학번도 묻지 않아요…", 설정 · 프로필 카드 아래 설명, 편지 안내 · 규칙, 로그인 · 설치 · 시작하기 안내)을
      지우고, 확인 창 문구는 한 줄로. 약관 · 개인정보 처리방침 · 운영정책도 몇 줄로 줄임 (`src/lib/legal.ts`)
- [x] **Phase 28 — 메시지 삭제 · 둘 다 볼 때만 흐르는 시간 · 연장 힌트**
      · 내 말을 길게 눌러 "삭제" → 둘 다에게 "삭제된 메시지입니다", "삭제했습니다" 알림. 원문은 `private.deleted_messages` 에만 (신고 증거용)
      · 대화 시간은 둘 다 대화 화면을 보고 있을 때만 준다: 앱이 10초마다 `room_view`, 한쪽이라도 끊기면 `rooms.paused_left` 에 얼림
        (그동안 `expires_at = infinity`), 둘 다 돌아오면 이어서. 멈춘 동안 타이머에 ⏸ · 목록에도 멈춘 시간. 하루 넘게 멈추면 닫힘
      · 연장할 때마다 서로 힌트 하나: 학년 → 성씨(명단) → 동아리 → 디플로마(그 차례에 연장하면서 직접 적음, 방마다 `private.room_hints`)
- [x] **Phase 29 — 연장 공개 순서 · 공통 질문 · 대화 고정**
      · 연장할 때 공개하는 것: 10분 째 학년 → 20분 공통 질문 → 30분 디플로마 → 40분 공통 질문 → 50분 동아리 (성씨는 뺐다).
        공통 질문은 방마다 정해진 질문 하나(`private.room_question`, 둘에게 같은 질문 · 두 번째는 첫 번째와 다름)에 연장하면서 답을 적고(30자), 연장되면 서로의 답 공개
      · 동아리까지 연장하고 10분 뒤(60분 째)에는 연장 대신 "이 채팅을 고정하시겠습니까?" — 둘 다 고정하면 `rooms.pinned`:
        시간 제한 · 멈춤 없음(`expires_at = infinity`), 대화 목록 맨 위, 방이 닫히지 않으니 24시간 삭제도 없음, 동시 대화 개수에 안 셈(`private.open_rooms`).
        한쪽이라도 안 하면 연장 거절처럼 끝난다. 고정한 대화도 나가기 · 신고 · 차단하면 닫히고 보통 대화처럼 지워진다
      · 채팅 색 깜빡임 고침 — 빠르게 스크롤하면 내 말풍선이 잠깐 보라색으로 보이던 것. 말풍선 그라디언트 위치를 scroll 이벤트 → 다음 프레임 JS 로 고쳐서
        몇 프레임씩 늦었고, 그 사이 그라디언트 밖으로 옛 기본색 보라(`#9a36e4`)가 비쳤다. 이제 CSS 스크롤 연동 애니메이션(`animation-timeline: view()`)이
        말풍선 뒤판을 옮기고(미지원 브라우저만 JS), 그라디언트 위아래를 끝 색으로 늘려 어긋나도 테마 색 밖으로 나가지 않는다 (`--bubble-a/b/c`)
- [x] **Phase 30 — 매너 온도** — 모두 40.0도에서 시작. 끝난 대화(24시간 안, 둘 다 말을 한 대화)나 고정한 대화에서 상대를 한 번 평가한다:
      좋았어요 · 괜찮았어요 · 아쉬웠어요 + 이유 칩 (`src/lib/manner.ts`, `RateForm`). 끝난 대화 화면 · 고정한 대화의 "평가하기" 막대 · 홈의 "어땠어요?" 카드.
      ★ 평가는 바로 반영하지 않고 매일 새벽 6시간 넘게 지난 것을 모아서(`private.apply_ratings`) — 방금 대화한 상대가 누가 낮게 줬는지 알 수 없게.
      좋았어요 +0.3 · 괜찮았어요 +0.1 · 아쉬웠어요 −0.8, 아쉬운 칩 하나에 −0.2 (2개까지), 같은 사람을 7일 안에 또 평가하면 첫 평가만, 0~99.
      신고 · 차단 · 운영진이 끝낸 대화는 평가하지 않는다. 온도는 상대 프로필 · 대화 맨 위 소개 · 내 프로필에 (`MannerTemp`)
- [x] **Phase 31 — 업적 (동 · 은 · 금)** — 24종 × 3등급 (`private.achievement_defs` 가 유일한 출처: 매너 · 대화 · 편지 · 특별).
      메시지는 24시간 뒤 지워지므로 개수는 `private.user_stats.counts` 에 가벼운 트리거로 쌓는다 (메시지 · 첫마디 · 공감 · 연장 · 고정 · 끝까지 · 공통 질문 ·
      편지 · 평가 · 매너 온도 · 연속 접속). 등급은 오르기만 한다. 공감은 한 메시지에 한 사람이 처음 달 때만, 경고를 받으면 "깨끗한 기록"은 처음부터.
      내 프로필의 "명성" 카드 → `/me/achievements` (분류 탭 · 메달 격자 · 대표 업적 걸기). 대화 상대에게는 대표 업적 3개만 (`partner_profile.badges`).
      새로 따면 탭 첫 화면에서 축하 시트 (`AchievementCelebrate`). 미리보기 `/dev/achievements` (`?celebrate`, `&one`), 화면 테스트 `achievements`
- [x] **Phase 32 — 익명편지 리뉴얼 (봉투 · 편지지)** — 채팅처럼 좌우로 쌓이던 편지 줄기를 없애고 **편지 한 통 = 봉투 하나**.
      편지함은 받은 편지 · 보낸 편지 따로 (`/letters`): 받은 편지는 덮개 쪽(안 연 편지는 밀랍 봉인 · 빛남), 보낸 편지는 주소 쪽(항공우편 줄무늬 · 우표 · 소인 · 읽음/답장 옴).
      받는 사람에게 모르는 사람은 **"익명의 ○학생"(성별만)** — 보낼 때의 성별을 `dm_msgs.from_gender` 에 새긴다. 내가 이름으로 보낸 사람의 답장은 그 이름으로.
      봉투 열기(`/letters/m/[id]`, 처음 여는 받은 편지만): 주소 면 → 뒤집기 → 봉인이 두 쪽으로 깨지고 → 덮개가 열리고(안감) → 편지지가 나와 → 펼쳐 읽기. 누르면 건너뜀.
      쓰기(`/letters/new` 찾기 → `EnvelopeCompose`, 답장 `/letters/m/[id]/reply`): 봉투가 열리고 편지지가 솟아 편지 쓰는 칸이 되고, 보내면 접혀 봉투로 →
      덮개 → 봉인 찍힘 → 뒤집어 소인 "보냄" → 날아간다. 답장은 편지로만 (채팅 모드 · 말풍선 삭제), 예전 채팅 줄은 표에 남고 편지함엔 안 보인다.
      손글씨는 나눔펜 (Fontsource, 자체 호스팅 · CSP font-src 'self' 그대로). 동작 줄이기면 연출 없이. 예전 주소 `/letters/<줄기>` 는 편지함으로
- [x] **Phase 33 — 전체 리디자인 (브랜드 유지 · 트렌디하게)** — 주황 → 핑크 브랜드는 그대로, 인스타 · 틴더처럼 따뜻하고 입체적으로 (`src/app.css` 토큰).
      서체 Pretendard (Phase 38 에 원티드 산스 · 베이글 팻 원으로 바꿈), 바탕은 따뜻한 흰색 + 탭 첫 화면 위쪽 빛 번짐(`--ambient`),
      카드는 흰 면 + 부드러운 그림자(`--shadow-1/2`) · 모서리 24px, 버튼은 알약 + 브랜드 빛(`--glow`), 머리글은 반투명 유리, **탭바는 아래에 떠 있는 유리 알약**.
      홈: 고정한 대화는 인스타 스토리 줄(새 메시지면 그라디언트 테두리), 대화 목록은 카드, 비어 있으면 도는 빛 덩어리 위 유리 카드, **찾는 중엔 내 얼굴 레이더**.
      연결 화면은 틴더 "It's a Match" 처럼 (두 얼굴 · 하트 · 손글씨 "연결됐어요!"). 프로필은 브랜드색 표지 + 걸친 아바타 카드. 시트는 손잡이 · 큰 모서리.
      접근성 점검(WCAG AA): 보조 글자 · 링크 · 위험색을 4.5:1 넘게, 작은 흰 글씨가 올라가는 배지는 진한 그라디언트(`--accent-fill-deep`),
      큰 버튼은 19px 굵게(큰 글씨 기준), 매너 온도 색은 라이트/다크 따로, 키보드 초점 테두리. 상단 바 색(`theme-color`)도 새 바탕색으로
- [x] **Phase 34 — DB 스키마 · 보안 · 코드 점검** — `schema.sql` 에 단계마다 다시 정의되던 함수 33개를 처음 자리의 최종 정의 하나로 (겹친 정의 43개 삭제,
      6952 → 5633줄, 맨 위 `check_function_bodies = off`). 정리 전후 PGlite 카탈로그(함수 · 열 · 제약 · 색인 · 트리거 · 정책 · 권한)가 같고, 실DB 함수 171개 본문도 레포와 같다.
      화면에서 안 쓰는 학생 RPC 14개(옛 공개 편지 · `my_room` · 편지 줄기 `dm_inbox`/`dm_thread` · `dm_letter` 직접 호출) 실행 권한 회수 — 표 · 함수는 남긴다.
      학생 RLS 정책 5개를 `(select auth.uid())` 로(Advisor `auth_rls_initplan`), 업적 색인, 트리거 함수 PUBLIC 권한 회수. 보안 점검 기록은 `SECURITY.md`.
      코드: 흩어진 `rpc()` 도우미를 `src/lib/rpc.ts` 하나로, `ChatView` 에서 머리글(`ChatHeader`) · 알림 띠(`Banner`) · 연장/고정 투표 띠(`VoteBanner`)를 떼어 냄.
      화면 테스트 `sheet` 의 오래된 실패(첫 화면을 정해진 시간만 기다림)를 고침 — 신고 사유가 뜰 때까지 기다림
- [x] **Phase 35 — 편지 · 알림 · 화면 다듬기**
      편지: 휴대폰에서 쓰는 동안 봉투가 편지지 · 보내기 단추를 가리던 것 고침(쓰는 동안 봉투를 치우고 보내기 줄은 키보드 위에).
      봉투 다시 그림 — 항공우편 줄무늬 · 학교 로고 우표 · 소인 · 우편번호 칸 · 접힌 날개 그늘 · 덮개 그림자 · 학교 로고 양각 밀랍 봉인.
      받은 편지는 보낸 사람 성별로 테두리 색(여학생 붉은색 · 남학생 푸른색). 편지함 = 안 연 편지만 위에, 읽은 · 보낸 편지는 갈색 책상 위 서류 더미 →
      누르면 보관함(`/letters/archive`, 받은/보낸 한 줄씩). 서명(닉네임) 직접 적기 — 비우면 "익명의 ○학생", 규칙 필터 · 검열봇 대상.
      찾기 결과에 학번(동명이인 구분). 편지 쓰기 단추 등 진한 브랜드 면이 테마 색을 따른다.
      알림: 상단 종 → 하트(`/activity`) — 새 메시지 · 편지 · 공지 · 개인 공지를 한곳에. 앱이 켜져 있어도 푸시를 보내고(그 대화를 보고 있을 때만 건너뜀),
      앱이 화면에 떠 있으면 위에서 내려오는 앱 안 알림 띠(`InAppBanner`). 같은 대화 알림은 한 장에 최근 말 몇 줄로 모이고, 알림을 누르면 새로고침 없이 이동,
      본 대화 · 편지의 알림은 알림 센터에서 지운다. 서버는 토큰을 `getClaims` 로 확인(비대칭 키면 인증 서버 왕복 없음).
      화면: 탭바를 화면 맨 아래에 붙임(아이폰에서 어중간하게 떠 보이던 것), 프로필 머리글 높이를 다른 탭과 맞춤, 화면 넘김 애니메이션(View Transitions),
      대화 목록 · 편지함을 기억해 두고 바로 그림, 매너 평가는 화면 가운데 큰 카드에서 끝냄, 토스트는 한 장만(그 자리에서 바뀜),
      업적 메달은 이모지 대신 새긴 선 그림 · 동전처럼 돌며 튀어나오는 축하, 연장 때 디플로마는 학교 목록에서 검색해 고름.
      운영: 학생 한 명에게 개인 공지(경고 · 연락) 보내기, 실시간 현황의 "대화 중"은 둘 다 대화 화면을 볼 때만. 학생 앱에서 F12 · 오른쪽 클릭 막음(보안 장치 아님)
- [x] **Phase 36 — Supabase 사용량 줄이기**
      요청 하나하나가 Supabase 로그(무료 1GB/월)가 된다. 새 업적 확인이 스스로 다시 도는 버그로 하루 24만 번 불리던 것을 고치고,
      주기 요청을 줄였다 — 접속 신호 30→60초 · 대화 "보고 있음" 10→20초 · 대화 안전망 45→90초 · 대화 목록 30→60초 ·
      안 읽은 편지 1→2분 · 편지함 30초(3개) → 2분(받은 편지 1개) · 새 업적 2→10분 · 운영자 실시간 현황 10→20초 ·
      매너 평가 대기는 1분마다가 아니라 대화가 끝나거나 고정될 때만. 서버의 창(온라인 130초 · 보고 있음 45초)을 그만큼 늘림.
      **새 기능을 만들 때 주기 요청은 꼭 필요한 만큼만, Realtime · 푸시 · 화면 복귀로 대신할 수 있으면 그쪽으로.**
- [x] **Phase 37 — 손글씨 편지 · 당겨서 새로고침**
      편지 본문도 To. · From. 과 같은 손글씨(나눔펜)로 쓰고 읽는다. 줄은 종이가 아니라 본문 칸에 긋고 줄 간격을 34px 로 고정해
      글줄이 언제나 편지지 줄 위에 앉는다 (종이 맨 위부터 그어 To. 높이만큼 어긋나던 것). 설치한 앱에는 새로고침 단추가 없어서
      탭 첫 화면 맨 위에서 당겼다 놓으면 새 버전을 확인하고 다시 불러온다(`PullRefresh`), 설정 › 계정에도 "앱 새로고침".
      편지지 꾸밈 — 종이 결 · 가장자리 바랜 빛 · 두 줄 여백선 · 테마 색 줄 · 학교 로고 물자국 · 마스킹 테이프 (이미지 파일 없이 CSS).
      상단 하트 · 톱니 그림 크기를 눈으로 같게(하트 가로 19 · 톱니 20).
      운영진에게 문의하기 — 설정 › 도움 에서 종류를 골라 보내고, 내 문의와 답변을 본다. 운영 화면 "문의" 탭에서 답하면
      그 학생에게 개인 공지(알림 · 공지 · 푸시)로 간다. 답 못 받은 문의 3개 · 하루 5개까지, 180일 뒤 삭제.
- [x] **Phase 38 — 서체**
      흔한 기본 서체(Pretendard) 대신 이 앱만의 글씨로. 본문 · 화면 글자는 원티드 산스(Wanted Sans Variable — 기하학적 · 촘촘 ·
      굵기 400~1000), 로고 · 탭 제목(익명편지 · 내 프로필) · 홈의 큰 10:00 · "연결됐어요!" · 업적 축하 · "새 편지"는
      베이글 팻 원(Bagel Fat One — 둥글고 통통한 디스플레이), 편지 글씨는 나눔펜 그대로. 셋 다 npm 으로 자체 호스팅,
      글자 범위별 분할 파일이라 화면에 쓰인 글자 묶음만 받는다 (CSP font-src 'self' 그대로).
- [x] **Phase 40 — 봉인 연출 · 봉투 메뉴 · 알림 한 목록 · 아바타 · 테마 색** (DB 변경 없음)
      밀랍 봉인: 보낼 때 녹은 밀랍이 떨어지고 놋쇠 도장이 화면 앞에서 내려와 **쿵** 찍힌다 (예비 동작 · 가까워지는 그림자 · 밀랍 눌림 ·
      충격 파문 · 봉투 눌림 · 진동). 열 때는 두 쪽으로 갈라져 날아가던 것을 없애고, 부르르 떨며 덮개 선을 따라 금이 가고
      부스러기가 떨어진 뒤 봉인이 덮개에 붙은 채 함께 들린다. 봉투 메뉴(길게 누르기 · 오른쪽 클릭 · ⋯)에서 채팅 시절의 "나가기"를 없애고
      편지 열기 · 답장 쓰기 · **편지 버리기**(= 서버 dm_close) · 차단 · 신고로. 하트 알림은 공지를 따로 나누지 않는 한 목록 —
      "공지사항" 화면(`/notices` 는 알림으로 넘김) · "공지 ·" 머리말 없이 시간순으로 섞이고, 개인 공지는 그 자리에서 펼쳐 읽는다.
      아바타는 글자 한 자 대신 이름으로 뽑은 메시 그라데이션 구슬(이름의 색 낱말 → 그 색 계열). 테마 색: 회색(검정) → 인스타 그라데이션,
      초록은 한 톤 연하게. 한글 줄바꿈을 낱말 단위로(`word-break: keep-all`), 프로필 "안 적을래요" 선택을 테두리로.
- [x] **Phase 41 — 키보드** — 아이폰이 16px 보다 작은 입력칸에서 화면을 확대해 비율이 깨지던 것(입력칸 16px · `maximum-scale=1`),
      키보드 대응을 `lib/keyboard.svelte.ts` 하나로 (`--vvh` · `--vv-top` · `--kb` · `html.kb-open`).
- [x] **Phase 42 — 전체 리팩토링** (동작 변경 없음 · DB 변경 없음)
      같은 일을 하는 코드를 하나로: 대화 메뉴(대화 목록 길게 누르기 · 대화방 ⋯ → `RoomActions`), 말 입력 알약(대화방 · AI 대화 → `MessageInput`
      — AI 대화도 칸이 자라고 초점 테두리 · 누름 반응이 생김), 봉투 더미(편지함 · 보관함 → `MailStack`), 편지 보내기(`letters/send.ts`),
      ⋯ 단추(`MoreButton`), 누름 반응 12곳을 `.u-tap`, 신고 사유 목록, 봉투에 적힌 나 · 상대(`myLabel` · `otherLabel`).
      홈을 나눔: 고정한 대화(`PinnedStories`) · 대화 목록(`RoomList`) · 매너 평가 대기(`RateQueue`) · 알림 안내(`PushAsk`) — 844 → 494줄.
      `rpc()` 도우미를 직접 짜던 곳(채팅 전송 계층 · 프로필 · 이름)도 쓰게, 창 폭은 `svelte/reactivity/window`. 안 쓰는 코드(`IN_APP_NAME` · `.hair`) 삭제.
- [x] **Phase 43 — 설정 늘리기 · 삼성 인터넷 → Chrome · 모바일 점검 · 봉투 From. 잘 보이게**
      설정: 글자 크기(대화 말풍선 · 편지 글씨 네 단계, 편지지 줄 간격도 같이) · 움직임 줄이기(기기 설정과 별개) · 진동(안드로이드) ·
      푸시 알림 종류별로 끄기(대화 메시지 · 공감 · 편지 — 기기 구독마다 `push_subscriptions.mute`, 서버가 보낼 때 거름, 운영진 공지는 못 끔) ·
      앱 안 알림 띠 · Enter 키로 보내기(끄면 줄바꿈, 휴대폰 키보드 Enter 자리도 "보내기"/"줄바꿈") · 편지지 글씨(손글씨 / 반듯한 글씨) ·
      봉투 여는 장면 · 버전(빌드 시각) · 이 기기 설정 초기화. 서버에 안 가는 것은 `lib/prefs.svelte.ts` 한 키(`prefs-v1`)에, 첫 화면 전에 app.html 이 입힌다.
      삼성 인터넷: 설치 정보(manifest)를 주지 않아 삼성 인터넷이 Play 프로텍트에 막히는 설치 앱을 만들지 못하게, 설치 안내 화면이 저절로 Chrome 을 연다(탭마다 한 번 · 안 되면 단추).
      모바일: `color-scheme` 선언 — 안드로이드 Chrome "사이트에 어두운 테마 적용" · 삼성 다크 모드가 화면을 뒤집지 않고, 아이폰 키보드 · 입력칸이 화면 모드를 따른다.
      봉투의 From. · To. — 머리말을 키우고 진하게, 이름 손글씨는 한 단계 크게 · 잉크를 조금 굵게, 줄 높이 1 에서 받침이 잘리던 것("학생" → "학새") 고침.
      미리보기 `/dev/letters` (`?dark`). 화면 테스트 `back` 에 설정 확인 추가, 스키마 테스트 [83]
      43-2 아이폰 상태바: `black-translucent` 는 시계 · 배터리 글씨가 늘 흰색이라 라이트 모드에서 안 보였다 → `default`
      (화면이 상태바 아래에서 시작, 상태바는 theme-color 에 맞춰 라이트면 검은 글씨). 이 값은 홈 화면에 추가할 때 저장돼서,
      예전에 추가한 앱은 라이트 모드일 때 상태바 자리(`--safe-top`)만 어둡게 받친다(`body::before`, 다크 모드 · 새로 추가한 앱 · 안드로이드는 안 보임)
- [x] **Phase 44 — 명성 소프트 리부트 · 베타 테스터 · 정지 풀기 · 첫 대화 5분 · 학번 로그인 · 익명편지 잠금 · 처음 사용법 안내**
      명성: 대화 맨 위 소개 · 상대 프로필 · 내 프로필의 메달을 누르면 어떻게 얻는지 · 등급 기준 (업적 화면과 같은 `BadgeDetail`).
      남의 메달 설명은 업적 카탈로그(`achievement_catalog`, 앱을 켠 동안 한 번)에서, 창은 루트에 하나(`BadgeSheet`) — 프로필 시트 위에도 뜬다.
      특별 업적(`achievement_defs.granted`) — 기준 없이 운영진이 주고 거둔다 (`admin_set_badge` · `admin_user_badges`, 사용자 상세 "특별 업적").
      첫 번째는 베타 테스터: 무지갯빛 메달 · 등급 대신 "특별" · 금은동 개수에 안 셈. 운영자 사용자 상세 — 정지 중이면 맨 위에 "정지 풀기"(영구 정지는 관리자만),
      제재 폼의 "정지 풀기(제한 해제)"는 정지 중일 때만. 첫 대화 5분(`room_minutes`), 연장은 10분 그대로 — 빈 홈은 숫자 대신 두 말풍선.
      로그인: 학번(5자리, 1~3학년)만 — 영어 아이디면 "선생님이신가요? 학생 전용" 안내. 익명편지 잠금(`letters_gate` · `letters_gate_min` 100명, 운영 설정에서 켜고 끔):
      가입한 학생(인증 + 시작하기)이 모일 때까지 편지 탭이 잠금 화면(실시간 가입 인원 — `signup_stats` 한 줄 표를 Realtime 으로, 주기 요청 없음),
      서버도 쓰기 · 찾기를 막는다(`dm_can_write` · `dm_search` → `letters_locked`). 처음 사용법 안내(`Tour`) — 처음 홈에 오면 11단계
      (환영 · 새 대화 찾기 · 시간 · 공개 순서/고정 · 말풍선 · 매너 온도 · 익명편지 · 프로필과 명성 · 알림 · 설정 · 지킬 것), 화면의 그 자리를 비추고
      건너뛸 수 있다. 설정 › 앱 › "사용법 다시 보기". 안내가 알려 주는 설명 문구(프로필 · 편지함 · 편지 찾기 · 평가 · 설정 설명)는 지웠다.
      스키마 테스트 [84], 화면 테스트 `back` · `login` · `letters` · `achievements` · `audit`
- [x] **Phase 45 — 공감 배지 누름 영역 · 받은 편지 인스타 스토리 공유**
      공감 배지(`ReactionBadge`): 넓힌 누름 영역을 말풍선 밑에 깔자(길게 누르기 · 두 번 톡을 가로채지 않게) 위 절반이 말풍선에 가려 44 가 안 됐다(`hit` 실패).
      → 버튼 자체가 44 × 44 상자, 보이는 알약(22)은 그 맨 위 — 상자는 알약 윗변(말풍선 아래 7px)에서 아래로 넓어서 말풍선과는 알약이 걸친 줄만 겹친다.
      공감이 달린 말풍선 아래 자리는 22 → 35 (`.bwrap.reacted`).
      받은 편지 화면: "편지로 답장 쓰기"(넓게) 오른쪽에 작은 인스타 버튼 — 누르면 스토리 그림(1080 × 1920, `letters/story.ts`)을 이 기기에서 그려
      폰 공유 창(Web Share, 파일)으로 → 인스타그램 › 스토리. 브랜드 그라디언트 바탕 + 같은 편지지(줄 · 여백선 · 테이프 · 로고 물자국), 서식 그대로,
      글씨는 설정의 편지지 글씨를 따른다. 긴 편지는 글씨를 줄여 맞추고(30px 까지) 넘치면 "…". From. 은 늘 익명 이름표(서명이 있으면 서명) —
      이름으로 온 답장이어도 상대 이름은 싣지 않는다. 그리는 사이 손길이 식어 공유 창이 막히면(iOS) "한 번 더" 안내 후 그려 둔 그림으로 바로,
      파일 공유가 없는 곳(데스크톱)은 그림을 저장. 서버 요청 없음. 화면 테스트 `hit` · `react` · `letters`
- [x] **Phase 46 — 찾고 고르면 키보드가 내려가게**
      아이폰은 버튼을 눌러도 입력칸에서 초점이 빠지지 않고, 입력칸이 화면에서 사라져도 키보드가 남는다 — 편지 받을 사람 · 연장 디플로마를
      찾아 고른 뒤에도 찾을 때의 키보드가 떠 있었다. 게다가 편지지(Tiptap)가 폰에서도 저절로 커서를 가져가 봉투 연출 내내 키보드가 화면을 반으로 줄였다.
      → `lib/keyboard.svelte.ts` `dismissOnTap` · `dismissKeyboard`: 입력 중 버튼 · 링크 · 고르기 항목을 누르거나 다른 화면으로 가면 키보드를 내린다(운영자 화면도).
      계속 쳐야 하는 곳(대화 입력 줄 · 공감 고르기 줄 · 편지 서식 막대)은 `data-keep-kb` 로 뺀다. 찾기 칸의 "검색" 키도 키보드를 내린다.
      편지지 저절로 커서는 마우스 · 키보드가 있는 기기만. 화면 테스트 `letters` · `features`
- [x] **Phase 47 — 편지 폴더 · 편지함 책상 비율 · 기기마다 줄바꿈**
      편지 폴더: 보관함 "고르기"로 여러 통(받은 · 보낸 섞어서)을 골라 이름 붙인 폴더에 넣는다 (`FolderPicker` — 있는 폴더 또는 새 이름).
      폴더에 넣은 편지는 받은/보낸 목록에서 빠지고 폴더에서만 보인다. 받은 편지는 봉투를 열어 본 것만. 폴더는 탭 아래 마닐라 폴더 서랍 줄 →
      `/letters/f/[id]`(빼기 · 다른 폴더로 · 이름 바꾸기 · 지우기 — 지우면 편지는 보관함으로). 고르는 중 뒤로가기 = 고르기 끝 (`backClose`,
      시트와 잇달아 닫을 때는 `historySettled`). 서버: `private.dm_folders` · `dm_folder_items`(한 편지 한 폴더), `dm_mailbox(p_box, p_before, p_folder)` —
      폴더 목록은 편지함 첫 쪽에 같이 싣는다(요청 수 그대로), `dm_folder_put` · `dm_folder_take` · `dm_folder_rename` · `dm_folder_delete`. 이름 20자 · 30개까지.
      편지함: 보관함 책상을 화면 아래쪽으로, 책상 · 더미 · 봉투를 화면 크기에 맞춰 같은 비율로(폭 390 · 높이 844 에서 1, 0.75~1.5 — 아이폰 SE · 큰 글꼴 안드로이드처럼 낮은 화면은 더 작게).
      줄바꿈: 안드로이드는 기기 글꼴을 키우면 웹 화면 폭이 좁아진다(360 · 130% ≈ 280). 모든 글 `text-wrap: pretty`(끝줄 외톨이 없게),
      제목 · 단추 · 이름표 `balance`, 쓰는 칸은 평소대로. 연장/고정 배너는 글 칸이 11em 아래로 줄지 않고 버튼이 아래 줄로("고정하시겠습/니까?" 없앰),
      설정 줄은 이름표를 쪼개지 않고 값 · 단추가 아래 줄로(› 는 오른쪽 끝에 붙박이), 대화 머리글 상태는 말줄임, 로그인 아래 두 단추는 좁으면 가운데 두 줄. `scripts/e2e/wrap.mjs` — 폭 280~520 · 30여 화면에서
      넘침 · 잘림 · 낱말 끊김 · 짧은 이름표 두 줄 · 외톨이를 찾는다. 스키마 테스트 [85], 화면 테스트 `letters` · `wrap`, 실DB 반영 (phase47_letter_folders)
- [x] **Phase 47-2 — 로고 글자가 잘리거나 두 줄로**
      아이패드 사파리에서 머리글 로고의 끝 글자가 다음 줄로 넘어가거나 잘렸다. 글자 폭에 맞춘 칸(`fit-content`)을 사파리가 글자보다
      소수점만큼 좁게 재면 낱말 넘김(`overflow-wrap`)이 끝 글자를 다음 줄로 보내고, 그라디언트 글자(`background-clip: text`)는 칸 밖으로 나온 획을
      칠하지 않는다(로그인 · 설치 화면은 자간을 좁혀서 R 의 끝이 늘 칸 밖이었다). `.wordmark` 는 늘 한 줄, 칸을 양옆으로 0.12em 넓히고 같은 만큼
      바깥 여백을 당겨 글자 자리는 그대로
- [x] **Phase 47-3 — 폴더 안에서 받은 편지 · 보낸 편지 나눠 보기**
      폴더 안 봉투마다 왼쪽 위 딱지 — "받은 편지"(흰 바탕 · 테마 색 · 들어오는 화살표) / "보낸 편지"(진한 바탕 · 종이비행기), 답장이면 "받은 답장" · "보낸 답장".
      둘 다 들어 있는 폴더는 위에 전체 · 받은 편지 · 보낸 편지 나눠 보기(수와 함께, 한 가지만 남으면 걷힌다). 보관함 서랍의 폴더 카드도 "받은 2 · 보낸 3".
      서버: `private.dm_folder_counts` — 폴더 목록(`dm_folder_list`)과 폴더 열기(`dm_mailbox` 의 folder)에 count · received · sent (요청 수 그대로).
      스키마 테스트 [85], 화면 테스트 `letters`, 실DB 반영 (phase47_3_folder_box_counts)
- [x] **Phase 48 — 운영자 화면 리뉴얼 · 편지함 판자 길게**
      결과는 누른 버튼 자체에: 모든 운영 폼이 `lib/admin/confirm.ts` 의 `ack()` · `confirmed()` 를 거친다 — 누르면 버튼 위에 "처리 중…" →
      초록 "✓ 적용됨"(서버 done 문구, 길면 앞부분만 + 전체는 알림) / 빨강 "✕ 실패"(이유는 알림). 버튼이 사라지는 조치(지우기 · 답변)는 알림으로.
      버튼 글자는 건드리지 않고 `data-ack` + CSS 덮개로만 그린다. 두 번 누름 막기. 화면 맨 위 결과 줄(FormMsg)은 자바스크립트 없을 때만.
      메뉴: 왼쪽 사이드바를 하는 일별로 묶음(지켜보기 · 신고 처리 · 사람과 대화 · 소통 · 운영) + 아이콘, 좁은 화면은 위쪽 한 줄 밀기.
      고친 칸 표시: 설정 폼에서 값을 바꾸면 그 줄에 테마 색 막대, 저장 단추에 빛 — 저장하면 걷힌다. 카드 · 표 · 수치 띠 다듬기.
      편지함: 책상 판자 230 → 300. 줄바꿈 검사(`wrap.mjs`)에 폴더 화면 · `WRAP_ENGINE=webkit`(사파리 엔진) 추가
- [x] **Phase 49 — 운영자 · 개발자 · 관리자 역할 나누기 · 운영진 현황 판**
      역할 셋(`private.staff.role`): 운영자(moderator) · 개발자(developer, 새로) · 관리자(admin). 권한표는 DB `private.staff_can` 과
      `lib/adminRoles.ts` 가 같은 표 — moderate(신고 · 제재 · 사용자 · 개인 공지 · 업적: 운영자 · 관리자) / identity(신원 · 전체 대화 · 편지 활동: 관리자) /
      settings(운영 수치 · AI · 금칙어 · 잠금 · 홈 배너: 개발자 · 관리자) / service(서비스 열고 닫기) · inquiry(문의) · audit(활동 기록): 모두 / notice(공지 올리기: 관리자).
      세 겹으로 막는다: 메뉴(권한 없는 메뉴 숨김) · 화면 load(`guard()` — 주소를 쳐도 403, 개발자는 첫 화면이 실시간) · DB 함수(`require_staff` 는 개발자를 막고,
      개발자도 되는 곳은 `require_perm`). 오른쪽 운영진 현황(디스코드 멤버 목록처럼): 역할별 묶음 · 접속 중(2분)/자리 비움(10분)/오프라인 · 하는 일("채팅 신고 보는 중") ·
      마지막 접속. 요청마다 하던 역할 확인을 `admin_staff_touch` 로 바꿔 그 한 번에 마지막 화면을 적고 팀 목록을 받는다(요청 수 그대로), 가만히 있으면 1분마다(탭이 보일 때만).
      역할 · 이름 정하기: `update private.staff set role = 'developer', display_name = '홍길동' where user_id = '…';`
      스키마 테스트 [86], 화면 테스트 `audit` [13], 실DB 반영 (phase49_staff_roles_presence)
- [x] **Phase 50 — 최고 관리자 · 운영진 관리**
      최고 관리자(`private.staff.owner`, 딱 한 명 · 관리자여야 — 유일 인덱스 · check 제약) = 20529. `/admin/staff`(최고 관리자에게만 메뉴 · guard · DB `require_owner`):
      학번으로 운영자 · 개발자 · 관리자 지정(관리자로 줄 땐 한 번 더 묻는다), 줄마다 역할 · 표시 이름 저장, 빼기(확인창). 최고 관리자 줄은 잠김(스스로 잠기지 않게).
      모든 변경은 활동 기록 `set_staff`. 사이드바 "최고 관리자", 현황 판에 "최고" 표시. 최고 관리자 넘기기는 DB 에서만:
      `update private.staff set owner = false where owner; update private.staff set owner = true where user_id = '…';`
      스키마 테스트 [87], 화면 테스트 `audit` [14], 실DB 반영 (phase50_staff_owner)
- [x] **Phase 51 — 베타테스터 역할 · 역할별 권한을 최고 관리자가 정한다**
      역할 넷: 운영자 · 개발자 · 베타테스터(beta, 처음엔 실시간 현황만 + 공지 목록) · 관리자(늘 전부). 권한 여덟: 실시간(live) · 활동 기록(audit) ·
      문의(inquiry) · 서비스 열고 닫기(service) · 운영 설정(settings) · 신고 처리 · 제재(moderate) · 공지(notice) · 학생 신원(identity).
      역할별 권한은 DB 표 `private.role_perms` — 운영진 관리 화면의 체크 표에서 최고 관리자가 바꾸고("권한 저장", 바뀐 역할만 · 활동 기록 `set_role_perms`),
      저장하면 바로 모든 DB 함수(`staff_can` · `require_staff` · `require_perm`) · 화면(guard · 메뉴)에 적용. 내 권한 목록(perms)은 요청마다 역할 확인과 같이 온다.
      관리자 역할은 표에 없다(늘 전부 — 잠겨 버리지 않게). 긴 정지(7일 넘게)는 여전히 관리자 역할만.
      스키마 테스트 [88], 화면 테스트 `audit` [15], 실DB 반영 (phase51_role_perms_beta)
- [x] **Phase 52 — 서버 점검**
      운영 설정 맨 위 "서버 점검" 카드(서비스 열고 닫기 또는 운영 설정 권한): 안내 문구(300자) · 끝나는 시각(선택, 한국 시간)을 적고 "점검 시작"(확인창) / "점검 끝내기".
      켜면 학생 앱 전체가 점검 화면(`lib/ui/Maintenance.svelte` — 도는 톱니 · 안내 · "오후 3:00쯤 끝나요 · 1시간 33분 남음" · 다시 확인(10초에 한 번)),
      새 대화(`request_match`) · 편지(`letter_eligible`)는 DB 도 막는다. 학생 앱은 앱을 열 때 설정으로, 그 뒤엔 1분마다 보내던 `heartbeat` 의 대답(maintenance)으로 알아서
      요청이 늘지 않고, 끄면 다음 박동에 저절로 열린다. 점검 중엔 모든 운영 화면 위에 주황 띠(역할 확인 요청에 같이 실림). 운영 화면은 점검 중에도 그대로.
      스키마 테스트 [89], 화면 테스트 `audit` [16] · `wrap`(점검 화면 모든 폭), 실DB 반영 (phase52_maintenance)
- [x] **Phase 53 — 점검 예약**
      점검 카드에 "시작 시각(비우면 지금 바로)" — 적으면 "점검 예약". `app_settings.maintenance_at` 에 시각만 적어 두고, 점검 여부를 물을 때마다
      `private.in_maintenance()`(켜져 있거나 예약 시각이 지났거나)로 본다 — 따로 도는 작업(cron) 없이 시각이 되면 1분 안에 모든 학생 앱이 점검 화면.
      예약 중엔 카드가 "⏰ 예약됨 · 지금 바로 시작 · 예약 취소", 운영 화면 위 파란 예약 띠, 24시간 안의 예약은 학생 홈에 "오늘 오후 3:00부터 서버 점검" 예고
      (heartbeat 대답의 maintenance_at). 점검 끝내기 · 예약 취소 = 점검 · 예약 둘 다 지운다. 운영 화면 시각은 늘 한국 시간(서버에서 그려도).
      스키마 테스트 [90], 화면 테스트 `audit` [17], 실DB 반영 (phase53_maintenance_schedule)
- [x] **Phase 54 — 점검하며 찾은 것들**
      학생 앱이 옆으로 밀리지 않게(`#app { overflow-x: clip }` — 비스듬한 봉투 · 딱지 · 여는 움직임이 잠깐 화면 밖으로 나가면 사파리가 페이지를 옆으로 끌게 했다).
      낮은 화면에서 편지 쓰기 단추가 보관함 이름표와 겹치면 동그란 연필 단추로 줄어든다(스크롤 · 크기 변화만 잰다). 인터넷이 끊기면 위쪽 띠 · 다시 이어지면
      "다시 연결됐어요" + 박동 한 번. 운영진 현황 판이 숨겨진 좁은 화면에선 1분마다 부르지 않는다(DB 요청 줄임). 활동 기록에 운영진 지정 · 역할 권한 ·
      서버 점검 · 점검 예약 · 익명편지 잠금 내용이 빈칸으로 보이던 것. Supabase 성능 진단의 인덱스 없는 외래 키 5개에 인덱스(실DB 반영 phase54_fk_indexes).
      화면 테스트 `letters`(낮은 화면 편지 쓰기 단추 · 인터넷 끊김 띠)
- [x] **Phase 55 — 실시간 전달을 DB 방송(Broadcast) · 비공개 채널로**
      실DB 통계(pg_stat_statements 9/20~9/29): DB 가 가장 오래 쓴 일은 Realtime 이 표 변경 기록(WAL)을 훑는 일(16만 번 · 약 930초 — 앱 요청 전부보다 많다).
      postgres_changes 는 변경마다 구독자마다 RLS 를 다시 돌리고, 채널을 붙일 때마다 발행 목록을 조회하고, 전달 보장도 없었다.
      이제 트리거 하나(`private.rt_broadcast`)가 바뀐 행을 필요한 채널에만 `realtime.send` 한다 — `room:<방>`(msg · room · vote · reaction, 입력 중 · 접속은 앱끼리),
      `inbox:<나>`(대화 목록 "다시 읽어" — 방 목록이 바뀔 때마다 채널을 다시 붙이지 않는다), `signups`(가입 인원). 채널은 비공개라 참여할 때 한 번
      `realtime.messages` 정책(`rt_allowed`)으로 "이 방 사람인가"를 본다 — 제3자는 참여 자체가 안 된다(예전엔 공개 채널이라 방 id 를 알면 입력 중 · 접속을 들을 수 있었다).
      읽음 표시는 대화 목록을 건드리지 않고, 바뀐 게 없는 방 갱신은 방송하지 않는다. 표 변경 발행은 거둔다(WAL 을 훑을 일 자체가 없다).
      새 업적 확인: 축하 창이 10분마다 따로 묻던 것(`new_achievements` — 9/28 고친 반복 버그 전엔 32만 번)을 1분 박동 대답(`ach_new`)에 싣는다.
      스키마 테스트 [91](가짜 realtime 스키마로 방송 · 채널 권한), 실서버 검사 `scripts/realtime-e2e.mjs` 를 비공개 채널로.
      실DB 반영은 두 단계: ① 트리거 · 정책 · heartbeat(옛 앱에도 무해, phase55_realtime_broadcast) → 새 앱 배포 → ② 표 변경 발행 거두기(phase55_unpublish).
      실서버 검사 17/17 — 20건 모두 도착(유실 0), 전달 지연 p50 110ms · p95 301ms, 제3자는 방 · 목록 채널 참여 자체가 거절(CHANNEL_ERROR).
- [x] **Phase 56 — 브랜드 글씨를 파셜산스로**
      로고 · 탭 첫 화면 제목 · 큰 숫자 · 축하 · 매칭 · 점검 화면의 브랜드 글씨(`--display`)를 베이글 팻 원 → 파셜산스(Partial Sans KR, 박준영).
      라이선스(눈누): 웹 · 앱 서버 탑재 · 로고(BI/CI) 사용 가능, 파일 수정 · 재배포 · 판매 금지 — 원본 woff2(308KB) 그대로 `src/lib/fonts/` 에 두고
      빌드가 해시 붙은 파일로 내보낸다(서비스워커 캐시 · CSP font-src 'self' 그대로). 앱에 쓰인 한글 818자 모두 들어 있다(글꼴 2,780자).
      한 굵기뿐이라 로그인 · 설치 화면 로고의 굵기 800/900(가짜 굵게)을 400 으로, 넓은 글씨라 로그인 · 설치 로고와 "연결됐어요!"는 좁은 폰에서 폭에 맞춰 줄인다.
      `@fontsource/bagel-fat-one` 제거. 화면 테스트 `wrap`(폭 280~520 전부) 통과.
- [x] **Phase 57 — 앱 이름을 랜디(Landy)로**
      로고 · 탭 제목 · 홈 화면 앱 이름(매니페스트) · 알림 · 편지 스토리 그림 · 운영자 화면 · AI 대화 봇 소개 · 안내 문장의 앱 이름을 바꿨다.
      문장 안에서는 "랜디", 로고 · 제목은 "Landy". 서비스워커 캐시 이름도 바꿔(v10) 옛 캐시는 새 워커가 켜질 때 지워진다.
      서명 사칭 필터(`dm_nick_bad`)는 새 이름(landy · 랜디)을 막는다 — 실DB 는 `schema.sql` 을 다시 실행해야 반영.
      Cloudflare Worker 이름(`wrangler.jsonc`)과 배포 주소는 그대로 — 바꾸면 새 Worker 로 배포돼 환경변수 · 설치한 앱 · 푸시 구독을 새로 잡아야 한다.
- [x] **Phase 58 — 짧은 이름에 맞춘 로고 비율 · 책상 위 물건들 · 밀랍 봉인 다시 맞춤**
      로고: 긴 이름(10자)에 맞췄던 크기를 짧은 이름(Landy, 5자)에 맞춘다 — 로그인 · 설치 화면은 아이콘 · 이름을 가운데 한 덩어리로 크게(64 · 52px),
      홈 머리글 21 → 27px, 스플래시 18 → 38px, 편지 스토리 그림 60 → 84px, 운영자 화면(사이드바 · 로그인)도 같은 로고 글씨.
      편지함 책상: 판자 300 → 380(×화면 비율)에 위에서 내려다본 물건들 — 포스트잇(하트 낙서) · 라테 아트 커피잔 · 컵 자국 · 만년필 · 연필 ·
      봉인 밀랍 막대와 놋쇠 도장 · 종이 클립. 서류 더미 · 이름표를 피해 가장자리에. 낮은 화면(높이 760 미만)은 판자 300 그대로(이름표가
      편지 쓰기 단추 위에 보이게, Phase 47) · 물건을 줄여 옮긴다.
      밀랍 봉인: 밀랍 모양이 오른쪽으로 2.7 치우쳐 왼쪽 가장자리가 도장 자국 테두리에 닿아 찝혀 보이던 것 — 도장 가운데(20, 20.5)를 중심으로 다시 그림.
      빛 반사가 밀랍 밖으로 나오던 것 · 금 가는 선이 밀랍 밖으로 나오던 것(밀랍 모양으로 자름)도. 사파리(WebKit)는 그림자 필터가 걸린 칸 밖으로 나오는
      것을 잘라서, 도장 찍는 동안 놋쇠 도장 · 충격 파문이 반듯하게 잘렸다 — 그림자를 밀랍 · 덮개 면에만 건다.
      `/dev/letters?stamp` 으로 봉인 연출만 크게 볼 수 있다.
- [x] **Phase 59 — 아이패드에서 편지함 책상이 왼쪽에 쪼그라든 것**
      사파리 18 까지는 기본 스타일이 모든 `button` 에 `align-items: flex-start` 를 줘서, `display: flex` 로 쓴 단추(편지함 책상)의 안쪽 판자 · 이름표가
      폭을 채우지 못하고 왼쪽에 좁게 붙었다(크롬은 기본값이 없어 멀쩡). 전역 `button` 초기화에 `align-items: normal` — 크롬과 같게.
      화면 테스트 `letters` 에 사파리 기본 스타일을 흉내 낸 아이패드(1180×820) 검사.
- [x] **Phase 60 — 교복 프로필 (대표 업적 = 교복 깃의 배지)**
      우리 학교는 교복 깃에 실제 배지를 달아 준다 — 프로필의 "명성" 카드(메달 한 줄)를 교복 그림(`src/lib/ui/Uniform.svelte`)으로 바꿨다.
      가슴을 가까이 본 남색 재킷 · 노치 깃(새틴 광) · 흰 셔츠 칼라 · 회색 V넥 조끼, 남색 바탕에 하늘색 사선 줄 · 물방울 무늬 넥타이(남) / 리본(여),
      가슴 주머니 위에 교표(원본 그림 그대로, 바탕만 투명 — `scripts/generate-crest.mjs`). 대표 업적 3개는 깃을 따라 위에서부터 배지로(누름 44),
      빈 칸은 점선 "+" → 업적 화면. 배지를 누르면 전과 같은 업적 자세히 · 대표에서 내리기.
      이름 카드는 낮게: 표지 56px 에 걸친 아바타(60) · 표지 위 이름 · "업적 n/m ›", 그 아래 매너 온도.
      상대 프로필 시트도 교복 — 상대 성별은 서버 밖으로 내보내지 않으므로 늘 넥타이 (DB 변경 없음).
      나중에 학교 실제 배지를 운영진이 주는 특별 업적으로 더하면 같은 깃에 달린다 (칸 수 `LAPEL_SLOTS`).
      미리보기 `/dev/achievements?uniform`. 화면 테스트 `achievements` · `letters` 에 교복 검사.
      홈 머리글 로고(Phase 58 에서 27px)의 누름 높이가 29 라 `hit` 검사에 걸리던 것도 44 로.
- [x] **Phase 61 — 교복 깃을 크게 · 주머니는 교표 위에 수평으로 · 더 진한 남색**
      깃(라펠)을 그림 아래 밖까지 이어지게 크게 그려 대표 업적 배지 3개가 모두 깃 안에 (전엔 2 · 3번째가 깃 밖 몸판에 걸렸다).
      가슴 주머니는 비스듬하던 것을 수평으로, 교표 바로 위 가운데에 (사진처럼). 교표는 천에 수놓은 듯 살짝 어둡게 · 그림자.
      재킷 · 깃 색을 더 진한 남색으로, 깃 뒤에 가려지던 단추는 뺐다.
      화면 테스트 `achievements`: 배지 가운데 · 위아래 · 좌우 끝이 모두 오른쪽 깃 안(넥타이 · 리본, 폭 320 포함), 주머니 수평 · 교표 위 가운데.
- [x] **Phase 62 — 교복을 자연스럽게 · 넥타이 매듭(머리) · 리본 다시 그림 · 몸통을 왼쪽으로**
      몸통 가운데를 왼쪽으로(x 100 → 72), 오른쪽 끝에 소매 솔기. 깃 · 칼라 · 조끼 V넥 · 셔츠 칼라를 곧은 선 대신 곡선으로,
      깃이 말리는 그늘(앞섶 쪽 어둡게 · 바깥 가장자리 빛 · 손바느질) · 깃과 칼라 사이 솔기 · 천 결(능직) · 가슴에 비치는 빛 · 흘러내리는 주름 · 배지가 천에 드리운 그림자.
      배지는 손으로 꽂은 듯 조금씩 기울고(-7 · 5 · -3도) 처음 보일 때 차례로 한 번 반짝인다.
      숨 쉬듯 아주 살짝 움직이고(5.6초) 넥타이 날 · 리본 꼬리 · 고리가 다른 박자로 흔들린다 — 동작 줄이기면 멈춘다.
      넥타이: 머리(매듭)를 날보다 넓고 볼록하게 — 감긴 천이라 줄무늬가 날과 반대 방향, 양옆 주름 · 아래 그림자 · 매듭 아래 오목한 보조개.
      셔츠 칼라는 목 가운데서 만나 매듭 양옆으로 펼쳐진다. 날은 아래로 넓어지며 둥근 그늘, 조끼 속으로.
      무늬(사진): 남색 바탕 · 흰 테를 두른 하늘색 넓은 사선 줄 · 작은 잎 무늬.
      리본: 고리 둘(바깥 끝이 뒤로 접혀 넘어가는 면 · 안쪽 그늘 · 주름, 좌우 조금 다르게 기울어) · 조여서 주름 잡힌 매듭 · 제비꼬리로 자른 꼬리 둘(왼쪽이 조금 길게).
      화면 테스트 `achievements`: 움직임 · 동작 줄이기면 멈춤, 매듭이 날 위를 덮고 날보다 넓다, 리본 고리 · 꼬리. 배지를 누르는 테스트(`achievements` · `letters`)는
      배지가 움직여 playwright 가 멈추기를 기다리므로 동작 줄이기를 켜고 누른다.
- [x] **Phase 63 — 교복 앞섶을 곧은 선 대신 곡선 · 두께 · 그림자로**
      깃 안쪽 가장자리(앞섶)가 한 줄로 곧게 내려와 평평해 보이던 것 — 목 옆에서 내려와 가슴께에서 안으로 살짝 부푸는 S 곡선으로.
      천 두께: 둥근 가장자리 빛(위에서 아래로 옅어짐) · 어두운 윤곽 · 손바느질. 깃이 조끼 · 셔츠 위로 떠서 앞섶 안쪽에 부드러운 그림자.
      깃이 말려 넘어가며 받는 넓은 빛 띠 · 앞섶 바로 안쪽 오목한 그늘. 왼쪽은 몸이 옆으로 돌아 들어가며 어두워지고 깃에 부드러운 주름.
      조끼 목둘레 단은 뜨개 골(립) 무늬로.
- [x] **Phase 64 — 교복 조끼를 사진처럼 위로 · 넥타이를 왼쪽 끝으로**
      조끼 V넥이 한참 아래(그림 높이 65%)에 있던 것 — 사진처럼 셔츠 칼라 끝 바로 아래를 지나는 넓고 얕은 V 로 올렸다. 매듭과 날 윗부분만 보이고
      날 · 칼라 끝은 조끼 속으로. 목둘레 단은 남색 골 무늬, 조끼는 왼쪽(몸이 돌아 들어가는 쪽)이 어둡고 깃 쪽에 그림자.
      스케치대로 몸 가운데(넥타이 · 칼라 · V넥 · 리본)만 왼쪽 끝으로(x 72 → 32) 옮기고 목 둘레를 1.25배로 크게 — 오른쪽 깃 · 배지 · 주머니 · 교표 자리는 그대로,
      왼쪽 깃은 그림 밖. 리본은 넥타이보다 조금 작게(0.9) 해서 왼쪽 고리가 조금만 잘린다.
      화면 테스트 `achievements`: V넥 아래 끝이 그림 위쪽 절반 · 매듭보다 아래, 매듭은 왼쪽 15% 안.
- [x] **Phase 65 — 교복 조끼는 둥근 V넥 · 넥타이 · 리본을 큼직하게 · 입은 순서대로 겹치게**
      조끼 목둘레: 뾰족한 V 대신 아래가 둥근(라운드에 가까운) V. 셔츠 칼라 끝 · 바깥 선보다 늘 아래라 칼라를 가리지 않는다.
      넥타이: 목 둘레 안에서 1.2배 더 — 머리(매듭)와 날이 큼직하게, 날은 아래로 더 넓어진다.
      리본: 전체를 크게(목 둘레 안에서 1.12배, 전보다 약 1.25배) · 머리(가운데 매듭)를 고리 안쪽 끝을 덮을 만큼 크게.
      실제로 입은 순서대로: 셔츠 → 넥타이 · 리본 꼬리 → 셔츠 칼라 → 조끼 → 리본 머리 · 고리 → 재킷. 리본 꼬리는 조끼 위에 걸치던 것 → 조끼 속으로,
      리본 고리 · 넥타이 매듭은 재킷 앞섶에 닿지 않게, 칼라 바깥은 목을 감아 재킷 깃 밑으로(앞섶 위쪽을 목 쪽으로 조금).
      화면 테스트 `achievements`: 칼라가 조끼 목둘레에 닿지 않는다 · 리본 고리 · 머리 · 넥타이 매듭이 재킷에 닿지 않는다 · 리본 고리가 조끼에 걸치지 않는다 ·
      넥타이 날 · 리본 꼬리 끝은 조끼 자리에 있고 조끼보다 아래 겹 · 리본 고리 · 머리는 조끼보다 위 겹.
- [x] **Phase 66 — 넥타이 · 리본 1.5배 · 넥타이 머리는 둥근 다이아몬드꼴 · 조끼 목둘레를 더 위로**
      넥타이: 머리(매듭) · 날을 1.5배 더. 머리는 윗변이 좁고 어깨가 가장 넓다가 아래로 둥글게 모이는 다이아몬드꼴(모서리는 모두 둥글게, 너비 74 · 높이 78).
      셔츠 칼라는 매듭 윗변 · 어깨가 다 보이게 넓게 펼치고, 목 둘레 전체를 그림 위 가장자리에서 조금 내렸다.
      조끼 목둘레: 아래 끝 126 → 106(그림 좌표)으로 올림. 여전히 아래가 둥글고 칼라 끝보다 아래.
      리본: 1.5배 더(가로 2.1 · 세로 1.85배, 고리가 조끼 목둘레에 닿지 않게 살짝 납작히). 앞섶 사이보다 넓어서 오른쪽 고리 끝은 재킷 깃 밑으로 들어가고
      (입었을 때처럼 — 재킷 위로 올라오지 않는다) 왼쪽은 그림 밖으로 조금 나간다.
      목 둘레(칼라 · 넥타이 · 조끼 목둘레)는 배율 겹침 없이 그림 좌표로 다시 그렸다. 조끼 몸판 오른쪽이 깃 밑에서 접히던 것도 바로잡음.
      화면 테스트: 리본 고리는 재킷보다 먼저(아래 겹), 겹침 검사는 그림 안에서 보이는 점만.
- [x] **Phase 67 — 리본 크기 되돌림 · 넥타이 날을 넓게 · 조끼 V 를 뾰족하게 · 재킷 깃을 곧게**
      리본: 1.5배로 키우자 고리가 그림 밖 · 재킷 밑으로 가려져 가운데 매듭과 꼬리만 남아 넥타이처럼 보였다 — Phase 65 크기(1.4배)로 되돌림.
      넥타이 날: 머리가 커진 만큼 넓게 (머리 아래 ±16 → 아래로 ±34, 머리 너비의 절반쯤).
      조끼 목둘레: 너무 둥글던 것 — 팔은 곧게, 끝만 살짝 둥근 V. 칼라 끝보다 아래는 그대로.
      재킷 깃: 앞섶의 S 곡선을 거의 곧게(곧은 선에서 0.5 안), 깃과 칼라 사이 솔기도 곧게.
      화면 테스트 `achievements`: 리본 고리가 고리마다 절반 넘게 · 둘 합쳐 3/4 넘게 보인다(1.5배일 때는 0.34 · 0.49 로 걸린다),
      넥타이 날 너비 ≥ 머리의 0.45, 조끼 목둘레 끝에서 옆으로 10 떨어진 곳이 2 넘게 높다(둥글면 거의 0), 재킷 앞섶이 곧은 선에서 2.5 안.
- [x] **Phase 68 — 넥타이 · 리본 · 셔츠 카라를 처음부터 다시 (하나의 비례로)**
      크기만 키우던 접근을 그만두고 셋을 한 체계로 다시 그렸다 — 카라 벌어짐(뾰족한 두 끝 사이)이 기준: 넥타이 매듭 ≈ 1/2, 리본 ≈ 2/3.
      카라: 큰 흰 덩어리였던 것 → 목에서 앞으로 꺾여 내려오는 끝이 뾰족한 잎(60도쯤). 두 겹 끝단의 두께(밝은 띠 · 윗땀), 꺾임 능선, 목 쪽 그늘,
      잎이 셔츠 · 매듭 위에 드리우는 두 겹 그림자(붙은 진한 것 + 번지는 것), 셔츠 · 카라의 옅은 천 결. 잎이 매듭 어깨를 덮고 리본 날개는 카라 위에 얹힌다.
      넥타이: 풍선 같던 둥근 머리 → 위가 넓고 아래로 좁아지는 깔때기 앞판(줄무늬가 옆 판과 반대) + 옆 판 · 접힌 선 · 치마 · 머리가 날 위에 드리운 그림자 · 보조개.
      날은 아래로 넓어지며 조끼 속으로 — 전엔 매듭에 가려 끝만 보이던 날이 이제 조끼 V 까지 길게 보인다. 줄무늬 간격은 물건 크기에 맞게(날 · 리본 따로).
      리본: 프레임에서 잘리던 고리가 통째로 들어오고(폭 64), 네모 상자 같던 머리는 조인 띠로. 날개는 위 면은 빛 · 아래 면은 접혀 그늘, 안쪽은 모아 잡은 주름.
      꼬리는 바깥으로 벌어지는 제비꼬리 두 개(끝이 조끼 목둘레 단 바로 위)로 — 전엔 서로 겹쳐 넥타이 날 한 장처럼 보였다. 꼬리 사이로 셔츠 여밈 단추.
      목 둘레 모양은 모두 목 가운데를 0 으로 둔 좌표(`translate(C 0)`) — 리본을 키우던 RIBBON 배율은 없앴다.
      화면 테스트 `achievements`: 카라 잎 둘 · 끝 각도 40~85도 · 매듭 ÷ 카라 벌어짐 0.4~0.62 · 카라 잎이 매듭 어깨를 덮음 · 리본 ÷ 벌어짐 0.55~0.8 ·
      리본이 프레임 안 · 카라 위 · 꼬리 두 개가 벌어짐(간격 ≥ 그림 너비의 4%) · 꼬리 끝이 조끼 목둘레 단 위, 리본 고리가 다 보임(≥ 95%).
- [x] **Phase 69 — 리본 꼬리 · 대표 업적 끌어 놓기 · 편지 선택 · 삭제**
      리본: 꼬리를 굵게(폭 16.5 → 22, 아래로 조금 넓어짐) · 길게 — 조끼보다 나중에 그려 조끼 목둘레 단을 넘어 조끼 위로 늘어진다(조끼 밖).
      셔츠 여밈 단추는 꼬리와 떼어 셔츠 쪽에(조끼 속으로).
      대표 업적 끌어 놓기 (클래시로얄 덱처럼, `lib/ui/badgeDrag.ts`): 손가락은 0.35초 꾹 눌러 집고(그 전에 10px 움직이면 스크롤), 마우스는 누른 채 끌면 바로.
      집은 메달은 손끝 위로 떠서 따라오고, 빈자리는 흐리게, 교복 깃의 칸마다 점선 고리 · 올라간 칸은 커지며 밝은 고리. 칸에 놓으면 그 칸으로 빨려 들어가고
      밖에 놓으면 제자리로. 집은 뒤로는 스크롤을 막고(touchmove preventDefault) 화면 위 · 아래 가장자리에서 저절로 스크롤, 끈 뒤의 누르기는 삼킨다.
      ① 내 프로필 교복: 배지를 꾹 눌러 다른 칸에 놓으면 자리를 바꾼다(빈 칸이면 맨 뒤로). ② 업적 화면: 대표 업적 칸 줄 대신 교복 — 딴 메달을
      꾹 눌러 교복 칸에 놓으면 그 칸의 대표 업적(있던 배지는 밀려난다), 집는 순간 교복이 화면 밖이면 보이게 스크롤. 잠긴 메달은 집히지 않는다.
      바로 바뀌어 보이고(`placedFeatured` · `featuredOf`) `set_featured_badges` 에 보이는 칸 순서 그대로, 서버가 거절하면 되돌린다. 누르기(자세히 · 걸기 · 내리기)는 그대로.
      끌 수 있는 배지에서 시작한 끌기는 당겨서 새로고침이 아니다. 상대 프로필 교복은 끌 수 없다.
      편지: 보관함 · 폴더의 "고르기" → "선택"(제목 "편지 선택", "n통 선택했어요"). 선택 막대에 "삭제"(빨간 글씨, 옆 단추와 12 띄움 · G1.4) →
      확인 시트("내 편지함에서만 지워지고 상대에게는 그대로 남아요 · 되돌릴 수 없어요") → 목록에서 빠진다. 폴더 화면은 삭제 · 폴더에서 빼기 · 다른 폴더로(좁은 폰에서도 한 줄).
      서버: 나에게서만 숨기는 `private.dm_hidden_msgs`, `dm_letter_delete(p_msgs)` — 받은 편지는 열어 본 것만(폴더와 같은 규칙), 200통까지, 폴더에서도 뺀다.
      편지 줄기는 그대로라 버리기 · 차단과 달리 답장이 오가고 새 편지는 보인다. `dm_box_of`(편지함 · 폴더 수 · 폴더 넣기) · `dm_open` 이 지운 편지를 없는 것으로 본다(제자리에서 고침).
      스키마 테스트 [92], 화면 테스트 `letters`(선택 · 삭제 · 320 폭 · 프로필 배지 옮기기 · 거절 시 되돌림) · `achievements`(터치 꾹 눌러 끌기 · 짧게 밀면 스크롤 · 교복 보이기 ·
      잠긴 메달 · 칸 밖 · 마우스 · 리본 꼬리가 조끼 위 · 꼬리 폭). 실DB 반영 (phase69_letter_delete — 2026-09-30, 세 함수 본문이 레포와 같음을 확인).
- [x] **Phase 70 — 교복을 멈추고 배지를 크게 · 전체 업적 보기 · CNSA 뱃지(극작소)**
      교복: 숨 쉬기 · 넥타이 날 · 리본 꼬리 · 고리 흔들림을 모두 뺐다 (움직이지 않는다). 깃의 배지를 그림 폭에 맞춰 크게(폭의 15%, 38~58 — 폰에서 약 50, 전엔 40).
      오른쪽 아래 구석에 작은 "전체 업적 보기 ›" (`Uniform` 의 `allHref`, 내 프로필 → 업적 화면, 누름 높이 44).
      CNSA 뱃지: 업적 분류 `cnsa`(탭 "CNSA") — 학교 동아리 · 행사의 실제 에나멜 핀을 그대로 그린 그림을 동그란 메달 대신 쓴다 (`lib/ui/pins`).
      첫 번째는 연극 동아리 극작소(`club_geukjakso`) — 검은 슬레이트(흰 화살 셋 · 점 셋 · 줄 셋)가 솟은 빨간 상자 + 막이 걷힌 무대 상자,
      칸마다 검은 금속 테두리 · 두께 · 에나멜 위 유리 빛 · 처음 보일 때 빛이 스친다. 잠겼으면 흑백 · 흐리게, 등급 자리엔 "CNSA".
      운영진이 주고 거둔다 (베타 테스터와 같은 `granted` 길 — 운영자 화면 사용자 상세). 자세히는 "동아리 부원에게 주는 CNSA 뱃지".
      새 뱃지는 `achievement_defs` 한 줄(category `cnsa`, granted) + `lib/ui/pins` 에 그림 컴포넌트 하나.
      스키마 테스트 [93], 화면 테스트 `achievements`(움직임 없음 · 전체 업적 보기 · 배지 크기 · CNSA 탭 · 핀 그림).
      실DB 반영 (phase70_cnsa_badge — 2026-09-30, 카탈로그 26종 · 주기 · 내 업적 · 대표 걸기를 되돌리는 트랜잭션으로 확인).
- [x] **Phase 71 — 우체통 · 운영자 뱃지 화면 · CNSA 뱃지 셋 · 넓은 책상**
      익명편지: "새로 온 편지가 없어요" 대신 맨 위에 큰 빨간 우체통(`lib/letters/Postbox`) — 안 읽은 편지 수 · 투입구에 봉투 끝.
      받을 때: 처음 보는 안 읽은 편지마다(앱을 켠 동안 한 번, `ANNOUNCED`) 봉투가 위에서 떨어져 투입구로 → 통이 출렁 → 아래 문이 열려 편지가 우체통 밑으로 나온다(`MailStack` 의 `emerge`).
      우체통을 누르면 가장 최근 안 읽은 편지. 보낼 때(`EnvelopeCompose`): 봉투를 뒤집는 동안 우체통이 아래에서 올라오고 → 봉투가 작아지며 투입구에 맞춰(`aim` 이 투입구 자리를 잰다)
      → 투입구로 쏙(봉투 자리 아래 가장자리 = 투입구 선, 그 밑은 잘림) → 출렁 · 진동 (전엔 하늘로 날아갔다). 동작 줄이기면 장면 없이.
      편지 보관함 이름표와 편지 쓰기 단추를 한 줄에(같은 높이, 떠 있던 단추 · 겹침 재기 삭제). 좁은 화면(360 미만)은 연필만 있는 네모 단추.
      책상을 화면 양옆보다 14 씩 넓혀(`--bleed`, 책상 위 물건은 제자리) 눌러서 살짝 줄어도 모서리에 바깥 바탕이 비치지 않게.
      운영자 화면 "뱃지"(`/admin/badges`, moderate): 분류(특별 · CNSA)별 뱃지 · 가진 사람 수 → 고른 뱃지를 찾은 학생 여럿에게 · 학번 목록으로(관리자만, 열람 기록) ·
      학교 인증한 학생 모두에게 주고, 가진 학생을 골라 한 번에 거둔다. 서버 `admin_badges` · `admin_badge_holders` · `admin_set_badge_many`(500명까지) ·
      `admin_grant_badge_by_no`(못 찾은 학번을 돌려준다) · `admin_grant_badge_all` — 바뀐 학생마다 grant_badge / revoke_badge 기록(bulk).
      CNSA 뱃지 셋: CNSA 뱃지(`cnsa_student`, 파란 두 상자 · 옅은 금 테) · MSMSP 우수 금뱃지(`msmsp_gold`, 금 육각 정육면체 · MSMP 새김) ·
      동아리 Beatus 뱃지(`club_beatus`, 공식 로고 — 은 테 · 검은 에나멜 · 세리프 B + 마우스 화살표). 동아리가 아닌 뱃지 자세히는 "운영진이 주는 CNSA 뱃지".
      스키마 테스트 [94], 화면 테스트 `letters`(우체통 · 우체통에서 나옴 · 한 줄 · 넓은 책상 · 투입구에 맞춰 넣기 · 좁은 화면) · `audit`(뱃지 화면) · `achievements`(CNSA 넷).
      실DB 반영 (phase71_badges_bulk — 2026-09-30, 카탈로그 29종 · 여럿 주기 · 다시 주면 0 · 가진 학생 · 거두기를 되돌리는 트랜잭션으로 확인).
- [x] **Phase 72 — 우체통을 납작한 2D 네모로 (스케치대로)**
      편지함 맨 위 화면 폭 가득한 빨간 네모 우체통(`Postbox`, HTML · CSS — 높이 `--h`): 위 띠 · 흰 봉투 문양 · 가로로 긴 투입구 · 아래 어두운 두께. 문 · 지붕 · 받침은 뺐다.
      편지가 오면 투입구로 떨어진 뒤 출렁 · 위 가장자리에 "+✉"(여러 통이면 "+2") → 편지가 우체통 밑으로 나온다.
      편지 쓰기: 우체통이 처음부터 화면 위쪽에 있고 편지지가 그 앞을 덮는다. 보내면 봉투가 작아져(최대 0.55배) 위쪽 투입구로 들어간다.
      보내고 편지함으로 돌아오면(`POSTED`) 목록을 새로 읽은 뒤 우체통 위 "+✉" · 보낸 편지가 책상 더미에 내려앉는다(`reloadMailbox` — 요청은 그대로).
      화면 테스트 `letters`(폭 가득한 2D 네모 · 위쪽 투입구에 넣기 · 돌아오면 "+✉" · 내려앉기).
- [x] **Phase 73 — 우체통 · 책상 · 편지를 한 장면으로**
      편지함 = 벽(`--wall`, 은은한 줄무늬 벽지 · 위에서 비치는 빛, 다크 모드는 어두운 벽) → 바로 아래 나무 책상 한 장(`--wood`, `.surface`).
      우체통은 벽에 걸린 칠한 쇠 우편함(폭 82% · 최대 300): 붉은 칠 · 위 차양 · 도드라진 테 · 크림색 봉투 문양 · 놋쇠 투입구 판(덮개) · 놋쇠 이름표 "우편" · 놋쇠 못, 벽에 그림자 —
      책상 위 놋쇠 도장 · 크림색 봉투와 같은 재료. 출렁은 걸이를 축으로 흔들림, "+✉" 는 종이 꼬리표.
      새 편지는 우체통에서 나와 책상 위쪽에 놓이고(`.fresh`), 아래쪽엔 물건 · 서류 더미 · 앞 모서리의 [이름표 | 편지 쓰기]. 나뭇결은 책상 한 장에만 있어 눌러도 판자는 그대로.
      편지 쓰기도 같은 장면 — 벽의 우체통 아래 책상 위에 편지지가 펼쳐진다(보내기 줄 · 안내 글은 나무색 위 밝은 글씨).
      화면 테스트 `letters`(벽에 걸린 2D 네모 → 바로 아래 책상 한 장에 새 편지 · 더미).
- [x] **Phase 74 — 우체통 다시 그림 (군더더기 없이)**
      시안 여러 개를 벽 · 책상 위에 놓고 비교해 고른 것: 둥근 빨간 네모 하나 · 위 크림색 봉투 배지 · 아래 놋쇠 투입구 · 짙은 테두리 · 위쪽 은은한 빛.
      차양 · 테 · 못 · 이름표는 뺐다. 폭은 조금 줄여(74% · 최대 270) 책상에 자리를 더 준다.
- [x] **Phase 75 — 우체통 · 벽을 앱의 색 · 정체성에 맞춤**
      Phase 73 · 74 의 소방차 빨강 · 놋쇠 · 옛날 줄무늬 벽지는 앱(브랜드 그라디언트 · 따뜻한 흰 바탕 · 브랜드색 빛)과 다른 세계였다.
      우체통 = 앱 아이콘과 같은 대각선 브랜드 그라디언트(주황 → 코랄 → 핑크) · 큰 둥근 모서리 · 흰 봉투 문양 · 반투명 흰 테 투입구 · 브랜드색 빛 그림자.
      벽(`--wall`) = 앱 바탕(`--bg`) + 탭 첫 화면의 브랜드 빛 번짐(`--ambient`) — 테마를 따라 바뀐다. 숫자는 앱의 숫자 배지(짙은 브랜드 면 · 흰 숫자), "+✉" 는 흰 알약.
- [x] **Phase 76 — 책상을 우체통과 같은 결로**
      어두운 실사 나무 · 놋쇠 · 만년필은 브랜드 우체통과 따로 놀았다. 시안 셋(밝은 단풍나무 · 복숭아빛 매트 · 꿀빛 나무)을 비교해 밝은 단풍나무로.
      책상(`--wood`) = 옅은 결의 밝은 단풍나무 · 위에서 비치는 빛, 앞 모서리 · 벽 쪽 그늘 · 물건 그림자도 같은 따뜻한 색 토큰(`--wood-edge` · `--wood-shade` · `--wood-drop` · `--wood-ink` · `--wood-base`).
      다크 모드는 한 톤 낮춘 같은 나무. 물건은 납작하고 부드러운 그림으로 다시: 살구빛 포스트잇 · 브랜드 그라디언트 머그 · 펜 · 살구 연필 · 분홍 밀랍과 하트 도장 · 분홍 클립.
      봉투 · 서류 더미 · 이름표 줄은 그대로(분위기 유지). 편지 쓰기의 보내기 줄 · 안내 글도 판자색.
- [x] **Phase 77 — 편지는 책상 위에서 접고 곧장 우체통으로 · 받은 편지는 그 반대 · 키보드에 가리던 편지지 머리**
      보낼 때: 봉투 자리를 화면 가운데에서 책상 한가운데로(우체통 · 벽을 가리지 않게). 편지지가 쓰던 자리에서 책상 가운데로 미끄러져 내려오며 접혀
      봉투에 들어가고(서식 막대 · 보내기 줄은 먼저 사라진다) → 덮개 · 봉인 → 곧장 우체통으로(가는 동안 뒤집혀 주소 면) → 투입구로 쏙. 4.7초(전엔 5.5초).
      받을 때(처음 여는 편지, `/letters/m/[id]`): 같은 장면(벽의 우체통 · 책상)에서 봉투가 투입구에서 빠져나와 → 커지며 책상 가운데로 → 뒤집기 · 봉인 금 · 덮개 · 편지지.
      키보드: 안드로이드 크롬이 키보드만큼 화면을 줄이며 커서 쪽으로 스크롤할 때 편지지 머리(To. · 날짜)가 붙어 있는 서식 막대 밑으로 숨었다 —
      키보드가 뜨면(`KB.open`) 몇 번 재어 커서가 보이는 만큼 되돌리고, 문서 `scroll-padding` · 편집기 `scrollMargin` 으로 머리글 · 서식 막대 · 보내기 줄을 비켜 가게.
      화면 테스트 `letters`(투입구에서 나옴 · 책상 가운데에 앉음 · 책상 가운데에서 봉인 · 키보드에 편지지 머리).
- [x] **Phase 78 — 새 편지 한도 하루 3통 → 50통**
      `app_settings.letter_burst` 50 · `letter_refill_per_sec` 50/86400(하루 50통 분량), 새로 가입한 학생도 처음부터 50(`user_presence.letter_tokens` 기본값).
      답 없이 3통까지(wait_reply) · 받는 사람이 끝내면 다시 못 보냄은 그대로(괴롭힘 막기). 스키마 테스트 [95] · [50](남은 한도 3통으로 두고 봄).
      실DB 반영 (phase78_letter_limit_50 — 2026-10-01). 그때 학생 19명의 남은 한도를 한 번 50으로 채웠고,
      운영진 요청으로 익명편지 데이터를 모두 지웠다 (편지 줄기 17 · 편지 51 · 폴더 2 · 폴더 안 편지 10 · 알림 기록 51 — 계정 · 업적은 그대로).
- [x] **Phase 79 — 새 편지는 우체통 안에 · 빨간 점 · 누르면 덜컹 덜컹 → 투입구에서 편지**
      안 읽은 편지는 더 이상 책상 위 봉투로 쌓이지 않고 우체통 안에 있다 — 오른쪽 위 빨간 점(숫자 배지 대신, 은은히 퍼지는 고리). 투입구에 봉투 끝은 보이지 않는다.
      새 편지는 투입구로 떨어져 들어간 다음에 점이 톡. 우체통을 누르면 편지함이 그 자리 · 크기를 적어 두고(`KNOCK`) 편지 화면이 화면 넘김 없이
      같은 우체통을 그려 이어 받는다 → 두 번 덜컹(햅틱 두 번) → 투입구에서 편지가 나와 책상 가운데로 → 열어 읽는다. 안 읽은 편지는 보관함에서도 연다.
      알림 등 다른 길로 와도 처음 여는 편지는 덜컹 덜컹부터. 투입구 자리는 흔들리지 않는 틀에서 그림 비율로 잰다(`slotRect`). e2e letters 152.
- [x] **Phase 80 — 알림에서도 우체통에서 꺼낸다 · 머리글 로고 y 꼬리 · 쓰는 동안 우체통 숨김**
      편지 알림(앱 안 알림 띠 · 시스템 알림 · 앱을 새로 여는 알림)은 `/letters/m/번호` 대신 `/letters?take=번호`로 (`viaMailbox` — 앱과 static/sw.js 가 같은 규칙).
      편지함이 목록을 읽고 우체통을 보여 준 뒤(새 편지가 투입구로 떨어지는 중이면 다 들어갈 때까지) 스스로 눌러 꺼낸다 → 두 번 덜컹 → 투입구에서 편지.
      `?take` 는 기록을 바꿔 끼우는 이동으로 지운다(얕은 replaceState 는 page.url 을 안 바꿔 뒤로 오면 다시 꺼냈고, 상태를 비우면 탭 guard 가 뒤로가기로 알았다).
      편지함을 보고 있으면 편지 알림 띠는 띄우지 않는다(주소 경로로 거른다). 로고: 파셜산스 y 꼬리가 줄 높이 1 에서 칸 아래로 0.175em 나가
      그라디언트 칸(.wordmark)을 아래로 0.22em 넓히고 자리는 그대로(margin -0.16em · 로그인 · 설치 화면 여백 보정). 편지 쓰기: 쓰는 동안 우체통을 숨긴다
      (화면에 붙어 있어 키보드 · 스크롤 때 색 고르기 줄 사이로 비쳤다) — 접기 시작하면 다시. e2e letters 162 · login · back · notices.
- [x] **Phase 81 — 다크 모드 우체통은 한 단계 어둡게**
      우체통 색을 app.css 토큰(`--post-a/b/c` 그라디언트 · `--post-sheen` 위쪽 빛 · `--post-glow` 그림자)으로 — 라이트는 앱 아이콘 그라디언트 그대로,
      다크는 #d65a36 → #cc4252 → #bb2a59 · 빛 0.14 · 브랜드색 빛 대신 검은 그림자. 빨간 점의 테는 바탕색(--bg — 전엔 그라디언트 값인 --wall 이라 테가 안 그려졌다).
      편지함 · 편지 쓰기 · 받은 편지 장면이 같은 우체통이라 함께 바뀐다. e2e letters 165.
- [x] **Phase 82 — 책상은 누른 것만 반응**
      전엔 책상 단추가 통째로 줄어(scale 0.985) 물건 · 서류 더미 · 이름표가 한꺼번에 움직였다. 이제 서류 더미(또는 빈 판자)를 누르면 더미만(0.95),
      이름표를 누르면 이름표만(0.97) 눌리고 보관함으로. 책상 위 물건(머그 · 펜 · 연필 · 포스트잇 · 봉인 · 클립)은 누르면 그것만 톡 튀어 오르고(햅틱)
      보관함으로 가지 않는다 — 컵 자국은 물건이 아니라 그대로. e2e letters 168.
- [x] **Phase 83 — 로고 글꼴 롯데리아 촵땡겨체 · 시작 화면 흰 이름 · 넥타이 · 리본을 사진처럼 단순하게**
      로고 글자(.wordmark · 스토리 그림의 Landy)만 롯데리아 촵땡겨체(--logo, src/lib/fonts/LOTTERIACHAB.woff2 — 눈누 배포 원본 그대로, font-display: block).
      탭 제목 · 큰 숫자는 그대로 파셜산스. 시작 화면(아이콘 + 이름)은 테마와 상관없이 어두운 바탕(#0c0a0b — 시스템 시작 화면 · manifest 와 같다) 위 흰 이름.
      교복: 넥타이는 짙은 남색 민무늬(가는 사선 결) · 작은 역사다리꼴 매듭 · 아래로 살짝 넓어지는 날, 리본은 남색 + 하늘색 사선 줄 —
      두 날개 · 가운데 매듭 · 바깥으로 벌어지는 꼬리. 겹겹이 쌓던 그늘 · 주름(매듭 판 · 보조개 · 비단 광 · 날개 주름 등)을 한두 겹으로 줄였다.
      e2e achievements 71(매듭 크기 기준을 사진대로 카라 벌어짐의 1/3 남짓) · letters 170 · login.
- [x] **Phase 84 — CNSA 뱃지 안내 · 뱃지 제출 · 어디에 보일지 · 대표 칸 5개 · 편지 추천 · Landy 뱃지를 아이콘 모양 핀으로**
      CNSA 뱃지 안내(CnsaBadgeTour, 다섯 장 — 무엇인가 · 얻는 법 · 없는 뱃지와 동아리 · 어디에 보일지 · 금 뱃지 5개면 5칸): CNSA 뱃지를 처음 받으면 한 번,
      업적 화면 CNSA 탭 · 설정 › 뱃지에서 다시. 기본 CNSA 뱃지는 Landy 금 뱃지를 처음 따면 저절로(award_stat · 지금 금 뱃지 가진 학생은 한 번 채움).
      뱃지 제출(/me/achievements/submit — 내 뱃지 인증 · 동아리 기장이 부원 학번까지 · 앱에 없는 뱃지 요청): 사진은 이 기기에서 줄여(1600 · JPEG)
      Storage 비공개 버킷 badge-proofs/{학생 id}/ 에, 학번 · 이름이 보여서 관리자만 /admin/badge-requests 에서 보고(열람 기록) 승인 · 반려하면 사진을 지우고
      결과는 개인 공지로. 기다리는 요청 3개 · 하루 5개. 인스타그램 제출은 app_settings.badge_instagram(비면 "준비 중").
      랜덤채팅에서 뱃지마다 숨기기(set_badge_chat — 정하지 않았으면 CNSA 는 숨김) · 편지 찾기의 내 뱃지 순서(내 순서 · 무작위).
      대표 칸: Landy 금 뱃지 5개면 3 → 5 (badge_slots · 교복 가슴 주머니 위에 둘). 편지 쓰기 찾기 아래 추천 5명(dm_recommend · 설정 › 편지 › 추천에 나오기, 기본 켜짐).
      Landy 뱃지: 동그란 메달 대신 아이콘 선을 굵게 따라 오린 입체 핀 — 금속 판(동 · 은 · 금 · 특별 무지갯빛) · 두께 · 뱃지마다 다른 에나멜(ENAMEL) · 금속 선 · 광택
      (/dev/pins 미리보기). 실DB 반영 (phase84_cnsa_badges_submissions_recommend). 스키마 테스트 [96] (1161) · e2e letters 197 · achievements 76 · audit 128.
      창을 닫으며 이동(navigateFromOverlay)을 고침 — 창의 얕은 기록 칸을 새 화면으로 바꿔 끼우면 SvelteKit 이 같은 화면의 기록으로 여겨
      새 화면에서 뒤로 와도 주소만 바뀌고 화면이 그대로였다(축하 "업적 보러 가기" · 안내 "뱃지 제출하기"). 이제 창의 칸을 먼저 걷어 내고 간다.
- [x] **2026-10-01 코드 리뷰 수정 (실DB 반영 2026-10-02)** — 차단 전후 검색/전송 응답으로 익명 상대를 실명 계정에 연결하는 통로를 닫음.
      차단·수신 거부·수신자 정지는 실제 편지 전달만 막고 발신자는 정상 보낸 편지를 보며, 수신자 편지함·안 읽은 수·푸시·수신 업적은 늘지 않는다.
      수신 거부는 종료 순서와 독립적으로 보존. 편지 차단·신고는 기존 랜덤채팅도 종료. 즉시/예약 점검·서비스 중단은 새 편지와 답장을 DB에서도 막음.
      DB 방송 `room:<id>`는 학생 읽기 전용, 입력 중·접속은 별도 `peer:<id>`. 마지막 접속 TTL이 마감 전에 끝났으면 스위퍼/복귀/만료 확인/재매칭에서도 남은 시간을 보존.
      백업은 모든 커서 요청을 감사 기록에 남김. 뱃지 요청 화면의 카탈로그는 moderate 또는 identity 권한으로 조회 가능. AI 규칙 검사는 합친 사용자 턴 전체를 받음.
      실DB 에는 한 번 쓰는 마이그레이션으로 반영했고(파일은 반영 뒤 지움 — 정의는 `schema.sql` 하나), 새 DB 는 최신 `schema.sql` 을 쓴다.
      실DB(LOVE)에는 2026-10-02 반영 — 적용 전 26개 함수가 저장소와 같은지 대조했고, 적용 뒤 본문 해시가 파일과 같은지 확인했다 (review_fixes_20261001_part1~3).
      스키마 테스트 [97]에 차단 전후 검색·추천·발신 결과·직접 열기·폴더·업적·기존 채팅·점검·타이머·감사·역할 조합 회귀를 추가.
      확인하며 더 고친 것: 읽음 저장이 계속 실패하면 2초마다 끝없이 다시 보내던 것 → 간격을 벌리다 다섯 번에서 멈춤 (그 뒤로는 새 메시지를 보거나 화면에 돌아올 때 한 번씩).
      업적 화면 "대표 업적 n/n" 제목이 폭 280 에서 두 줄로 꺾이던 것 (Phase 84, wrap 스위트가 잡음). letters 스위트의 키보드 검사는 밀어 올린 직후를 같은 호출에서 재게.
      스키마 1196 · 채팅 90 · 계정 17 · AI 35 · 화면 24 스위트 통과.
- [x] **2026-10-02 군살 빼기 (ponytail 감사)** — 반영이 끝난 마이그레이션 사본(778줄) · 어디서도 부르지 않는 스크립트 2개(realtime-warmup · smtp-check) 삭제.
      "DB 가 옛 버전일 때" 대비 코드 제거 — 프로필 · 설정은 열을 한 번에 읽고(schemaCompatibility.ts 삭제), 메시지 열 목록은 고정(withMsgCols 삭제),
      박동의 ach_new 옛 DB 분기 삭제. **이제 DB 를 먼저 올리고 앱을 푸시하는 순서가 안전장치 없이 필수다.**
      편지 화면 4곳의 "아직 떠 있나" 검사에서 계정 검사를 뺌 — 계정이 바뀌면 루트 레이아웃이 화면을 통째로 다시 만든다. afterSent 의 계정 인자도 같이.
      한 곳에서만 쓰던 래퍼 setAllowRematch · 쓰이지 않던 isLandy 삭제, 파일 밖에서 안 쓰는 이름 53개의 export 를 뗌.
- [x] **Phase 85 — 옛 공개 편지 게시판(Phase 10~15) 걷어내기** — 학생 화면은 Phase 23 부터 이름 편지였고 학생 실행 권한도 Phase 34 에 거뒀다.
      실DB 의 표 7개(letters · letter_comments · letter_participants · letter_reply_assignments · letter_reply_cooldown · letter_likes · letter_push_log)는 전부 0건이었다.
      지운 것: 표 7개 · 함수 20개(피드 · 쓰기 · 댓글 · 답장 배정 · 하트 · 알림 · 신고 · 운영자 열람 · 자동 신고) · 규칙/검열 트리거 4개 · 색인 · 알림 기록 정리 작업 ·
      안 쓰는 설정 열 5개 · 토큰 버킷 열 2개, 운영자 화면 `/admin/posts` 와 사용자 상세의 "편지 · 댓글 보기", 푸시 API 의 `letter_comment_id`.
      남긴 것(이름 편지가 같이 쓴다): 신고 표 `private.letter_reports` · `letter_report_evidence`, 한도 `letter_bucket_take`(2종), 익명 이름, `blocked_between`, 서식 검사 `letter_fmt_ok`, 운영자 편지 신고 RPC.
      검열 대기열(`mod_enqueue` · `mod_claim` · `mod_verdict`)은 채팅 · 이름 편지만. 운영자 통계 "24시간 편지"와 사용자 상세 "쓴 편지"는 이름 편지 수로 (예전엔 늘 0).
      `app_settings.letter_max_len` · `comment_max_len` 은 캐시된 옛 앱이 아직 고르므로 남김 (`ponytail:` 표시 — 새 앱이 다 퍼진 뒤 지운다).
      `schema.sql` 7319 → 6520줄, 스키마 테스트 [45]~[52] · [59] 삭제 · [58] 은 `letter_fmt_ok` 를 바로 검사 (1196 → 1073). 옛 스키마 위에 새 스키마를 얹는 경로도 PGlite 로 확인 (1073 통과). 실DB 반영 2026-10-02 (phase85_drop_public_letters_part1~2 — 표가 비어 있지 않으면 멈추는 안전장치와 함께, 반영 뒤 함수 7개 본문 해시 대조).
- [x] **Phase 86 — 새 로고 · 기본 테마 보라** (DB 변경 없음) — 앱 아이콘을 새 로고(흰 바탕 위 연보라 꽃잎 L)로: `branding/icon-source.png` 교체,
      `static/` 아이콘 5종 · 알림 배지 재생성. 마스커블은 로고를 68% 로 줄여 둘레를 흰 바탕으로 (`generate-icons.mjs` 의 scale),
      배지는 흰색 대신 "색이 있는 곳"을 남긴다 (`generate-badge.mjs`). 봉투 우표 · 소인의 도형은 학교 로고라 그대로.
      기본 테마: 다홍(주황 → 핑크)을 지우고 로고의 연보라 → 보라로 — `app.css` 의 `--g-*`(#dc9cfb · #b96cf5 · #9a52eb), 채운 면
      `--accent-fill` · 말풍선(#b56cf3 → #a35bee → #8c46e2, 흰 글씨 대비는 예전 다홍과 같은 수준), 글자색 `--accent`(라이트 #8b3fd9 5.2:1 · 다크 #c79bff),
      작은 흰 글씨 면 `--accent-fill-deep`(4.7:1 넘게), 빛 번짐 · 버튼 빛 · 우체통(`--post-*`, 다크는 한 단계 어둡게) · 책상 소품 · 연결 화면 하트 · 스토리 그림.
      테마 목록의 첫 칸 id 는 `sunset` → `landy` (기본은 저장하지 않으므로 고른 적 없는 기기는 그대로 새 기본). 다른 색(보라 · 파랑 · 초록 · 인스타)은 그대로.
- [x] **Phase 87 — 보라 테마 빼기 · 우체통은 늘 연한 붉은색** (DB 변경 없음) — 새 기본(연보라 → 보라)과 겹치던 예전 "보라"(남색 → 자주) 테마를 뺌 — 색 후보 4개(기본 · 파랑 · 초록 · 인스타),
      그 색을 골라 둔 기기는 기본으로. 우체통은 테마 색과 상관없이 연한 붉은색(`--post-a/b/c` #ff9e94 → #f8807f → #ec6470, 다크는 한 단계 어둡게) · 붉은 빛 그림자.
      서비스워커 캐시 v11 — 아이콘은 주소가 그대로라 옛 로고가 캐시에서 나오던 것 (SHELL 의 그림을 바꾸면 버전을 올린다).
- [x] **Phase 88 — 뱃지 이름 · 코드 정리** — "MSMSP 우수 금뱃지" → "MSMP 우수 금뱃지"(코드 `msmsp_gold` → `msmp_gold`, 핀 그림 `MsmpGold.svelte`), "동아리 Beatus 뱃지" → "Beatus".
      코드를 바꾸며 가진 학생 · 뱃지 요청 · 대표 업적 · 랜덤채팅 숨김 설정을 새 코드로 옮기고 옛 정의를 지운다 (`schema.sql` Phase 88, 여러 번 실행해도 같다).

## 2026-10-02 보안 수정 배포

로컬 코드와 테스트를 수정한 상태다. 운영 반영은 다음 순서로 진행한다.

1. Phase 88까지 설치된 기존 Supabase DB의 SQL Editor에서 `supabase/migrations/20261004020711_security_hardening_20261002.sql`을 실행한다. 전체 `schema.sql`을 기존 DB에 다시 실행할 필요는 없다. 새 DB는 전체 스키마로 설치한다. 마이그레이션은 트랜잭션이며 재실행할 수 있다.
2. `npm ci`, `npm run check`, `npm test`, `npm run build`로 확인하고 `npx wrangler deploy --dry-run`으로 Worker 번들을 검사한다. `npm audit`도 확인한다.
3. 기존 Cloudflare Secret인 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`를 유지하고 Worker를 배포한다. `PUBLIC_SUPABASE_URL`이 있으면 같은 Supabase 프로젝트를 가리켜야 한다. 새 비밀 값은 필요 없다. `wrangler.jsonc`의 15분 간격 Cron Trigger도 함께 반영한다.
4. Cloudflare 예약 작업 실행 기록에서 성공 여부를 확인한다. 배포 어댑터는 앱 Worker를 비공개 빌드 폴더에 보존하고, 최종 진입점에 `fetch`와 사진 정리 `scheduled`를 함께 넣는다. 정리 대상 경로와 service_role 키를 정적 assets에 넣지 않는다.

사진은 계정당 저장 중 12장(장당 5MiB), 최근 24시간 업로드 15장까지다. 신청 취소·심사 시 삭제를 즉시 시도하고, 실패한 작업은 경로를 보존해 재시도한다. 미제출 사진은 1시간 후 정리 대상이 되며, 기존 미연결 사진도 마이그레이션 후 정리된다. 계정 삭제 시에도 사진 삭제 예약은 남는다. 예약 작업은 한 번에 최대 100장을 처리하므로 장애·대기열이 있으면 삭제가 지연될 수 있다.

검증은 합성 계정과 로컬 DB로 수행한다. 운영 Storage API와 실제 PostgreSQL 동시 연결은 별도 검증 대상이다. 실제 학생의 계정·사진·대화를 시험에 사용하지 않는다.
      실DB 반영 (phase88_rename_badge_code_msmp_gold — 가진 학생 19 · 대표 4 · 숨김 설정 2 그대로 옮겨짐). 활동 기록의 옛 코드는 고치지 않는다. 스키마 테스트 [98] (1077).
- [x] **Phase 89 — 저절로 뜨는 창은 한 번에 하나 · 프로필 안내 · 익명편지 안내** (DB 변경 없음) — 처음 가입하면 사용법 안내 · 업적 축하 · CNSA 뱃지 안내 · 알림 안내가
      한꺼번에 겹쳐 떴다. 원인 셋: ① 안내가 홈이 그려지고 0.6초 뒤에 뜨는데 "떠 있는 동안"만 다른 창을 막아서 그 사이에 축하 · 알림 안내가 먼저 떴다.
      ② 그 대기 표시(`UI.touring`)를 effect 로 적었는데, Svelte 는 effect 안에서 바뀐 값에 딸린 `{#if}` 를 다음 effect 보다 먼저 그려서 알림 안내가 떴다 사라졌다.
      ③ 창을 닫으며 걷는 뒤로가기 칸(`history.back()`)이 같은 순간에 뜬 다음 창의 칸을 걷어 내 다음 창이 뜨자마자 닫혔다 (effect 정리 함수 안의 `page.state` 는 바뀌기 전 값).
      고침: 안내가 뜰 차례인지를 그때그때 계산(`lib/tour.svelte.ts` 의 `tourDue` · `touring`) — 뜨기 전부터 다른 창이 기다린다. 축하할 업적이 있으면(기다리는 중에도)
      매너 평가 · 알림 안내가 기다린다(`UI.celebrating`). `backClose` 는 쌓은 칸을 직접 세고(`stack`), 닫히는 창의 칸이 다 걷힌 뒤에 새 칸을 쌓는다(`settling`).
      순서: 사용법 안내 → 업적 축하 → 매너 평가 → 알림 안내. 안내는 탭마다(`Tour.svelte` 하나가 화면에 따라): 홈(11단계, 그대로) ·
      프로필(이름 카드 · 교복 · 전체 업적 · 소개 · 이야기하고 싶은 상대 → 끝까지 보면 CNSA 뱃지 안내가 이어진다 — 이미 본 기기는 잇지 않는다) ·
      익명편지(우체통 · 보관함 · 편지 쓰기 · 버리기 · 차단 · 신고, 편지가 열려 있을 때만 · 알림에서 편지를 꺼내러 왔을 때는 미룬다).
      CNSA 뱃지 안내는 이제 축하 창 뒤 · 업적 화면에서 저절로 뜨지 않는다 (업적 화면 CNSA 탭 · 설정 › 뱃지에서 다시). 비출 자리가 화면 밖이면 끌어오고, 자리가 커서
      카드가 위아래에 안 들어가면 화면 아래에 겹쳐 놓는다. 설정 › "사용법 다시 보기"는 세 안내를 모두 처음부터. e2e back (순서 · 프로필 · 익명편지 안내 22개 추가) · letters.
- [ ] Phase 7 — (보류) Durable Object 전송 계층. 학술탐구 큐 · 벤치는 별도 저장소(serverless-log-queue)에서 진행하고, 앱 적용 여부는 실험 결과를 본 뒤 따로 정한다.
