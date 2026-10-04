import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * schema.sql 을 진짜 PostgreSQL(PGlite, WASM)에 올려 돌리는 테스트.
 * Supabase 프로젝트를 건드리지 않고 스키마·트리거·권한을 검증한다.
 *
 *   npm run test:schema
 *
 * ⚠️ PGlite 는 단일 커넥션이라 동시 트랜잭션을 재현할 수 없다.
 *    매칭 advisory lock / 연장 투표 경쟁은 `supabase start`(로컬 Docker Postgres)에서 따로 검증한다.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA = here + 'schema.sql';

const db = new PGlite();

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
	if (ok) {
		pass++;
		console.log(`  PASS  ${name}`);
	} else {
		fail++;
		console.log(`  FAIL  ${name}  ${detail}`);
	}
}

async function expectError(name, fn, needle) {
	try {
		await fn();
		check(name, false, '(에러가 나야 하는데 성공함)');
	} catch (e) {
		check(name, String(e.message).includes(needle), `실제: ${e.message}`);
	}
}

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

/** 테스트용 가입. auth.users 에 직접 넣어 트리거를 탄다. */
async function signUp(email, confirmed = false) {
	const r = await one(
		`insert into auth.users (email, email_confirmed_at)
		 values ($1, case when $2 then now() else null end) returning id`,
		[email, confirmed]
	);
	return r.id;
}

// ── Supabase 환경 스텁 ────────────────────────────────────────────────
// 롤: 스키마의 grant/revoke 가 파싱되게 만든다.
// auth 스키마: 실제 Supabase 의 auth.users / auth.uid() 를 흉내낸다.
await db.exec(readFileSync(here + 'test-bootstrap.sql', 'utf8'));

/** uid 사용자로 로그인한 것처럼 RLS 를 적용해 실행한다. */
async function as(uid, fn) {
	await db.query(`select set_config('test.uid', $1, false)`, [uid ?? '']);
	await db.exec(uid ? 'set role authenticated' : 'set role anon');
	try {
		return await fn();
	} finally {
		await db.exec('reset role');
		await db.query(`select set_config('test.uid', '', false)`);
	}
}
const rowsAs = async (uid, sql, params = []) => as(uid, async () => (await db.query(sql, params)).rows);

/**
 * 화면에서 더 부르지 않아 Phase 34 에서 학생 실행 권한을 거둔 RPC (옛 공개 편지 것은 Phase 85 에서 함수째 지웠다) — 옛 기능 테스트가 함수 자체의 규칙은 계속 확인할 수 있게
 * 테스트에서만 다시 열어 둔다. 거둔 것은 맨 끝 [80] 에서 스키마를 다시 실행해 확인한다.
 */
const LEGACY_RPCS = ['my_room()', 'dm_inbox()', 'dm_thread(bigint)', 'dm_letter(bigint, text, jsonb, text)'];
const openLegacy = async () => {
	for (const f of LEGACY_RPCS) await db.exec(`grant execute on function public.${f} to authenticated`);
};

console.log('\n[1] 스키마 실행');
try {
	await db.exec(readFileSync(SCHEMA, 'utf8'));
	check('schema.sql 이 오류 없이 실행됨', true);
} catch (e) {
	check('schema.sql 이 오류 없이 실행됨', false, e.message);
	process.exit(1);
}

console.log('\n[2] 재실행 안전성 · 단일 행 설정');
try {
	await db.exec(readFileSync(SCHEMA, 'utf8'));
	check('schema.sql 두 번 실행해도 안전 (idempotent)', true);
	await openLegacy();
} catch (e) {
	check('schema.sql 두 번 실행해도 안전 (idempotent)', false, e.message);
}
check(
	'app_settings 는 항상 한 행',
	(await one('select count(*)::int n from public.app_settings')).n === 1
);
check(
	'연장 횟수 기본값은 무제한 (max_rounds = 0)',
	(await one('select max_rounds from public.app_settings')).max_rounds === 0
);
check(
	'기본 대화 시간 5분 / 연장 10분 (Phase 44)',
	JSON.stringify(await one('select room_minutes, extend_minutes from public.app_settings')) === '{"room_minutes":5,"extend_minutes":10}'
);
check('★ 익명편지 잠금은 처음부터 켜져 있다 (가입 100명까지)', JSON.stringify(await one('select letters_gate, letters_gate_min from public.app_settings')) === '{"letters_gate":true,"letters_gate_min":100}');
// 편지 테스트들은 편지가 열려 있다고 본다 — 잠금은 맨 끝 [84] 에서 따로 확인한다
await db.exec('update public.app_settings set letters_gate = false');

console.log('\n[3] 학교 이메일 도메인 강제');
const uidA = await signUp('hong@cnsa.hs.kr');
check('허용 도메인은 가입된다', !!uidA);

await expectError(
	'외부 도메인(@gmail.com)은 거부된다',
	() => signUp('hong@gmail.com'),
	'school_email_required'
);
await expectError(
	'대문자 도메인도 동일하게 판정된다 (@GMAIL.COM 거부)',
	() => signUp('hong@GMAIL.COM'),
	'school_email_required'
);
check(
	'대문자 학교 도메인(@CNSA.HS.KR)은 허용된다',
	!!(await signUp('kim@CNSA.HS.KR'))
);
await expectError(
	'이메일 없는 계정(익명 가입)은 거부된다',
	() => db.query('insert into auth.users (email) values (null)'),
	'school_email_required'
);

console.log('\n[4] 이메일 변경 경로 차단');
await expectError(
	'가입 후 외부 메일로 바꿔치기가 막힌다',
	() => db.query('update auth.users set email = $1 where id = $2', ['hong@naver.com', uidA]),
	'school_email_required'
);
await db.query('update auth.users set email = $1 where id = $2', ['hong2@cnsa.hs.kr', uidA]);
check(
	'같은 학교 도메인 안에서의 변경은 허용된다',
	(await one('select email from auth.users where id = $1', [uidA])).email === 'hong2@cnsa.hs.kr'
);

console.log('\n[4-2] ★ 계정 선점 방지 (비밀번호 가입 API 우회)');
{
	const HASH = '$2a$10$attackerchosenpasswordhashxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
	const pw = async (id) => (await one('select encrypted_password p from auth.users where id=$1', [id])).p;
	// 1) 공격자가 피해자 이메일 + 자기 비밀번호로 가입 (확인 전)
	const victim = (await one(`insert into auth.users (email, encrypted_password) values ('victim@cnsa.hs.kr', $1) returning id`, [HASH])).id;
	check('★ 확인 전 계정에는 비밀번호가 저장되지 않는다', (await pw(victim)) === '');
	// 2) 확인 전에 공격자가 다시 가입해 비밀번호를 덮어쓰려 함
	await db.query('update auth.users set encrypted_password = $2 where id = $1', [victim, HASH]);
	check('★ 확인 전 재가입으로도 비밀번호를 넣을 수 없다', (await pw(victim)) === '');
	// 3) 진짜 학생이 OTP 로 확인
	await db.query('update auth.users set email_confirmed_at = now() where id = $1', [victim]);
	check('★ 피해자가 확인한 뒤에도 공격자의 비밀번호는 남아 있지 않다', (await pw(victim)) === '');
	// 대조군: 운영자가 확인된 상태로 만든 개발용 계정은 비밀번호 유지
	const dev = (await one(`insert into auth.users (email, email_confirmed_at, encrypted_password) values ('devacct@cnsa.hs.kr', now(), $1) returning id`, [HASH])).id;
	check('확인된 상태로 만든 개발용 계정은 비밀번호가 유지된다', (await pw(dev)) === HASH);
	await db.query('update auth.users set encrypted_password = $2 where id = $1', [dev, HASH + 'x']);
	check('확인된 계정의 비밀번호 변경은 정상 동작', (await pw(dev)) === HASH + 'x');
}

console.log('\n[5] 가입 파이프라인');
check(
	'가입 시 profiles 행이 생긴다',
	(await one('select count(*)::int n from public.profiles where id = $1', [uidA])).n === 1
);
check(
	'가입 시 user_presence 행이 생긴다',
	(await one('select count(*)::int n from public.user_presence where user_id = $1', [uidA])).n === 1
);
check(
	'미확인 계정은 verified = false',
	(await one('select verified from public.profiles where id = $1', [uidA])).verified === false
);
check(
	'온보딩 전에는 onboarded = false',
	(await one('select onboarded from public.profiles where id = $1', [uidA])).onboarded === false
);

await db.query('update auth.users set email_confirmed_at = now() where id = $1', [uidA]);
check(
	'이메일 확인 시 profiles.verified 가 동기화된다',
	(await one('select verified from public.profiles where id = $1', [uidA])).verified === true
);

const uidB = await signUp('lee@cnsa.hs.kr', true);
check(
	'확인된 상태로 생성되면 곧바로 verified = true',
	(await one('select verified from public.profiles where id = $1', [uidB])).verified === true
);

console.log('\n[6] 익명성 — 권한과 RLS 구조');

const rls = async (schema, table) =>
	(
		await one(
			`select c.relrowsecurity from pg_class c
			   join pg_namespace n on n.oid = c.relnamespace
			  where n.nspname = $1 and c.relname = $2`,
			[schema, table]
		)
	).relrowsecurity;

const policyCount = async (schema, table) =>
	(
		await one(
			`select count(*)::int n from pg_policies where schemaname = $1 and tablename = $2`,
			[schema, table]
		)
	).n;

for (const [s, t] of [
	['public', 'profiles'],
	['public', 'user_presence'],
	['public', 'app_settings'],
	['private', 'auth_config'],
	['private', 'staff']
]) {
	check(`${s}.${t} 에 RLS 가 켜져 있다`, (await rls(s, t)) === true);
}

check('user_presence 는 정책 0개 = 클라 전면 차단', (await policyCount('public', 'user_presence')) === 0);
check('private.auth_config 는 정책 0개', (await policyCount('private', 'auth_config')) === 0);
check('private.staff 는 정책 0개', (await policyCount('private', 'staff')) === 0);

check(
	'profiles 는 self read/update 정책만 (2개)',
	(await policyCount('public', 'profiles')) === 2
);

const hasColPriv = async (col) =>
	(
		await one(
			`select count(*)::int n from information_schema.column_privileges
			  where grantee = 'authenticated' and table_schema = 'public'
			    and table_name = 'profiles' and column_name = $1 and privilege_type = 'UPDATE'`,
			[col]
		)
	).n > 0;

check('사용자는 gender 를 수정할 수 있다', await hasColPriv('gender'));
check('사용자는 want 를 수정할 수 있다', await hasColPriv('want'));
check('사용자는 onboarded 를 수정할 수 있다', await hasColPriv('onboarded'));
check('★ 사용자는 status 를 수정할 수 없다 (정지 자가 해제 불가)', !(await hasColPriv('status')));
check('★ 사용자는 verified 를 수정할 수 없다', !(await hasColPriv('verified')));
check('★ 사용자는 strikes 를 수정할 수 없다', !(await hasColPriv('strikes')));

const schemaPriv = (
	await one(
		`select has_schema_privilege('authenticated', 'private', 'USAGE') as ok`
	)
).ok;
check('★ authenticated 는 private 스키마에 접근할 수 없다', schemaPriv === false);

console.log('\n[7] 자기 행 보장 폴백 (ensure_self)');
await db.query(`select set_config('test.uid', $1, false)`, [uidB]);
await db.query('delete from public.user_presence where user_id = $1', [uidB]);
await db.query('select public.ensure_self()');
check(
	'ensure_self 가 없어진 user_presence 행을 복구한다',
	(await one('select count(*)::int n from public.user_presence where user_id = $1', [uidB])).n === 1
);
await db.query(`select set_config('test.uid', '', false)`);
await expectError(
	'비로그인 상태에서 ensure_self 는 거부된다',
	() => db.query('select public.ensure_self()'),
	'unauthenticated'
);

// ════════════════════════════════════════════════════════════════════
//  Phase 2 — 채팅 코어
// ════════════════════════════════════════════════════════════════════
const A = await signUp('alpha@cnsa.hs.kr', true);
const B = await signUp('bravo@cnsa.hs.kr', true);
const C = await signUp('charlie@cnsa.hs.kr', true);
const room = (await one(`select private.dev_open_room('alpha@cnsa.hs.kr','bravo@cnsa.hs.kr',60) as id`)).id;
const cid = () => crypto.randomUUID();
const send = (uid, seat, body, c = cid()) =>
	as(uid, () =>
		db.query(
			`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1,$2,$3,$4)`,
			[room, seat, body, c]
		)
	);

console.log('\n[8] ★ 익명성 — 구조 자체');
const msgCols = (
	await db.query(
		`select column_name, data_type from information_schema.columns
		  where table_schema='public' and table_name='messages'`
	)
).rows;
check(
	'messages 에 sender_id/user_id 같은 식별 컬럼이 존재하지 않는다',
	!msgCols.some((c) => /sender_id|user_id|author/.test(c.column_name))
);
check(
	'messages 의 uuid 컬럼은 room_id·client_msg_id 뿐이다',
	msgCols.filter((c) => c.data_type === 'uuid').map((c) => c.column_name).sort().join() ===
		'client_msg_id,room_id'
);

const rmA = await rowsAs(A, 'select user_id, seat from public.room_members');
check('★ room_members: A 에게는 자기 행 1개만 보인다', rmA.length === 1 && rmA[0].user_id === A);
check(
	'★ room_members: 상대(B)의 user_id 는 어떤 쿼리로도 안 보인다',
	(await rowsAs(A, 'select * from public.room_members where user_id = $1', [B])).length === 0
);

const snapA = (await rowsAs(A, 'select public.room_snapshot($1) s', [room]))[0].s;
const snapStr = JSON.stringify(snapA);
check('room_snapshot: A 는 seat 1', snapA.my_seat === 1);
check('room_snapshot: 내 alias 와 상대 alias 가 다르다', snapA.my_alias !== snapA.partner_alias);
check(
	'★ room_snapshot 응답에 어느 사용자의 uuid 도 들어있지 않다',
	!snapStr.includes(A) && !snapStr.includes(B)
);
check('room_snapshot 에 server_now 가 있다 (시계 보정용)', !!snapA.server_now);
const snapB = (await rowsAs(B, 'select public.room_snapshot($1) s', [room]))[0].s;
check('B 가 보는 상대 alias = A 의 alias', snapB.partner_alias === snapA.my_alias);

console.log('\n[9] 방 접근 권한');
check('A 는 방을 볼 수 있다', (await rowsAs(A, 'select id from public.rooms')).length === 1);
check('★ 제3자 C 는 방을 볼 수 없다', (await rowsAs(C, 'select id from public.rooms')).length === 0);
check(
	'A 는 시작 안내(시스템 메시지)를 본다',
	(await rowsAs(A, 'select sender_seat from public.messages')).some((m) => m.sender_seat === 0)
);
check(
	'★ C 는 그 방의 메시지를 한 건도 볼 수 없다',
	(await rowsAs(C, 'select id from public.messages where room_id = $1', [room])).length === 0
);
await expectError(
	'★ 비로그인(anon)은 messages 에 접근 자체가 거부된다',
	() => rowsAs(null, 'select id from public.messages'),
	'permission denied'
);
await expectError(
	'C 가 room_snapshot 을 부르면 not_member',
	() => rowsAs(C, 'select public.room_snapshot($1)', [room]),
	'not_member'
);
check(
	'my_room: A 는 현재 방을 받는다',
	(await rowsAs(A, 'select public.my_room() r', []))[0].r.room.room_id === room
);
check(
	'my_room: 방이 없는 C 는 null',
	(await rowsAs(C, 'select public.my_room() r', []))[0].r.room === null
);

console.log('\n[10] 메시지 전송');
await send(A, 1, '안녕');
await send(B, 2, '반가워');
check(
	'A·B 가 각자 자기 좌석으로 보낸 메시지가 저장된다',
	(await rowsAs(A, 'select body from public.messages where sender_seat > 0 order by id')).map((m) => m.body).join() ===
		'안녕,반가워'
);
await expectError('★ A 가 상대 좌석(2)으로 위장해 보낼 수 없다', () => send(A, 2, '가짜'), 'row-level security');
await expectError('★ A 가 시스템 메시지(0)를 위조할 수 없다', () => send(A, 0, '공지'), 'row-level security');
await expectError('★ 제3자 C 는 그 방에 보낼 수 없다', () => send(C, 1, '끼어들기'), 'row-level security');
await expectError('빈 메시지(공백만)는 거부된다', () => send(A, 1, '   '), 'check');
await expectError('500자 초과는 거부된다', () => send(A, 1, 'ㄱ'.repeat(501)), 'check');

const dup = cid();
await send(A, 1, '한 번만', dup);
await expectError('같은 client_msg_id 재전송은 중복 행을 만들지 않는다', () => send(A, 1, '한 번만', dup), 'duplicate');

await expectError(
	'클라이언트가 created_at 을 조작할 수 없다',
	() =>
		as(A, () =>
			db.query(
				`insert into public.messages (room_id, sender_seat, body, client_msg_id, created_at)
				 values ($1, 1, 'x', $2, now() - interval '1 day')`,
				[room, cid()]
			)
		),
	'permission denied'
);
await expectError(
	'★ 보낸 메시지를 수정할 수 없다 (증거 무결성)',
	() => as(A, () => db.query(`update public.messages set body = '수정' where room_id = $1`, [room])),
	'permission denied'
);
await expectError(
	'★ 보낸 메시지를 삭제할 수 없다',
	() => as(A, () => db.query(`delete from public.messages where room_id = $1`, [room])),
	'permission denied'
);
await expectError(
	'사용자가 방을 직접 조작(연장)할 수 없다',
	() => as(A, () => db.query(`update public.rooms set expires_at = now() + interval '9 hours'`)),
	'permission denied'
);

console.log('\n[11] 읽음 표시');
const lastId = (await one('select max(id)::int m from public.messages where room_id = $1', [room])).m;
await as(B, () => db.query('select public.mark_read($1, $2)', [room, lastId]));
check(
	'B 가 읽으면 A 의 스냅샷에 their_read_id 로 보인다',
	Number((await rowsAs(A, 'select public.room_snapshot($1) s', [room]))[0].s.their_read_id) === lastId
);
await as(B, () => db.query('select public.mark_read($1, $2)', [room, 1]));
check(
	'읽음 위치는 뒤로 가지 않는다',
	Number((await rowsAs(A, 'select public.room_snapshot($1) s', [room]))[0].s.their_read_id) === lastId
);

console.log('\n[12] ★ 만료 강제 — 배치가 아니라 INSERT 정책');
await db.query(`update public.rooms set expires_at = now() - interval '1 second' where id = $1`, [room]);
check(
	'status 는 아직 active (스위퍼가 안 돌았다고 가정)',
	(await one('select status from public.rooms where id = $1', [room])).status === 'active'
);
await expectError(
	'★ 그래도 만료된 방에는 메시지를 보낼 수 없다',
	() => send(A, 1, '늦었다'),
	'row-level security'
);
check(
	'만료됐지만 아직 닫히지 않은 방의 대화는 볼 수 있다',
	(await rowsAs(A, 'select id from public.messages where room_id = $1', [room])).length > 0
);

await db.query(`update public.rooms set status = 'closed', closed_at = now() where id = $1`, [room]);
check(
	'★ 방이 닫히면 과거 대화가 클라이언트에서 사라진다',
	(await rowsAs(A, 'select id from public.messages where room_id = $1', [room])).length === 0
);
check(
	'닫힌 방도 rooms 행 자체는 보인다 (종료 알림을 Realtime 으로 받기 위해)',
	(await rowsAs(A, 'select status from public.rooms where id = $1', [room]))[0]?.status === 'closed'
);
check(
	'서버에는 메시지가 남아 있다 (신고 증거용, 24시간 뒤 purge)',
	(await one('select count(*)::int n from public.messages where room_id = $1', [room])).n > 0
);

console.log('\n[13] 여러 대화 동시 (Phase 8)');
{
	const r2 = (await one(`insert into public.rooms (status, expires_at, alias1, alias2)
		values ('active', now() + interval '10 min', 'x', 'y') returning id`)).id;
	const r3 = (await one(`insert into public.rooms (status, expires_at, alias1, alias2)
		values ('active', now() + interval '10 min', 'x', 'y') returning id`)).id;
	await db.query(`insert into public.room_members (room_id, user_id, seat) values ($1, $2, 1)`, [r2, C]);
	await db.query(`insert into public.room_members (room_id, user_id, seat) values ($1, $2, 1)`, [r3, C]);
	check(
		'한 사람이 열린 방 여러 개에 동시에 있을 수 있다',
		(await one('select count(*)::int n from public.room_members where user_id = $1 and open', [C])).n === 2
	);
	await db.query(`update public.room_members set open = false where user_id = $1`, [C]);
}
const room2 = (await one(`select private.dev_open_room('alpha@cnsa.hs.kr','bravo@cnsa.hs.kr',60) as id`)).id;
check(
	'개발용 방 열기: 두 사람의 새 방이 가장 최근 방이 된다',
	(await rowsAs(A, 'select public.my_room() r'))[0].r.room.room_id === room2
);
const aliases2 = await one('select alias1, alias2 from public.rooms where id = $1', [room2]);
const nickA = (await one('select nickname from public.profiles where id = $1', [A])).nickname;
check('방 안 이름 = 계정의 고유 익명 이름', aliases2.alias1 === nickA && aliases2.alias1 !== aliases2.alias2);

// ════════════════════════════════════════════════════════════════════
//  Phase 3 — 타임박스
// ════════════════════════════════════════════════════════════════════
const rpcAs = async (uid, fn, ...args) => {
	const ph = args.map((_, i) => `$${i + 1}`).join(',');
	return (await rowsAs(uid, `select public.${fn}(${ph}) r`, args))[0].r;
};
const roomRow = (id) => one('select * from public.rooms where id = $1', [id]);
const setExpiry = (id, sec) =>
	db.query(`update public.rooms set expires_at = now() + make_interval(secs => $2) where id = $1`, [id, sec]);
const fresh = async () =>
	(await one(`select private.dev_open_room('alpha@cnsa.hs.kr','bravo@cnsa.hs.kr',10) as id`)).id;

console.log('\n[14] 연장 투표 — 정상 흐름');
{
	const r = await fresh();
	const early = await rpcAs(A, 'vote_extension', r, true);
	check('투표창 전(만료 10분 전)에는 too_early — 미리 시간을 쌓을 수 없다', early.result === 'too_early');

	await setExpiry(r, 60); // 투표창(90초) 안으로
	const before = await roomRow(r);
	const v1 = await rpcAs(A, 'vote_extension', r, true);
	check('A 만 동의 → waiting', v1.result === 'waiting');
	check('A 의 스냅샷: my_vote=true, partner_vote=null', v1.snap.my_vote === true && v1.snap.partner_vote === null);
	const bSnap = await rpcAs(B, 'room_snapshot', r);
	check('B 의 스냅샷에 "상대가 연장을 원해요"가 보인다 (partner_vote=true)', bSnap.partner_vote === true);

	const again = await rpcAs(A, 'vote_extension', r, true);
	check('★ A 가 한 번 더 눌러도 연장되지 않는다', again.result === 'waiting');

	const v2 = await rpcAs(B, 'vote_extension', r, true);
	const after = await roomRow(r);
	check('B 도 동의 → extended', v2.result === 'extended');
	const addedMin = (new Date(after.expires_at) - new Date(before.expires_at)) / 60000;
	check('★ 연장은 now() 가 아니라 기존 expires_at + 정확히 10분', Math.abs(addedMin - 10) < 0.01, `${addedMin}분`);
	check('round 가 2 가 된다', after.round === 2);
	check(
		'연장 안내 시스템 메시지가 남는다',
		(await one(`select count(*)::int n from public.messages where room_id=$1 and sender_seat=0 and body like '%연장%'`, [r])).n === 1
	);
	const snap2 = await rpcAs(A, 'room_snapshot', r);
	check('★ 새 라운드에서는 이전 표가 섞이지 않는다 (my_vote=null)', snap2.my_vote === null && snap2.partner_vote === null);

	await setExpiry(r, 60);
	// 두 번째 연장은 공통 질문 차례 (Phase 29) — 답을 적으면서 연장한다
	const b3 = await rpcAs(B, 'vote_extension', r, true, '러닝');
	const a3 = await rpcAs(A, 'vote_extension', r, true, '밴드 음악');
	check('두 번째 연장도 된다 (무제한 기본값)', b3.result === 'waiting' && a3.result === 'extended' && (await roomRow(r)).round === 3);
}

console.log('\n[15] 연장 거절 · 마음 바꾸기');
{
	const r = await fresh();
	await setExpiry(r, 60);
	await rpcAs(A, 'vote_extension', r, true);
	const flip = await rpcAs(A, 'vote_extension', r, true);
	check('동의를 다시 눌러도 waiting 유지', flip.result === 'waiting');
	const no = await rpcAs(B, 'vote_extension', r, false);
	const row = await roomRow(r);
	check('한쪽이 거절 → declined, 즉시 종료', no.result === 'declined' && row.status === 'closed' && row.close_reason === 'declined');
	check(
		'종료되면 두 사람 모두 방에서 풀려난다 (새 매칭 가능)',
		(await one('select count(*)::int n from public.room_members where room_id=$1 and open', [r])).n === 0
	);
	await expectError('종료된 방에 메시지를 보낼 수 없다', () => send(A, 1, '아직?'), 'row-level security');
}

console.log('\n[16] ★ 만료 경계');
{
	const r = await fresh();
	await setExpiry(r, 60);
	await rpcAs(A, 'vote_extension', r, true);
	await setExpiry(r, -1); // B 의 표가 도착하기 직전에 만료됨
	const late = await rpcAs(B, 'vote_extension', r, true);
	const row = await roomRow(r);
	check('★ 만료 직후 도착한 표는 버려지고 방이 닫힌다', late.result === 'expired' && row.status === 'closed');
	check('늦은 표가 시간을 되살리지 못한다 (round 그대로)', row.round === 1);
}
{
	const r = await fresh();
	await setExpiry(r, 60);
	await rpcAs(A, 'vote_extension', r, true); // 한쪽만 동의하고 상대는 무응답
	await setExpiry(r, -1);
	const s = await rpcAs(A, 'close_if_expired', r);
	check('★ 무응답 = 거절 — 만료 시 expired 로 종료', s.status === 'closed' && s.close_reason === 'expired');
}
{
	const r = await fresh();
	const s = await rpcAs(A, 'close_if_expired', r);
	check('★ 만료 전 close_if_expired 는 아무것도 닫지 않는다 (조기 종료 불가)', s.status === 'active');
	check('close_if_expired 도 server_now 를 돌려준다', !!s.server_now);
}

console.log('\n[17] 연장 상한 (운영자가 설정하면)');
{
	await db.query('update public.app_settings set max_rounds = 2');
	const r = await fresh();
	await setExpiry(r, 60);
	await rpcAs(A, 'vote_extension', r, true);
	await rpcAs(B, 'vote_extension', r, true); // round 2
	await setExpiry(r, 60);
	const cap = await rpcAs(A, 'vote_extension', r, true);
	check('max_rounds=2 면 두 번째 라운드에서 max_rounds', cap.result === 'max_rounds');
	await db.query('update public.app_settings set max_rounds = 0');
}

console.log('\n[18] 나가기');
{
	const r = await fresh();
	const s = await rpcAs(A, 'leave_room', r, true);
	check('넘기기 → skipped 로 종료', s.status === 'closed' && s.close_reason === 'skipped');
	const bs = await rpcAs(B, 'room_snapshot', r);
	check('상대에게도 종료 사유가 보인다', bs.close_reason === 'skipped');
	await expectError('남은 상대도 더는 보낼 수 없다', () => send(B, 2, '어디 가'), 'row-level security');
	await expectError('제3자는 남의 방을 닫을 수 없다', () => rpcAs(C, 'leave_room', r, true), 'not_member');
}

console.log('\n[19] 권한');
await expectError(
	'★ 사용자가 close_room 을 직접 부를 수 없다 (아무 방이나 닫기 방지)',
	() => rowsAs(A, `select public.close_room($1, 'admin')`, [room2]),
	'permission denied'
);
await expectError(
	'사용자가 sweep_rooms 를 부를 수 없다',
	() => rowsAs(A, 'select public.sweep_rooms()'),
	'permission denied'
);
await expectError(
	'★ 투표를 테이블에 직접 넣을 수 없다 (RPC 만)',
	() => as(A, () => db.query(`insert into public.extension_votes (room_id, round, seat, agree) values ($1, 1, 2, true)`, [room2])),
	'permission denied'
);
await expectError('제3자는 투표할 수 없다', () => rpcAs(C, 'vote_extension', room2, true), 'not_member');

console.log('\n[20] 입장 확인 (pending → active)');
{
	// 매칭(Phase 4)이 만들 형태의 pending 방을 손으로 만든다
	await db.query(`update public.room_members set open = false where user_id in ($1,$2)`, [A, B]);
	const r = (
		await one(`insert into public.rooms (status, expires_at, alias1, alias2)
		           values ('pending', now() + interval '60 seconds', '말랑복숭아', '새벽수달') returning id`)
	).id;
	await db.query(`insert into public.room_members (room_id, user_id, seat) values ($1,$2,1), ($1,$3,2)`, [r, A, B]);

	await expectError('pending 방에는 아직 메시지를 보낼 수 없다', () => send(A, 1, '먼저'), 'row-level security');
	const a = await rpcAs(A, 'ack_room', r);
	check('한쪽만 입장 → 여전히 pending', a.status === 'pending');
	const bSnap = await rpcAs(B, 'room_snapshot', r);
	check('B 에게 "상대가 들어왔어요"가 보인다 (partner_joined)', bSnap.partner_joined === true);
	const b = await rpcAs(B, 'ack_room', r);
	const row = await roomRow(r);
	const mins = (new Date(row.expires_at) - new Date(row.armed_at)) / 60000;
	check('양쪽 입장 → active', b.status === 'active');
	check('★ 첫 대화 5분 타이머는 둘 다 들어온 순간부터 시작된다 (Phase 44)', Math.abs(mins - 5) < 0.01, `${mins}분`);
	check(
		'시작 안내 시스템 메시지',
		(await one(`select count(*)::int n from public.messages where room_id=$1 and sender_seat=0`, [r])).n === 1
	);
	const twice = await rpcAs(A, 'ack_room', r);
	check('다시 ack 해도 타이머가 리셋되지 않는다', twice.expires_at === b.expires_at);
}
{
	await db.query(`update public.room_members set open = false where user_id in ($1,$2)`, [A, B]);
	const r = (
		await one(`insert into public.rooms (status, expires_at, alias1, alias2)
		           values ('pending', now() + interval '60 seconds', 'x', 'y') returning id`)
	).id;
	await db.query(`insert into public.room_members (room_id, user_id, seat) values ($1,$2,1), ($1,$3,2)`, [r, A, B]);
	await rpcAs(A, 'ack_room', r);
	await setExpiry(r, -1); // B 가 60초 안에 안 들어옴
	const s = await rpcAs(A, 'close_if_expired', r);
	check('★ 상대가 60초 안에 안 들어오면 no_show 로 종료', s.status === 'closed' && s.close_reason === 'no_show');
}

console.log('\n[21] 스위퍼 — 좀비 방 정리');
{
	await db.query(`update public.room_members set open = false where user_id in ($1,$2)`, [A, B]);
	const r = await fresh();
	await setExpiry(r, -5); // 양쪽 다 앱을 꺼버렸다
	const n = (await one('select public.sweep_rooms() n')).n;
	const row = await roomRow(r);
	check('만료된 방을 닫는다', n >= 1 && row.status === 'closed' && row.close_reason === 'expired');
	check(
		'★ 두 사람 모두 방에서 풀려나 새 매칭을 받을 수 있다',
		(await one('select count(*)::int n from public.room_members where user_id in ($1,$2) and open', [A, B])).n === 0
	);
	const live = await fresh();
	await db.query('select public.sweep_rooms()');
	check('만료 안 된 방은 건드리지 않는다', (await roomRow(live)).status === 'active');
}

// ════════════════════════════════════════════════════════════════════
//  Phase 4 — 랜덤 매칭
// ════════════════════════════════════════════════════════════════════
let seq = 0;
async function person(gender, want, { onboarded = true } = {}) {
	const id = await signUp(`p${++seq}-${gender}@cnsa.hs.kr`, true);
	await db.query('update public.profiles set gender=$2, want=$3, onboarded=$4 where id=$1', [id, gender, want, onboarded]);
	return id;
}
const match = (uid) => rpcAs(uid, 'request_match');
/** 모든 사람을 풀에서 빼고 열린 방을 닫는다 — 시나리오끼리 섞이지 않게 */
async function resetPool() {
	await db.query(`update public.user_presence set seeking_until = null, seeking_since = null, current_room_id = null`);
	await db.query(`update public.room_members set open = false where open`);
	await db.query(`update public.rooms set status = 'closed' where status <> 'closed'`);
}

console.log('\n[22] 매칭 자격');
{
	await resetPool();
	const n = await person('m', 'f', { onboarded: false });
	check('온보딩 전에는 매칭 불가 (not_eligible)', (await match(n)).status === 'not_eligible');
	const s = await person('m', 'f');
	await db.query(`update public.profiles set status='suspended' where id=$1`, [s]);
	check('정지된 계정은 매칭 불가', (await match(s)).status === 'not_eligible');
	const t = await person('m', 'f');
	await db.query(`update public.profiles set suspended_until = now() + interval '1 day' where id=$1`, [t]);
	check('기간 정지 중인 계정도 매칭 불가', (await match(t)).status === 'not_eligible');
	await db.query('update public.app_settings set is_open = false');
	check('킬 스위치가 꺼지면 service_closed', (await match(await person('f', 'm'))).status === 'service_closed');
	await db.query('update public.app_settings set is_open = true');
	await expectError('비로그인은 매칭 불가', () => rowsAs(null, 'select public.request_match()'), 'permission denied');
}

console.log('\n[23] 기본 매칭');
{
	await resetPool();
	const m1 = await person('m', 'f');
	const f1 = await person('f', 'm');
	const w = await match(m1);
	check('혼자면 waiting (reason=empty)', w.status === 'waiting' && w.reason === 'empty');
	check('대기 응답에 다음 폴링 간격이 온다', w.poll_ms === 4000);

	const r = await match(f1);
	check('상대가 찾는 중이면 즉시 matched', r.status === 'matched' && !!r.room_id);
	check(
		'★ 매칭 응답에 어느 사용자 uuid 도 없다',
		!JSON.stringify(r).includes(m1) && !JSON.stringify(r).includes(f1)
	);
	const row = await roomRow(r.room_id);
	check('방은 pending — 둘 다 입장해야 타이머가 시작된다', row.status === 'pending');
	check('입장 마감은 60초', Math.abs((new Date(row.expires_at) - Date.now()) / 1000 - 60) < 5);
	check('두 alias 가 다르다', row.alias1 !== row.alias2);

	const again = await match(m1);
	check('★ 먼저 기다리던 쪽이 다시 폴링하면 같은 방을 받는다', again.status === 'matched' && again.room_id === r.room_id);
	check(
		'매칭되면 두 사람 모두 풀에서 빠진다',
		(await one(`select count(*)::int n from public.user_presence where user_id in ($1,$2) and seeking_until is not null`, [m1, f1])).n === 0
	);
	const f2 = await person('f', 'm');
	check('이미 방에 있는 사람은 다른 사람에게 잡히지 않는다', (await match(f2)).status === 'waiting');

	check(
		'매칭만으로는 재매칭 기록이 남지 않는다 (아직 대화 시작 전)',
		(await one('select count(*)::int n from public.pair_history where user_lo = least($1::uuid,$2::uuid)', [m1, f1])).n === 0
	);
	await rpcAs(m1, 'ack_room', r.room_id);
	await rpcAs(f1, 'ack_room', r.room_id);
	check(
		'둘 다 입장해 대화가 시작되면 기록된다',
		(await one('select count(*)::int n from public.pair_history where user_lo = least($1::uuid,$2::uuid) and user_hi = greatest($1::uuid,$2::uuid)', [m1, f1])).n === 1
	);
}

console.log('\n[24] 선호 성별');
{
	await resetPool();
	const m = await person('m', 'm'); // 남자를 원하는 남자
	const f = await person('f', 'm'); // 남자를 원하는 여자
	await match(f);
	const r = await match(m);
	check('★ 한쪽 선호만 맞으면 매칭되지 않는다 (filtered)', r.status === 'waiting' && r.reason === 'filtered');
	const m2 = await person('m', 'm');
	check('양쪽 선호가 맞으면 매칭된다', (await match(m2)).status === 'matched');
	await resetPool();
	const any1 = await person('f', 'any');
	const any2 = await person('f', 'any');
	await match(any1);
	check('"상관없어요" 끼리는 매칭된다', (await match(any2)).status === 'matched');
}

console.log('\n[25] 차단 · 재매칭 쿨다운');
{
	await resetPool();
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	await db.query('insert into public.blocks (blocker_id, blocked_id) values ($1,$2)', [y, x]);
	await match(x);
	check('★ 차단한 상대와는 매칭되지 않는다', (await match(y)).status === 'waiting');
	check('★ 차단당한 쪽에서 찾아도 매칭되지 않는다 (양방향)', (await match(x)).status === 'waiting');

	await resetPool();
	const p = await person('m', 'f');
	const q = await person('f', 'm');
	await db.query(`insert into public.pair_history (user_lo, user_hi, last_matched_at)
	                values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), now() - interval '2 days')`, [p, q]);
	await match(p);
	check('★ 7일 안에 대화한 상대와는 다시 매칭되지 않는다', (await match(q)).status === 'waiting');
	await db.query(`update public.pair_history set last_matched_at = now() - interval '8 days'
	                 where user_lo = least($1::uuid,$2::uuid)`, [p, q]);
	check('7일이 지나면 다시 만날 수 있다', (await match(q)).status === 'matched');
}

console.log('\n[26] ★ 앱을 안 보고 있는 사람은 잡지 않는다');
{
	await resetPool();
	const idle = await person('m', 'f');
	const me2 = await person('f', 'm');
	await match(idle);
	await db.query(`update public.user_presence set seeking_until = now() - interval '1 second' where user_id = $1`, [idle]);
	check('폴링이 끊겨 seeking 이 만료된 사람은 후보가 아니다', (await match(me2)).status === 'waiting');

	await resetPool();
	const u = await person('m', 'f');
	const v = await person('f', 'm');
	await match(u);
	await rpcAs(u, 'stop_seeking');
	check('대기 화면을 떠나면(stop_seeking) 즉시 풀에서 빠진다', (await match(v)).status === 'waiting');
}

console.log('\n[27] 공정성 — 오래 기다린 사람 먼저');
{
	await resetPool();
	const early = await person('m', 'f');
	const late = await person('m', 'f');
	await match(early);
	await db.query(`update public.user_presence set seeking_since = now() - interval '5 minutes' where user_id = $1`, [early]);
	await match(late);
	const f = await person('f', 'm');
	const r = await match(f);
	const seat2 = (await one('select user_id from public.room_members where room_id = $1 and seat = 2', [r.room_id])).user_id;
	check('5분 기다린 사람이 방금 온 사람보다 먼저 매칭된다', seat2 === early);
	const lateAgain = await match(late);
	check('계속 폴링해도 seeking_since 는 첫 요청 시각을 유지한다', lateAgain.status === 'waiting');
}

console.log('\n[28] no_show 후 재매칭');
{
	await resetPool();
	const a = await person('m', 'f');
	const b = await person('f', 'm');
	await match(a);
	const r = await match(b);
	await rpcAs(b, 'ack_room', r.room_id);
	await setExpiry(r.room_id, -1); // a 가 60초 안에 안 들어옴
	const again = await match(b);
	check('★ 만료된 pending 방은 다음 매칭 요청 때 no_show 로 정리된다', (await roomRow(r.room_id)).close_reason === 'no_show');
	check('들어왔던 쪽은 곧바로 다시 찾을 수 있다', again.status === 'waiting' || again.status === 'matched');
	const back = await match(a);
	check('★ 대화한 적 없으므로 같은 상대와 다시 만날 수 있다', back.status === 'matched');
}

console.log('\n[29] 익명성 — 매칭 관련 테이블');
for (const t of ['pair_history', 'blocks', 'user_presence']) {
	await expectError(`★ 사용자는 ${t} 를 읽을 수 없다`, () => rowsAs(A, `select * from public.${t}`), 'permission denied');
}

// ════════════════════════════════════════════════════════════════════
//  Phase 5 — 신고 · 차단 · 도배 제한
// ════════════════════════════════════════════════════════════════════
const emailOf = async (id) => (await one('select email from auth.users where id = $1', [id])).email;
async function pairRoom(u1, u2, minutes = 10) {
	await db.query(`update public.room_members set open = false where user_id in ($1,$2)`, [u1, u2]);
	return (await one(`select private.dev_open_room($1, $2, $3) as id`, [await emailOf(u1), await emailOf(u2), minutes])).id;
}
const sendIn = (uid, roomId, seat, body) =>
	as(uid, () =>
		db.query(`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1,$2,$3,$4)`, [
			roomId, seat, body, crypto.randomUUID()
		])
	);
const cnt = async (sql, p = []) => (await one(sql, p)).n;

console.log('\n[30] 신고');
{
	await resetPool();
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	const r = await pairRoom(x, y);
	await sendIn(x, r, 1, '안녕');
	await sendIn(y, r, 2, '불쾌한 말');
	await sendIn(y, r, 2, '또 불쾌한 말');

	await expectError('잘못된 사유는 거부', () => rpcAs(x, 'report_partner', r, 'whatever', ''), 'invalid_reason');
	await expectError('제3자는 신고할 수 없다', () => rpcAs(A, 'report_partner', r, 'harassment', ''), 'not_member');

	const res = await rpcAs(x, 'report_partner', r, 'harassment', '계속 욕해요');
	check('신고 접수', res.status === 'ok');
	check('★ 신고 응답에도 사용자 uuid 가 없다', !JSON.stringify(res).includes(y) && !JSON.stringify(res).includes(x));
	check('신고하면 방이 즉시 종료된다', (await roomRow(r)).close_reason === 'reported');
	check('신고하면 자동으로 차단된다', (await cnt('select count(*)::int n from public.blocks where blocker_id=$1 and blocked_id=$2', [x, y])) === 1);

	const rep = await one('select * from private.reports where room_id = $1', [r]);
	check('신고 대상은 서버가 해석한 상대 uuid', rep.reported_id === y && rep.reporter_id === x);
	const ev = (await db.query('select sender, body from private.report_evidence where report_id = $1 order by ord', [rep.id])).rows;
	check('대화 전문이 증거로 복사된다 (시스템 1 + 대화 3)', ev.length === 4);
	check('증거는 좌석이 아니라 역할로 기록 (1=신고자, 2=피신고자)', ev[1].sender === 1 && ev[2].sender === 2 && ev[3].sender === 2);

	await db.query('delete from public.messages where room_id = $1', [r]);
	check('★ 원본 메시지를 지워도 증거는 남는다 (24시간 purge 대비)', (await cnt('select count(*)::int n from private.report_evidence where report_id=$1', [rep.id])) === 4);

	check('같은 방 중복 신고는 already', (await rpcAs(x, 'report_partner', r, 'spam', '')).status === 'already');
	check('★ 방이 닫힌 뒤에도 신고할 수 있다 (상대의 맞신고)', (await rpcAs(y, 'report_partner', r, 'other', '')).status === 'ok');

	await expectError('★ 사용자는 신고 테이블에 접근할 수 없다', () => rowsAs(x, 'select * from private.reports'), 'permission denied');
	await expectError('★ 사용자는 증거 테이블에 접근할 수 없다', () => rowsAs(x, 'select * from private.report_evidence'), 'permission denied');
}

console.log('\n[31] 차단');
{
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	const r = await pairRoom(x, y);
	const res = await rpcAs(x, 'block_partner', r);
	check('차단 → 방 종료 (blocked)', res.status === 'ok' && (await roomRow(r)).close_reason === 'blocked');
	check('차단 목록에 기록', (await cnt('select count(*)::int n from public.blocks where blocker_id=$1 and blocked_id=$2', [x, y])) === 1);
	await resetPool();
	await match(x);
	check('차단 후 다시는 매칭되지 않는다', (await match(y)).status === 'waiting');
}

console.log('\n[32] ★ 자동 정지 — 서로 다른 신고자 3명');
{
	await resetPool();
	const t = await person('m', 'f');
	for (let i = 0; i < 3; i++) {
		const rp = await person('f', 'm');
		const r = await pairRoom(t, rp);
		await rpcAs(rp, 'report_partner', r, 'harassment', '');
		const st = (await one('select status from public.profiles where id = $1', [t])).status;
		if (i < 2) check(`신고 ${i + 1}건 — 아직 정상`, st === 'active');
		else check('3번째 신고자 → 자동 정지', st === 'suspended');
	}
	check('자동 정지가 감사 기록에 남는다', (await cnt(`select count(*)::int n from private.audit_log where action='auto_suspend' and target_user=$1`, [t])) === 1);
	check('정지된 사람은 매칭 불가', (await match(t)).status === 'not_eligible');

	const t2 = await person('m', 'f');
	const rp = await person('f', 'm');
	for (let i = 0; i < 3; i++) {
		const r = await pairRoom(t2, rp);
		await db.query('delete from private.reports where room_id = $1', [r]);
		await rpcAs(rp, 'report_partner', r, 'spam', '');
	}
	check('★ 같은 사람이 여러 번 신고해도 1명으로 센다 (보복성 신고 방지)', (await one('select status from public.profiles where id=$1', [t2])).status === 'active');
}

console.log('\n[33] 메시지 도배 제한 (토큰 버킷)');
{
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	const r = await pairRoom(x, y);
	let ok = 0;
	let limited = false;
	for (let i = 0; i < 14; i++) {
		try {
			await sendIn(x, r, 1, `도배 ${i}`);
			ok++;
		} catch (e) {
			limited = String(e.message).includes('rate_limited');
			break;
		}
	}
	check('순간 12개까지는 보낼 수 있다', ok === 12, `${ok}개`);
	check('13번째는 rate_limited', limited);
	check('상대는 영향받지 않는다', await sendIn(y, r, 2, '나는 보낼 수 있다').then(() => true, () => false));
	await db.query(`update public.user_presence set tokens_at = now() - interval '4 seconds' where user_id = $1`, [x]);
	check('잠시 뒤 다시 보낼 수 있다 (초당 1.5개 충전)', await sendIn(x, r, 1, '다시').then(() => true, () => false));

	const before = (await one('select msg_tokens from public.user_presence where user_id=$1', [y])).msg_tokens;
	await sendIn(A, r, 2, '끼어들기').catch(() => {});
	const after = (await one('select msg_tokens from public.user_presence where user_id=$1', [y])).msg_tokens;
	check('★ 제3자의 끼어들기 시도가 방 주인의 한도를 깎지 않는다', before === after);
}

console.log('\n[34] 넘기기 연타 제한');
{
	await resetPool();
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	await match(y);
	await db.query(`update public.user_presence set match_tokens = 0, match_at = now() where user_id = $1`, [x]);
	const r = await match(x);
	check('한도를 다 쓰면 cooldown + 대기 시간 안내', r.status === 'cooldown' && r.retry_after_ms > 0);
	const z = await person('m', 'f');
	check('쉬는 동안에도 상대(y)는 다른 사람과 매칭될 수 있다', (await match(z)).status === 'matched');
}

// ════════════════════════════════════════════════════════════════════
//  Phase 6 — 운영자 RPC
// ════════════════════════════════════════════════════════════════════
async function svc(fn, ...args) {
	const ph = args.map((_, i) => `$${i + 1}`).join(',');
	await db.exec('set role service_role');
	try {
		return (await db.query(`select public.${fn}(${ph}) r`, args)).rows[0].r;
	} finally {
		await db.exec('reset role');
	}
}

console.log('\n[35] ★ 운영자 함수는 service_role 만');
for (const fn of ['admin_stats()', 'admin_list_reports()', 'admin_audit()', 'admin_get_settings()']) {
	await expectError(`학생 계정으로 ${fn} 호출 불가`, () => rowsAs(A, `select public.${fn}`), 'permission denied');
}
await expectError('비로그인으로도 불가', () => rowsAs(null, 'select public.admin_stats()'), 'permission denied');
await expectError(
	'★ 학생이 스스로 정지를 풀 수 없다',
	() => rowsAs(A, `select public.admin_sanction($1, 'reinstate', null, $1, null, '')`, [A]),
	'permission denied'
);

console.log('\n[36] 운영자 기능');
{
	const staff = await person('m', 'f');
	check('운영진이 아니면 role 없음', (await svc('admin_staff_role', staff)) === null);
	await db.query(`insert into private.staff (user_id, role) values ($1, 'admin')`, [staff]);
	check('운영진 지정 후 role = admin', (await svc('admin_staff_role', staff)) === 'admin');

	const stats = await svc('admin_stats');
	check('현황 집계', typeof stats.open_reports === 'number' && 'seeking_now' in stats);

	const list = await svc('admin_list_reports', 'all', 100);
	check('신고 목록', Array.isArray(list) && list.length > 0);
	check('★ 신고 목록에 이메일이 없다', !JSON.stringify(list).includes('@'));

	const target = list.find((r) => r.reason === 'harassment' && r.evidence_count === 4);
	const det = await svc('admin_report', target.id);
	check('상세: 증거 대화 전문', det.evidence.length === 4);
	check('상세: 신고자의 신고 이력(허위 신고 판단용)', typeof det.reporter_filed === 'number');
	check('★ 상세에도 이메일이 없다 (신원은 별도 열람)', !JSON.stringify(det).includes('@'));

	await svc('admin_set_report', target.id, 'reviewing', '', staff);
	check('신고 상태 변경', (await one('select status from private.reports where id=$1', [target.id])).status === 'reviewing');

	const u = target.reported_id;
	const s1 = await svc('admin_sanction', u, 'suspend', 3, staff, target.id, '욕설');
	const days = (new Date(s1.suspended_until) - Date.now()) / 86400000;
	check('3일 정지', Math.abs(days - 3) < 0.01);
	check('정지 중에는 매칭 불가', (await match(u)).status === 'not_eligible');
	await svc('admin_sanction', u, 'reinstate', null, staff, target.id, '');
	check('해제하면 다시 매칭 가능', (await match(u)).status !== 'not_eligible');

	const b1 = await person('m', 'f');
	const b2 = await person('f', 'm');
	const r = await pairRoom(b1, b2);
	await svc('admin_sanction', b1, 'ban', null, staff, null, '');
	check('영구 정지', (await one('select status from public.profiles where id=$1', [b1])).status === 'banned');
	check('★ 정지 즉시 진행 중이던 대화가 닫힌다', (await roomRow(r)).close_reason === 'admin');
	await expectError('suspend 는 기간이 필요', () => svc('admin_sanction', b2, 'suspend', 0, staff, null, ''), 'days_required');

	await svc('admin_log_identity_view', staff, [u], target.id);
	const log = await svc('admin_audit', 50);
	check('★ 신원 열람이 감사 기록에 남는다', log.some((l) => l.action === 'view_identity' && l.staff_id === staff));
	check('조치들도 전부 기록된다', ['sanction_suspend', 'sanction_reinstate', 'sanction_ban', 'report_reviewing'].every((a) => log.some((l) => l.action === a)));

	const st = await svc('admin_update_settings', JSON.stringify({ notice: '점검 중', is_open: false }), staff);
	check('설정 변경 (공지·킬 스위치)', st.notice === '점검 중' && st.is_open === false);
	check('킬 스위치가 즉시 반영', (await match(b2)).status === 'service_closed');
	await svc('admin_update_settings', JSON.stringify({ notice: '', is_open: true }), staff);
	await expectError('범위를 벗어난 값은 DB 가 거부', () => svc('admin_update_settings', JSON.stringify({ room_minutes: 999 }), staff), 'check');
	check('알 수 없는 키는 무시된다', !('evil' in (await svc('admin_update_settings', JSON.stringify({ evil: 1 }), staff))));
}

// ════════════════════════════════════════════════════════════════════
//  Phase 8 — 고유 익명 이름 · 프로필 · 온라인 · 여러 대화
// ════════════════════════════════════════════════════════════════════
console.log('\n[37] 고유 익명 이름');
{
	const u = await signUp('nick-test@cnsa.hs.kr', true);
	const n = (await one('select nickname from public.profiles where id = $1', [u])).nickname;
	check('가입하면 익명 이름이 자동으로 붙는다', typeof n === 'string' && n.length >= 3);
	check(
		'모든 계정에 이름이 있다 (기존 계정 채우기 포함)',
		(await cnt('select count(*)::int n from public.profiles where nickname is null')) === 0
	);
	check(
		'이름은 겹치지 않는다',
		(await cnt('select count(*)::int n from (select nickname from public.profiles group by nickname having count(*) > 1) d')) === 0
	);
	// 이름 공간이 붐빌 때: 같은 후보만 나오게 만들어도 숫자를 붙여 가입이 성공한다
	await db.exec(`create or replace function private.nickname_candidate() returns text language sql volatile as $x$ select '고정이름' $x$`);
	const k1 = await signUp('crowd-1@cnsa.hs.kr', true);
	const k2 = await signUp('crowd-2@cnsa.hs.kr', true);
	const [n1, n2] = [
		(await one('select nickname from public.profiles where id = $1', [k1])).nickname,
		(await one('select nickname from public.profiles where id = $1', [k2])).nickname
	];
	check('★ 후보가 겹쳐도 가입이 실패하지 않고 서로 다른 이름을 받는다', n1 !== n2 && n1.startsWith('고정이름') && n2.startsWith('고정이름'), `${n1} / ${n2}`);
	await db.exec(readFileSync(SCHEMA, 'utf8')); // 원래 후보 함수로 되돌린다
	await openLegacy();

	check('★ 사용자는 이름(nickname)을 직접 바꿀 수 없다', !(await hasColPriv('nickname')));
	check('★ 소개글도 직접 update 로는 바꿀 수 없다 (검사 함수 경유만)', !(await hasColPriv('bio')));
}

console.log('\n[38] 프로필 수정');
{
	const u = await person('m', 'f');
	const up = (bio, tags, mbti) => rpcAs(u, 'update_my_profile', bio, tags, mbti);
	const r = await up('  밴드   음악 좋아해요 ', ['  기타 ', '독서', '기타', ''], 'enfp');
	check('소개글 공백 정리', r.bio === '밴드 음악 좋아해요');
	check('관심사: 공백·빈 값·중복 제거, 순서 유지', JSON.stringify(r.interests) === '["기타","독서"]');
	check('MBTI 는 대문자로 저장', r.mbti === 'ENFP');
	check(
		'자기 프로필에서 바로 읽힌다',
		(await rowsAs(u, 'select bio, mbti from public.profiles where id = $1', [u]))[0]?.mbti === 'ENFP'
	);
	await expectError('소개글 60자 초과 거절', () => up('가'.repeat(61), [], null), 'bio_too_long');
	await expectError('관심사 6개 거절', () => up('', ['a', 'b', 'c', 'd', 'e', 'f'], null), 'too_many_interests');
	await expectError('관심사 12자 초과 거절', () => up('', ['가'.repeat(13)], null), 'interest_too_long');
	await expectError('잘못된 MBTI 거절', () => up('', [], 'ABCD'), 'invalid_mbti');
	await expectError('★ 학번·전화번호 같은 긴 숫자 거절', () => up('20231234 연락줘', [], null), 'personal_info');
	await expectError('★ SNS 아이디(@) 거절', () => up('인스타 @hello', [], null), 'personal_info');
	await expectError('★ 관심사에 숨겨도 거절', () => up('', ['010-1234'], null), 'personal_info');
	const cleared = await up('', [], '');
	check('비우기 가능 (MBTI 빈 값 → 없음)', cleared.bio === '' && cleared.mbti === null);
	await expectError('비로그인은 수정 불가', () => rowsAs(null, `select public.update_my_profile('', '{}', null)`), 'permission denied');
}

console.log('\n[39] 비밀번호 설정 여부');
{
	const u = await person('m', 'f');
	check('처음엔 비밀번호 없음', (await rpcAs(u, 'my_account')).has_password === false);
	await db.query(`update auth.users set encrypted_password = 'hash' where id = $1`, [u]);
	check('비밀번호를 설정하면 true', (await rpcAs(u, 'my_account')).has_password === true);
	check('응답에 비밀번호 해시는 없다', !JSON.stringify(await rpcAs(u, 'my_account')).includes('hash'));
}

console.log('\n[40] 온라인 표시');
{
	await resetPool();
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	const r = await pairRoom(x, y);
	await db.query(`update public.user_presence set online_until = now() - interval '1 second' where user_id in ($1,$2)`, [x, y]);
	check('앱을 안 켠 상대는 오프라인', (await rpcAs(x, 'room_snapshot', r)).partner_online === false);
	await rpcAs(y, 'heartbeat', true);
	check('상대가 heartbeat 를 보내면 온라인', (await rpcAs(x, 'room_snapshot', r)).partner_online === true);
	check('대화 목록에도 온라인이 보인다', (await rpcAs(x, 'my_rooms')).rooms[0].partner_online === true);
	await rpcAs(y, 'heartbeat', false);
	check('앱을 내려놓으면 곧바로 오프라인', (await rpcAs(x, 'room_snapshot', r)).partner_online === false);
	await rpcAs(y, 'heartbeat', true);
	await match(y); // 찾기 폴링(짧은 TTL)이 heartbeat 가 잡은 긴 온라인 시각을 줄이지 않는다
	const until = (await one('select online_until > now() + interval \'30 seconds\' as ok from public.user_presence where user_id = $1', [y])).ok;
	check('찾기 폴링이 온라인 시각을 줄이지 않는다', until === true);
	await match(y);
	await rpcAs(y, 'heartbeat', false);
	check(
		'앱을 내려놓으면 찾기도 멈춘다',
		(await one('select seeking_until from public.user_presence where user_id = $1', [y])).seeking_until === null
	);
}

console.log('\n[41] 상대 프로필');
{
	await resetPool();
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	const z = await person('f', 'm');
	await rpcAs(y, 'update_my_profile', '고양이 키워요', ['고양이', '영화'], 'ISTJ');
	const r = await pairRoom(x, y);
	const p = await rpcAs(x, 'partner_profile', r);
	check('같은 방 상대의 기본 정보를 본다', p.bio === '고양이 키워요' && p.mbti === 'ISTJ' && p.interests.length === 2);
	check('상대 이름 = 상대의 고유 익명 이름', p.nickname === (await one('select nickname from public.profiles where id=$1', [y])).nickname);
	check('★ 응답에 uuid 가 없다', !JSON.stringify(p).includes(y) && !JSON.stringify(p).includes(x));
	check('★ 성별·선호·계정 상태는 보여주지 않는다', !('gender' in p) && !('want' in p) && !('status' in p));
	await expectError('★ 제3자는 그 방의 프로필을 볼 수 없다', () => rpcAs(z, 'partner_profile', r), 'not_member');
	await rpcAs(x, 'leave_room', r, false);
	check('대화가 끝난 뒤에도 (신고하려고) 볼 수 있다', (await rpcAs(x, 'partner_profile', r)).bio === '고양이 키워요');
	check(
		'★ 다른 사람의 프로필 행은 직접 읽히지 않는다',
		(await rowsAs(x, 'select bio from public.profiles where id = $1', [y])).length === 0
	);
}

console.log('\n[42] ★ 여러 대화 동시 진행');
{
	await resetPool();
	await db.query('update public.app_settings set max_open_rooms = 2');
	const x = await person('m', 'f');
	const y1 = await person('f', 'm');
	const y2 = await person('f', 'm');
	const y3 = await person('f', 'm');

	await match(y1);
	const a = await match(x);
	check('첫 번째 대화 매칭', a.status === 'matched');
	await rpcAs(x, 'ack_room', a.room_id);
	await rpcAs(y1, 'ack_room', a.room_id);

	await match(y2);
	const b = await match(x);
	check('★ 대화 중에도 새 상대를 찾아 두 번째 대화를 연다', b.status === 'matched' && b.room_id !== a.room_id);
	await rpcAs(x, 'ack_room', b.room_id);

	const list = await rpcAs(x, 'my_rooms');
	check('대화 목록에 두 대화가 모두 있다', list.rooms.length === 2);
	check('★ 대화 목록에 uuid 는 room_id 뿐', ![x, y1, y2].some((u) => JSON.stringify(list).includes(u)));

	await match(y3);
	const c = await match(x);
	check('★ 동시 대화 상한(2)에 닿으면 full — 더 찾지 않는다', c.status === 'full' && c.max === 2);
	check(
		'full 이면 찾기 목록에서 빠진다',
		(await one('select seeking_until from public.user_presence where user_id = $1', [x])).seeking_until === null
	);

	// 상대 쪽 상한도 지킨다
	await db.query('update public.app_settings set max_open_rooms = 1');
	await match(x); // x 는 이미 2개 — full
	const d = await match(y3);
	check('★ 상한이 찬 사람은 다른 사람에게도 잡히지 않는다', d.status === 'waiting');
	await db.query('update public.app_settings set max_open_rooms = 5');

	// 같은 사람과 두 대화는 열리지 않는다 — 재매칭 쿨다운 기록이 없어도
	await resetPool();
	const p = await person('m', 'f');
	const q = await person('f', 'm');
	await match(p);
	const first = await match(q);
	await rpcAs(p, 'ack_room', first.room_id);
	await rpcAs(q, 'ack_room', first.room_id);
	await db.query('delete from public.pair_history'); // 쿨다운이 아니라 '열린 대화' 조건만 본다
	await match(p);
	const second = await match(q);
	check('★ 이미 대화가 열린 상대와는 또 매칭되지 않는다', first.status === 'matched' && second.status === 'waiting', second.status);

	// 안 읽은 메시지 수 (q 가 보낸 것을 p 가 본다)
	const qSeat = (await rpcAs(q, 'room_snapshot', first.room_id)).my_seat;
	await sendIn(q, first.room_id, qSeat, '안녕');
	await sendIn(q, first.room_id, qSeat, '뭐해');
	const pl = (await rpcAs(p, 'my_rooms')).rooms.find((r) => r.room_id === first.room_id);
	check('대화 목록: 안 읽은 메시지 수', pl.unread === 2, JSON.stringify(pl));
	check('대화 목록: 마지막 메시지 미리보기', pl.last_body === '뭐해' && pl.last_seat === qSeat);
	const last = (await one('select max(id)::int m from public.messages where room_id = $1', [first.room_id])).m;
	await rpcAs(p, 'mark_read', first.room_id, last);
	check('읽으면 0', (await rpcAs(p, 'my_rooms')).rooms.find((r) => r.room_id === first.room_id).unread === 0);

	await db.query(`update public.rooms set expires_at = now() - interval '1 second' where id = $1`, [first.room_id]);
	check('시간이 지난 대화는 목록에서 빠진다', !(await rpcAs(p, 'my_rooms')).rooms.some((r) => r.room_id === first.room_id));
}

// ════════════════════════════════════════════════════════════════════
//  Phase 9 — 푸시 알림
// ════════════════════════════════════════════════════════════════════
console.log('\n[43] 푸시 구독');
{
	const u = await person('m', 'f');
	const v = await person('f', 'm');
	const P256 = 'B' + 'x'.repeat(86); // base64url 65바이트 = 87자
	const AUTH = 'a'.repeat(22);
	await rpcAs(u, 'save_push_subscription', 'https://fcm.googleapis.com/fcm/send/u1', P256, AUTH);
	check('내 기기를 알림 대상으로 저장', (await cnt('select count(*)::int n from public.push_subscriptions where user_id = $1', [u])) === 1);
	await expectError('https 가 아닌 주소 거절', () => rpcAs(u, 'save_push_subscription', 'http://x', P256, AUTH), 'invalid_subscription');
	await expectError('키 길이가 이상하면 거절', () => rpcAs(u, 'save_push_subscription', 'https://fcm.googleapis.com/fcm/send/z', 'short', AUTH), 'invalid_subscription');
	await expectError('★ 알려진 푸시 서버가 아닌 주소는 거절 (서버가 아무 데나 요청을 보내지 않게)', () => rpcAs(u, 'save_push_subscription', 'https://evil.example/hook', P256, AUTH), 'invalid_subscription');
	await expectError('비슷하게 꾸민 주소도 거절', () => rpcAs(u, 'save_push_subscription', 'https://fcm.googleapis.com.evil.example/x', P256, AUTH), 'invalid_subscription');
	await rpcAs(u, 'save_push_subscription', 'https://updates.push.services.mozilla.com/wpush/v2/abc', P256, AUTH);
	await rpcAs(u, 'save_push_subscription', 'https://wns2-sg2p.notify.windows.com/w/?token=abc', P256, AUTH);
	check('파이어폭스 · 엣지 푸시 주소는 받는다', (await cnt('select count(*)::int n from public.push_subscriptions where user_id = $1', [u])) === 3);
	for (let i = 0; i < 12; i++) await rpcAs(u, 'save_push_subscription', `https://fcm.googleapis.com/fcm/send/many${i}`, P256, AUTH);
	check('★ 한 사람 기기는 10대까지 — 넘으면 오래된 것부터 지운다', (await cnt('select count(*)::int n from public.push_subscriptions where user_id = $1', [u])) === 10
		&& (await cnt(`select count(*)::int n from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/many11'`)) === 1);
	await db.query(`delete from public.push_subscriptions where user_id = $1 and endpoint like '%many%'`, [u]);
	await expectError('★ 구독 목록은 누구도 직접 읽지 못한다 (기기 주소·키)', () => rowsAs(u, 'select * from public.push_subscriptions'), 'permission denied');

	await rpcAs(v, 'save_push_subscription', 'https://fcm.googleapis.com/fcm/send/u1', P256, AUTH);
	check(
		'같은 기기에서 다른 계정으로 로그인하면 주인이 바뀐다 (이전 계정 알림이 오지 않게)',
		(await one('select user_id from public.push_subscriptions where endpoint = $1', ['https://fcm.googleapis.com/fcm/send/u1'])).user_id === v
	);
	await rpcAs(u, 'delete_push_subscription', 'https://fcm.googleapis.com/fcm/send/u1');
	check('★ 남의 구독은 지울 수 없다', (await cnt('select count(*)::int n from public.push_subscriptions where endpoint = $1', ['https://fcm.googleapis.com/fcm/send/u1'])) === 1);
	await rpcAs(v, 'delete_push_subscription', 'https://fcm.googleapis.com/fcm/send/u1');
	check('내 구독은 지울 수 있다 (알림 끄기·로그아웃)', (await cnt('select count(*)::int n from public.push_subscriptions where endpoint = $1', ['https://fcm.googleapis.com/fcm/send/u1'])) === 0);
}

console.log('\n[44] ★ 푸시 발송 판단');
{
	await resetPool();
	const s = await person('m', 'f');
	const t = await person('f', 'm');
	const z = await person('f', 'm');
	const P256 = 'B' + 'x'.repeat(86);
	await rpcAs(t, 'save_push_subscription', 'https://web.push.apple.com/t1', P256, 'a'.repeat(22));
	const r = await pairRoom(s, t);
	const sSeat = (await rpcAs(s, 'room_snapshot', r)).my_seat;
	await db.query(`update public.user_presence set online_until = now() - interval '1 second' where user_id in ($1,$2)`, [s, t]);
	await sendIn(s, r, sSeat, '자니?');
	const mid = (await one('select max(id)::int m from public.messages where room_id = $1', [r])).m;

	await expectError('★ 학생 계정은 발송 판단 함수를 부를 수 없다', () => rowsAs(s, 'select public.push_payload(1, $1)', [s]), 'permission denied');
	check('★ 보낸 사람이 아니면 발송하지 않는다 (남의 메시지로 알림 위조 불가)', (await svc('push_payload', mid, z)).skip === 'not_sender');
	check('받는 사람 쪽에서 요청해도 발송하지 않는다', (await svc('push_payload', mid, t)).skip === 'not_sender');

	const p = await svc('push_payload', mid, s);
	check('받는 사람 기기로 보낼 내용이 나온다', p.subs?.length === 1 && p.body === '자니?' && p.room_id === r);
	check('제목 = 보낸 사람의 익명 이름', p.title === (await one('select nickname from public.profiles where id = $1', [s])).nickname);
	check('★ 알림 내용에 사용자 uuid 가 없다', ![s, t].some((x) => JSON.stringify({ title: p.title, body: p.body, room_id: p.room_id }).includes(x)));
	check('★ 같은 메시지로 두 번 보내지 않는다', (await svc('push_payload', mid, s)).skip === 'already');

	await rpcAs(t, 'heartbeat', true);
	await sendIn(s, r, sSeat, '아 보고 있구나');
	const mid2 = (await one('select max(id)::int m from public.messages where room_id = $1', [r])).m;
	const p2 = await svc('push_payload', mid2, s);
	check('★ 앱이 켜져 있어도 그 대화 화면이 아니면 보낸다 (앱 안 알림으로 뜬다, Phase 35)', p2.subs?.length === 1 && Number(p2.id) === Number(mid2) && !!p2.at, JSON.stringify(p2));
	await rpcAs(t, 'room_view', r, true);
	await sendIn(s, r, sSeat, '이제 보고 있네');
	const mid2b = (await one('select max(id)::int m from public.messages where room_id = $1', [r])).m;
	check('★ 받는 사람이 그 대화 화면을 보고 있으면 보내지 않는다', (await svc('push_payload', mid2b, s)).skip === 'viewing');
	await rpcAs(t, 'room_view', r, false);

	await rpcAs(t, 'heartbeat', false);
	await sendIn(s, r, sSeat, '긴 메시지 '.repeat(40));
	const mid3 = (await one('select max(id)::int m from public.messages where room_id = $1', [r])).m;
	check('알림 본문은 120자로 자른다', (await svc('push_payload', mid3, s)).body.length === 120);

	await db.query(`update public.messages set created_at = now() - interval '11 minutes' where id = $1`, [mid3]);
	await db.query(`delete from private.push_log where message_id = $1`, [mid3]);
	check('오래된 메시지로는 보내지 않는다', (await svc('push_payload', mid3, s)).skip === 'stale');

	await svc('push_prune', ['https://web.push.apple.com/t1']);
	await sendIn(s, r, sSeat, '또');
	const mid4 = (await one('select max(id)::int m from public.messages where room_id = $1', [r])).m;
	check('사라진 기기를 지우면 보낼 곳이 없다', (await svc('push_payload', mid4, s)).skip === 'no_device');
	await rpcAs(s, 'leave_room', r, false);
	check('닫힌 대화로는 보내지 않는다', (await svc('push_payload', mid4, s)).skip === 'closed');
}

// ════════════════════════════════════════════════════════════════════
//  Phase 11 — 관리자 권한 확장
// ════════════════════════════════════════════════════════════════════
const audits = async (action, staff) =>
	cnt('select count(*)::int n from private.audit_log where action = $1 and staff_id = $2', [action, staff]);

console.log('\n[53] ★ 역할 분리 — 운영진 vs 관리자');
{
	const adm = await person('m', 'f');
	const mod = await person('f', 'm');
	const outsider = await person('m', 'f');
	await db.query(`insert into private.staff (user_id, role) values ($1, 'admin'), ($2, 'moderator')`, [adm, mod]);
	const u = await person('m', 'f');

	for (const fn of ['admin_find_users(null, null, null, 10)', `admin_user('${u}', '${u}')`,
		`admin_rooms('all', '${u}', 10)`, `admin_room('${u}', '${u}')`, `admin_user_rooms('${u}', '${u}')`]) {
		await expectError(`★ 학생 계정으로 ${fn.split('(')[0]} 호출 불가`, () => rowsAs(u, `select public.${fn}`), 'permission denied');
	}
	await expectError('★ 운영진 명단에 없으면 service_role 이라도 거절', () => svc('admin_user', u, outsider), 'not_staff');
	await expectError('★ 명단에 없는 사람 이름으로 제재 불가', () => svc('admin_sanction', u, 'warn', null, outsider, null, ''), 'not_staff');

	check('운영진: 경고 가능', (await svc('admin_sanction', u, 'warn', null, mod, null, '')).strikes >= 1);
	check('운영진: 7일 정지 가능', !!(await svc('admin_sanction', u, 'suspend', 7, mod, null, '')).suspended_until);
	await expectError('★ 운영진: 8일 이상 정지 불가', () => svc('admin_sanction', u, 'suspend', 8, mod, null, ''), 'mod_days_limit');
	await expectError('★ 운영진: 영구 정지 불가', () => svc('admin_sanction', u, 'ban', null, mod, null, ''), 'admin_only');
	await svc('admin_sanction', u, 'ban', null, adm, null, '');
	check('관리자: 영구 정지 가능', (await one('select status from public.profiles where id=$1', [u])).status === 'banned');
	await expectError('★ 운영진: 영구정지 해제 불가', () => svc('admin_sanction', u, 'reinstate', null, mod, null, ''), 'admin_only');
	await expectError('★ 운영진: 다른 운영진 제재 불가', () => svc('admin_sanction', adm, 'warn', null, mod, null, ''), 'admin_only');
	await svc('admin_sanction', u, 'reinstate', null, adm, null, '');
	check('관리자: 해제 가능', (await one('select status from public.profiles where id=$1', [u])).status === 'active');

	await expectError('★ 운영진: 이메일 열람 불가', () => svc('admin_log_identity_view', mod, [u], null), 'admin_only');
	await expectError('★ 운영진: 이메일 검색 불가', () => svc('admin_find_users', '@cnsa', 'all', mod, 10), 'admin_only');
	for (const [fn, args] of [['admin_rooms', ['all', mod, 10]], ['admin_room', [u, mod]], ['admin_user_rooms', [u, mod]]]) {
		await expectError(`★ 운영진: ${fn} 불가 (관리자 전용)`, () => svc(fn, ...args), 'admin_only');
	}
	check('운영진: 사용자 상세는 볼 수 있다', (await svc('admin_user', u, mod)).profile.id === u);
}

console.log('\n[54] 사용자 검색 · 상세');
{
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const u = await person('f', 'm');
	const nick = (await one('select nickname from public.profiles where id = $1', [u])).nickname;
	const byNick = await svc('admin_find_users', nick, 'all', adm, 50);
	check('익명 이름으로 검색', byNick.some((x) => x.id === u));
	check('ID 앞자리로 검색', (await svc('admin_find_users', u.slice(0, 8), 'all', adm, 50)).some((x) => x.id === u));
	check('★ 검색 결과에 이메일이 없다', !JSON.stringify(byNick).includes('@'));
	const before = await audits('search_email', adm);
	const email = await emailOf(u);
	check('관리자: 이메일로 검색', (await svc('admin_find_users', email, 'all', adm, 50)).some((x) => x.id === u));
	check('★ 이메일 검색은 기록된다', (await audits('search_email', adm)) === before + 1);
	check('필터: 운영진', (await svc('admin_find_users', '', 'staff', adm, 200)).every((x) => x.staff_role));
	await svc('admin_sanction', u, 'suspend', 2, adm, null, '테스트');
	check('필터: 이용 제한', (await svc('admin_find_users', '', 'restricted', adm, 200)).some((x) => x.id === u));

	const d = await svc('admin_user', u, adm);
	check('상세: 프로필 · 활동 수 · 제재 이력', d.profile.nickname === nick && typeof d.counts.rooms === 'number' &&
		d.history.some((h) => h.action === 'sanction_suspend'));
	check('★ 상세에 이메일이 없다', !JSON.stringify(d).includes('@'));
	check('없는 사용자는 null', (await svc('admin_user', '00000000-0000-0000-0000-000000000000', adm)) === null);
}

console.log('\n[55] ★ 관리자 열람 — 대화 (전부 기록)');
{
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const x = await person('m', 'f');
	const y = await person('f', 'm');
	const r = await pairRoom(x, y);
	await sendIn(x, r, 1, '안녕');
	await sendIn(y, r, 2, '반가워');

	const list = await svc('admin_rooms', 'live', adm, 300);
	const item = list.find((z) => z.id === r);
	check('진행 중 대화 목록', !!item && item.live === true && item.message_count === 2);
	check('목록에는 두 사람 계정이 나온다', item.members.map((m) => m.user_id).sort().join() === [x, y].sort().join());
	const mine = await svc('admin_user_rooms', x, adm);
	check('한 사람의 대화 목록 + 상대', mine.some((z) => z.id === r && z.partner_id === y));

	const before = await audits('view_room', adm);
	const room = await svc('admin_room', r, adm);
	check('대화 내용 열람', room.messages.filter((m) => m.seat > 0).map((m) => m.body).join() === '안녕,반가워');
	check('누가 어느 자리인지', room.members.find((m) => m.seat === 1).user_id === x);
	check('★ 대화 열람은 열 때마다 기록된다', (await audits('view_room', adm)) === before + 1);

}

console.log('\n[56] ★ 학번-이름 명렬표 — 이메일 확인 옆 이름 표시');
{
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	const u = await signUp('10101@cnsa.hs.kr', true);

	await expectError('★ 학생 계정으로 admin_roster_import 호출 불가', () => rowsAs(u, `select public.admin_roster_import(1::smallint, '[]'::jsonb)`), 'permission denied');
	await expectError('★ 학생 계정으로 admin_roster_name 호출 불가', () => rowsAs(u, `select public.admin_roster_name('${u}', '10101@cnsa.hs.kr')`), 'permission denied');

	const n = await svc('admin_roster_import', 1, JSON.stringify([{ no: 10101, name: '테스트생' }, { no: 10102, name: '둘째' }]));
	check('명렬표 반영 개수', n === 2);
	check('명렬표 반영은 활동 기록에 남는다 (staff_id 없이)', (await cnt(`select count(*)::int n from private.audit_log where action = 'roster_import'`)) >= 1);

	check('이메일 앞자리(학번)로 이름 찾기', (await svc('admin_roster_name', adm, '10101@cnsa.hs.kr')) === '테스트생');
	check('명단에 없는 학번은 null', (await svc('admin_roster_name', adm, '99999@cnsa.hs.kr')) === null);
	check('학번 형태가 아닌 이메일도 null (에러 아님)', (await svc('admin_roster_name', adm, 'p1-m@cnsa.hs.kr')) === null);
	check('이메일이 없어도(탈퇴 등) null', (await svc('admin_roster_name', adm, null)) === null);
	await expectError('★ 운영진은 이름 조회 불가 (관리자 전용)', () => svc('admin_roster_name', mod, '10101@cnsa.hs.kr'), 'admin_only');

	check('같은 학번 재반입 → 이름 갱신', (await svc('admin_roster_import', 1, JSON.stringify([{ no: 10101, name: '정정된이름' }]))) === 1);
	check('갱신된 이름이 바로 반영된다', (await svc('admin_roster_name', adm, '10101@cnsa.hs.kr')) === '정정된이름');
	check('학번이 너무 길어도 오류 없이 null', (await svc('admin_roster_name', adm, '12345678901234@cnsa.hs.kr')) === null);

	// 운영자 화면의 익명 이름 옆 "(학번 이름)"
	const noName = await signUp('20999@cnsa.hs.kr', true); // 명단에 없는 학번
	const plain = await person('m', 'f'); // 학번 형태가 아닌 이메일
	await expectError('★ 학생 계정으로 admin_student_labels 호출 불가',
		() => rowsAs(u, `select public.admin_student_labels('${u}', array['${u}']::uuid[])`), 'permission denied');
	await expectError('★ 운영진은 학번·이름 목록 불가 (관리자 전용)', () => svc('admin_student_labels', mod, [u]), 'admin_only');
	const before = await audits('view_identity', adm);
	const labels = await svc('admin_student_labels', adm, [u, noName, plain]);
	check('학번 + 이름', labels[u] === '10101 정정된이름', JSON.stringify(labels));
	check('명단에 없는 학번은 학번만', labels[noName] === '20999', JSON.stringify(labels));
	check('학번 형태가 아닌 이메일은 빠진다', !(plain in labels));
	check('★ 학번·이름 목록도 활동 기록에 남는다', (await audits('view_identity', adm)) === before + 1);
	check('빈 목록은 기록 없이 빈 객체', JSON.stringify(await svc('admin_student_labels', adm, [])) === '{}' &&
		(await audits('view_identity', adm)) === before + 1);
}

console.log('\n[57] 실시간 현황 — 접속 중 · 매칭 대기 · 대화 중 · 오프라인');
{
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	await resetPool();
	const off = await person('m', 'f');
	const on = await person('f', 'm');
	const seek = await person('m', 'f');
	const c1 = await person('m', 'f');
	const c2 = await person('f', 'm');
	await db.query(`update public.user_presence set online_until = now() - interval '5 minutes' where user_id = $1`, [off]);
	await db.query(`insert into public.user_presence (user_id, online_until) values ($1, now() + interval '1 minute')
	                on conflict (user_id) do update set online_until = excluded.online_until`, [on]);
	await db.query(`insert into public.user_presence (user_id, online_until, seeking_until, seeking_since)
	                values ($1, now() + interval '1 minute', now() + interval '1 minute', now())
	                on conflict (user_id) do update set online_until = excluded.online_until,
	                  seeking_until = excluded.seeking_until, seeking_since = excluded.seeking_since`, [seek]);
	const room = await pairRoom(c1, c2);

	await expectError('★ 학생 계정으로 admin_live_users 호출 불가', () => rowsAs(off, `select public.admin_live_users('${off}')`), 'permission denied');
	await expectError('★ 운영진 명단에 없으면 거절', () => svc('admin_live_users', off), 'not_staff');

	const list = await svc('admin_live_users', adm);
	const by = (id) => list.find((x) => x.id === id);
	check('전체 사용자가 나온다', [off, on, seek, c1, c2].every((id) => by(id)));
	check('오프라인: online=false, 마지막 접속 시각 있음', by(off).online === false && !!by(off).last_seen && by(off).room_count === 0);
	check('접속 중', by(on).online === true && !by(on).seeking && by(on).room_count === 0);
	check('매칭 대기', by(seek).seeking === true);
	check('대화 중: 살아 있는 방 1개 + 관리자에게는 방 id', by(c1).room_count === 1 && by(c1).rooms?.[0] === room);
	check('★ 이메일은 들어 있지 않다', !JSON.stringify(list).includes('@'));

	const ml = await svc('admin_live_users', mod);
	const mc1 = ml.find((x) => x.id === c1);
	check('★ 운영진: 대화 중 개수는 보이지만 어느 방인지는 없다', mc1.room_count === 1 && mc1.rooms === null);

	await db.query(`update public.rooms set status = 'closed', closed_at = now() where id = $1`, [room]);
	await db.query(`update public.room_members set open = false where room_id = $1`, [room]);
	check('방이 닫히면 대화 중이 아니다', (await svc('admin_live_users', adm)).find((x) => x.id === c1).room_count === 0);
}

console.log('\n[58] ★ 편지 서식 — 정해진 종류·색·범위만');
{
	const ok = async (body, f) => (await one('select private.letter_fmt_ok($1::jsonb, $2) a', [f === null ? null : JSON.stringify(f), body])).a;
	const fmt = { m: [[0, 5, 'b'], [0, 5, 'h:yellow'], [6, 11, 'u'], [6, 11, 's'], [6, 11, 'c:blue'], [6, 11, 'z:lg']], a: [[1, 'center']] };
	check('정해진 종류 · 색 · 크기 · 정렬은 통과', (await ok('hello\nworld', fmt)) === true);
	check('서식이 없으면(null) 통과', (await ok('서식 없는 편지', null)) === true);
	check('위치는 글자(code point) 단위 — 이모지도 한 글자', (await ok('😀ab', { m: [[1, 3, 'b']] })) === true);

	const bad = [
		['모르는 종류', { m: [[0, 1, 'x']] }],
		['목록에 없는 형광펜 색', { m: [[0, 1, 'h:red']] }],
		['★ 색 대신 CSS 값 끼워 넣기', { m: [[0, 1, 'c:red;background:url(//evil)']] }],
		['★ 크기 대신 임의 값', { m: [[0, 1, 'z:999px']] }],
		['본문보다 긴 범위', { m: [[0, 99, 'b']] }],
		['시작 >= 끝', { m: [[3, 3, 'b']] }],
		['음수 위치', { m: [[-1, 2, 'b']] }],
		['소수 위치', { m: [[0.5, 2, 'b']] }],
		['문자열 위치', { m: [['0', '2', 'b']] }],
		['원소 개수가 틀림', { m: [[0, 2]] }],
		['모르는 최상위 키', { m: [], x: 1 }],
		['없는 줄 정렬', { a: [[5, 'center']] }],
		['정렬 값이 목록에 없음', { a: [[0, 'justify']] }],
		['서식이 배열', [[0, 1, 'b']]],
		['범위가 너무 많음', { m: Array.from({ length: 501 }, () => [0, 1, 'b']) }]
	];
	for (const [name, f] of bad) check(`★ 거절: ${name}`, (await ok('hello\nworld', f)) === false);
}

console.log('\n[60] ★ 운영자 RPC 역할 점검 — DB 에서도 막는다');
{
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	const outsider = await person('m', 'f');

	await expectError('★ 운영진: 운영 수치 변경 불가', () => svc('admin_update_settings', JSON.stringify({ room_minutes: 12 }), mod), 'admin_only');
	await expectError('★ 운영진: 공지 변경 불가', () => svc('admin_update_settings', JSON.stringify({ notice: 'x' }), mod), 'admin_only');
	check('운영진: 서비스 열고 닫기는 가능', (await svc('admin_update_settings', JSON.stringify({ is_open: false }), mod)).is_open === false);
	await svc('admin_update_settings', JSON.stringify({ is_open: true }), mod);
	await expectError('★ 명단에 없으면 설정 변경 불가', () => svc('admin_update_settings', JSON.stringify({ is_open: false }), outsider), 'not_staff');
	check('관리자: 운영 수치 변경 가능', (await svc('admin_update_settings', JSON.stringify({ room_minutes: 10 }), adm)).room_minutes === 10);

	const rep = (await one(`select id from private.reports order by created_at desc limit 1`))?.id;
	if (rep) await expectError('★ 명단에 없으면 채팅 신고 처리 불가', () => svc('admin_set_report', rep, 'reviewing', '', outsider), 'not_staff');

	const gone = await person('f', 'm');
	await db.query(`delete from public.profiles where id = $1`, [gone]);
	await expectError('탈퇴한 계정 제재는 "조치 완료"가 아니라 오류', () => svc('admin_sanction', gone, 'warn', null, adm, null, ''), 'user_not_found');
}

console.log('\n[61] ★ 공지사항 — 관리자만 올리고, 학생은 어디까지 봤는지 계정에 남는다');
{
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	const st = await person('m', 'f');
	const st2 = await person('f', 'm');

	const empty = await rpcAs(st, 'my_notices');
	check('처음: 공지 없음 · 본 번호 0', empty.notices.length === 0 && Number(empty.last_seen) === 0, JSON.stringify(empty));
	check('없는데 봤다고 해도 0', Number(await rpcAs(st, 'mark_notices_seen', 999)) === 0);

	await expectError('★ 운영진은 공지를 못 올린다', () => svc('admin_post_notice', mod, '제목', ''), 'admin_only');
	await expectError('★ 명단 밖은 공지를 못 올린다', () => svc('admin_post_notice', st, '제목', ''), 'not_staff');
	await expectError('빈 제목은 안 된다', () => svc('admin_post_notice', adm, '   ', ''), 'check');
	const n1 = Number(await svc('admin_post_notice', adm, ' 첫 공지 ', '내용 1'));
	const n2 = Number(await svc('admin_post_notice', adm, '둘째 공지', ''));
	check('운영진도 목록은 본다', (await svc('admin_notices', mod)).length === 2);

	const a = await rpcAs(st, 'my_notices');
	check('학생: 최신순 · 제목 앞뒤 공백 정리', a.notices.map((n) => Number(n.id)).join() === `${n2},${n1}` && a.notices[1].title === '첫 공지');
	check('★ 학생에게 올린 사람 uuid 는 안 보인다', !JSON.stringify(a).includes(adm));
	check('아직 안 봤다 (빨간 점)', Number(a.last_seen) < n2);

	check('봤다 → 최신 번호까지', Number(await rpcAs(st, 'mark_notices_seen', n2)) === n2);
	check('뒤로 가지 않는다', Number(await rpcAs(st, 'mark_notices_seen', n1)) === n2);
	check('없는 번호로 앞질러 가지 않는다', Number(await rpcAs(st, 'mark_notices_seen', n2 + 100)) === n2);
	check('다른 학생은 따로', Number((await rpcAs(st2, 'my_notices')).last_seen) === 0);

	const n3 = Number(await svc('admin_post_notice', adm, '셋째 공지', '새 소식'));
	const b = await rpcAs(st, 'my_notices');
	check('새 공지가 오면 다시 빨간 점', Number(b.notices[0].id) === n3 && Number(b.last_seen) === n2);

	await svc('admin_remove_notice', adm, n3);
	check('내린 공지는 학생에게 안 보인다', !(await rpcAs(st, 'my_notices')).notices.some((n) => Number(n.id) === n3));
	await expectError('이미 내린 공지는 다시 못 내린다', () => svc('admin_remove_notice', adm, n3), 'notice_not_found');
	await expectError('★ 운영진은 공지를 못 내린다', () => svc('admin_remove_notice', mod, n2), 'admin_only');
	const log = (await db.query(`select action, detail from private.audit_log where action in ('post_notice', 'remove_notice') order by id`)).rows;
	check('올리고 내린 것이 활동 기록에', log.filter((l) => l.action === 'post_notice').length === 3 && log.some((l) => l.action === 'remove_notice' && l.detail.title === '셋째 공지'));

	await expectError('★ 학생은 공지 표를 직접 못 읽는다', () => rowsAs(st, 'select * from private.notices'), 'permission denied');
	await expectError('★ 학생은 공지를 직접 못 올린다', () => rpcAs(st, 'admin_post_notice', st, 'x', ''), 'permission denied');
	await expectError('로그인 없이 공지 목록 불가', () => rpcAs(null, 'my_notices'), 'permission denied');
}

console.log('\n[62] ★ 메시지 공감 — 자리(seat)로만, 대화 중에만, 같은 방 두 사람만');
{
	const r = await fresh();
	const seatA = Number(await rpcAs(A, 'my_seat', r));
	const seatB = Number(await rpcAs(B, 'my_seat', r));
	const say = async (uid, room, seat, body) =>
		(await rowsAs(uid, `insert into public.messages (room_id, sender_seat, body, client_msg_id)
		                    values ($1, $2, $3, gen_random_uuid()) returning id`, [room, seat, body]))[0].id;
	const m1 = await say(A, r, seatA, '안녕');
	const react = (uid, msg, emoji) => rpcAs(uid, 'react_message', msg, emoji);
	const rows = (uid) => rowsAs(uid, `select message_id, seat, emoji from public.message_reactions where room_id = $1 and emoji is not null order by seat`, [r]);

	const a = await react(B, m1, 'heart');
	check('상대 메시지에 공감', a.status === 'ok' && Number(a.seat) === seatB && a.emoji === 'heart', JSON.stringify(a));
	check('내 메시지에도 공감할 수 있다', (await react(A, m1, 'laugh')).status === 'ok');
	const seen = await rows(A);
	check('두 사람 모두 보인다 (자리마다 하나)', seen.length === 2 && seen.map((x) => x.emoji).join() === (seatA < seatB ? 'laugh,heart' : 'heart,laugh'), JSON.stringify(seen));
	check('★ 공감 표에 사용자 식별자 없음 (자리만)',
		(await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'message_reactions'`)).rows
			.every((c) => !/user|profile|email/.test(c.column_name)));

	check('다른 공감으로 바꾸기', (await react(B, m1, 'fire')).emoji === 'fire' && (await rows(B)).find((x) => Number(x.seat) === seatB).emoji === 'fire');
	check('취소 (null)', (await react(B, m1, null)).status === 'ok' && !(await rows(A)).some((x) => Number(x.seat) === seatB));
	check('없는 공감 종류는 거절', (await react(B, m1, 'angry')).status === 'bad_emoji');
	await expectError('DB 에서도 정해진 종류만', () => db.query(`insert into public.message_reactions (message_id, room_id, seat, emoji) values ($1, $2, 1, 'poop')`, [m1, r]), 'check');

	const sys = (await one(`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, 0, '안내', gen_random_uuid()) returning id`, [r])).id;
	check('시스템 안내에는 공감 불가', (await react(A, sys, 'heart')).status === 'system');

	const outsider = await person('m', 'f');
	check('★ 다른 방 사람은 공감 불가 (있는지도 모름)', (await react(outsider, m1, 'heart')).status === 'not_found');
	check('★ 다른 방 사람에게는 공감이 안 보인다',
		(await rowsAs(outsider, `select * from public.message_reactions where room_id = $1`, [r])).length === 0);
	check('없는 메시지', (await react(A, 99999999, 'heart')).status === 'not_found');
	await expectError('★ 학생이 표에 직접 쓰기 불가',
		() => rowsAs(A, `insert into public.message_reactions (message_id, room_id, seat, emoji) values ($1, $2, $3, 'heart')`, [m1, r, seatA]), 'permission denied');
	await expectError('★ 상대 자리로 위조 불가 (직접 수정 불가)',
		() => rowsAs(A, `update public.message_reactions set emoji = 'sad' where message_id = $1`, [m1]), 'permission denied');

	await setExpiry(r, -1);
	check('★ 시간이 끝난 방에는 공감 불가', (await react(B, m1, 'heart')).status === 'closed');
	await db.query(`update public.rooms set status = 'closed', closed_at = now() where id = $1`, [r]);
	check('닫힌 방의 공감은 안 보인다 (메시지처럼)', (await rows(A)).length === 0);
	await db.query(`delete from public.messages where id = $1`, [m1]);
	check('메시지가 지워지면 공감도 같이', (await one(`select count(*)::int n from public.message_reactions where message_id = $1`, [m1])).n === 0);

	const r2 = await fresh();
	const m2 = await say(A, r2, Number(await rpcAs(A, 'my_seat', r2)), '관리자 열람용');
	await react(B, m2, 'wow');
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const view = await svc('admin_room', r2, adm);
	const vm = view.messages.find((m) => Number(m.id) === Number(m2));
	check('관리자 대화 열람에 공감 표시 (자리별)', vm?.reactions?.[String(seatB)] === 'wow', JSON.stringify(vm));
}

console.log('\n[63] ★ 공감 푸시 — 상대 메시지에, 한 번만, 앱을 안 보고 있을 때만');
{
	const r = await fresh();
	const seatA = Number(await rpcAs(A, 'my_seat', r));
	const seatB = Number(await rpcAs(B, 'my_seat', r));
	const say = async (uid, seat, body) =>
		(await rowsAs(uid, `insert into public.messages (room_id, sender_seat, body, client_msg_id)
		                    values ($1, $2, $3, gen_random_uuid()) returning id`, [r, seat, body]))[0].id;
	const mA = await say(A, seatA, '실리카겔 좋아하세요?');
	await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/a', 'k', 'x')
	                on conflict do nothing`, [A]);
	await db.query(`update public.user_presence set online_until = now() - interval '1 minute' where user_id = $1`, [A]);
	const pay = (actor, msg) => svc('reaction_push_payload', msg, actor);

	check('공감 전에는 보낼 것 없음', (await pay(B, mA)).skip === 'no_reaction');
	await rpcAs(B, 'react_message', mA, 'heart');
	const p = await pay(B, mA);
	const aliasB = (await rpcAs(A, 'room_snapshot', r)).partner_alias;
	check('상대 메시지에 공감 → A 의 기기로 알림', p.subs?.length === 1 && p.subs[0].endpoint === 'https://push.example/a', JSON.stringify(p));
	check('제목 = 공감한 사람의 방 안 이름, 본문 = 공감 + 메시지', p.title === aliasB && p.body === '❤️ 공감: 실리카겔 좋아하세요?' && p.room_id === r, JSON.stringify(p));
	check('★ 알림에 uuid 없음', ![A, B].some((u) => JSON.stringify({ ...p, subs: [], job: undefined, lease: undefined }).includes(u)));
	check('같은 공감을 또 요청해도 한 번만', (await pay(B, mA)).skip === 'already');
	await rpcAs(B, 'react_message', mA, 'laugh');
	check('★ 공감을 바꿔도 다시 울리지 않는다 (알림 폭탄 방지)', (await pay(B, mA)).skip === 'already');

	const mB = await say(B, seatB, '내 메시지');
	await rpcAs(B, 'react_message', mB, 'fire');
	check('내 메시지에 단 공감은 알림 없음', (await pay(B, mB)).skip === 'own_message');
	check('★ 다른 사람이 대신 요청할 수 없다', (await pay(await person('m', 'f'), mA)).skip === 'not_member');

	const mA2 = await say(A, seatA, '두 번째');
	await rpcAs(B, 'react_message', mA2, 'wow');
	await db.query(`update public.user_presence set online_until = now() + interval '1 minute' where user_id = $1`, [A]);
	await db.query(`update public.room_members set viewing_until = now() + interval '20 seconds' where room_id = $1 and user_id = $2`, [r, A]);
	check('받는 사람이 그 대화 화면을 보고 있으면 보내지 않는다', (await pay(B, mA2)).skip === 'viewing');
	await expectError('★ 학생은 직접 부를 수 없다', () => rpcAs(B, 'reaction_push_payload', mA, B), 'permission denied');
}

console.log('\n[64] ★ 메시지 답장 — 같은 방의 사람 메시지만, 보낸 뒤 못 바꾼다');
{
	const r = await fresh();
	const seatA = Number(await rpcAs(A, 'my_seat', r));
	const seatB = Number(await rpcAs(B, 'my_seat', r));
	const say = async (uid, room, seat, body, replyTo = null) =>
		(await rowsAs(uid, `insert into public.messages (room_id, sender_seat, body, client_msg_id, reply_to)
		                    values ($1, $2, $3, gen_random_uuid(), $4) returning id, reply_to`, [room, seat, body, replyTo]))[0];
	const m1 = await say(A, r, seatA, '실리카겔 좋아하세요?');
	const m2 = await say(B, r, seatB, '네 완전요!', m1.id);
	check('답장 저장 · 상대도 읽힘', Number(m2.reply_to) === Number(m1.id) &&
		Number((await rowsAs(A, `select reply_to from public.messages where id = $1`, [m2.id]))[0].reply_to) === Number(m1.id));
	check('내 메시지에도 답장 가능', Number((await say(A, r, seatA, '저도요', m2.id)).reply_to) === Number(m2.id));
	const sys = (await one(`select id from public.messages where room_id = $1 and sender_seat = 0 order by id limit 1`, [r])).id;
	await expectError('시스템 안내에는 답장 불가', () => say(B, r, seatB, 'x', sys), 'bad_reply');
	await expectError('없는 메시지 번호', () => say(B, r, seatB, 'x', 99999999), 'bad_reply');
	const other = await fresh();   // A·B 의 이전 방은 닫힌다 — 다른 방 메시지는 트리거가 먼저 막는지 본다
	const oA = Number(await rpcAs(A, 'my_seat', other));
	const oB = Number(await rpcAs(B, 'my_seat', other));
	const o1 = await say(A, other, oA, '다른 방');
	await expectError('★ 다른 방 메시지 번호로 답장 불가 (내용 엿보기 방지)', () => say(B, other, oB, 'x', m1.id), 'bad_reply');
	await expectError('★ 보낸 뒤 답장 대상을 바꿀 수 없다', () => rowsAs(A, `update public.messages set reply_to = null where id = $1`, [o1.id]), 'permission denied');
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const reply = await say(B, other, oB, '답장', o1.id);
	const view = await svc('admin_room', other, adm);
	check('관리자 대화 열람에 답장 대상', Number(view.messages.find((m) => Number(m.id) === Number(reply.id))?.reply_to) === Number(o1.id));
}


console.log('\n[65] ★ 규칙 필터 — 신상정보 · 금칙어는 보내기 전에 막는다');
{
	const rv = async (t) => (await one(`select private.rule_violation($1) v`, [t])).v;
	const cases = [
		['010-1234-5678 로 연락해', 'personal_info'], ['공일공 말고 01012345678', 'personal_info'], ['0 1 0 1 2 3 4 5 6 7 8', 'personal_info'],
		['나 20529 야', 'personal_info'], ['2학년 5반이야', 'personal_info'], ['@silica_gel 팔로우해', 'personal_info'],
		['인스타 아이디 알려줘', 'personal_info'], ['open.kakao.com/o/abc 들어와', 'personal_info'], ['카톡 추가해줄래', 'personal_info'],
		['니애미', 'blocked_word'], ['섹 스', 'blocked_word']
	];
	for (const [t, want] of cases) check(`막음: "${t}" → ${want}`, (await rv(t)) === want, String(await rv(t)));
	const okCases = ['15000원 들었어', '2026년에 봐요', '인스타 감성 사진 좋아해요', '온라인 수업 추가됐대', '3명이서 갔어요',
		'아 시험 망했다 ㅋㅋ', '보지 마세요 스포예요', '10000'];
	for (const t of okCases) check(`통과: "${t}"`, (await rv(t)) === null, String(await rv(t)));

	const r = await fresh();
	const seatA = Number(await rpcAs(A, 'my_seat', r));
	const ins = (body) => rowsAs(A, `insert into public.messages (room_id, sender_seat, body, client_msg_id)
	                                 values ($1, $2, $3, gen_random_uuid()) returning id`, [r, seatA, body]);
	await expectError('★ 채팅: 전화번호는 보내지지 않는다', () => ins('내 번호 010 9876 5432'), 'personal_info');
	await expectError('★ 채팅: 금칙어', () => ins('니 애 미'), 'blocked_word');
	check('채팅: 평범한 말은 보내진다', (await ins('안녕하세요')).length === 1);
	check('막힌 메시지는 남지 않는다', (await one(`select count(*)::int n from public.messages where room_id = $1 and body like '%9876%'`, [r])).n === 0);

	const adm = await person('f', 'm');
	await db.query(`insert into private.staff (user_id, role) values ($1, 'admin')`, [adm]);
	const mod = await person('f', 'm');
	await db.query(`insert into private.staff (user_id, role) values ($1, 'moderator')`, [mod]);
	await expectError('틀린 정규식은 저장 안 됨 (모든 글이 막히는 사고 방지)', () => svc('admin_set_banned_terms', ['(깨진'], adm), 'bad_pattern');
	await expectError('금칙어는 관리자만', () => svc('admin_set_banned_terms', ['새금칙어'], mod), 'admin_only');
	const before = await svc('admin_banned_terms');
	const saved = await svc('admin_set_banned_terms', [...before, '  바보멍청이 ', '바보멍청이'], adm);
	check('금칙어 추가 (앞뒤 공백 · 중복 정리)', saved.filter((x) => x === '바보멍청이').length === 1 && saved.length === before.length + 1);
	check('추가한 금칙어가 바로 적용', (await rv('이 바보멍청이야')) === 'blocked_word');
	await svc('admin_set_banned_terms', before, adm);
	check('지우면 바로 풀림', (await rv('이 바보멍청이야')) === null);
	await expectError('★ 학생은 금칙어 목록을 볼 수 없다', () => rowsAs(A, `select public.admin_banned_terms()`), 'permission denied');
}

console.log('\n[66] ★ AI 검토 대기열 — 켜져 있을 때만 쌓이고, 걸리면 자동 신고');
{
	// 앞 구역(규칙 필터)에서 막힌 글도 전송 한도를 쓴다 — 느린 기계(CI)에서 한도가 모자라 실패하지 않게 채워 둔다
	await db.query(`update public.user_presence set msg_tokens = 12, tokens_at = now()`);
	const q = async () => (await one(`select count(*)::int n from private.mod_queue`)).n;
	const r0 = await fresh();
	const s0 = Number(await rpcAs(A, 'my_seat', r0));
	const say = async (uid, room, seat, body) =>
		(await rowsAs(uid, `insert into public.messages (room_id, sender_seat, body, client_msg_id)
		                    values ($1, $2, $3, gen_random_uuid()) returning id`, [room, seat, body]))[0].id;
	const n0 = await q();
	await say(A, r0, s0, '꺼져 있을 때');
	check('AI 검토가 꺼져 있으면 쌓이지 않는다', (await q()) === n0);
	check('꺼져 있으면 가져갈 것도 없다', (await svc('mod_claim', 5)).length === 0);

	await db.query(`update public.app_settings set ai_moderation = true, ai_mod_daily_cap = 3`);
	const r = await fresh();
	const sA = Number(await rpcAs(A, 'my_seat', r));
	const sB = Number(await rpcAs(B, 'my_seat', r));
	await say(A, r, sA, '안녕하세요');
	await say(B, r, sB, '반가워요');
	const bad = await say(A, r, sA, '너 진짜 못생겼다 학교 나오지 마');
	check('메시지가 쌓인다 (시스템 안내 제외)', (await q()) === n0 + 3);

	const got = await svc('mod_claim', 5);
	check('하루 한도(3)까지만 가져간다', got.length === 3, JSON.stringify(got.map((x) => x.id)));
	const item = got.find((x) => x.text.startsWith('너 진짜'));
	check('맥락: 앞의 메시지와 누가 말했는지', item?.context?.length === 2 && item.context[0].who === '작성자' && item.context[1].who === '상대', JSON.stringify(item?.context));
	check('★ 맥락에 uuid · 이름 없음', ![A, B].some((u) => JSON.stringify(got).includes(u)));
	check('한도가 차면 더 안 준다', (await svc('mod_claim', 5)).length === 0);

	for (const x of got.filter((x) => x !== item)) await svc('mod_verdict', x.id, false, 'none', '');
	const v = await svc('mod_verdict', item.id, true, 'harassment', '외모 비하');
	check('판정 저장', v.status === 'ok' && v.flagged === true);
	check('같은 항목에 두 번 판정 못 함', (await svc('mod_verdict', item.id, true, 'harassment', 'x')).status === 'gone');

	const rep = await one(`select * from private.reports where room_id = $1 and source = 'auto'`, [r]);
	check('★ 자동 신고: 걸린 사람 · 신고자 없음', rep?.reported_id === A && rep.reporter_id === null && rep.reason === 'harassment', JSON.stringify(rep));
	check('자동 신고 메모에 이유와 글 앞부분', rep?.note.includes('외모 비하') && rep.note.includes('너 진짜'));
	const ev = (await db.query(`select sender, body from private.report_evidence where report_id = $1 order by ord`, [rep.id])).rows;
	check('증거: 대화 사본 (2 = 걸린 사람)', ev.some((e) => e.sender === 2 && e.body.startsWith('너 진짜')) && ev.some((e) => e.sender === 1 && e.body === '반가워요'));
	const list = await svc('admin_list_reports', 'open', 100);
	check('운영진 목록에 source = auto', list.find((x) => x.id === rep.id)?.source === 'auto');

	// 자동 신고는 자동 정지 횟수에 안 들어간다
	await db.query(`update public.app_settings set auto_suspend_reports = 1`);
	check('★ 자동 신고만으로는 정지되지 않는다', (await one(`select status from public.profiles where id = $1`, [A])).status === 'active');
	await db.query(`update public.app_settings set auto_suspend_reports = 3`);

	// 한도를 늘려 두 번째 걸림 → 같은 신고에 덧붙인다
	await db.query(`update public.app_settings set ai_mod_daily_cap = 100`);
	await say(A, r, sA, '또 나쁜 말');
	const g2 = await svc('mod_claim', 5);
	await svc('mod_verdict', g2[0].id, true, 'harassment', '두 번째');
	check('같은 방 두 번째 걸림은 한 신고에 덧붙인다', (await one(`select count(*)::int n from private.reports where room_id = $1 and source = 'auto'`, [r])).n === 1 &&
		(await one(`select note from private.reports where id = $1`, [rep.id])).note.includes('두 번째'));

	// 놓아주기 · 위기 신호
	await say(B, r, sB, '요즘 너무 힘들어서 사라지고 싶어');
	const g3 = await svc('mod_claim', 5);
	const approved = (await one('select coalesce(sum(tries),0)::int n from private.mod_queue where claimed_at >= private.ai_day_start()')).n;
	await svc('mod_release', g3.map((x) => x.id));
	check('AI 검토 실패 재시도는 승인한 일일 예산을 환불하지 않음', (await one('select coalesce(sum(tries),0)::int n from private.mod_queue where claimed_at >= private.ai_day_start()')).n === approved);
	check('놓아주면 다시 가져갈 수 있다', (await svc('mod_claim', 5)).length === g3.length);
	const g4 = (await db.query(`select id from private.mod_queue where status = 'working'`)).rows.map((x) => Number(x.id));
	await svc('mod_verdict', g4[0], true, 'self_harm', '위기 신호');
	const sh = await one(`select reason, reported_id from private.reports where room_id = $1 and source = 'auto' and reported_id = $2`, [r, B]);
	check('★ 위기 신호(self_harm) 자동 신고', sh?.reason === 'self_harm');
	await expectError('학생은 self_harm 사유로 신고할 수 없다', () => rpcAs(A, 'report_partner', r, 'self_harm', ''), 'invalid_reason');

	const u = await svc('admin_ai_usage');
	check('운영진 사용량 집계', u.mod_checked_today >= 3 && u.mod_flagged_today >= 3, JSON.stringify(u));
	await expectError('★ 학생은 대기열을 가져갈 수 없다', () => rowsAs(A, `select public.mod_claim(5)`), 'permission denied');
	await expectError('★ 학생은 판정을 쓸 수 없다', () => rowsAs(A, `select public.mod_verdict(1, false, 'none', '')`), 'permission denied');
	await db.query(`update public.app_settings set ai_moderation = false`);
}

console.log('\n[67] ★ AI 대화 상대 — 사람당 · 앱 전체 하루 한도, 시간 · 턴 제한');
{
	const start = (uid) => rpcAs(uid, 'ai_chat_start');
	const u1 = await person('m', 'f'), u2 = await person('f', 'm'), u3 = await person('m', 'm');
	check('꺼져 있으면 off', (await start(u1)).status === 'off');
	await db.query(`update public.app_settings set ai_chat = true, ai_chat_per_user = 2, ai_chat_daily_cap = 3, ai_chat_minutes = 10, ai_chat_max_turns = 2`);
	const c1 = await start(u1);
	check('시작: id · 끝나는 시각 · 남은 횟수', c1.status === 'ok' && c1.id && c1.max_turns === 2 && c1.left_today === 1, JSON.stringify(c1));
	check('안 끝난 대화가 있으면 그걸 이어간다 (횟수 안 셈)', (await start(u1)).id === c1.id);

	const turn = (chat, uid, text) => svc('ai_chat_turn', chat, uid, text);
	check('한 턴', (await turn(c1.id, u1, '안녕')).status === 'ok');
	check('★ 남의 대화로는 못 보낸다', (await turn(c1.id, u2, '안녕')).status === 'not_found');
	check('★ AI 에게도 신상은 못 보낸다', (await turn(c1.id, u1, '내 번호 01012345678')).status === 'blocked');
	check('두 번째 턴', (await turn(c1.id, u1, '뭐해')).turns === 2);
	check('턴 한도', (await turn(c1.id, u1, '또')).status === 'turns');

	const c2 = await start(u1);
	check('턴을 다 쓰면 새 대화 (오늘 2번째)', c2.status === 'ok' && c2.id !== c1.id && c2.left_today === 0);
	await db.query(`update private.ai_chats set expires_at = now() - interval '1 second' where id = $1`, [c2.id]);
	check('시간이 지나면 끝', (await turn(c2.id, u1, '안녕')).status === 'expired');
	check('★ 사람당 하루 한도', (await start(u1)).status === 'limit');

	check('다른 사람은 된다 (앱 전체 3번째)', (await start(u2)).status === 'ok');
	check('★ 앱 전체 하루 한도', (await start(u3)).status === 'full');

	await db.query(`update public.profiles set status = 'suspended' where id = $1`, [u3]);
	check('정지된 계정은 못 쓴다', (await start(u3)).status === 'restricted');
	await expectError('★ 학생은 턴을 직접 셀 수 없다 (한도 우회 방지)', () => rowsAs(u1, `select public.ai_chat_turn($1, $2, 'x')`, [c1.id, u1]), 'permission denied');
	check('★ AI 대화 내용은 DB 에 없다 (몇 번 썼는지만)', (await db.query(`select column_name from information_schema.columns
		where table_schema = 'private' and table_name = 'ai_chats'`)).rows.every((x) => !/body|text|content|message/.test(x.column_name)));
	await db.query(`update public.app_settings set ai_chat = false`);
}


console.log('\n[68] ★ 대화 백업 (CSV) — 관리자만, 기록 남김, 계정 정보 없음, 엑셀 수식 막음');
{
	await db.query(`update public.user_presence set msg_tokens = 12, tokens_at = now()`); // 앞 구역에서 쓴 전송 한도
	const r = await fresh();
	const sA = Number(await rpcAs(A, 'my_seat', r));
	const sB = Number(await rpcAs(B, 'my_seat', r));
	const say = async (uid, seat, body) =>
		(await rowsAs(uid, `insert into public.messages (room_id, sender_seat, body, client_msg_id)
		                    values ($1, $2, $3, gen_random_uuid()) returning id`, [r, seat, body]))[0].id;
	await say(A, sA, '그냥 "따옴표"랑, 쉼표');
	await say(B, sB, '=HYPERLINK("http://x","클릭")');
	await say(A, sA, '줄\n바꿈');
	const adm = await person('f', 'm');
	await db.query(`insert into private.staff (user_id, role) values ($1, 'admin')`, [adm]);
	const mod = await person('f', 'm');
	await db.query(`insert into private.staff (user_id, role) values ($1, 'moderator')`, [mod]);
	const from = new Date(Date.now() - 3600_000).toISOString(), to = new Date(Date.now() + 3600_000).toISOString();

	await expectError('운영진(모더레이터)은 못 받는다', () => svc('admin_export_messages', mod, from, to, 0, 5000), 'admin_only');
	await expectError('★ 학생은 부를 수 없다', () => rowsAs(A, `select public.admin_export_messages($1, now(), now() + interval '1 hour', 0, 10)`, [A]), 'permission denied');
	await expectError('기간이 거꾸로면 오류', () => svc('admin_export_messages', adm, to, from, 0, 10), 'bad_range');

	const logs0 = (await one(`select count(*)::int n from private.audit_log where action = 'export_messages'`)).n;
	const out = await svc('admin_export_messages', adm, from, to, 0, 5000);
	const mine = out.csv.split('\n').filter((l) => l.includes(r));
	check('이 방 메시지가 다 들어 있다 (시스템 안내 포함)', mine.length >= 4, String(mine.length));
	check('따옴표 · 쉼표는 CSV 규칙대로', out.csv.includes('"그냥 ""따옴표""랑, 쉼표"'));
	check('★ 엑셀 수식은 앞에 \' 를 붙여 글자로', out.csv.includes(`"'=HYPERLINK(""http://x"",""클릭"")"`));
	check('줄바꿈은 칸 안에 그대로', out.csv.includes('"줄\n바꿈"'));
	const aliases = await one('select alias1, alias2 from public.rooms where id = $1', [r]);
	check('보낸 사람은 방 안 익명 이름', out.csv.includes(`"${sA === 1 ? aliases.alias1 : aliases.alias2}"`) && out.csv.includes('"시스템 안내"'));
	check('★ 계정 정보(사용자 id · 이메일)는 없다', ![A, B].some((u) => out.csv.includes(u)) && !out.csv.includes('@cnsa'));
	check('★ 받을 때 활동 기록', (await one(`select count(*)::int n from private.audit_log where action = 'export_messages'`)).n === logs0 + 1);

	const p1 = await svc('admin_export_messages', adm, from, to, 0, 2);
	const p2 = await svc('admin_export_messages', adm, from, to, Number(p1.last_id), 2);
	check('조각으로 나눠 받기 (이어 받는 조각은 겹치지 않음)', p1.count === 2 && p2.count >= 1 && Number(p2.csv.split(',')[0]) > Number(p1.last_id));
	check('★ 이어 받는 조각도 열람 기록을 남긴다', (await one(`select count(*)::int n from private.audit_log where action = 'export_messages'`)).n === logs0 + 3);
	const none = await svc('admin_export_messages', adm, new Date(Date.now() - 7200_000).toISOString(), new Date(Date.now() - 3600_000 - 1000).toISOString(), 0, 10);
	check('기간 밖이면 빈 결과', none.count === 0 && none.csv === '');
}

console.log('\n[69] ★ 만났던 사람도 다시 만나기 — 둘 다 켰을 때만');
{
	await resetPool();
	await db.query('update public.user_presence set match_tokens = 99');
	const p = await person('m', 'f');
	const q = await person('f', 'm');
	const recent = () => db.query(`insert into public.pair_history (user_lo, user_hi, last_matched_at)
	                values (least($1::uuid,$2::uuid), greatest($1::uuid,$2::uuid), now() - interval '1 day')
	                on conflict (user_lo, user_hi) do update set last_matched_at = excluded.last_matched_at`, [p, q]);
	await recent();
	check('기본은 꺼짐', (await one('select allow_rematch from public.profiles where id = $1', [p])).allow_rematch === false);

	await rowsAs(p, 'update public.profiles set allow_rematch = true where id = auth.uid()');
	check('본인이 켤 수 있다', (await one('select allow_rematch from public.profiles where id = $1', [p])).allow_rematch === true);
	await rowsAs(p, 'update public.profiles set allow_rematch = true where id = $1', [q]);
	check('★ 남의 설정은 못 바꾼다', (await one('select allow_rematch from public.profiles where id = $1', [q])).allow_rematch === false);
	await expectError('status 같은 다른 열은 여전히 못 바꾼다', () => rowsAs(p, `update public.profiles set status = 'active' where id = auth.uid()`), 'permission denied');

	await match(p);
	check('★ 한쪽만 켜면 최근 상대는 여전히 제외', (await match(q)).status === 'waiting');

	await rowsAs(q, 'update public.profiles set allow_rematch = true where id = auth.uid()');
	check('★ 둘 다 켜면 최근 상대와도 매칭', (await match(q)).status === 'matched');

	await resetPool();
	await recent();
	const fresh = await person('m', 'f');
	await match(p);
	await match(fresh);
	const got = await match(q);
	const mem = got.status === 'matched' ? await one('select count(*)::int n from public.room_members where room_id = $1 and user_id = $2', [got.room_id, fresh]) : { n: 0 };
	check('켜도 처음 보는 사람이 기다리면 그쪽 먼저', got.status === 'matched' && mem.n === 1, JSON.stringify(got));

	await resetPool();
	await recent();
	await db.query('insert into public.blocks (blocker_id, blocked_id) values ($1,$2) on conflict do nothing', [q, p]);
	await match(p);
	check('★ 둘 다 켜도 차단한 사이는 안 잡힌다', (await match(q)).status === 'waiting');
	await db.query('delete from public.blocks where blocker_id = $1 and blocked_id = $2', [q, p]);
}

console.log('\n[70] ★ 보안 점검 — 표 권한 · 트리거 함수 (Supabase 기본 권한 위에서)');
{
	const u = await person('m', 'f');
	await expectError('★ 로그인 안 한 사람은 profiles 를 못 읽는다', () => rowsAs(null, 'select id from public.profiles'), 'permission denied');
	await expectError('★ 학생도 user_presence 를 직접 못 읽는다 (접속 여부는 RPC 로만)', () => rowsAs(u, 'select * from public.user_presence'), 'permission denied');
	await expectError('★ profiles 를 통째로 비울 수 없다 (TRUNCATE 는 RLS 를 거치지 않는다)', () => rowsAs(u, 'truncate public.profiles cascade'), 'permission denied');
	await expectError('profiles 에 행을 직접 넣을 수 없다', () => rowsAs(u, `insert into public.profiles (id) values (gen_random_uuid())`), 'permission denied');
	await expectError('app_settings 는 읽기만', () => rowsAs(u, 'update public.app_settings set is_open = false'), 'permission denied');
	await expectError('★ 트리거 함수는 직접 부를 수 없다', () => rowsAs(u, 'select public.msg_rate_limit()'), 'permission denied');
	check('내 프로필 읽기 · 정해진 열 고치기는 그대로', (await rowsAs(u, 'select id from public.profiles')).length === 1
		&& (await rowsAs(u, `update public.profiles set want = 'any' where id = auth.uid() returning id`)).length === 1);
	check('설정 읽기는 그대로', (await rowsAs(u, 'select is_open from public.app_settings')).length === 1);
}

console.log('\n[71] ★ 이름 편지 — 학생을 찾아 익명으로 보내고 주고받기 (Phase 23)');
{
	await resetPool();
	await db.query(`update public.user_presence set letter_tokens = 3, letter_at = now(), comment_tokens = 10, comment_at = now()`);
	let no = 20700;
	// 학교 이메일 앞자리 = 학번 → 명렬표 이름
	const named = async (name, grade, gender = 'm', want = 'f') => {
		const n = ++no;
		if (name) await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, want=$3, onboarded=true where id=$1', [id, gender, want]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('김보냄', 1);      // 보내는 사람
	const B = await named('박받음', 2);      // 받는 사람
	const C = await named('박받음', 3);      // 동명이인
	const D = await named(null, null);       // 명렬표에 없음
	const E = await named('최남', 2);        // 제3자

	console.log('  [이름]');
	const accA = await rpcAs(A, 'my_account');
	check('★ 명렬표에서 이름 · 학년 자동', accA.name === '김보냄' && accA.grade === 1 && accA.name_source === 'roster', JSON.stringify(accA));
	check('명렬표에 있으면 직접 못 바꾼다', (await rpcAs(A, 'set_my_name', '가짜이름')).status === 'roster');
	check('명렬표에 없으면 이름이 비어 있다', (await rpcAs(D, 'my_account')).name == null);
	check('이상한 이름은 거절', (await rpcAs(D, 'set_my_name', '1')).status === 'bad_name');
	check('★ 명렬표에 있는 이름으로는 적을 수 없다 (사칭 방지)', (await rpcAs(D, 'set_my_name', '박받음')).status === 'name_in_roster');
	check('명렬표에 없는 사람은 한 번 적는다', (await rpcAs(D, 'set_my_name', '이외부')).status === 'ok' && (await rpcAs(D, 'my_account')).name_source === 'self');
	check('한 번 적으면 못 바꾼다', (await rpcAs(D, 'set_my_name', '다른이름')).status === 'already');

	console.log('  [찾기]');
	check('두 글자 미만은 찾지 않는다', (await rpcAs(A, 'dm_search', '박')).length === 0);
	let found = await rpcAs(A, 'dm_search', '박받음');
	check('★ 이름으로 찾기 — 동명이인은 학년으로 구분', found.length === 2 && found.every((x) => x.name === '박받음') && found.map((x) => x.grade).join(',') === '2,3', JSON.stringify(found));
	check('★ 결과에 이메일 · 학번 없음', !JSON.stringify(found).includes('@') && !JSON.stringify(found).includes(String(no)));
	check('나 자신은 안 나온다', (await rpcAs(A, 'dm_search', '김보냄')).length === 0);
	check('명렬표 확인 여부', found[0].checked === true && (await rpcAs(A, 'dm_search', '이외부'))[0]?.checked === false);
	await db.query('update public.profiles set letters_open = false where id = $1', [C]);
	check('★ 편지 받기를 끄면 검색에 안 나온다', (await rpcAs(A, 'dm_search', '박받음')).length === 1);
	await expectError('로그인 안 하면 못 찾는다', () => rowsAs(null, `select public.dm_search('박받음')`), 'permission denied');

	console.log('  [보내기 · 받기]');
	const s1 = await rpcAs(A, 'dm_send', B, '안녕 나야 누군지 맞혀봐');
	check('편지 보내기', s1.status === 'ok' && s1.thread_id > 0, JSON.stringify(s1));
	check('받기를 끈 사람에게는 못 보낸다', (await rpcAs(A, 'dm_send', C, '안녕')).status === 'not_available');
	const inB = await rpcAs(B, 'dm_inbox');
	const rb = inB.threads[0];
	check('★ 받는 사람에게 보낸 사람은 익명 이름뿐', rb.role === 'received' && rb.title && rb.title !== '김보냄' && rb.grade == null && rb.unread === 1, JSON.stringify(rb));
	const thB = await rpcAs(B, 'dm_thread', s1.thread_id);
	check('★ 받는 사람 쪽 어디에도 보낸 사람 계정 · 이름이 없다', !JSON.stringify(inB).includes(A) && !JSON.stringify(thB).includes(A) && !JSON.stringify(thB).includes('김보냄'));
	check('열면 읽음', (await rpcAs(B, 'dm_inbox')).threads[0].unread === 0 && thB.messages[0].mine === false);
	const sa = (await rpcAs(A, 'dm_inbox')).threads[0];
	check('보낸 사람에게는 받는 사람 이름 · 학년', sa.role === 'sent' && sa.title === '박받음' && sa.grade === 2);
	check('남의 편지는 열 수 없다', (await rpcAs(E, 'dm_thread', s1.thread_id)).status === 'not_found' && (await rpcAs(E, 'dm_letter', s1.thread_id, '끼어들기')).status === 'not_found');
	await expectError('★ 편지 표는 직접 못 읽는다', () => rowsAs(B, 'select * from private.dm_threads'), 'permission denied');

	await rpcAs(A, 'dm_send', B, '두 번째');
	await rpcAs(A, 'dm_letter', s1.thread_id, '세 번째');
	check('★ 답 없이 네 번째는 안 된다 (연달아 3개까지)', (await rpcAs(A, 'dm_letter', s1.thread_id, '네 번째')).status === 'wait_reply' && (await rpcAs(A, 'dm_thread', s1.thread_id)).wait_reply === true);
	check('받는 사람이 답장', (await rpcAs(B, 'dm_letter', s1.thread_id, '누구세요?')).status === 'ok');
	check('답이 오면 다시 쓸 수 있다', (await rpcAs(A, 'dm_letter', s1.thread_id, '비밀')).status === 'ok');
	const thA = await rpcAs(A, 'dm_thread', s1.thread_id);
	check('주고받은 순서 · 내 말 표시', thA.messages.length === 5 && thA.messages.map((m) => (m.mine ? 'A' : 'B')).join('') === 'AAABA');
	await expectError('★ 신상정보는 편지에도 못 쓴다', () => rpcAs(A, 'dm_letter', s1.thread_id, '내 번호 010-1234-5678'), 'personal_info');

	console.log('  [푸시]');
	await expectError('학생은 푸시 판단 함수를 못 부른다', () => rowsAs(B, 'select public.dm_push_payload(1, $1)', [B]), 'permission denied');
	await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://web.push.apple.com/dmB', 'k', 'x')`, [B]);
	await db.query(`update public.user_presence set online_until = now() - interval '1 second' where user_id = $1`, [B]);
	const t2 = await rpcAs(A, 'dm_send', E, '처음 보내는 편지');
	await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://web.push.apple.com/dmE', 'k', 'x')`, [E]);
	await db.query(`update public.user_presence set online_until = now() - interval '1 second' where user_id = $1`, [E]);
	const pl = await svc('dm_push_payload', t2.msg_id, A);
	const aliasE = (await rpcAs(E, 'dm_inbox')).threads.find((t) => t.id === t2.thread_id).title;
	void aliasE;
	// Phase 32 — 봉투는 열어야 보인다: 제목은 성별만, 본문 없이, 편지 한 통으로 바로
	check('★ 새 편지 알림: "익명의 남학생에게서 편지가 왔어요" · 본문 · 보낸 사람 정보 없음', pl.title === '익명의 남학생에게서 편지가 왔어요' && pl.body === '봉투를 열어 확인해 보세요' && pl.url === `/letters/m/${t2.msg_id}` && !JSON.stringify(pl).includes('김보냄') && !JSON.stringify(pl).includes('처음 보내는'), JSON.stringify(pl));
	check('남이 쓴 말로는 알림을 못 보낸다', (await svc('dm_push_payload', t2.msg_id, B)).skip === 'not_author');

	console.log('  [끝내기 · 차단 · 신고]');
	check('받는 사람이 끝내기', (await rpcAs(E, 'dm_close', t2.thread_id)).status === 'ok' && (await rpcAs(A, 'dm_letter', t2.thread_id, '왜')).status === 'closed');
	const refused = await rpcAs(A, 'dm_send', E, '다시');
	check('★ 수신 거부는 발신 응답으로 드러나지 않고 실제 전달을 막는다', refused.status === 'ok'
		&& (await one('select delivered from private.dm_msgs where id = $1', [refused.msg_id])).delivered === false
		&& (await rpcAs(E, 'dm_open', refused.msg_id)).status === 'not_found');
	const rep = await rpcAs(B, 'dm_report', s1.thread_id, 'harassment', '누군지 모를 사람이 계속');
	check('신고', rep.status === 'ok');
	const lr = await one(`select * from private.letter_reports where target_type = 'dm' and letter_id = $1`, [s1.thread_id]);
	check('★ 신고 대상 = 보낸 사람 (운영진만 안다) · 대화 전문이 증거로', lr.reported_id === A && lr.reporter_id === B && (await cnt('select count(*)::int n from private.letter_report_evidence where report_id = $1', [lr.id])) === 5);
	check('★ 신고하면 차단 · 끝남, 이름 검색은 차단 전후 동일 (신원 오라클 방지)', (await cnt('select count(*)::int n from public.blocks where blocker_id = $1 and blocked_id = $2', [B, A])) === 1
		&& (await rpcAs(A, 'dm_thread', s1.thread_id)).thread_status === 'closed' && (await rpcAs(A, 'dm_search', '박받음')).some((p) => p.id === B));
	check('같은 편지는 두 번 신고하지 않는다', (await rpcAs(B, 'dm_report', s1.thread_id, 'spam', '')).status === 'already');
	const det = await svc('admin_letter_report', lr.id);
	check('운영자 신고 상세에 편지 줄기 상태', det.target.thread_status === 'closed' && det.evidence[0].kind === 'dm_sender');
	const adm = await person('m', 'f');
	await db.query(`insert into private.staff (user_id, role) values ($1, 'admin') on conflict do nothing`, [adm]);
	await svc('admin_remove_dm', s1.thread_id, adm, lr.id);
	check('★ 운영진이 내리면 둘 다에게서 사라진다 · 기록', !(await rpcAs(B, 'dm_inbox')).threads.some((t) => t.id === s1.thread_id)
		&& (await rpcAs(A, 'dm_thread', s1.thread_id)).status === 'not_found'
		&& (await cnt(`select count(*)::int n from private.audit_log where action = 'remove_dm'`)) === 1);

	console.log('  [한도 · AI 검토]');
	const F = await named('한도만', 1), G = await named('한도둘', 1), H = await named('한도셋', 1), I = await named('한도넷', 1);
	await db.query('update public.user_presence set letter_tokens = 3, letter_at = now() where user_id = $1', [A]);
	const r1 = await rpcAs(A, 'dm_send', F, '1'), r2 = await rpcAs(A, 'dm_send', G, '2'), r3 = await rpcAs(A, 'dm_send', H, '3');
	check('★ 새 편지는 편지 한도 (기본 3통) — 넷째는 쉬었다가', [r1, r2, r3].every((r) => r.status === 'ok') && (await rpcAs(A, 'dm_send', I, '4')).status === 'rate_limited');
	await db.query(`update public.app_settings set ai_moderation = true, ai_mod_daily_cap = 50`);
	await db.query(`update private.mod_queue set status = 'done' where status in ('pending','working')`);
	await rpcAs(F, 'dm_letter', r1.thread_id, '너 진짜 짜증나 [flag]');
	const claimed = await svc('mod_claim', 5);
	const it = claimed.find((c) => c.kind === 'dm');
	check('AI 검토가 편지도 가져간다 (앞 말 맥락과 함께)', it && it.text.includes('짜증나') && it.context.length === 1, JSON.stringify(claimed));
	await svc('mod_verdict', it.id, true, 'harassment', '모욕');
	check('★ 걸리면 자동 신고 (대상 = 그 말을 쓴 사람)', (await one(`select reported_id, source from private.letter_reports where target_type = 'dm' and letter_id = $1`, [r1.thread_id]))?.reported_id === F);
	await db.query(`update public.app_settings set ai_moderation = false`);
}

console.log('\n[72] 이름 편지 서식 — 편지 쓰기 편집기 (Phase 24)');
{
	await resetPool();
	await db.query(`update public.user_presence set letter_tokens = 3, letter_at = now(), comment_tokens = 10, comment_at = now()`);
	let no = 20800;
	const named = async (name, grade) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, want=$3, onboarded=true where id=$1', [id, 'm', 'f']);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('서식보냄', 1), B = await named('서식받음', 2), C = await named('서식셋', 2);
	check('옛 두 인자 dm_send 는 없다 (헷갈리지 않게)', (await cnt(`select count(*)::int n from pg_proc where proname = 'dm_send'`)) === 1);
	const fmt = { m: [[0, 2, 'b'], [3, 5, 'h:yellow'], [3, 5, 'c:red']], a: [[1, 'center']] };
	const r = await rpcAs(A, 'dm_send', B, '안녕 친구\n가운데', JSON.stringify(fmt));
	check('★ 서식과 함께 보낸다', r.status === 'ok', JSON.stringify(r));
	const tb = await rpcAs(B, 'dm_thread', r.thread_id);
	check('★ 받는 사람에게 본문 · 서식 그대로', tb.messages[0].body === '안녕 친구\n가운데' && JSON.stringify(tb.messages[0].fmt?.m) === JSON.stringify(fmt.m) && JSON.stringify(tb.messages[0].fmt?.a) === JSON.stringify(fmt.a), JSON.stringify(tb.messages[0]));
	check('서식 없이도 보낸다 (두 인자 호출)', (await rpcAs(A, 'dm_send', B, '두 번째')).status === 'ok'
		&& (await rpcAs(B, 'dm_thread', r.thread_id)).messages[1].fmt === null);
	check('빈 서식({})은 없음으로', (await rpcAs(A, 'dm_send', B, '세 번째', '{}')).status === 'ok'
		&& (await rpcAs(B, 'dm_thread', r.thread_id)).messages[2].fmt === null);
	check('★ 표에 없는 서식은 거절', (await rpcAs(A, 'dm_send', C, '안녕하세요', JSON.stringify({ m: [[0, 2, 'c:#000']] }))).status === 'bad_text');
	check('본문 밖을 가리키는 서식은 거절', (await rpcAs(A, 'dm_send', C, '안녕', JSON.stringify({ m: [[0, 9, 'b']] }))).status === 'bad_text');
	check('앞뒤 공백이 남은 본문 + 서식은 거절 (위치가 어긋남)', (await rpcAs(A, 'dm_send', C, ' 안녕 ', JSON.stringify({ m: [[0, 2, 'b']] }))).status === 'bad_text');
	check('거절된 것은 저장되지 않는다', !(await rpcAs(C, 'dm_inbox')).threads.length);
	const lr = await rpcAs(B, 'dm_report', r.thread_id, 'spam', '');
	await db.query(`update private.dm_msgs set status = 'removed' where thread_id = $1`, [r.thread_id]);
	check('내려진 말은 서식도 안 보인다', lr.status === 'ok' && (await rpcAs(A, 'dm_thread', r.thread_id)).messages.every((m) => m.body === null && m.fmt === null));
}

console.log('\n[73] 이름 편지 — 나가면 내 목록에서 지우기 (Phase 25)');
{
	await resetPool();
	await db.query(`update public.user_presence set letter_tokens = 3, letter_at = now(), comment_tokens = 10, comment_at = now()`);
	let no = 20900;
	const named = async (name, grade) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, want=$3, onboarded=true where id=$1', [id, 'm', 'f']);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('나감보냄', 1), B = await named('나감받음', 2), C = await named('나감셋', 2);
	const ids = async (u) => (await rpcAs(u, 'dm_inbox')).threads.map((t) => t.id);
	const t1 = await rpcAs(A, 'dm_send', B, '첫 편지');
	check('★ 보낸 사람이 나가면 내 목록에서 사라진다', (await rpcAs(A, 'dm_close', t1.thread_id)).status === 'ok' && !(await ids(A)).includes(t1.thread_id)
		&& (await rpcAs(A, 'dm_thread', t1.thread_id)).status === 'not_found');
	const bSide = (await rpcAs(B, 'dm_inbox')).threads.find((t) => t.id === t1.thread_id);
	check('상대 목록에는 "끝남"으로 남는다', bSide?.status === 'closed' && (await rpcAs(B, 'dm_thread', t1.thread_id)).closed_by === 'sender');
	const t2 = await rpcAs(A, 'dm_send', B, '다시 보내는 편지');
	const aList = (await rpcAs(A, 'dm_inbox')).threads;
	check('★ 끝낸 뒤 같은 사람에게 다시 보내도 내 목록엔 하나만', t2.status === 'ok' && t2.thread_id !== t1.thread_id && aList.length === 1 && aList[0].id === t2.thread_id, JSON.stringify(aList));
	const bList = (await rpcAs(B, 'dm_inbox')).threads;
	check('받는 쪽: 새 편지는 새 가명 (같은 사람인지 모름)', bList.length === 2 && bList[0].title !== bList[1].title, JSON.stringify(bList));
	check('받는 사람도 끝난 편지에서 나가면 사라진다', (await rpcAs(B, 'dm_close', t1.thread_id)).status === 'ok' && !(await ids(B)).includes(t1.thread_id) && (await ids(B)).includes(t2.thread_id));
	await rpcAs(B, 'dm_close', t2.thread_id);
	const refused = await rpcAs(A, 'dm_send', B, '또');
	check('★ 받는 사람이 나가면 이후 편지는 응답으로 구별되지 않고 수신되지 않는다', refused.status === 'ok'
		&& (await rpcAs(B, 'dm_open', refused.msg_id)).status === 'not_found');
	check('보낸 쪽엔 "끝남"으로 남는다 (받는 사람이 끝냄)', (await rpcAs(A, 'dm_inbox')).threads.find((t) => t.id === t2.thread_id)?.status === 'closed');
	const t3 = await rpcAs(A, 'dm_send', C, '셋에게');
	check('차단하면 내 목록에서 사라진다', (await rpcAs(C, 'dm_block', t3.thread_id)).status === 'ok' && !(await ids(C)).includes(t3.thread_id));
	await db.query('delete from public.blocks where blocker_id = $1', [C]);
	await db.query(`update public.user_presence set letter_tokens = 3, letter_at = now() where user_id = $1`, [C]);
	const t4 = await rpcAs(C, 'dm_send', A, '반대로');
	const r4 = await rpcAs(A, 'dm_report', t4.thread_id, 'spam', '');
	check('★ 신고하면 내 목록에서 사라지고 증거는 남는다', r4.status === 'ok' && !(await ids(A)).includes(t4.thread_id)
		&& (await cnt(`select count(*)::int n from private.letter_report_evidence e join private.letter_reports r on r.id = e.report_id where r.target_type = 'dm' and r.letter_id = $1`, [t4.thread_id])) === 1);
	check('나간 편지도 표에는 남는다 (운영자 확인용)', (await cnt('select count(*)::int n from private.dm_threads where id = any($1)', [[t1.thread_id, t2.thread_id, t3.thread_id, t4.thread_id]])) === 4);
}

console.log('\n[74] 이름 편지 — 읽음 (Phase 26)');
{
	await resetPool();
	await db.query(`update public.user_presence set letter_tokens = 3, letter_at = now(), comment_tokens = 10, comment_at = now()`);
	let no = 21000;
	const named = async (name, grade) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, want=$3, onboarded=true where id=$1', [id, 'm', 'f']);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('읽음보냄', 1), B = await named('읽음받음', 2);
	const s1 = await rpcAs(A, 'dm_send', B, '읽었어?');
	check('상대가 안 열어 봤으면 읽음 전', (await rpcAs(A, 'dm_thread', s1.thread_id)).their_read < s1.msg_id);
	await rpcAs(B, 'dm_thread', s1.thread_id);
	check('★ 상대가 열어 보면 내 말까지 읽음', (await rpcAs(A, 'dm_thread', s1.thread_id)).their_read >= s1.msg_id);
	const r1 = await rpcAs(B, 'dm_letter', s1.thread_id, '응');
	check('받는 쪽도: 보낸 사람이 아직 안 봤으면 읽음 전', (await rpcAs(B, 'dm_thread', s1.thread_id)).their_read < r1.msg_id);
}

console.log('\n[75] 이름 편지 — 편지로 답장 · 채팅하기 (Phase 27)');
{
	await resetPool();
	await db.query(`update public.user_presence set letter_tokens = 3, letter_at = now(), comment_tokens = 10, comment_at = now()`);
	let no = 21100;
	const named = async (name, grade) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, want=$3, onboarded=true where id=$1', [id, 'm', 'f']);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('모드보냄', 1), B = await named('모드받음', 2), C = await named('모드셋', 3);
	const s1 = await rpcAs(A, 'dm_send', B, '첫 편지');
	const tb = await rpcAs(B, 'dm_thread', s1.thread_id);
	check('★ 새 편지는 편지 모드 · 편지지 To(받는 사람 이름) / From(가명)', tb.mode === 'letter' && tb.messages[0].letter === true
		&& tb.recipient_name === '모드받음' && tb.alias === tb.title && !JSON.stringify(tb).includes('모드보냄'), JSON.stringify(tb));
	const ta = await rpcAs(A, 'dm_thread', s1.thread_id);
	check('보낸 사람도 자기 가명(From)을 안다', ta.alias === tb.alias && ta.recipient_name === '모드받음');
	// Phase 32 — 채팅 모드(채팅 한 줄 · 채팅하기)는 없어졌다
	await expectError('★ 채팅 한 줄(dm_reply)은 없다', () => rowsAs(B, `select public.dm_reply(1, 'x')`), 'does not exist');
	await expectError('★ 채팅하기(dm_chat)도 없다', () => rowsAs(A, `select public.dm_chat(1)`), 'does not exist');
	const l2 = await rpcAs(B, 'dm_letter', s1.thread_id, '답장 편지', JSON.stringify({ m: [[0, 2, 'b']] }));
	const ta2 = await rpcAs(A, 'dm_thread', s1.thread_id);
	check('★ 편지로 답장 (서식 포함) — 여전히 편지 모드', l2.status === 'ok' && ta2.mode === 'letter' && ta2.messages[1].letter === true && ta2.messages[1].fmt?.m?.length === 1);
	check('편지 답장도 표에 없는 서식은 거절', (await rpcAs(A, 'dm_letter', s1.thread_id, '안녕', JSON.stringify({ m: [[0, 2, 'c:#000']] }))).status === 'bad_text');
	await db.query(`update private.dm_threads set mode = 'chat' where id = $1`, [s1.thread_id]);
	check('★ 예전에 채팅으로 바뀐 줄기도 편지로 답장된다', (await rpcAs(A, 'dm_letter', s1.thread_id, '편지로 답장')).status === 'ok');
	check('남의 줄기에는 못 쓴다', (await rpcAs(C, 'dm_letter', s1.thread_id, 'x')).status === 'not_found');
	await expectError('로그인 안 하면 못 쓴다', () => rowsAs(null, `select public.dm_letter(1, 'x')`), 'permission denied');
	// 예전 데이터 옮기기: 첫 말 = 편지, 채팅처럼 주고받은 줄기 = 채팅
	const old = await rpcAs(A, 'dm_send', C, '옛 편지');
	await db.query(`update private.dm_threads set mode = 'letter' where id = $1`, [old.thread_id]);
	await db.query(`insert into private.dm_msgs (thread_id, from_sender, body) values ($1, false, '옛 답장')`, [old.thread_id]);
	await db.query(`update private.dm_msgs set is_letter = false where thread_id = $1`, [old.thread_id]);
	await db.query(`update private.dm_msgs m set is_letter = true where not m.is_letter and m.id = (select min(o.id) from private.dm_msgs o where o.thread_id = m.thread_id)`);
	await db.query(`update private.dm_threads t set mode = 'chat' where t.mode = 'letter' and exists (select 1 from private.dm_msgs m where m.thread_id = t.id and not m.is_letter)`);
	const ot = await rpcAs(C, 'dm_thread', old.thread_id);
	check('예전 줄기: 첫 말은 편지 · 채팅처럼 주고받았으면 채팅 모드', ot.mode === 'chat' && ot.messages[0].letter === true && ot.messages[1].letter === false, JSON.stringify(ot.messages));
}

console.log('\n[76] 랜덤 채팅 — 메시지 삭제 · 둘 다 볼 때만 흐르는 시간 · 연장 힌트 (Phase 28)');
{
	await resetPool();
	let no = 21200;
	const named = async (name, grade) => {
		const n = ++no;
		if (name) await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set onboarded=true where id=$1', [id]);
		await rpcAs(id, 'ensure_self');
		return { id, email: `${n}@cnsa.hs.kr` };
	};
	const A = await named('김철수', 2), B = await named('박영희', 1);
	const open = async () => (await one(`select private.dev_open_room($1, $2, 10) as id`, [A.email, B.email])).id;

	console.log('  [삭제]');
	let room = await open();
	const sent = await rowsAs(A.id, `insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, 1, '비밀 이야기', gen_random_uuid()) returning id`, [room]);
	const mid = sent[0].id;
	check('남의 말은 지울 수 없다', (await rpcAs(B.id, 'delete_message', mid)).status === 'not_found');
	check('★ 내 말 지우기', (await rpcAs(A.id, 'delete_message', mid)).status === 'ok');
	const seenB = (await rowsAs(B.id, 'select body, deleted_at from public.messages where id = $1', [mid]))[0];
	check('★ 상대에게도 "삭제된 메시지입니다" (원문은 학생이 읽을 수 없음)', seenB.body === '삭제된 메시지입니다' && seenB.deleted_at != null);
	await expectError('원문 보관함은 학생이 못 읽는다', () => rowsAs(B.id, 'select * from private.deleted_messages'), 'permission denied');
	check('다시 지워도 그대로', (await rpcAs(A.id, 'delete_message', mid)).status === 'ok');
	await rpcAs(B.id, 'report_partner', room, 'harassment', '');
	const ev = await db.query(`select e.body from private.report_evidence e join private.reports r on r.id = e.report_id where r.room_id = $1 order by e.ord`, [room]);
	check('★ 신고 증거에는 원문 ("[삭제함] …")', ev.rows.some((x) => x.body === '[삭제함] 비밀 이야기'), JSON.stringify(ev.rows));
	const sent2 = await one(`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, 1, '끝난 뒤', gen_random_uuid()) returning id`, [room]).catch(() => null);
	check('끝난 대화의 말은 지울 수 없다', !sent2 || (await rpcAs(A.id, 'delete_message', sent2.id)).status === 'closed');
	await db.query('delete from public.blocks');

	console.log('  [시간]');
	room = await open();
	const left0 = await one(`select expires_at - now() as l from public.rooms where id = $1`, [room]);
	let snap = await rpcAs(A.id, 'room_view', room, true);
	check('★ 한쪽만 보고 있으면 시간이 멈춘다', snap.paused === true && (await one(`select paused_left is not null as p, expires_at = 'infinity' as inf from public.rooms where id = $1`, [room])).inf === true);
	check('멈춘 동안에도 대화는 열려 있다 (쓸 수 있음)', (await rowsAs(A.id, `select public.room_is_writable($1) w`, [room]))[0].w === true);
	check('멈춘 동안 연장 투표는 안 된다', (await rpcAs(A.id, 'vote_extension', room, true)).result === 'too_early');
	const listed = (await rpcAs(A.id, 'my_rooms')).rooms.find((r) => r.room_id === room);
	check('대화 목록: 멈춤 표시 · 남은 시간은 보통 시각으로', listed?.paused === true && !Number.isNaN(Date.parse(listed.expires_at)), JSON.stringify(listed));
	await db.query(`update public.rooms set paused_left = interval '7 minutes' where id = $1`, [room]);
	snap = await rpcAs(B.id, 'room_view', room, true);
	const rr = await one(`select paused_left, round(extract(epoch from expires_at - now())) as sec from public.rooms where id = $1`, [room]);
	check('★ 둘 다 보면 멈춘 곳부터 다시 흐른다', snap.paused === false && rr.paused_left == null && rr.sec >= 418 && rr.sec <= 420, JSON.stringify(rr));
	snap = await rpcAs(B.id, 'room_view', room, false);
	check('★ 한쪽이 떠나면 바로 멈춘다', snap.paused === true);
	await rpcAs(B.id, 'room_view', room, true);
	await db.query(`update public.room_members set viewing_until = now() - interval '5 seconds' where room_id = $1 and seat = 2`, [room]);
	await svc('sweep_rooms').catch(async () => db.query('select public.sweep_rooms()'));
	check('앱이 갑자기 꺼져도 스위퍼가 멈춘다', (await one(`select paused_left is not null as p from public.rooms where id = $1`, [room])).p === true);
	await db.query(`update public.rooms set paused_since = now() - interval '2 days' where id = $1`, [room]);
	await db.query('select public.sweep_rooms()');
	check('하루 넘게 멈춰 있던 대화는 닫힌다', (await one(`select status from public.rooms where id = $1`, [room])).status === 'closed');
	void left0;

	console.log('  [연장 공개 순서 — Phase 29: 학년 → 공통 질문 → 디플로마 → 공통 질문 → 동아리]');
	room = await open();
	await rpcAs(A.id, 'room_view', room, true); await rpcAs(B.id, 'room_view', room, true);
	const toWindow = (id = room) => db.query(`update public.rooms set expires_at = now() + interval '20 seconds' where id = $1`, [id]);
	const lastSys = async () => (await one(`select body from public.messages where room_id = $1 and sender_seat = 0 order by id desc limit 1`, [room])).body;
	await toWindow();
	snap = await rpcAs(A.id, 'room_snapshot', room);
	check('처음엔 공개된 힌트 없음 · 다음 힌트 = 학년', snap.partner_hints.length === 0 && snap.next_hint?.kind === 'grade' && snap.next_hint.typed === false && snap.pin_next === false && snap.pinned === false);
	await rpcAs(A.id, 'vote_extension', room, true);
	let v = await rpcAs(B.id, 'vote_extension', room, true);
	check('★ 10분 째 연장 → 서로의 학년', v.result === 'extended' && JSON.stringify(v.snap.partner_hints) === JSON.stringify([{ kind: 'grade', label: '학년', value: '2학년' }]), JSON.stringify(v.snap.partner_hints));
	check('내 쪽 공개 힌트도 안다', (await rpcAs(A.id, 'room_snapshot', room)).my_hints[0].value === '2학년' && (await rpcAs(A.id, 'room_snapshot', room)).partner_hints[0].value === '1학년');
	check('연장 안내 메시지에 힌트 이름', (await lastSys()).includes('학년 공개'));

	await toWindow();
	snap = await rpcAs(A.id, 'room_snapshot', room);
	const q1 = snap.next_hint?.label;
	check('★ 20분 째는 공통 질문 — 직접 답하는 차례, 둘에게 같은 질문', snap.next_hint?.kind === 'q1' && snap.next_hint.typed === true && !!q1 && q1 === (await rpcAs(B.id, 'room_snapshot', room)).next_hint?.label, JSON.stringify(snap.next_hint));
	check('성씨는 순서에서 빠졌다', !JSON.stringify(snap).includes('성씨'));
	check('★ 답을 안 적으면 연장할 수 없다', (await rpcAs(A.id, 'vote_extension', room, true)).result === 'need_hint');
	check('신상정보가 들어간 답은 안 된다', (await rpcAs(A.id, 'vote_extension', room, true, '010-1234-5678')).result === 'need_hint');
	check('30자 넘는 답은 안 된다', (await rpcAs(A.id, 'vote_extension', room, true, '가'.repeat(31))).result === 'need_hint');
	await rpcAs(A.id, 'vote_extension', room, true, '밴드 음악 듣기 요즘 완전 빠졌어요'); v = await rpcAs(B.id, 'vote_extension', room, true, '러닝');
	check('★ 연장 → 서로의 공통 질문 답 공개 (이름표 = 그 질문)', v.result === 'extended' && v.snap.partner_hints[1]?.kind === 'q1' && v.snap.partner_hints[1].label === q1 && v.snap.partner_hints[1].value === '밴드 음악 듣기 요즘 완전 빠졌어요' && (await rpcAs(A.id, 'room_snapshot', room)).partner_hints[1].value === '러닝', JSON.stringify(v.snap.partner_hints));
	check('안내: 공통 질문 답 공개', (await lastSys()).includes('공통 질문 답 공개'));

	await toWindow();
	snap = await rpcAs(A.id, 'room_snapshot', room);
	check('★ 30분 째는 디플로마 — 직접 적는 차례', snap.next_hint?.kind === 'diploma' && snap.next_hint.typed === true);
	check('디플로마를 안 적으면 연장할 수 없다', (await rpcAs(A.id, 'vote_extension', room, true)).result === 'need_hint');
	check('★ 학교에 없는 디플로마는 안 된다 (목록에서만, Phase 35)', (await rpcAs(A.id, 'vote_extension', room, true, '과학')).result === 'need_hint');
	await rpcAs(A.id, 'vote_extension', room, true, 'IB'); v = await rpcAs(B.id, 'vote_extension', room, true, '물리학');
	check('★ 연장 → 서로가 고른 디플로마', v.result === 'extended' && v.snap.partner_hints[2]?.kind === 'diploma' && v.snap.partner_hints[2].value === 'IB' && (await rpcAs(A.id, 'room_snapshot', room)).partner_hints[2].value === '물리학');

	await toWindow();
	snap = await rpcAs(A.id, 'room_snapshot', room);
	check('★ 40분 째는 두 번째 공통 질문 — 첫 질문과 다르다', snap.next_hint?.kind === 'q2' && snap.next_hint.typed === true && snap.next_hint.label !== q1, JSON.stringify(snap.next_hint));
	await rpcAs(A.id, 'vote_extension', room, true, '가을'); v = await rpcAs(B.id, 'vote_extension', room, true, '겨울');
	check('연장 → 두 번째 답 공개', v.result === 'extended' && v.snap.partner_hints[3]?.value === '가을');

	await toWindow();
	snap = await rpcAs(A.id, 'room_snapshot', room);
	check('★ 50분 째는 동아리', snap.next_hint?.kind === 'club' && snap.next_hint.typed === true && snap.pin_next === false);
	await rpcAs(A.id, 'vote_extension', room, true, '밴드부'); v = await rpcAs(B.id, 'vote_extension', room, true, '방송부');
	check('★ 연장 → 서로의 동아리 · 다섯 가지 전부 공개', v.result === 'extended' && v.snap.partner_hints.length === 5 && v.snap.partner_hints[4].value === '밴드부' && v.snap.next_hint === null, JSON.stringify(v.snap.partner_hints));
	await expectError('힌트 보관함은 학생이 못 읽는다', () => rowsAs(A.id, 'select * from private.room_hints'), 'permission denied');

	console.log('  [대화 고정 — Phase 29]');
	snap = await rpcAs(A.id, 'room_snapshot', room);
	check('동아리 다음 차례는 연장이 아니라 고정 여부', snap.pin_next === true && snap.next_hint === null && snap.pinned === false);
	check('마감 직전 전에는 고정도 못 누른다', (await rpcAs(A.id, 'vote_extension', room, true)).result === 'too_early');
	await toWindow();
	check('고정 차례에는 적을 것이 없다 (힌트 없이 동의)', (await rpcAs(A.id, 'vote_extension', room, true)).result === 'waiting');
	check('상대 화면: 고정을 원한다는 표', (await rpcAs(B.id, 'room_snapshot', room)).partner_vote === true);
	v = await rpcAs(B.id, 'vote_extension', room, true);
	const pr = await one(`select pinned, pinned_at is not null as at, expires_at = 'infinity' as inf, paused_left is null as np from public.rooms where id = $1`, [room]);
	check('★ 둘 다 고정 → 고정됨 · 시간 제한 없음', v.result === 'pinned' && v.snap.pinned === true && v.snap.pin_next === false && pr.pinned && pr.at && pr.inf && pr.np, JSON.stringify(pr));
	check('안내: 둘 다 고정했어요', (await lastSys()).includes('고정'));
	check('고정 뒤에도 공개된 힌트는 그대로', v.snap.partner_hints.length === 5 && v.snap.next_hint === null);
	check('고정한 대화에 또 투표할 수 없다', (await rpcAs(A.id, 'vote_extension', room, true)).result === 'pinned');
	check('고정한 대화는 쓸 수 있다', (await rowsAs(A.id, `select public.room_is_writable($1) w`, [room]))[0].w === true);
	snap = await rpcAs(B.id, 'room_view', room, false);
	check('★ 한쪽이 떠나도 멈추지 않는다 (시간이 없으니)', snap.paused === false && (await one(`select paused_left is null as np from public.rooms where id = $1`, [room])).np);
	await db.query(`update public.room_members set viewing_until = now() - interval '5 seconds' where room_id = $1`, [room]);
	await db.query(`update public.rooms set paused_since = now() - interval '3 days' where id = $1`, [room]);
	await db.query('select public.sweep_rooms()');
	check('★ 스위퍼가 닫지 않는다 (며칠 지나도)', (await one(`select status from public.rooms where id = $1`, [room])).status === 'active');
	await db.query(`update public.rooms set paused_since = null where id = $1`, [room]);

	// 고정한 대화가 목록 맨 위 — 나중에 연 대화에 새 메시지가 있어도
	// (dev_open_room 은 두 사람의 열린 방을 닫으므로 여기서는 직접 만든다)
	const C = await named('이민수', 3);
	const rawRoom = async (u1, u2) => {
		const id = (await one(`insert into public.rooms (status, armed_at, expires_at, alias1, alias2) values ('active', now(), now() + interval '10 minutes', '가람', '나래') returning id`)).id;
		await db.query(`insert into public.room_members (room_id, user_id, seat, joined_at) values ($1, $2, 1, now()), ($1, $3, 2, now())`, [id, u1, u2]);
		return id;
	};
	const other = await rawRoom(A.id, C.id);
	await db.query(`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, 2, '방금', gen_random_uuid())`, [other]);
	const list = (await rpcAs(A.id, 'my_rooms')).rooms;
	check('★ 대화 목록: 고정한 대화가 맨 위', list[0]?.room_id === room && list[0].pinned === true && list.some((r) => r.room_id === other && r.pinned === false), JSON.stringify(list.map((r) => [r.room_id === room, r.pinned])));
	check('★ 고정한 대화는 동시 대화 개수에 세지 않는다', (await one(`select private.open_rooms($1) n`, [A.id])).n === 1);
	await expectError('동시 대화 개수 함수는 학생이 부를 수 없다', () => rowsAs(A.id, 'select private.open_rooms($1)', [A.id]), 'permission denied');

	// 고정을 거절하면 연장 거절과 같이 끝난다
	const r2 = await rawRoom(B.id, C.id);
	await db.query(`update public.rooms set round = 6, expires_at = now() + interval '20 seconds' where id = $1`, [r2]);
	check('다른 방: 고정 차례', (await rpcAs(B.id, 'room_snapshot', r2)).pin_next === true);
	await rpcAs(B.id, 'vote_extension', r2, true);
	v = await rpcAs(C.id, 'vote_extension', r2, false);
	check('★ 한쪽이 고정하지 않으면 대화가 끝난다', v.result === 'declined' && (await one(`select pinned from public.rooms where id = $1`, [r2])).pinned === false);

	// 고정한 대화도 나가면 닫힌다 (그때부터는 보통 대화처럼 24시간 뒤 지워진다)
	await rpcAs(A.id, 'leave_room', room, false);
	check('고정한 대화도 나가면 닫힌다', (await one(`select status from public.rooms where id = $1`, [room])).status === 'closed');
}

console.log('\n[77] 매너 온도 — 평가 · 모아서 반영 · 익명성 (Phase 30)');
{
	await resetPool();
	let no = 21300;
	const mk = async () => {
		const n = ++no;
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set onboarded=true where id=$1', [id]);
		await rpcAs(id, 'ensure_self');
		return { id, email: `${n}@cnsa.hs.kr` };
	};
	const A = await mk(), B = await mk(), C = await mk();
	const temp = async (u) => Number((await one('select manner_temp t from public.profiles where id=$1', [u.id])).t);
	const say = (room, seat) => db.query(`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, $2, '안녕', gen_random_uuid())`, [room, seat]);
	const talk = async (room) => { await say(room, 1); await say(room, 2); await say(room, 1); await say(room, 2); };
	const openRoom = async (x, y) => (await one(`select private.dev_open_room($1, $2, 10) as id`, [x.email, y.email])).id;
	const age = (room, h) => db.query(`update private.ratings set created_at = now() - make_interval(hours => $2) where room_id = $1`, [room, h]);
	const apply = () => db.query('select private.apply_ratings()');
	const rate = async (u, room, score, reasons = []) => (await rpcAs(u.id, 'rate_partner', room, score, reasons)).status;

	check('처음 온도는 40.0도', (await temp(A)) === 40);
	let room = await openRoom(A, B);
	await talk(room);
	check('대화 중에는 평가할 수 없다', (await rate(A, room, 'good')) === 'not_eligible');
	const r0 = await openRoom(A, B); // 앞 방은 닫힌다 (dev_open_room)
	await rpcAs(A.id, 'leave_room', r0, false);
	check('★ 둘 다 말하지 않고 끝난 대화는 평가할 수 없다', (await rate(A, r0, 'good')) === 'not_eligible' && (await rpcAs(A.id, 'room_snapshot', r0)).can_rate === false);

	room = await openRoom(A, B);
	await talk(room);
	await rpcAs(A.id, 'leave_room', room, false);
	let snap = await rpcAs(A.id, 'room_snapshot', room);
	check('★ 둘 다 말한 대화가 끝나면 평가할 수 있다', snap.can_rate === true && snap.rated === false);
	const card = (await rpcAs(B.id, 'pending_ratings')).find((x) => x.room_id === room);
	check('홈 카드: 평가할 대화 · 상대 익명 이름 (uuid 없음)', !!card?.partner_alias && Object.keys(card).sort().join() === 'partner_alias,pinned,room_id', JSON.stringify(card));
	check('좋았는데 "무례해요"는 안 된다', (await rate(A, room, 'good', ['rude'])) === 'bad_input');
	check('없는 이유 칩은 안 된다', (await rate(A, room, 'good', ['xyz'])) === 'bad_input');
	check('★ 평가하기', (await rate(A, room, 'good', ['kind', 'fun'])) === 'ok');
	check('한 대화에 한 번만', (await rate(A, room, 'bad')) === 'already');
	snap = await rpcAs(A.id, 'room_snapshot', room);
	check('평가한 뒤: rated · 더는 못 함', snap.rated === true && snap.can_rate === false);
	check('평가한 대화는 홈 카드에서 빠진다', !(await rpcAs(A.id, 'pending_ratings')).some((x) => x.room_id === room));

	await apply();
	check('★ 바로 반영하지 않는다 (6시간 안에는 그대로)', (await temp(B)) === 40);
	await age(room, 7);
	await apply();
	check('★ 모아서 반영: 좋았어요 +0.3', (await temp(B)) === 40.3);
	check('아쉬운 이유는 세 개까지 고를 수 있다', (await rate(B, room, 'bad', ['rude', 'dry', 'spam'])) === 'ok');
	await age(room, 7);
	await apply();
	check('★ 아쉬웠어요 −0.8, 아쉬운 칩은 2개까지 −0.2씩', (await temp(A)) === 38.8);

	room = await openRoom(A, B);
	await talk(room);
	await rpcAs(B.id, 'leave_room', room, false);
	await rate(A, room, 'good');
	await age(room, 7);
	await apply();
	check('★ 7일 안에 같은 사람을 또 평가하면 세지 않는다', (await temp(B)) === 40.3);

	room = await openRoom(A, C);
	await talk(room);
	await rpcAs(C.id, 'report_partner', room, 'harassment', '');
	check('신고로 끝난 대화는 서로 평가할 수 없다', (await rate(A, room, 'bad')) === 'not_eligible' && (await rate(C, room, 'bad')) === 'not_eligible');
	await db.query('delete from public.blocks');

	room = await openRoom(B, C);
	await talk(room);
	await rpcAs(B.id, 'leave_room', room, false);
	await db.query(`update public.rooms set closed_at = now() - interval '25 hours' where id = $1`, [room]);
	check('닫힌 지 24시간이 지나면 평가할 수 없다', (await rate(B, room, 'good')) === 'not_eligible');

	room = await openRoom(B, C);
	await db.query(`update public.rooms set pinned = true, pinned_at = now(), expires_at = 'infinity' where id = $1`, [room]);
	snap = await rpcAs(B.id, 'room_snapshot', room);
	check('★ 고정한 대화는 말 수 · 기간과 상관없이 평가할 수 있다', snap.can_rate === true && (await rpcAs(B.id, 'pending_ratings')).some((x) => x.room_id === room && x.pinned));
	await db.query('update public.profiles set manner_temp = 98.9 where id = $1', [C.id]);
	await rate(B, room, 'good');
	await age(room, 7);
	await apply();
	check('99도를 넘지 않는다', (await temp(C)) === 99);
	check('상대 프로필에 매너 온도', (await rpcAs(B.id, 'partner_profile', room)).manner_temp === 99);

	await expectError('평가 표는 학생이 못 읽는다', () => rowsAs(A.id, 'select * from private.ratings'), 'permission denied');
	await expectError('★ 온도는 학생이 못 고친다', () => rowsAs(A.id, 'update public.profiles set manner_temp = 99 where id = $1', [A.id]), 'permission denied');
	await expectError('반영 함수는 학생이 못 부른다', () => rowsAs(A.id, 'select private.apply_ratings()'), 'permission denied');
	check('익명 사용자는 평가할 수 없다', await rowsAs(null, `select public.rate_partner($1, 'good')`, [room]).then(() => false, () => true));
}

console.log('\n[78] 업적 — 카운터 · 동/은/금 · 대표 업적 (Phase 31)');
{
	await resetPool();
	let no = 21400;
	const mk = async () => {
		const n = ++no;
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set onboarded=true where id=$1', [id]);
		await rpcAs(id, 'ensure_self');
		return { id, email: `${n}@cnsa.hs.kr` };
	};
	const A = await mk(), B = await mk();
	const stat = async (u, k) => Number((await one('select counts->>$2 v from private.user_stats where user_id = $1', [u.id, k]))?.v ?? 0);
	const tier = async (u, code) => (await one('select tier from private.user_achievements where user_id = $1 and code = $2', [u.id, code]))?.tier ?? 0;
	const openRoom = async (x, y) => (await one(`select private.dev_open_room($1, $2, 10) as id`, [x.email, y.email])).id;
	const say = async (room, seat) => (await one(`insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, $2, '안녕', gen_random_uuid()) returning id`, [room, seat])).id;

	check('카탈로그 29종 (Phase 44 베타 테스터 · Phase 70 극작소 · Phase 71 CNSA 뱃지 셋 포함)', Number((await one('select count(*) n from private.achievement_defs')).n) === 29);

	console.log('  [대화]');
	let room = await openRoom(A, B);
	const m1 = await say(room, 1);
	await say(room, 2);
	await say(room, 1);
	check('★ 보낸 메시지 · 첫마디', (await stat(A, 'msgs')) === 2 && (await stat(B, 'msgs')) === 1 && (await stat(A, 'hello')) === 1 && (await stat(B, 'hello')) === 0);
	await rpcAs(B.id, 'react_message', m1, 'heart');
	await rpcAs(B.id, 'react_message', m1, null);
	await rpcAs(B.id, 'react_message', m1, 'laugh');
	check('★ 받은 공감 — 껐다 켜도 한 번만', (await stat(A, 'hearts')) === 1);
	await rpcAs(A.id, 'react_message', m1, 'heart');
	check('내 메시지에 내가 단 공감은 세지 않는다', (await stat(A, 'hearts')) === 1);
	await db.query(`update public.rooms set round = 2 where id = $1`, [room]);
	check('★ 연장', (await stat(A, 'extends')) === 1 && (await stat(B, 'extends')) === 1);
	await db.query(`update public.rooms set round = 6 where id = $1`, [room]);
	check('★ 동아리까지 공개 (50분)', (await stat(A, 'deep')) === 1);
	await db.query(`insert into private.room_hints (room_id, seat, kind, value) values ($1, 1, 'q1', '러닝')`, [room]);
	check('공통 질문 답', (await stat(A, 'answers')) === 1 && (await stat(B, 'answers')) === 0);
	await db.query(`update public.rooms set pinned = true, round = 7, expires_at = 'infinity' where id = $1`, [room]);
	check('★ 고정 → 고정 친구 · 끝까지 이어간 대화 (연장으로는 안 셈)', (await stat(A, 'pins')) === 1 && (await stat(A, 'chats')) === 1 && (await stat(A, 'extends')) === 2);
	check('★ 동 등급: 고정 친구 1명 · 속 깊은 대화 1번', (await tier(A, 'pin')) === 1 && (await tier(A, 'deep')) === 1);
	await rpcAs(A.id, 'leave_room', room, false);
	check('고정했던 대화를 나가도 두 번 세지 않는다', (await stat(A, 'chats')) === 1);

	room = await openRoom(A, B);
	await db.query(`select public.close_room($1, 'expired')`, [room]);
	check('★ 시간이 다 돼 끝난 대화 = 끝까지 이어간 대화 · 깨끗한 기록', (await stat(B, 'chats')) === 2 && (await stat(B, 'clean')) === 2);
	room = await openRoom(A, B);
	await rpcAs(A.id, 'leave_room', room, true);
	check('중간에 나간 대화는 세지 않는다', (await stat(A, 'chats')) === 2);
	await db.query('update public.profiles set strikes = strikes + 1 where id = $1', [B.id]);
	check('경고를 받으면 깨끗한 기록이 처음부터', (await stat(B, 'clean')) === 0);
	room = await openRoom(A, B);
	await db.query(`select public.close_room($1, 'declined')`, [room]);
	check('경고가 있으면 깨끗한 기록은 안 오른다 (대화 수는 오름)', (await stat(B, 'clean')) === 0 && (await stat(B, 'chats')) === 3);

	console.log('  [등급 · 평가 · 온도]');
	await db.query(`update private.user_stats set counts = counts || '{"extends": 19}' where user_id = $1`, [A.id]);
	room = await openRoom(A, B);
	await db.query(`update public.rooms set round = round + 1 where id = $1`, [room]);
	check('★ 기준을 넘으면 은 등급 (연장 20)', (await tier(A, 'extend')) === 2);
	await db.query(`update private.user_stats set counts = counts || '{"extends": 0}' where user_id = $1`, [A.id]);
	await db.query('select private.award_stat($1, $2, 0)', [A.id, 'extends']);
	check('★ 등급은 내려가지 않는다', (await tier(A, 'extend')) === 2);
	await db.query('update public.profiles set manner_temp = 45.2 where id = $1', [A.id]);
	check('★ 매너 온도 45도 → 따뜻한 사람 은', (await tier(A, 'warm')) === 2);
	room = await openRoom(A, B);
	await say(room, 1); await say(room, 2); await say(room, 1); await say(room, 2);
	await rpcAs(A.id, 'leave_room', room, false);
	await rpcAs(B.id, 'rate_partner', room, 'good', ['kind', 'listen']);
	check('평가를 남기면 성실한 평가자 카운터', (await stat(B, 'rated')) === 1);
	check('반영 전에는 칭찬이 안 쌓인다', (await stat(A, 'kind')) === 0);
	await db.query(`update private.ratings set created_at = now() - interval '7 hours' where room_id = $1`, [room]);
	await db.query('select private.apply_ratings()');
	check('★ 반영되면 "좋았어요" · 칩별 칭찬', (await stat(A, 'good')) === 1 && (await stat(A, 'kind')) === 1 && (await stat(A, 'listen')) === 1 && (await stat(A, 'fun')) === 0);

	console.log('  [편지]');
	const t = (await one(`insert into private.dm_threads (sender_id, recipient_id, sender_alias) values ($1, $2, '푸른 우표') returning id`, [A.id, B.id])).id;
	await db.query(`insert into private.dm_msgs (thread_id, from_sender, body, is_letter, fmt) values ($1, true, '안녕', true, '{"v":1,"m":[]}'::jsonb)`, [t]);
	await db.query(`insert into private.dm_msgs (thread_id, from_sender, body, is_letter) values ($1, true, '또 안녕', true)`, [t]);
	check('★ 편지: 보냄 · 받음 · 꾸밈', (await stat(A, 'letters_sent')) === 2 && (await stat(B, 'letters_got')) === 2 && (await stat(A, 'deco')) === 1 && (await stat(A, 'replies_got')) === 0);
	await db.query(`insert into private.dm_msgs (thread_id, from_sender, body, is_letter) values ($1, false, '답장이야', true)`, [t]);
	check('★ 답장을 받으면 답장 카운터', (await stat(A, 'replies_got')) === 1 && (await stat(B, 'letters_sent')) === 1 && (await stat(B, 'replies_got')) === 0);
	await db.query(`insert into private.dm_msgs (thread_id, from_sender, body, is_letter) values ($1, false, '채팅 한 줄', false)`, [t]);
	check('예전 채팅 줄은 세지 않는다', (await stat(B, 'letters_sent')) === 1);

	console.log('  [연속 접속 · 개척자]');
	await rpcAs(A.id, 'heartbeat', true);
	const rank = Number((await one('select count(*) n from public.profiles o where o.created_at <= (select created_at from public.profiles where id = $1)', [A.id])).n);
	const want = rank <= 100 ? 3 : rank <= 300 ? 2 : rank <= 1000 ? 1 : 0;
	check('처음 접속 = 1일 · 개척자는 가입 순서대로', (await stat(A, 'streak')) === 1 && (await tier(A, 'pioneer')) === want, `rank ${rank}`);
	await rpcAs(A.id, 'heartbeat', true);
	check('같은 날 다시 접속해도 1일', (await stat(A, 'streak')) === 1);
	await db.query(`update private.user_stats set streak_day = streak_day - 1 where user_id = $1`, [A.id]);
	await rpcAs(A.id, 'heartbeat', true);
	check('★ 다음 날 접속하면 2일', (await stat(A, 'streak')) === 2);
	await db.query(`update private.user_stats set streak_day = streak_day - 3 where user_id = $1`, [A.id]);
	await rpcAs(A.id, 'heartbeat', true);
	check('★ 하루라도 빠지면 다시 1일', (await stat(A, 'streak')) === 1);

	console.log('  [보이는 곳]');
	const mine = await rpcAs(A.id, 'my_achievements');
	const ext = mine.items.find((x) => x.code === 'extend');
	check('★ 내 업적: 29종 · 진행도 · 등급 · 새로 딴 것', mine.items.length === 29 && ext.tier === 2 && ext.value === 0 && JSON.stringify(ext.tiers) === '[5,20,50]' && ext.new === true, JSON.stringify(ext));
	check('개척자는 가입 순서 (작을수록 좋음)', mine.items.find((x) => x.code === 'pioneer').lower_better === true);
	check('대표 업적은 자동으로 높은 등급부터 3개', mine.featured.length === 3 && mine.featured.every((x, i, a) => i === 0 || a[i - 1].tier >= x.tier), JSON.stringify(mine.featured));
	check('새 업적 목록', (await rpcAs(A.id, 'new_achievements')).length > 0);
	await rpcAs(A.id, 'mark_achievements_seen');
	check('★ 봤다고 하면 새 업적이 비워진다', (await rpcAs(A.id, 'new_achievements')).length === 0 && !(await rpcAs(A.id, 'my_achievements')).items.some((x) => x.new));
	check('가지지 않은 업적은 대표로 못 고른다', (await rpcAs(A.id, 'set_featured_badges', ['talk'])).status === 'not_owned');
	check('4개는 못 고른다', (await rpcAs(A.id, 'set_featured_badges', ['pin', 'deep', 'warm', 'extend'])).status === 'too_many');
	const fx = await rpcAs(A.id, 'set_featured_badges', ['warm', 'pin']);
	check('★ 대표 업적 고르기 — 고른 순서대로, 남는 자리는 자동', fx.status === 'ok' && fx.featured[0].code === 'warm' && fx.featured[1].code === 'pin' && fx.featured.length === 3, JSON.stringify(fx));
	room = await openRoom(A, B);
	const pp = await rpcAs(B.id, 'partner_profile', room);
	check('★ 상대 프로필: 대표 업적 3개 · 업적 수', pp.badges.length === 3 && pp.badges[0].code === 'warm' && pp.badge_count >= 5, JSON.stringify(pp));
	check('★ 상대 프로필에 uuid 없음', !JSON.stringify(pp).includes(A.id) && !JSON.stringify(pp).includes('user_id'));
	await expectError('카운터 표는 학생이 못 읽는다', () => rowsAs(A.id, 'select * from private.user_stats'), 'permission denied');
	await expectError('업적 표는 학생이 못 읽는다', () => rowsAs(A.id, 'select * from private.user_achievements'), 'permission denied');
	await expectError('카운터를 학생이 못 올린다', () => rowsAs(A.id, `select private.bump($1, 'extends', 100)`, [A.id]), 'permission denied');
	await expectError('★ 대표 업적 칸을 직접 못 고친다', () => rowsAs(A.id, `update public.profiles set featured_badges = '{talk}' where id = $1`, [A.id]), 'permission denied');
}

console.log('\n[79] 익명편지 리뉴얼 — 편지함 · 봉투 열기 · 편지로만 답장 · 성별 (Phase 32)');
{
	let no = 21500;
	const named = async (name, grade, gender) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, onboarded=true where id=$1', [id, gender]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('편지보냄', 1, 'f');   // 이름으로 찾아 보내는 사람 (익명)
	const B = await named('편지받음', 2, 'm');   // 받는 사람
	const X = await named('성별없음', 3, 'x');
	const E = await named('제삼자', 3, 'm');
	const box = async (u, which) => (await rpcAs(u, 'dm_mailbox', which)).letters;

	const s1 = await rpcAs(A, 'dm_send', B, '처음 쓰는 편지', JSON.stringify({ m: [[0, 2, 'b']] }));
	check('편지 보내기', s1.status === 'ok');
	check('★ 보낼 때의 성별이 새겨진다', (await one('select from_gender g from private.dm_msgs where id = $1', [s1.msg_id])).g === 'f');
	let rb = await box(B, 'received');
	const r0 = rb.find((x) => x.id === s1.msg_id);
	check('★ 받은 편지함: 익명 + 성별만 (이름 없음) · 아직 안 엶', r0 && r0.from_gender === 'f' && r0.from_name === null && r0.opened === false && r0.is_reply === false && !JSON.stringify(rb).includes('편지보냄'), JSON.stringify(r0));
	check('받은 편지함에 본문은 없다 (봉투는 열어야 보인다)', !JSON.stringify(rb).includes('처음 쓰는'));
	const sa = (await box(A, 'sent')).find((x) => x.id === s1.msg_id);
	check('★ 보낸 편지함: 받는 사람 이름 · 학년 · 아직 안 읽음', sa && sa.to_name === '편지받음' && sa.to_grade === 2 && sa.opened === false && sa.replied === false, JSON.stringify(sa));
	check('보낸 편지는 내 받은 편지함에 없다', !(await box(A, 'received')).some((x) => x.id === s1.msg_id));
	check('안 연 편지 수', (await rpcAs(B, 'dm_unread')) === 1);

	check('남의 편지는 열 수 없다', (await rpcAs(E, 'dm_open', s1.msg_id)).status === 'not_found');
	const mine = await rpcAs(A, 'dm_open', s1.msg_id);
	check('보낸 사람이 열어 봐도 "읽음"이 되지 않는다', mine.status === 'ok' && mine.role === 'sent' && mine.opened === false && mine.can_reply === false && mine.to_name === '편지받음');
	const op = await rpcAs(B, 'dm_open', s1.msg_id);
	check('★ 받은 사람이 봉투를 열면 본문 · 서식 · From 은 성별만', op.status === 'ok' && op.role === 'received' && op.body === '처음 쓰는 편지' && op.fmt?.m?.length === 1
		&& op.from_gender === 'f' && op.from_name === null && op.can_reply === true && !JSON.stringify(op).includes('편지보냄'), JSON.stringify(op));
	check('★ 열면 보낸 쪽에 "읽음" · 안 연 편지 수가 준다', (await box(A, 'sent')).find((x) => x.id === s1.msg_id).opened === true && (await rpcAs(B, 'dm_unread')) === 0);

	console.log('  [답장]');
	check('★ 보낸 사람은 자기 편지에 답장할 수 없다', (await rpcAs(A, 'dm_reply_to', s1.msg_id, '내가 나에게')).status === 'not_found');
	check('남은 답장할 수 없다', (await rpcAs(E, 'dm_reply_to', s1.msg_id, '끼어들기')).status === 'not_found');
	const rp = await rpcAs(B, 'dm_reply_to', s1.msg_id, '고마워 누구야?');
	check('★ 받은 사람이 편지로 답장', rp.status === 'ok' && rp.thread_id === s1.thread_id);
	const ra = (await box(A, 'received')).find((x) => x.id === rp.msg_id);
	check('★ 답장은 이름으로 (내가 이름으로 찾아 보낸 사람이니까) · 답장 표시', ra && ra.from_name === '편지받음' && ra.is_reply === true && ra.from_gender === 'm', JSON.stringify(ra));
	const sb = (await box(B, 'sent')).find((x) => x.id === rp.msg_id);
	check('★ 답장한 쪽의 보낸 편지함: To 는 "익명의 ○학생" (성별만)', sb && sb.to_name === null && sb.to_gender === 'f', JSON.stringify(sb));
	check('보낸 편지함: 답장이 왔다', (await box(A, 'sent')).find((x) => x.id === s1.msg_id).replied === true);
	const opA = await rpcAs(A, 'dm_open', rp.msg_id);
	check('답장을 열면 From = 이름 · 받은 편지니 답장 가능', opA.from_name === '편지받음' && opA.is_reply === true && opA.can_reply === true);

	console.log('  [예전 채팅 줄 · 3통 · 성별 x]');
	await db.query(`insert into private.dm_msgs (thread_id, from_sender, body, is_letter) values ($1, true, '예전 채팅 한 줄', false)`, [s1.thread_id]);
	check('★ 예전 채팅 줄은 편지함에 안 보인다', !JSON.stringify(await box(B, 'received')).includes('예전') && (await box(B, 'received')).length === 1);
	const s2 = await rpcAs(X, 'dm_send', B, '성별을 안 밝힌 사람');
	check('성별 x → "익명의 학생"으로 (from_gender x)', (await box(B, 'received')).find((x) => x.id === s2.msg_id).from_gender === 'x');
	await rpcAs(X, 'dm_send', B, '두 번째');
	await rpcAs(X, 'dm_send', B, '세 번째');
	check('★ 답 없이 3통이면 상대 차례 (wait_reply)', (await rpcAs(X, 'dm_send', B, '네 번째')).status === 'wait_reply' && (await rpcAs(X, 'dm_open', s2.msg_id)).wait_reply === true);
	const last = (await box(B, 'received'))[0];
	await rpcAs(B, 'dm_reply_to', last.id, '답장');
	check('답장을 받으면 다시 쓸 수 있다', (await rpcAs(X, 'dm_send', B, '네 번째')).status === 'ok');

	console.log('  [끝내기 · 숨김 · 알림]');
	await rpcAs(B, 'dm_close', s2.thread_id);
	// 끝내기(나가기)는 끝낸 사람 편지함에서 그 편지를 치운다 (Phase 25) — 끝낸 뒤엔 어느 쪽도 이어 쓸 수 없다
	check('끝낸 편지에는 답장할 수 없다', (await rpcAs(B, 'dm_reply_to', s2.msg_id, 'x')).status !== 'ok');
	const refused = await rpcAs(X, 'dm_send', B, '다시');
	check('수신 거부 이후 새 편지는 수신자에게 전달하지 않는다', refused.status === 'ok'
		&& (await rpcAs(B, 'dm_open', refused.msg_id)).status === 'not_found');
	check('끝낸 사람 편지함에서 사라진다', !(await box(B, 'received')).some((x) => x.thread_id === s2.thread_id));
	await db.query('update private.dm_threads set recipient_hidden = true where id = $1', [s2.thread_id]);
	check('나간 편지는 편지함에서도 · 열 수도 없다', !(await box(B, 'received')).some((x) => x.thread_id === s2.thread_id) && (await rpcAs(B, 'dm_open', s2.msg_id)).status === 'not_found');
	await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://web.push.apple.com/dm32', 'k', 'x') on conflict do nothing`, [A]);
	await db.query(`update public.user_presence set online_until = now() - interval '1 second' where user_id = $1`, [A]);
	const rp2 = await rpcAs(B, 'dm_reply_to', rp.msg_id - 1, '또 답장');
	const pl = await svc('dm_push_payload', rp2.msg_id, B);
	check('★ 답장 알림: "○○님의 답장이 왔어요" · 본문 없음 · 그 편지로', pl.title === '편지받음님의 답장이 왔어요' && pl.body === '봉투를 열어 확인해 보세요' && pl.url === `/letters/m/${rp2.msg_id}`, JSON.stringify(pl));
	await expectError('로그인 안 하면 편지함을 못 본다', () => rowsAs(null, `select public.dm_mailbox('received')`), 'permission denied');
	check('이상한 편지함 이름은 빈 목록', (await box(A, 'trash')).length === 0);
}

console.log('\n[80] 점검 — 스키마 정리 · 쓰지 않는 RPC 권한 회수 (Phase 34)');
{
	await db.exec(readFileSync(SCHEMA, 'utf8'));
	check('정리한 스키마도 다시 실행해도 안전', true);
	const dup = await one(`select count(*)::int n from (select 1 from regexp_matches($1, 'create or replace function ([a-z_.]+)\\(', 'gi') m group by m[1] having count(*) > 1) x`, [readFileSync(SCHEMA, 'utf8').replace(/drop function[^;]*;/gi, '')]);
	check('★ 함수마다 정의는 한 번 (인자가 바뀐 vote_extension · dm_send 옛 판만 따로)', dup.n === 2, `${dup.n}개 겹침`);
	const stillOpen = [];
	for (const f of LEGACY_RPCS) {
		const r = await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a`);
		if (r.a) stillOpen.push(f);
	}
	check('★ 화면에서 쓰지 않는 학생 RPC 4개 — 학생 실행 권한 없음', LEGACY_RPCS.length === 4 && stillOpen.length === 0, stillOpen.join(', '));
	const old = await one(`select (select count(*)::int from pg_proc where proname in ('letter_feed', 'letter_detail', 'post_letter', 'post_comment', 'set_letter_like',
		'request_letter_reply_task', 'delete_my_letter', 'delete_my_comment', 'block_letter_author', 'report_letter', 'letter_notify', 'admin_letter_post',
		'admin_user_letters', 'admin_remove_letter_content', 'auto_report_letter')) fns,
		(select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname in ('public', 'private')
			and c.relname in ('letters', 'letter_comments', 'letter_participants', 'letter_reply_assignments', 'letter_reply_cooldown', 'letter_likes', 'letter_push_log')) tables`);
	check('★ 옛 공개 편지(Phase 10~15)는 함수 · 표째 없다 (Phase 85)', old.fns === 0 && old.tables === 0, JSON.stringify(old));
	check('이름 편지가 같이 쓰는 것은 남는다 (신고 표 · 한도 · 서식 검사)', (await one(`select to_regclass('private.letter_reports') is not null
		and to_regprocedure('private.letter_bucket_take(uuid, text)') is not null and to_regprocedure('private.letter_fmt_ok(jsonb, text)') is not null a`)).a === true);
	check('편지 답장은 dm_reply_to 로만 (dm_letter 직접 호출 불가)', (await one(`select has_function_privilege('authenticated', 'public.dm_reply_to(bigint, text, jsonb, text)', 'execute') a`)).a === true
		&& (await one(`select has_function_privilege('authenticated', 'public.dm_letter(bigint, text, jsonb, text)', 'execute') a`)).a === false);
	// dm_reply_to 는 안에서 dm_letter 를 부른다 — 학생이 dm_letter 를 직접 못 불러도 답장은 된다 (definer 권한)
	let no80 = 21600;
	const named80 = async (name) => {
		const n = ++no80;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, 1, $2) on conflict (student_no) do update set name = excluded.name', [n, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set onboarded=true where id=$1', [id]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const P = await named80('권한보냄'), Q = await named80('권한받음');
	const s80 = await rpcAs(P, 'dm_send', Q, '권한 확인 편지');
	check('★ dm_letter 를 거둬도 받은 편지에 답장(dm_reply_to)은 된다', s80.status === 'ok' && (await rpcAs(Q, 'dm_reply_to', s80.msg_id, '답장')).status === 'ok');
	await expectError('dm_letter 는 학생이 직접 부를 수 없다', () => rowsAs(Q, `select public.dm_letter($1, 'x')`, [s80.thread_id]), 'permission denied');
	check('지금 쓰는 RPC 는 그대로 (편지함 · 평가 · 업적)', (await one(`select has_function_privilege('authenticated', 'public.dm_mailbox(text, bigint, bigint)', 'execute') and has_function_privilege('authenticated', 'public.rate_partner(uuid, text, text[])', 'execute') and has_function_privilege('authenticated', 'public.my_achievements()', 'execute') a`)).a === true);
}


console.log('\n[81] 편지 서명 · 학번 검색 · 개인 공지 · 실시간 현황 "대화 중" (Phase 35)');
{
	let no81 = 31700;
	const named81 = async (name, gender) => {
		const n = ++no81;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, 2, $2) on conflict (student_no) do update set name = excluded.name', [n, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set onboarded = true, gender = $2 where id = $1', [id, gender]);
		await rpcAs(id, 'ensure_self');
		return { id, no: n };
	};
	const W = await named81('서명쓴이', 'f'), R = await named81('동명이', 'm'), R2 = await named81('동명이', 'm');
	void R2;
	const found = await rpcAs(W.id, 'dm_search', '동명이');
	check('★ 찾기 결과에 학번 — 같은 학년 동명이인을 구분', found.length === 2 && found.every((x) => x.name === '동명이' && x.grade === 2)
		&& new Set(found.map((x) => String(x.no))).size === 2 && found.some((x) => String(x.no) === String(R.no)), JSON.stringify(found));

	check('12자 넘는 서명은 안 된다', (await rpcAs(W.id, 'dm_send', R.id, '안녕', null, '가'.repeat(13))).status === 'bad_nick');
	check('★ 신상정보가 들어간 서명은 안 된다 (규칙 필터)', (await rpcAs(W.id, 'dm_send', R.id, '안녕', null, '010-1234-5678')).status === 'bad_nick');
	check('운영자 사칭 서명은 안 된다', (await rpcAs(W.id, 'dm_send', R.id, '안녕', null, 'CNSA 운영자')).status === 'bad_nick');
	check('앱 이름 사칭 서명은 안 된다', (await rpcAs(W.id, 'dm_send', R.id, '안녕', null, 'Landy')).status === 'bad_nick'
		&& (await rpcAs(W.id, 'dm_send', R.id, '안녕', null, '랜 디')).status === 'bad_nick');
	check('서명이 막히면 편지도 가지 않는다', Number((await one('select count(*) n from private.dm_msgs m join private.dm_threads t on t.id = m.thread_id where t.sender_id = $1', [W.id])).n) === 0);

	await db.query(`update public.app_settings set ai_moderation = true`);
	await db.query(`insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/r81', 'k', 'x') on conflict do nothing`, [R.id]);
	const s1 = await rpcAs(W.id, 'dm_send', R.id, '서명 붙인 편지', null, '  별빛   소녀 ');
	check('서명과 함께 보내진다 (앞뒤 공백 · 겹친 빈칸 정리)', s1.status === 'ok' && (await one('select from_nick from private.dm_msgs where id = $1', [s1.msg_id])).from_nick === '별빛 소녀');
	const inbox = (await rpcAs(R.id, 'dm_mailbox', 'received')).letters;
	check('★ 받은 편지함: From. = 서명 · 성별 (이름 · id 없음)', inbox[0]?.from_nick === '별빛 소녀' && inbox[0].from_gender === 'f' && !inbox[0].from_name
		&& !JSON.stringify(inbox).includes(W.id), JSON.stringify(inbox[0]));
	check('보낸 편지함: 내 서명', (await rpcAs(W.id, 'dm_mailbox', 'sent')).letters[0]?.my_nick === '별빛 소녀');
	const opened = await rpcAs(R.id, 'dm_open', s1.msg_id);
	check('편지 열기: From. = 서명', opened.from_nick === '별빛 소녀' && opened.my_nick == null);
	const pay = await svc('dm_push_payload', s1.msg_id, W.id);
	check('★ 알림 제목에 서명', pay.title === '별빛 소녀에게서 편지가 왔어요', JSON.stringify(pay));

	await db.query(`update private.mod_queue set status = 'done' where not (kind = 'dm' and ref_id = $1)`, [s1.msg_id]);
	const claimed = await svc('mod_claim', 3);
	const mine = claimed.find((c) => c.kind === 'dm');
	check('★ 검열봇(AI 검토)을 켜면 서명도 본문과 함께 검사된다', mine?.text === '[서명: 별빛 소녀] 서명 붙인 편지', JSON.stringify(claimed));
	await db.query(`update public.app_settings set ai_moderation = false`);

	const r1 = await rpcAs(R.id, 'dm_reply_to', s1.msg_id, '답장이에요', null, '가짜 서명');
	check('이름으로 받은 쪽의 답장에는 서명이 붙지 않는다 (이미 이름이 알려져 있다)', r1.status === 'ok'
		&& (await one('select from_nick from private.dm_msgs where id = $1', [r1.msg_id])).from_nick === null);
	const back = await rpcAs(W.id, 'dm_open', r1.msg_id);
	check('답장을 연 익명 쪽: 보낸 사람 이름 · 지난번 내 서명', back.from_name === '동명이' && back.my_nick === '별빛 소녀', JSON.stringify(back));
	check('답장한 쪽의 보낸 편지함: To. = 상대 서명', (await rpcAs(R.id, 'dm_mailbox', 'sent')).letters[0]?.to_nick === '별빛 소녀');
	const r2 = await rpcAs(W.id, 'dm_reply_to', r1.msg_id, '다시 답장', null, '새벽 별');
	check('익명 쪽은 답장에 새 서명을 쓸 수 있다', r2.status === 'ok' && (await one('select from_nick from private.dm_msgs where id = $1', [r2.msg_id])).from_nick === '새벽 별');
	const plain = await rpcAs(R2.id, 'dm_send', R.id, '서명 없이');
	check('서명을 비우면 null — 화면은 "익명의 ○학생"', plain.status === 'ok' && (await one('select from_nick from private.dm_msgs where id = $1', [plain.msg_id])).from_nick === null);

	console.log('  [개인 공지]');
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	await expectError('★ 학생은 개인 공지를 보낼 수 없다', () => rowsAs(W.id, `select public.admin_send_personal_notice($1, $2, 'message', 'x', 'y')`, [W.id, R.id]), 'permission denied');
	await expectError('운영진 명단에 없으면 거절', () => svc('admin_send_personal_notice', W.id, R.id, 'message', 'x', ''), 'not_staff');
	const pn = await svc('admin_send_personal_notice', mod, R.id, 'warning', '대화 매너 경고', '상대를 존중해 주세요');
	check('운영진이 학생 한 명에게 경고를 보낸다 (활동 기록)', Number(pn) > 0
		&& Number((await one(`select count(*) n from private.audit_log where action = 'personal_notice' and target_user = $1`, [R.id])).n) === 1);
	const mineN = await rpcAs(R.id, 'my_notices');
	check('★ 받은 학생의 공지 목록에 개인 공지 (안 읽음)', mineN.personal?.[0]?.title === '대화 매너 경고' && mineN.personal[0].kind === 'warning' && mineN.personal[0].read === false);
	check('★ 다른 학생에게는 보이지 않는다', (await rpcAs(W.id, 'my_notices')).personal.length === 0);
	const pnPush = await svc('personal_notice_push', pn);
	check('개인 공지 알림 (한 번만)', pnPush.title === '운영진 경고' && pnPush.body === '대화 매너 경고' && pnPush.url === '/notices'
		&& (await svc('personal_notice_push', pn)).skip === 'already', JSON.stringify(pnPush));
	await rowsAs(W.id, 'select public.read_personal_notice($1)', [pn]);
	check('★ 남의 개인 공지는 읽음 처리할 수 없다', (await rpcAs(R.id, 'my_notices')).personal[0].read === false);
	await rowsAs(R.id, 'select public.read_personal_notice($1)', [pn]);
	check('읽으면 읽음', (await rpcAs(R.id, 'my_notices')).personal[0].read === true);
	check('운영진 화면: 보낸 개인 공지 · 읽은 시각', !!(await svc('admin_personal_notices', adm, R.id))[0]?.read_at);
	await svc('admin_remove_personal_notice', adm, pn);
	check('거두면 학생 목록에서 사라진다 (기록은 남음)', (await rpcAs(R.id, 'my_notices')).personal.length === 0
		&& Number((await one('select count(*) n from private.personal_notices where id = $1', [pn])).n) === 1);
	await expectError('학생은 개인 공지 표를 직접 못 읽는다', () => rowsAs(R.id, 'select * from private.personal_notices'), 'permission denied');

	console.log('  [실시간 현황 — 둘 다 보고 있을 때만 "대화 중"]');
	await resetPool();
	const c1 = await person('m', 'f'), c2 = await person('f', 'm');
	const room = await pairRoom(c1, c2);
	const st = async () => (await svc('admin_live_users', adm)).find((x) => x.id === c1);
	check('대화방은 있지만 둘 다 보고 있지 않으면 "대화 중"이 아니다', (await st()).room_count === 1 && (await st()).talking === 0);
	await rpcAs(c1, 'room_view', room, true);
	check('한 명만 보고 있어도 아니다', (await st()).talking === 0);
	await rpcAs(c2, 'room_view', room, true);
	check('★ 둘 다 대화 화면을 보고 있으면 "대화 중"', (await st()).talking === 1);
}

console.log('\n[82] 운영진에게 문의하기 (Phase 37)');
{
	const Q = await person('f', 'm'), O = await person('m', 'f');
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	check('종류가 없거나 너무 짧으면 bad_input', (await rpcAs(Q, 'send_inquiry', 'nope', '안녕하세요 문의')).status === 'bad_input'
		&& (await rpcAs(Q, 'send_inquiry', 'use', ' 짧 ')).status === 'bad_input'
		&& (await rpcAs(Q, 'send_inquiry', 'use', '가'.repeat(1001))).status === 'bad_input');
	const q1 = await rpcAs(Q, 'send_inquiry', 'bug', '  편지 봉투가 안 열려요  ');
	check('★ 문의 보내기 (앞뒤 공백 정리)', q1.status === 'ok' && (await one('select body from private.inquiries where id = $1', [q1.id])).body === '편지 봉투가 안 열려요');
	await rpcAs(Q, 'send_inquiry', 'use', '두 번째 문의입니다');
	await rpcAs(Q, 'send_inquiry', 'etc', '세 번째 문의입니다');
	check('★ 답을 못 받은 문의는 3개까지', (await rpcAs(Q, 'send_inquiry', 'etc', '네 번째 문의입니다')).status === 'too_many');
	const mine = await rpcAs(Q, 'my_inquiries');
	check('내 문의 목록 (최근 순 · 답변 없음)', mine.length === 3 && mine[0].body === '세 번째 문의입니다' && mine.every((x) => x.answer === null) && !JSON.stringify(mine).includes(Q));
	check('★ 남의 문의는 안 보인다', (await rpcAs(O, 'my_inquiries')).length === 0);
	await expectError('학생은 문의 표를 직접 못 읽는다', () => rowsAs(Q, 'select * from private.inquiries'), 'permission denied');
	await expectError('★ 학생은 운영진 문의 목록을 못 부른다', () => rowsAs(Q, 'select public.admin_inquiries($1)', [Q]), 'permission denied');
	await expectError('학생은 답변할 수 없다', () => rowsAs(Q, `select public.admin_answer_inquiry($1, $2, '답')`, [Q, q1.id]), 'permission denied');
	await expectError('운영진 명단에 없으면 거절', () => svc('admin_inquiries', O), 'not_staff');

	const list = await svc('admin_inquiries', mod);
	const openIds = list.items.filter((x) => !x.answered_at).map((x) => x.id);
	check('★ 운영진 목록: 답을 기다리는 문의 수 · 오래된 것부터', list.open >= 3 && openIds.indexOf(q1.id) >= 0
		&& openIds.every((x, i) => i === 0 || openIds[i - 1] < x), JSON.stringify(openIds));
	await expectError('빈 답변은 안 된다', () => svc('admin_answer_inquiry', mod, q1.id, '  '), 'bad_answer');
	const nid = await svc('admin_answer_inquiry', mod, q1.id, '새로고침 후 다시 열어 보세요!');
	check('★ 답변 → 그 학생에게 개인 공지 (하트 · 공지에 뜬다)', (await rpcAs(Q, 'my_notices')).personal.some((n) => n.id === nid && n.title === '문의하신 내용에 답변드려요' && n.body === '새로고침 후 다시 열어 보세요!')
		&& (await rpcAs(O, 'my_notices')).personal.length === 0);
	check('★ 내 문의 목록에도 답변', (await rpcAs(Q, 'my_inquiries')).find((x) => x.id === q1.id)?.answer === '새로고침 후 다시 열어 보세요!');
	check('답변은 활동 기록에 남는다', Number((await one(`select count(*) n from private.audit_log where action = 'answer_inquiry' and target_user = $1`, [Q])).n) === 1);
	await expectError('같은 문의에 두 번 답할 수 없다', () => svc('admin_answer_inquiry', adm, q1.id, '또 답'), 'already_answered');
	check('답을 받으면 다시 보낼 수 있다 (답 못 받은 문의 2개)', (await rpcAs(Q, 'send_inquiry', 'account', '네 번째 문의입니다')).status === 'ok');
	check('★ 하루 5개까지', (await rpcAs(Q, 'send_inquiry', 'etc', '다섯 번째 문의')).status === 'too_many');
	await db.query(`update private.inquiries set answered_at = now(), answer = 'x' where user_id = $1`, [Q]);
	check('답을 다 받아도 하루 5개를 넘으면 rate', (await rpcAs(Q, 'send_inquiry', 'etc', '다섯 번째 문의')).status === 'ok'
		&& (await rpcAs(Q, 'send_inquiry', 'etc', '여섯 번째 문의')).status === 'rate');
}

console.log('\n[83] 알림 종류별로 끄기 (Phase 43)');
{
	await resetPool();
	const s = await person('m', 'f');
	const t = await person('f', 'm');
	const P256 = 'B' + 'x'.repeat(86);
	const EP = 'https://fcm.googleapis.com/fcm/send/mute-t';
	await rpcAs(t, 'save_push_subscription', EP, P256, 'a'.repeat(22));
	const muteOf = async () => (await one('select mute from public.push_subscriptions where endpoint = $1', [EP])).mute;
	check('처음엔 아무것도 끄지 않았다', (await muteOf()).length === 0);
	await rpcAs(t, 'set_push_mute', EP, ['letter', 'chat', 'chat', 'notice', 'hack']);
	check('★ 알려진 종류만 · 중복 없이 저장 (운영진 공지는 끌 수 없다)', JSON.stringify(await muteOf()) === '["chat","letter"]', JSON.stringify(await muteOf()));
	await rpcAs(s, 'set_push_mute', EP, []);
	check('★ 남의 기기 설정은 못 바꾼다', JSON.stringify(await muteOf()) === '["chat","letter"]');
	await rpcAs(t, 'save_push_subscription', EP, P256, 'a'.repeat(22));
	check('구독을 다시 저장해도(로그인) 끈 종류는 그대로', JSON.stringify(await muteOf()) === '["chat","letter"]');
	await expectError('로그인 안 하면 거절', () => rowsAs(null, `select public.set_push_mute('x', '{}')`), 'permission denied');

	const r = await pairRoom(s, t);
	const sSeat = (await rpcAs(s, 'room_snapshot', r)).my_seat;
	await sendIn(s, r, sSeat, '알림 꺼 둔 사람에게');
	const mid = (await one('select max(id)::int m from public.messages where room_id = $1', [r])).m;
	const p = await svc('push_payload', mid, s);
	check('★ 발송 판단은 기기마다 끈 종류를 같이 돌려준다 (서버가 거른다)', p.subs?.length === 1 && JSON.stringify(p.subs[0].mute) === '["chat","letter"]', JSON.stringify(p));
	await rpcAs(t, 'set_push_mute', EP, null);
	check('비우면 다시 모두 받는다', (await muteOf()).length === 0);
}

console.log('\n[84] 특별 업적(베타 테스터) · 업적 카탈로그 · 익명편지 잠금 (Phase 44)');
{
	const X = await person('m', 'f'), Y = await person('f', 'm');
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;

	// 카탈로그 — 누구나(로그인한 학생) 설명 · 기준을 본다
	const cat = await rpcAs(X, 'achievement_catalog');
	const beta = cat.find((d) => d.code === 'beta');
	check('★ 카탈로그: 29종 · 설명 · 등급 기준 · 베타 테스터는 운영진이 주는 업적', cat.length === 29 && beta?.granted === true && beta.title === '베타 테스터'
		&& JSON.stringify(cat.find((d) => d.code === 'extend').tiers) === '[5,20,50]' && cat.find((d) => d.code === 'extend').granted === false, JSON.stringify(beta));
	await expectError('비로그인은 카탈로그를 못 본다', () => rowsAs(null, 'select public.achievement_catalog()'), 'permission denied');
	check('내 업적에도 granted 가 온다 (아직 없음)', (await rpcAs(X, 'my_achievements')).items.find((a) => a.code === 'beta')?.granted === true
		&& (await rpcAs(X, 'my_achievements')).items.find((a) => a.code === 'beta')?.tier === 0);

	// 주기 · 거두기 — 운영진 누구나, 기록에 남는다
	await expectError('★ 학생은 업적을 줄 수 없다', () => rowsAs(X, `select public.admin_set_badge($1, $1, 'beta', true)`, [X]), 'permission denied');
	await expectError('운영진 명단에 없으면 거절', () => svc('admin_set_badge', X, Y, 'beta', true), 'not_staff');
	await expectError('★ 기준으로 따는 업적은 줄 수 없다', () => svc('admin_set_badge', mod, X, 'talk', true), 'not_grantable');
	const got = await svc('admin_set_badge', mod, X, 'beta', true);
	check('★ 운영진이 베타 테스터를 준다 → 가진 것으로', got.find((b) => b.code === 'beta')?.has === true);
	check('★ 새 업적 축하에 뜬다', (await rpcAs(X, 'new_achievements')).some((b) => b.code === 'beta'));
	await svc('admin_set_badge', adm, X, 'beta', true);
	check('두 번 줘도 하나', Number((await one(`select count(*) n from private.user_achievements where user_id = $1 and code = 'beta'`, [X])).n) === 1);
	check('대표 업적(자동)에 들어간다', (await rpcAs(X, 'set_featured_badges', ['beta'])).status === 'ok'
		&& (await one('select featured_badges from public.profiles where id = $1', [X])).featured_badges.includes('beta'));
	await svc('admin_set_badge', mod, X, 'beta', false);
	check('★ 거두면 없어지고 대표 업적에서도 빠진다', !(await svc('admin_user_badges', adm, X)).find((b) => b.code === 'beta').has
		&& !(await one('select featured_badges from public.profiles where id = $1', [X])).featured_badges.includes('beta'));
	check('주고 거둔 것은 기록에 남는다', Number((await one(`select count(*) n from private.audit_log where action in ('grant_badge', 'revoke_badge') and target_user = $1`, [X])).n) === 3);

	// 익명편지 잠금
	const students = async () => (await one('select students from public.signup_stats')).students;
	const real = Number((await one('select count(*) n from public.profiles where verified and onboarded')).n);
	check('★ 가입 인원 = 학교 인증 + 시작하기까지 마친 학생 수', (await students()) === real, `${await students()} vs ${real}`);
	const before = await students();
	const Z = await person('f', 'm');
	check('★ 새로 가입하면 바로 늘어난다 (Realtime 으로 앱이 본다)', (await students()) === before + 1);
	check('학생은 가입 인원을 읽을 수 있다 (숫자 하나)', (await rowsAs(Y, 'select students from public.signup_stats')).length === 1);
	await expectError('학생은 가입 인원을 못 바꾼다', () => rowsAs(Y, 'update public.signup_stats set students = 999'), 'permission denied');

	await svc('admin_update_settings', JSON.stringify({ letters_gate: true, letters_gate_min: before + 100 }), adm);
	check('★ 잠겨 있으면 편지를 못 쓴다', (await rpcAs(Y, 'dm_send', Z, '안녕', null, null)).status === 'letters_locked');
	check('★ 잠겨 있으면 찾기도 비어 있다', (await rpcAs(Y, 'dm_search', '가나')).length === 0);
	await svc('admin_update_settings', JSON.stringify({ letters_gate_min: 1 }), adm);
	check('★ 가입 인원이 기준을 넘으면 저절로 열린다', (await rpcAs(Y, 'dm_send', Z, '안녕', null, null)).status !== 'letters_locked');
	await svc('admin_update_settings', JSON.stringify({ letters_gate_min: before + 100 }), adm);
	await svc('admin_update_settings', JSON.stringify({ letters_gate: false }), adm);
	check('★ 운영자가 잠금을 끄면 바로 열린다', (await rpcAs(Y, 'dm_send', Z, '또 안녕', null, null)).status !== 'letters_locked');
	await expectError('운영진(관리자 아님)은 잠금을 못 바꾼다', () => svc('admin_update_settings', JSON.stringify({ letters_gate: true }), mod), 'admin_only');
	await expectError('기준은 1명 이상', () => svc('admin_update_settings', JSON.stringify({ letters_gate_min: 0 }), adm), 'app_settings_letters_gate_min');
}

console.log('\n[85] 편지 폴더 — 여러 통 골라 폴더에 · 빼기 · 이름 바꾸기 · 지우기 (Phase 47)');
{
	let no = 27500;
	const named = async (name, grade, gender) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, onboarded=true where id=$1', [id, gender]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('폴더보냄', 1, 'f');
	const B = await named('폴더받음', 2, 'm');
	const C = await named('폴더셋째', 3, 'f');
	const E = await named('폴더남', 3, 'm');
	const box = async (u, which) => (await rpcAs(u, 'dm_mailbox', which)).letters.map((x) => x.id);
	const s1 = await rpcAs(A, 'dm_send', B, '첫 편지');
	const s2 = await rpcAs(C, 'dm_send', B, '다른 사람 편지');
	const s3 = await rpcAs(B, 'dm_send', E, '내가 보낸 편지');
	const s4 = await rpcAs(A, 'dm_send', B, '두 번째 편지');
	check('편지 넷 준비', [s1, s2, s3, s4].every((x) => x.status === 'ok'), JSON.stringify([s1, s2, s3, s4]));
	await rpcAs(B, 'dm_open', s1.msg_id);
	await rpcAs(B, 'dm_open', s2.msg_id);

	const first = await rpcAs(B, 'dm_mailbox', 'received');
	check('처음엔 폴더 없음 (편지함 첫 쪽에 폴더 목록이 같이 온다)', JSON.stringify(first.folders) === '[]' && first.letters.every((x) => x.box === 'received'));
	const put = await rpcAs(B, 'dm_folder_put', [s1.msg_id, s2.msg_id, s3.msg_id, s4.msg_id], null, '  고마운   편지 ');
	check('★ 여러 통을 골라 새 폴더에 — 이름은 공백 정리, 안 연 편지(s4)는 빠진다', put.status === 'ok' && put.folder.name === '고마운 편지' && put.moved === 3, JSON.stringify(put));
	const fid = put.folder.id;
	check('★ 폴더에 넣은 편지는 받은/보낸 편지 목록에서 빠진다 (안 연 편지는 그대로)', JSON.stringify(await box(B, 'received')) === JSON.stringify([s4.msg_id]) && (await box(B, 'sent')).length === 0);
	const inF = await rpcAs(B, 'dm_mailbox', 'received', null, fid);
	check('★ 폴더를 열면 받은 · 보낸 편지가 섞여서 · 편지마다 box · 폴더 이름', inF.folder.name === '고마운 편지'
		&& JSON.stringify(inF.letters.map((x) => [x.id, x.box])) === JSON.stringify([[s3.msg_id, 'sent'], [s2.msg_id, 'received'], [s1.msg_id, 'received']]), JSON.stringify(inF));
	check('★ 폴더를 열면 편지 수도 — 전체 · 받은 편지 · 보낸 편지 (Phase 47-3)', inF.folder.count === 3 && inF.folder.received === 2 && inF.folder.sent === 1, JSON.stringify(inF.folder));
	const fl = (await rpcAs(B, 'dm_mailbox', 'sent')).folders;
	check('폴더 목록에 이름 · 편지 수(전체 · 받은 · 보낸)', fl.length === 1 && fl[0].id === fid && fl[0].name === '고마운 편지' && fl[0].count === 3 && fl[0].received === 2 && fl[0].sent === 1, JSON.stringify(fl));
	check('다음 쪽(p_before)에는 폴더 목록을 다시 싣지 않는다', (await rpcAs(B, 'dm_mailbox', 'received', s4.msg_id + 1)).folders == null);

	const again = await rpcAs(B, 'dm_folder_put', [s1.msg_id], null, '고마운 편지');
	check('★ 같은 이름이면 그 폴더에 — 새로 만들지 않는다', again.folder.id === fid && Number((await one('select count(*) n from private.dm_folders where owner_id = $1', [B])).n) === 1);
	const f2 = await rpcAs(B, 'dm_folder_put', [s1.msg_id], null, '보관');
	check('★ 다른 폴더에 넣으면 옮겨 간다 (한 편지는 한 폴더에만)', f2.status === 'ok' && (await rpcAs(B, 'dm_mailbox', 'received', null, fid)).letters.length === 2
		&& (await rpcAs(B, 'dm_mailbox', 'received', null, f2.folder.id)).letters.map((x) => x.id).join() === String(s1.msg_id));
	check('있는 폴더를 번호로 골라 넣기', (await rpcAs(B, 'dm_folder_put', [s1.msg_id], fid, null)).folder.id === fid);

	check('빈 이름은 안 된다', (await rpcAs(B, 'dm_folder_put', [s1.msg_id], null, '   ')).status === 'bad_name');
	check('이름은 20자까지', (await rpcAs(B, 'dm_folder_put', [s1.msg_id], null, '가'.repeat(21))).status === 'bad_name');
	check('빈 목록은 안 된다', (await rpcAs(B, 'dm_folder_put', [], null, '빈')).status === 'bad_request');
	check('★ 남의 폴더에는 못 넣는다', (await rpcAs(A, 'dm_folder_put', [s1.msg_id], fid, null)).status === 'not_found');
	const stolen = await rpcAs(E, 'dm_folder_put', [s1.msg_id, s2.msg_id], null, '남의 편지');
	check('★ 남의 편지는 내 폴더에 안 들어간다', stolen.status === 'ok' && stolen.moved === 0 && (await rpcAs(E, 'dm_mailbox', 'received', null, stolen.folder.id)).letters.length === 0);
	check('★ 상대 쪽에는 아무것도 바뀌지 않는다 (A 의 보낸 편지 그대로)', (await box(A, 'sent')).includes(s1.msg_id));
	await expectError('★ 폴더 표는 직접 못 읽는다', () => rowsAs(B, 'select * from private.dm_folders'), 'permission denied');
	await expectError('로그인 안 하면 못 부른다', () => rowsAs(null, `select public.dm_folder_put('{1}'::bigint[], null, 'x')`), 'permission denied');

	check('★ 폴더에서 빼면 보관함으로 돌아온다', (await rpcAs(B, 'dm_folder_take', [s3.msg_id])).moved === 1 && (await box(B, 'sent')).includes(s3.msg_id));
	check('이름 바꾸기', (await rpcAs(B, 'dm_folder_rename', fid, '소중한 편지')).status === 'ok' && (await rpcAs(B, 'dm_mailbox', 'received', null, fid)).folder.name === '소중한 편지');
	check('다른 폴더와 같은 이름으로는 못 바꾼다', (await rpcAs(B, 'dm_folder_rename', fid, '보관')).status === 'exists');
	check('남의 폴더 이름은 못 바꾼다', (await rpcAs(A, 'dm_folder_rename', fid, '해킹')).status === 'not_found');

	await rpcAs(B, 'dm_close', s2.thread_id);
	const fAfter = (await rpcAs(B, 'dm_mailbox', 'received')).folders.find((f) => f.id === fid);
	check('★ 버린 편지는 폴더에서도 안 보이고 수에서도 빠진다', !(await rpcAs(B, 'dm_mailbox', 'received', null, fid)).letters.some((x) => x.id === s2.msg_id)
		&& fAfter.count === 1 && fAfter.received === 1 && fAfter.sent === 0, JSON.stringify(fAfter));

	check('남의 폴더는 못 지운다', (await rpcAs(A, 'dm_folder_delete', fid)).status === 'not_found');
	check('★ 폴더를 지우면 편지는 보관함으로 돌아온다 (지워지지 않는다)', (await rpcAs(B, 'dm_folder_delete', fid)).status === 'ok' && (await box(B, 'received')).includes(s1.msg_id)
		&& Number((await one('select count(*) n from private.dm_msgs where id = $1', [s1.msg_id])).n) === 1);
	for (let i = 0; i < 29; i++) await rpcAs(B, 'dm_folder_put', [s1.msg_id], null, `폴더${i}`);
	check('폴더는 30개까지', (await rpcAs(B, 'dm_folder_put', [s1.msg_id], null, '서른한째')).status === 'too_many');
	check('없는 폴더를 열면 빈 목록', (await rpcAs(B, 'dm_mailbox', 'received', null, 999999)).letters.length === 0);
}

console.log('\n[86] 운영자 · 개발자 · 관리자 역할 나누기 · 운영진 현황 (Phase 49)');
{
	const dev = await person('m', 'f');
	const mod = await person('f', 'm');
	const adm = await person('m', 'm');
	const kid = await person('f', 'f');
	await db.query(`insert into private.staff (user_id, role, display_name) values ($1, 'developer', '개발'), ($2, 'moderator', null), ($3, 'admin', null)`, [dev, mod, adm]);
	const t = await svc('admin_staff_touch', dev, '/admin/settings');
	check('★ 개발자 역할 · 현황 판에 팀 · 지금 보는 화면', t.role === 'developer' && t.team.length >= 3 && t.team.find((x) => x.me)?.path === '/admin/settings' && t.team.find((x) => x.me)?.name === '개발', JSON.stringify(t).slice(0, 300));
	check('경로 없이 부르면(현황 새로고침) 화면은 그대로', (await svc('admin_staff_touch', dev, null)).team.find((x) => x.me).path === '/admin/settings');
	check('명단에 없으면 null', (await svc('admin_staff_touch', kid, '/admin')) === null);
	await expectError('없는 역할은 못 넣는다', () => db.query(`update private.staff set role = 'owner' where user_id = $1`, [dev]), 'check');
	// 개발자: 설정 · 금칙어 · 문의 · 실시간은 되고, 학생을 다루는 조치는 안 된다
	check('★ 개발자: 운영 수치 변경 가능', (await svc('admin_update_settings', JSON.stringify({ room_minutes: 6 }), dev)).room_minutes === 6);
	await svc('admin_update_settings', JSON.stringify({ room_minutes: 5 }), adm);
	check('개발자: 금칙어 저장 가능', (await svc('admin_set_banned_terms', ['바\\s*보'], dev)) != null);
	await svc('admin_set_banned_terms', [], adm);
	check('개발자: 문의 목록 · 실시간 · 공지 목록', typeof (await svc('admin_inquiries', dev)).open === 'number' && Array.isArray(await svc('admin_live_users', dev)) && Array.isArray(await svc('admin_notices', dev)));
	await expectError('★ 개발자: 제재 불가', () => svc('admin_sanction', kid, 'warn', null, dev, null, ''), 'no_permission');
	await expectError('★ 개발자: 사용자 상세 불가', () => svc('admin_user', kid, dev), 'no_permission');
	await expectError('★ 개발자: 신원 열람 불가', () => svc('admin_log_identity_view', dev, [kid], null), 'admin_only');
	await expectError('개발자: 공지 올리기 불가', () => svc('admin_post_notice', dev, '제목', ''), 'admin_only');
	// 운영자: 조치는 되고 설정 수치는 안 된다 (그대로)
	await expectError('★ 운영자: 금칙어 변경 불가', () => svc('admin_set_banned_terms', ['x'], mod), 'admin_only');
	check('운영자: 서비스 열고 닫기 가능', (await svc('admin_update_settings', JSON.stringify({ is_open: true }), mod)).is_open === true);
}

console.log('\n[87] 최고 관리자 · 운영진 관리 (Phase 50)');
{
	const own = await signUp('27901@cnsa.hs.kr', true);
	const adm2 = await signUp('27902@cnsa.hs.kr', true);
	const kid = await signUp('27903@cnsa.hs.kr', true);
	await db.query(`insert into private.staff (user_id, role, owner) values ($1, 'admin', true), ($2, 'admin', false)`, [own, adm2]);
	await expectError('★ 최고 관리자는 한 명뿐', () => db.query(`update private.staff set owner = true where user_id = $1`, [adm2]), 'staff_one_owner');
	await expectError('최고 관리자는 관리자여야', () => db.query(`update private.staff set role = 'moderator' where user_id = $1`, [own]), 'staff_owner_admin');
	check('★ touch 에 owner 표시', (await svc('admin_staff_touch', own, null)).owner === true && (await svc('admin_staff_touch', adm2, null)).owner === false);
	await expectError('★ 다른 관리자는 운영진 명단을 못 본다', () => svc('admin_staff_list', adm2), 'owner_only');
	await expectError('★ 다른 관리자는 운영진을 못 정한다', () => svc('admin_staff_set', adm2, '27903', 'moderator', null), 'owner_only');
	const l1 = await svc('admin_staff_set', own, '27903', 'developer', '  코딩왕 ');
	const k1 = l1.find((x) => x.id === kid);
	check('★ 최고 관리자: 학번으로 개발자 지정 · 표시 이름', k1?.role === 'developer' && k1.display_name === '코딩왕' && k1.no === '27903', JSON.stringify(k1));
	check('역할 바꾸기', (await svc('admin_staff_set', own, '27903', 'moderator', '코딩왕')).find((x) => x.id === kid).role === 'moderator');
	await expectError('없는 학번', () => svc('admin_staff_set', own, '99999', 'moderator', null), 'user_not_found');
	await expectError('없는 역할', () => svc('admin_staff_set', own, '27903', 'owner', null), 'bad_role');
	await expectError('★ 최고 관리자 자신은 여기서 못 바꾼다', () => svc('admin_staff_set', own, '27901', 'moderator', null), 'owner_locked');
	check('★ 빼기 (역할 없음)', !(await svc('admin_staff_set', own, '27903', null, null)).some((x) => x.id === kid) && (await svc('admin_staff_role', kid)) === null);
	check('기록에 남는다', Number((await one(`select count(*) n from private.audit_log where action = 'set_staff' and staff_id = $1`, [own])).n) === 3);
}

console.log('\n[88] 베타테스터 · 역할별 권한을 최고 관리자가 정한다 (Phase 51)');
{
	const own = (await one(`select user_id from private.staff where owner`)).user_id;
	const other = await signUp('27904@cnsa.hs.kr', true);
	await db.query(`insert into private.staff (user_id, role) values ($1, 'admin')`, [other]);
	const b = (await svc('admin_staff_set', own, '27903', 'beta', '베타')).find((x) => x.no === '27903');
	check('★ 베타테스터 지정', b?.role === 'beta');
	const tb = await svc('admin_staff_touch', b.id, null);
	check('★ 베타테스터 처음 권한 = 실시간만 (touch 의 perms)', JSON.stringify(tb.perms) === '["live"]', JSON.stringify(tb.perms));
	check('베타테스터: 실시간 가능', Array.isArray(await svc('admin_live_users', b.id)));
	await expectError('★ 베타테스터: 문의 불가', () => svc('admin_inquiries', b.id), 'no_permission');
	await expectError('★ 베타테스터: 제재 불가', () => svc('admin_sanction', other, 'warn', null, b.id, null, ''), 'no_permission');
	await expectError('베타테스터: 설정 불가', () => svc('admin_update_settings', JSON.stringify({ is_open: true }), b.id), 'no_permission');
	check('관리자는 늘 전부 (perms 8개)', (await svc('admin_staff_touch', other, null)).perms.length === 8);
	await expectError('★ 다른 관리자는 권한 표를 못 바꾼다', () => svc('admin_set_role_perms', other, 'beta', ['live', 'inquiry']), 'owner_only');
	const after = await svc('admin_set_role_perms', own, 'beta', ['live', 'inquiry', 'inquiry']);
	check('★ 최고 관리자: 베타테스터에 문의 권한 주기', JSON.stringify(after.beta) === '["inquiry","live"]', JSON.stringify(after));
	check('★ 바꾸면 바로 적용 — 베타테스터 문의 가능', typeof (await svc('admin_inquiries', b.id)).open === 'number');
	await expectError('관리자 역할 권한은 못 바꾼다', () => svc('admin_set_role_perms', own, 'admin', []), 'bad_role');
	await expectError('없는 권한', () => svc('admin_set_role_perms', own, 'beta', ['root']), 'bad_perm');
	await svc('admin_set_role_perms', own, 'moderator', ['live', 'service', 'inquiry', 'audit']);
	const modId = (await one(`select user_id from private.staff where role = 'moderator' limit 1`)).user_id;
	await expectError('★ 운영자에게서 신고 처리를 빼면 제재도 막힌다', () => svc('admin_sanction', other, 'warn', null, modId, null, ''), 'no_permission');
	await svc('admin_set_role_perms', own, 'moderator', ['live', 'moderate', 'service', 'inquiry', 'audit']);
	check('권한 바꾸기도 기록에 남는다', Number((await one(`select count(*) n from private.audit_log where action = 'set_role_perms'`)).n) === 3);
}

console.log('\n[89] 서버 점검 (Phase 52)');
{
	const own = (await one(`select user_id from private.staff where owner`)).user_id;
	const b = (await one(`select user_id from private.staff where role = 'beta' limit 1`)).user_id;
	const kid = await person('m', 'f');
	check('평소엔 heartbeat 에 점검 없음', (await rpcAs(kid, 'heartbeat', true)).maintenance == null);
	await expectError('★ 서비스 권한 없는 역할(베타테스터)은 점검을 못 켠다', () => svc('admin_update_settings', JSON.stringify({ maintenance: true }), b), 'no_permission');
	const until = new Date(Date.now() + 3600_000).toISOString();
	const st = await svc('admin_update_settings', JSON.stringify({ maintenance: true, maintenance_msg: '서버 점검 중이에요', maintenance_until: until }), own);
	check('★ 점검 켜기 (문구 · 끝나는 시각)', st.maintenance === true && st.maintenance_msg === '서버 점검 중이에요' && !!st.maintenance_until);
	const hb = await rpcAs(kid, 'heartbeat', true);
	check('★ 학생 heartbeat 대답에 점검 안내', hb.maintenance?.msg === '서버 점검 중이에요' && !!hb.maintenance?.until, JSON.stringify(hb));
	check('★ 점검 중엔 새 대화 찾기 막힘', (await rpcAs(kid, 'request_match')).status === 'service_closed');
	check('운영 화면(touch)에도 점검 중 표시', (await svc('admin_staff_touch', own, null)).maintenance === true);
	check('설정 표에서도 읽힌다 (앱을 열 때)',(await rowsAs(kid, 'select maintenance from public.app_settings'))[0]?.maintenance === true);
	const off = await svc('admin_update_settings', JSON.stringify({ maintenance: false, maintenance_until: '' }), own);
	check('★ 점검 끄기 · 끝나는 시각 지우기', off.maintenance === false && off.maintenance_until === null && (await rpcAs(kid, 'heartbeat', true)).maintenance == null);
}

console.log('\n[90] 점검 예약 (Phase 53)');
{
	const own = (await one(`select user_id from private.staff where owner`)).user_id;
	const kid = await person('f', 'm');
	const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
	await svc('admin_update_settings', JSON.stringify({ maintenance: false, maintenance_at: soon, maintenance_msg: '예약 점검' }), own);
	const hb1 = await rpcAs(kid, 'heartbeat', true);
	check('★ 예약만 — 아직 점검 아님 · heartbeat 에 예고(24시간 안)', hb1.maintenance == null && !!hb1.maintenance_at, JSON.stringify(hb1));
	check('예약 중에도 새 대화는 된다', (await rpcAs(kid, 'request_match')).status !== 'service_closed');
	check('운영 화면(touch)에 예약 시각', !!(await svc('admin_staff_touch', own, null)).maintenance_at && (await svc('admin_staff_touch', own, null)).maintenance === false);
	await db.query(`update public.app_settings set maintenance_at = now() - interval '1 minute' where id`); // 시각이 지났다
	const hb2 = await rpcAs(kid, 'heartbeat', true);
	check('★ 예약 시각이 지나면 저절로 점검 중 (heartbeat · 새 대화 막힘 · touch)', hb2.maintenance?.msg === '예약 점검' && hb2.maintenance_at == null
		&& (await rpcAs(kid, 'request_match')).status === 'service_closed' && (await svc('admin_staff_touch', own, null)).maintenance === true, JSON.stringify(hb2));
	await svc('admin_update_settings', JSON.stringify({ maintenance: false, maintenance_at: '' }), own);
	check('★ 점검 끝내기 = 예약도 지운다', (await rpcAs(kid, 'heartbeat', true)).maintenance == null && (await one(`select maintenance_at from public.app_settings where id`)).maintenance_at === null);
	const far = new Date(Date.now() + 3 * 86400_000).toISOString();
	await svc('admin_update_settings', JSON.stringify({ maintenance_at: far }), own);
	check('24시간보다 먼 예약은 학생에게 아직 안 알린다', (await rpcAs(kid, 'heartbeat', true)).maintenance_at == null);
	await svc('admin_update_settings', JSON.stringify({ maintenance_at: '' }), own);
}

console.log('\n[91] 실시간 전달 = DB 방송 · 비공개 채널 (Phase 55)');
{
	await db.query("update public.profiles set status='active',suspended_until=null,verified=true,onboarded=true where id=any($1)", [[A,B]]);
	const r = await fresh();
	const seatA = Number(await rpcAs(A, 'my_seat', r));
	const seatB = Number(await rpcAs(B, 'my_seat', r));
	const sent = async () => (await db.query(`select topic, event, payload, private from realtime.messages order by id`)).rows;
	const clear = () => db.query(`delete from realtime.messages`);
	const on = (rows, topic, event) => rows.filter((x) => x.topic === topic && x.event === event);

	await clear();
	const m = (await rowsAs(A, `insert into public.messages (room_id, sender_seat, body, client_msg_id)
	                             values ($1, $2, '안녕 방송', gen_random_uuid()) returning id`, [r, seatA]))[0].id;
	let got = await sent();
	const msg = on(got, `room:${r}`, 'msg')[0];
	check('★ 새 메시지 → 그 방 채널에 msg (비공개)', msg?.payload.body === '안녕 방송' && Number(msg.payload.id) === Number(m) && msg.private === true, JSON.stringify(got));
	check('★ 두 사람의 대화 목록 채널에 changed', on(got, `inbox:${A}`, 'changed').length === 1 && on(got, `inbox:${B}`, 'changed').length === 1);
	check('★ 방 채널 페이로드에 사용자 id 없음', !got.filter((x) => x.topic.startsWith('room:')).some((x) => JSON.stringify(x.payload).includes(A) || JSON.stringify(x.payload).includes(B)));

	await clear();
	await rpcAs(B, 'mark_read', r, m);
	got = await sent();
	check('★ 읽음 → 방 채널에 room(read) · 대화 목록은 안 건드린다', on(got, `room:${r}`, 'room').length === 1
		&& Number(on(got, `room:${r}`, 'room')[0].payload[`read${seatB}`]) === Number(m) && !got.some((x) => x.topic.startsWith('inbox:')), JSON.stringify(got));

	await clear();
	await rpcAs(B, 'mark_read', r, m); // 같은 값 — 행이 안 바뀐다
	check('바뀐 게 없으면 방송도 없다', (await sent()).length === 0);

	await clear();
	await rpcAs(B, 'react_message', m, 'heart');
	got = await sent();
	check('공감 → reaction (자리만)', on(got, `room:${r}`, 'reaction')[0]?.payload.emoji === 'heart' && Number(on(got, `room:${r}`, 'reaction')[0].payload.seat) === seatB, JSON.stringify(got));

	await clear();
	await db.query(`insert into public.extension_votes (room_id, round, seat, agree) values ($1, 1, $2, true)`, [r, seatA]);
	check('연장 투표 → vote', on(await sent(), `room:${r}`, 'vote')[0]?.payload.agree === true);

	await clear();
	await db.query(`select public.close_room($1, 'left')`, [r]);
	got = await sent();
	check('★ 방 닫힘 → room(closed) + 두 사람 목록 changed', on(got, `room:${r}`, 'room')[0]?.payload.status === 'closed'
		&& on(got, `inbox:${A}`, 'changed').length === 1 && on(got, `inbox:${B}`, 'changed').length === 1, JSON.stringify(got));

	await clear();
	const n0 = (await one(`select students from public.signup_stats`)).students;
	await person('f', 'm');
	got = await sent();
	check('가입 인원이 바뀌면 signups 채널에 students', on(got, 'signups', 'students')[0]?.payload.students === n0 + 1, JSON.stringify(got));

	// ── 채널 권한 (Realtime 이 참여할 때 이 정책으로 묻는다) ──
	const rtAs = async (uid, topic, sql) => {
		await db.query(`select set_config('realtime.topic', $1, false)`, [topic]);
		try {
			return await rowsAs(uid, sql);
		} finally {
			await db.query(`select set_config('realtime.topic', '', false)`);
		}
	};
	const canRead = async (uid, topic) => (await rtAs(uid, topic, `select count(*)::int n from realtime.messages`))[0].n > 0;
	const canSend = async (uid, topic, event = 'typing') => {
		try {
			await rtAs(uid, topic, `insert into realtime.messages (topic, extension, event, payload) values ('${topic}', 'broadcast', '${event}', '{}')`);
			return true;
		} catch (e) {
			if (!/row-level security/.test(e.message)) throw e;
			return false;
		}
	};
	const outsider = await person('m', 'f');
	check('★ 방 사람은 DB 채널을 읽기만 한다 (서버 이벤트 위조 금지)', (await canRead(A, `room:${r}`)) && !(await canSend(B, `room:${r}`)));
	for (const event of ['msg', 'room', 'vote', 'reaction']) check(`★ 학생은 서버 ${event} 방송을 위조할 수 없다`, !(await canSend(B, `room:${r}`, event)));
	check('★ 종료된 방의 peer 채널에는 신규 발송을 허용하지 않는다', !await canSend(B, `peer:${r}`));
	const openRoom = await fresh();
	check('★ 열린 방의 입력 중 · 접속 표시는 분리한 peer 채널로 보낸다', await canSend(B, `peer:${openRoom}`));
	check('★ 다른 사람은 그 방 채널을 못 듣고 못 보낸다', !(await canRead(outsider, `room:${r}`)) && !(await canSend(outsider, `room:${r}`)));
	check('★ 다른 사람은 peer 채널도 못 듣고 못 보낸다', !(await canRead(outsider, `peer:${r}`)) && !(await canSend(outsider, `peer:${r}`)));
	check('★ 대화 목록 채널은 나만 (남의 것 못 들음)', (await canRead(A, `inbox:${A}`)) && !(await canRead(A, `inbox:${B}`)));
	check('★ 목록 · 가입 인원 채널엔 아무도 못 보낸다', !(await canSend(A, `inbox:${A}`)) && !(await canSend(A, 'signups')));
	check('가입 인원 채널은 누구나 듣는다', await canRead(outsider, 'signups'));
	check('이상한 채널 이름은 거절 (오류 없이)', !(await canRead(A, 'room:not-a-uuid')) && !(await canRead(A, 'admin')) && !(await canRead(A, `room:${r}x`)));
	check('★ 로그인 안 하면 아무 채널도', !(await canRead(null, 'signups')) && !(await canRead(null, `room:${r}`)));
	check('★ 표 변경 발행이 없다 (WAL 을 훑지 않는다)', (await db.query(`select 1 from pg_publication_tables where pubname = 'supabase_realtime'`)).rows.length === 0);

	// 새 업적은 박동 대답에 실린다 (앱이 10분마다 따로 묻지 않는다)
	check('첫 박동 — 개척자 업적을 막 땄다', (await rpcAs(outsider, 'heartbeat', true)).ach_new === true);
	await rpcAs(outsider, 'mark_achievements_seen');
	check('새 업적 없으면 ach_new = false', (await rpcAs(outsider, 'heartbeat', true)).ach_new === false);
	await db.query(`insert into private.user_achievements (user_id, code, tier) values ($1, 'talk', 1)`, [outsider]);
	check('★ 새 업적을 따면 박동 대답에 ach_new = true', (await rpcAs(outsider, 'heartbeat', true)).ach_new === true);
	await rpcAs(outsider, 'mark_achievements_seen');
	check('봤음으로 남기면 다시 false', (await rpcAs(outsider, 'heartbeat', true)).ach_new === false);
	check('백그라운드 박동(p_online = false)엔 안 싣는다', (await rpcAs(outsider, 'heartbeat', false)).ach_new === false);
}

console.log('\n[92] 편지 지우기 — 선택한 편지를 나에게서만 (Phase 69)');
{
	let no = 27600;
	const named = async (name, grade, gender) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name, grade = excluded.grade', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query('update public.profiles set gender=$2, onboarded=true where id=$1', [id, gender]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('지움보냄', 1, 'f');
	const B = await named('지움받음', 2, 'm');
	const E = await named('지움남', 3, 'm');
	const box = async (u, which) => (await rpcAs(u, 'dm_mailbox', which)).letters.map((x) => x.id);
	const s1 = await rpcAs(A, 'dm_send', B, '지울 편지');
	const s2 = await rpcAs(A, 'dm_send', B, '폴더에 둔 편지');
	const s3 = await rpcAs(B, 'dm_send', E, '내가 보낸 편지');
	const s4 = await rpcAs(A, 'dm_send', B, '안 연 편지');
	check('편지 넷 준비', [s1, s2, s3, s4].every((x) => x.status === 'ok'), JSON.stringify([s1, s2, s3, s4]));
	await rpcAs(B, 'dm_open', s1.msg_id);
	await rpcAs(B, 'dm_open', s2.msg_id);
	const put = await rpcAs(B, 'dm_folder_put', [s2.msg_id], null, '지울 폴더');
	const fid = put.folder.id;

	const del = await rpcAs(B, 'dm_letter_delete', [s1.msg_id, s2.msg_id, s3.msg_id, s4.msg_id]);
	check('★ 선택한 편지를 지운다 — 안 연 받은 편지(s4)는 빠진다', del.status === 'ok' && del.moved === 3, JSON.stringify(del));
	check('★ 지운 편지는 받은 · 보낸 편지 목록에서 사라진다 (안 연 편지는 그대로)', JSON.stringify(await box(B, 'received')) === JSON.stringify([s4.msg_id]) && (await box(B, 'sent')).length === 0);
	const f = (await rpcAs(B, 'dm_mailbox', 'received')).folders.find((x) => x.id === fid);
	check('★ 폴더에 있던 편지도 사라지고 폴더 수에서 빠진다 (폴더는 남는다)', (await rpcAs(B, 'dm_mailbox', 'received', null, fid)).letters.length === 0 && f?.count === 0
		&& Number((await one('select count(*) n from private.dm_folder_items where owner_id = $1', [B])).n) === 0, JSON.stringify(f));
	check('★ 지운 편지는 열 수 없다', (await rpcAs(B, 'dm_open', s1.msg_id)).status === 'not_found' && (await rpcAs(B, 'dm_open', s3.msg_id)).status === 'not_found');
	check('★ 지운 편지는 폴더에 다시 못 넣는다', (await rpcAs(B, 'dm_folder_put', [s1.msg_id], fid, null)).moved === 0);
	check('★ 상대의 편지는 그대로 — A 의 보낸 편지 · E 의 받은 편지', (await box(A, 'sent')).includes(s1.msg_id) && (await box(E, 'received')).includes(s3.msg_id)
		&& (await rpcAs(E, 'dm_open', s3.msg_id)).status === 'ok');
	check('편지는 DB 에서 지워지지 않는다 (신고 · 운영 기록)', Number((await one('select count(*) n from private.dm_msgs where id = any($1)', [[s1.msg_id, s2.msg_id, s3.msg_id]])).n) === 3);
	const again = await rpcAs(B, 'dm_letter_delete', [s1.msg_id]);
	check('이미 지운 편지를 또 지우면 0통', again.status === 'ok' && again.moved === 0);
	check('★ 남의 편지는 못 지운다', (await rpcAs(E, 'dm_letter_delete', [s1.msg_id, s4.msg_id])).moved === 0 && (await box(A, 'sent')).includes(s1.msg_id));
	check('빈 목록 · 200통 넘게는 안 된다', (await rpcAs(B, 'dm_letter_delete', [])).status === 'bad_request'
		&& (await rpcAs(B, 'dm_letter_delete', Array.from({ length: 201 }, (_, i) => i + 1))).status === 'bad_request');

	// 줄기는 그대로 — 버리기와 달리 답장이 오가고, 상대가 새로 보낸 편지는 다시 보인다
	await rpcAs(B, 'dm_open', s4.msg_id);
	const r1 = await rpcAs(B, 'dm_reply_to', s4.msg_id, '답장');
	await rpcAs(A, 'dm_open', r1.msg_id);
	const s5 = await rpcAs(A, 'dm_reply_to', r1.msg_id, '지운 뒤 새 편지');
	check('★ 지워도 편지 줄기는 그대로 — 답장이 오가고 새 편지는 보인다', r1.status === 'ok' && s5.status === 'ok' && (await box(B, 'received')).includes(s5.msg_id), JSON.stringify([r1, s5]));
	check('안 읽은 수는 안 연 편지만 (지운 편지와 상관없다)', (await rpcAs(B, 'dm_unread')) === 1);
	await expectError('★ 지운 편지 표는 직접 못 읽는다', () => rowsAs(B, 'select * from private.dm_hidden_msgs'), 'permission denied');
	await expectError('로그인 안 하면 못 부른다', () => rowsAs(null, `select public.dm_letter_delete('{1}'::bigint[])`), 'permission denied');
}

console.log('\n[93] CNSA 뱃지 — 극작소 (Phase 70)');
{
	const X = await person('f', 'm');
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	const club = (await rpcAs(X, 'achievement_catalog')).find((d) => d.code === 'club_geukjakso');
	check('★ 카탈로그에 극작소 — CNSA 분류 · 운영진이 주는 뱃지', club?.category === 'cnsa' && club.granted === true && club.title === '극작소', JSON.stringify(club));
	check('아직 없으면 잠김', (await rpcAs(X, 'my_achievements')).items.find((a) => a.code === 'club_geukjakso')?.tier === 0);
	check('운영자 화면의 줄 수 있는 뱃지 목록에 있다', (await svc('admin_user_badges', mod, X)).some((b) => b.code === 'club_geukjakso' && !b.has));
	await svc('admin_set_badge', mod, X, 'club_geukjakso', true);
	const mine = (await rpcAs(X, 'my_achievements')).items.find((a) => a.code === 'club_geukjakso');
	check('★ 주면 가진 것으로 · 새 업적 축하 · 대표 업적으로 걸 수 있다', mine?.tier === 3 && (await rpcAs(X, 'new_achievements')).some((b) => b.code === 'club_geukjakso')
		&& (await rpcAs(X, 'set_featured_badges', ['club_geukjakso'])).featured[0].code === 'club_geukjakso', JSON.stringify(mine));
	await expectError('★ 없는 분류는 못 넣는다', () => one(`insert into private.achievement_defs (code, title, description, icon, category, stat, bronze, silver, gold, sort) values ('x', 'x', 'x', 'x', 'club', 'x', 1, 1, 1, 99)`), 'achievement_defs_category_check');
}

console.log('\n[94] CNSA 뱃지 셋 · 운영자 뱃지 화면 — 여러 명에게 한 번에 (Phase 71)');
{
	const X = await person('m', 'f');
	const Y = await person('f', 'm');
	const N = await signUp('29071@cnsa.hs.kr', true); // 학번이 앞자리인 학교 이메일
	await db.query('update public.profiles set onboarded = true where id = $1', [N]);
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	const cat = await rpcAs(X, 'achievement_catalog');
	const pick = (c) => cat.find((d) => d.code === c);
	check('★ 카탈로그에 CNSA 뱃지 · MSMP 우수 금뱃지 · Beatus — CNSA 분류 · 운영진이 준다',
		['cnsa_student', 'msmp_gold', 'club_beatus'].every((c) => pick(c)?.category === 'cnsa' && pick(c).granted === true)
		&& pick('cnsa_student').title === 'CNSA 뱃지' && pick('msmp_gold').title === 'MSMP 우수 금뱃지' && pick('club_beatus').description === 'IT 동아리 Beatus의 뱃지');
	check('CNSA 탭 순서: CNSA · MSMP · Beatus · 극작소', cat.filter((d) => d.category === 'cnsa').map((d) => d.code).join() === 'cnsa_student,msmp_gold,club_beatus,club_geukjakso');

	const list = await svc('admin_badges', mod);
	check('★ 뱃지 목록: 줄 수 있는 것만 (베타 테스터 + CNSA 넷) · 가진 사람 수', list.map((b) => b.code).join() === 'beta,cnsa_student,msmp_gold,club_beatus,club_geukjakso'
		&& list.every((b) => typeof b.holders === 'number' && b.category), JSON.stringify(list.map((b) => [b.code, b.holders])));
	const before = list.find((b) => b.code === 'club_beatus').holders;
	check('★ 여러 명에게 한 번에 주기 — 바뀐 수', (await svc('admin_set_badge_many', mod, 'club_beatus', [X, Y, X], true)) === 2);
	check('이미 가진 사람에게 다시 주면 건너뛴다', (await svc('admin_set_badge_many', mod, 'club_beatus', [X, Y], true)) === 0);
	check('가진 사람 수가 는다', (await svc('admin_badges', mod)).find((b) => b.code === 'club_beatus').holders === before + 2);
	const holders = await svc('admin_badge_holders', mod, 'club_beatus');
	check('★ 가진 학생 목록 — 익명 이름 · 받은 때', [X, Y].every((u) => holders.some((h) => h.id === u && h.earned_at && 'nickname' in h)));
	check('받은 학생에게 새 업적 축하', (await rpcAs(Y, 'new_achievements')).some((b) => b.code === 'club_beatus'));
	check('한 명씩 주고 거둔 것처럼 사람마다 기록 (bulk)', Number((await one(`select count(*) n from private.audit_log where action = 'grant_badge' and detail->>'code' = 'club_beatus' and (detail->>'bulk')::boolean and target_user = any($1)`, [[X, Y]])).n) === 2);
	await rpcAs(X, 'set_featured_badges', ['club_beatus']);
	check('★ 여러 명에게서 한 번에 거두기 — 대표 업적에서도 빠진다', (await svc('admin_set_badge_many', mod, 'club_beatus', [X, Y], false)) === 2
		&& !(await one('select featured_badges from public.profiles where id = $1', [X])).featured_badges.includes('club_beatus')
		&& (await rpcAs(X, 'my_achievements')).items.find((a) => a.code === 'club_beatus').tier === 0);
	check('거둔 것도 사람마다 기록', Number((await one(`select count(*) n from private.audit_log where action = 'revoke_badge' and detail->>'code' = 'club_beatus' and target_user = any($1)`, [[X, Y]])).n) === 2);
	await expectError('★ 기준으로 따는 업적은 여러 명에게도 못 준다', () => svc('admin_set_badge_many', mod, 'talk', [X], true), 'not_grantable');
	await expectError('가진 사람 목록도 줄 수 있는 뱃지만', () => svc('admin_badge_holders', mod, 'talk'), 'not_grantable');
	await expectError('한 번에 500명까지', () => svc('admin_set_badge_many', mod, 'club_beatus', Array.from({ length: 501 }, () => X), true), 'too_many');
	await expectError('운영진 명단에 없으면 거절', () => svc('admin_set_badge_many', X, 'club_beatus', [Y], true), 'not_staff');
	await expectError('★ 학생은 부를 수 없다', () => rowsAs(X, `select public.admin_set_badge_many($1, 'club_beatus', array[$1]::uuid[], true)`, [X]), 'permission denied');
	await expectError('학생은 뱃지 목록도 못 본다', () => rowsAs(X, `select public.admin_badges($1)`, [X]), 'permission denied');

	console.log('  [학번으로 · 모두에게]');
	await expectError('★ 학번으로 주기는 관리자만 (학생 신원)', () => svc('admin_grant_badge_by_no', mod, 'msmp_gold', [29071]), 'admin_only');
	const byNo = await svc('admin_grant_badge_by_no', adm, 'msmp_gold', [29071, 29999, 29999]);
	check('★ 학번으로 주기 — 가입한 학생에게만 · 못 찾은 학번을 알려 준다', byNo.given === 1 && byNo.found === 1 && JSON.stringify(byNo.missing) === '[29999]', JSON.stringify(byNo));
	check('학번으로 준 학생이 뱃지를 가졌다', Number((await one(`select tier from private.user_achievements where user_id = $1 and code = 'msmp_gold'`, [N])).tier) === 3);
	check('학번 조회는 열람 기록에 남는다', Number((await one(`select count(*) n from private.audit_log where staff_id = $1 and action = 'view_identity' and detail->>'via' = 'badge'`, [adm])).n) >= 1);
	await expectError('빈 학번 목록은 거절', () => svc('admin_grant_badge_by_no', adm, 'msmp_gold', []), 'bad_nos');
	const late = await person('m', 'f', { onboarded: false });
	const everyone = Number((await one('select count(*) n from public.profiles where verified and onboarded')).n);
	const had = Number((await one(`select count(*) n from private.user_achievements a join public.profiles p on p.id = a.user_id where a.code = 'cnsa_student' and p.verified and p.onboarded`)).n);
	check('★ 모두에게 — 학교 인증 · 시작하기를 마친 학생 전부', (await svc('admin_grant_badge_all', mod, 'cnsa_student')) === everyone - had
		&& (await rpcAs(X, 'my_achievements')).items.find((a) => a.code === 'cnsa_student').tier === 3);
	check('다시 눌러도 더 주지 않는다', (await svc('admin_grant_badge_all', mod, 'cnsa_student')) === 0);
	check('시작하기 전인 계정은 빠진다', !(await one(`select 1 x from private.user_achievements where user_id = $1 and code = 'cnsa_student'`, [late])));
}

console.log('\n[95] 새 편지 한도 — 하루 50통 (Phase 78)');
{
	const s = await one('select letter_burst, letter_refill_per_sec from public.app_settings where id');
	check('★ 편지 한도 50통 · 하루에 50통 분량이 다시 찬다', Number(s.letter_burst) === 50 && Math.abs(Number(s.letter_refill_per_sec) * 86400 - 50) < 0.1, JSON.stringify(s));
	await db.query('update public.app_settings set letters_gate = false where id');
	let no = 38000;
	// 편지를 보내려면 명렬표 이름이 있어야 한다 — 학교 이메일 앞자리 = 학번
	const named = async (name) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, 1, $2) on conflict (student_no) do update set name = excluded.name', [n, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query("update public.profiles set gender = 'm', want = 'f', onboarded = true where id = $1", [id]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const A = await named('오십보냄');
	check('새로 가입한 학생도 처음부터 50통', Number((await one('select letter_tokens from public.user_presence where user_id = $1', [A])).letter_tokens) === 50);
	const got = [];
	for (let i = 0; i < 5; i++) got.push((await rpcAs(A, 'dm_send', await named(`오십받음${i}`), `안녕 ${i}`)).status);
	check('★ 넷째 · 다섯째 새 편지도 보낼 수 있다 (전엔 셋째에서 막혔다)', got.every((x) => x === 'ok'), JSON.stringify(got));
	await db.query('update public.user_presence set letter_tokens = 0, letter_at = now() where user_id = $1', [A]);
	check('한도를 다 쓰면 그래도 막힌다', (await rpcAs(A, 'dm_send', await named('오십더'), '하나 더')).status === 'rate_limited');
}

console.log('\n[96] CNSA 뱃지 — 기본 뱃지 열림 · 5칸 · 랜덤채팅 숨기기 · 편지 찾기 순서 · 추천 · 제출 (Phase 84)');
{
	await db.query('update public.app_settings set letters_gate = false where id');
	let no = 39000;
	const emailOf = async (id) => (await one('select email from auth.users where id = $1', [id])).email;
	const named = async (name, grade = 2) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, $2, $3) on conflict (student_no) do update set name = excluded.name', [n, grade, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query("update public.profiles set gender = 'f', want = 'm', onboarded = true where id = $1", [id]);
		await rpcAs(id, 'ensure_self');
		return id;
	};
	const has = async (u, code) => !!(await one('select 1 x from private.user_achievements where user_id = $1 and code = $2', [u, code]));

	console.log('  [기본 CNSA 뱃지 · 칸]');
	const U = await named('뱃지주인');
	const my0 = await rpcAs(U, 'my_achievements');
	check('★ 처음엔 대표 뱃지 3칸 · 금 0', my0.slots === 3 && my0.golds === 0, JSON.stringify({ slots: my0.slots, golds: my0.golds }));
	await db.query(`select private.set_stat($1, 'chats', 5)`, [U]);
	check('동 · 은으로는 기본 CNSA 뱃지가 열리지 않는다', !(await has(U, 'cnsa_student')));
	await db.query(`select private.set_stat($1, 'chats', 100)`, [U]);
	check('★ Landy 금 뱃지를 처음 따면 기본 CNSA 뱃지가 열린다 (새 업적 축하에도)', (await has(U, 'cnsa_student')) && (await rpcAs(U, 'new_achievements')).some((b) => b.code === 'cnsa_student'));
	await db.query(`select private.badge_apply((select user_id from private.staff where role = 'admin' limit 1), 'beta', array[$1]::uuid[], true)`, [U]);
	check('특별 업적(베타)은 금 뱃지로 세지 않는다', (await rpcAs(U, 'my_achievements')).golds === 1);
	check('3칸일 때 4개는 too_many', (await rpcAs(U, 'set_featured_badges', ['chats', 'cnsa_student', 'beta', 'talk'])).status === 'too_many');
	for (const [st, v] of [['msgs', 10000], ['hearts', 500], ['answers', 50], ['owl', 50]]) await db.query('select private.set_stat($1, $2, $3)', [U, st, v]);
	const my5 = await rpcAs(U, 'my_achievements');
	check('★ 금 뱃지 5개면 5칸', my5.golds === 5 && my5.slots === 5, JSON.stringify({ slots: my5.slots, golds: my5.golds }));
	const five = ['cnsa_student', 'chats', 'talk', 'heart', 'question'];
	const set5 = await rpcAs(U, 'set_featured_badges', five);
	check('★ 5칸이면 대표 뱃지 5개까지 — 고른 순서대로', set5.status === 'ok' && set5.featured.map((b) => b.code).join() === five.join(), JSON.stringify(set5));
	check('6개는 too_many', (await rpcAs(U, 'set_featured_badges', [...five, 'owl'])).status === 'too_many');

	console.log('  [랜덤채팅에서 숨기기]');
	const W = await named('대화상대');
	await db.query(`update public.user_presence set current_room_id = null where user_id in ($1, $2)`, [U, W]);
	const room = (await one(`select private.dev_open_room($1, $2, 10) as id`, [await emailOf(U), await emailOf(W)])).id;
	const seen = async () => (await rpcAs(W, 'partner_profile', room)).badges.map((b) => b.code);
	const chat0 = await seen();
	check('★ 정하지 않았으면 CNSA 뱃지는 랜덤채팅에서 숨김 — 다음 뱃지로 채운다', !chat0.includes('cnsa_student') && chat0.length === 5 && chat0[0] === 'chats', chat0.join());
	check('내 화면에는 그대로', (await rpcAs(U, 'my_achievements')).featured[0].code === 'cnsa_student');
	check('★ 내 뱃지마다 랜덤채팅에 보이는지 (CNSA 숨김 · 나머지 보임)', (() => { const c = my5.chat; return c.cnsa_student === false && c.chats === true && !('club_beatus' in c); })(), JSON.stringify(my5.chat));
	check('★ 보이게 하면 랜덤채팅에도', (await rpcAs(U, 'set_badge_chat', 'cnsa_student', true)).status === 'ok' && (await seen())[0] === 'cnsa_student');
	await rpcAs(U, 'set_badge_chat', 'chats', false);
	check('Landy 뱃지도 숨길 수 있다', !(await seen()).includes('chats'));
	check('가진 뱃지만 정할 수 있다', (await rpcAs(U, 'set_badge_chat', 'club_beatus', true)).status === 'not_owned');
	const cnt = (await rpcAs(W, 'partner_profile', room)).badge_count;
	check('상대에게 보이는 뱃지 수도 숨긴 것은 빼고', cnt === (await rpcAs(U, 'my_achievements')).items.filter((a) => a.tier > 0).length - 1, String(cnt));
	await expectError('★ 숨기기 목록을 직접 고칠 수 없다 (가진 뱃지만 — set_badge_chat)', () => rowsAs(U, `update public.profiles set badge_chat = '{"x":true}' where id = $1`, [U]), 'permission denied');

	console.log('  [편지 찾기 · 추천]');
	const found = (await rpcAs(W, 'dm_search', '뱃지주인')).find((p) => p.id === U);
	check('★ 편지 찾기 결과에 대표 뱃지 — 내 순서 (CNSA 도 보인다)', found?.badges.map((b) => b.code).join() === five.join(), JSON.stringify(found?.badges));
	await rowsAs(U, `update public.profiles set letter_badge_order = 'random' where id = $1`, [U]);
	const orders = new Set();
	for (let i = 0; i < 12; i++) orders.add((await rpcAs(W, 'dm_search', '뱃지주인')).find((p) => p.id === U).badges.map((b) => b.code).join());
	check('★ 무작위로 해 두면 같은 뱃지가 섞여 나온다', orders.size > 1 && [...orders].every((o) => o.split(',').sort().join() === [...five].sort().join()), [...orders].join(' | '));
	await expectError('순서는 내 순서 · 무작위만', () => rowsAs(U, `update public.profiles set letter_badge_order = 'abc' where id = $1`, [U]), 'profiles_letter_badge_order');

	const off = await named('추천싫음');
	await rowsAs(off, `update public.profiles set letters_recommend = false where id = $1`, [off]);
	const closed = await named('편지끔');
	await rowsAs(closed, `update public.profiles set letters_open = false where id = $1`, [closed]);
	let recs = [];
	for (let i = 0; i < 15; i++) recs.push(await rpcAs(W, 'dm_recommend'));
	check('★ 추천은 5명 — 이름 · 학년 · 대표 뱃지', recs.every((r) => r.length === 5 && r.every((p) => p.name && p.id && Array.isArray(p.badges))), JSON.stringify(recs[0]).slice(0, 200));
	const ids = recs.flat().map((p) => p.id);
	check('★ 추천을 끈 사람 · 받기를 끈 사람 · 나는 나오지 않는다', !ids.includes(off) && !ids.includes(closed) && !ids.includes(W));
	check('추천은 매번 섞인다', new Set(recs.map((r) => r.map((p) => p.id).join())).size > 1);
	await rpcAs(W, 'dm_send', U, '안녕 뱃지주인');
	const after = [];
	for (let i = 0; i < 10; i++) after.push(...(await rpcAs(W, 'dm_recommend')).map((p) => p.id));
	check('이미 편지를 보내고 있는 사람은 추천에서 빠진다', !after.includes(U));
	await db.query('update public.app_settings set letters_gate = true, letters_gate_min = 10000 where id');
	check('익명편지가 잠겨 있으면 추천도 없다', (await rpcAs(W, 'dm_recommend')).length === 0);
	await db.query('update public.app_settings set letters_gate = false, letters_gate_min = 100 where id');

	console.log('  [뱃지 제출]');
	const S1 = await named('기장');
	const ph = (u, k = 'aaaaaaaa1') => [`${u}/${k}.jpg`];
	const sub = async (u, kind, code, title, note, nos, photos) => {
		// 제출 경로는 실제 업로드 객체를 가리켜야 한다. 입력 검증용 fixture는 관리자 역할로 만든다.
		for (const path of photos) if (path.startsWith(`${u}/`)) {
			await db.query(`insert into storage.objects (bucket_id, name)
				select 'badge-proofs', $1 where not exists (select 1 from storage.objects where bucket_id = 'badge-proofs' and name = $1)`, [path]);
		}
		return rpcAs(u, 'badge_request_submit', kind, code, title, note, nos, photos);
	};
	check('★ 남의 폴더 사진 · 사진 없음은 bad_input', (await sub(S1, 'proof', 'msmp_gold', null, '', [], ph(U))).status === 'bad_input' && (await sub(S1, 'proof', 'msmp_gold', null, '', [], [])).status === 'bad_input');
	check('★ 동아리 뱃지는 기장 제출로만 (not_club)', (await sub(S1, 'proof', 'club_beatus', null, '', [], ph(S1))).status === 'not_club');
	check('기본 CNSA 뱃지는 제출하지 않는다 (금 뱃지로 열린다)', (await sub(S1, 'proof', 'cnsa_student', null, '', [], ph(S1))).status === 'bad_input');
	check('기준으로 따는 Landy 업적은 제출 못 한다', (await sub(S1, 'proof', 'chats', null, '', [], ph(S1))).status === 'bad_input');
	check('이미 가진 뱃지는 already', (await sub(U, 'proof', 'cnsa_student', null, '', [], ph(U))).status === 'bad_input'
		&& (await (async () => { await db.query(`select private.badge_apply((select user_id from private.staff where role = 'admin' limit 1), 'msmp_gold', array[$1]::uuid[], true)`, [U]); return (await sub(U, 'proof', 'msmp_gold', null, '', [], ph(U))).status; })()) === 'already');
	const r1 = await sub(S1, 'proof', 'msmp_gold', null, '학생증이랑 같이 찍었어요', [], ph(S1, 'proof0001'));
	check('★ 내 뱃지 인증 제출', r1.status === 'ok' && r1.id > 0, JSON.stringify(r1));
	const n1 = await named('부원하나'), n2 = await named('부원둘');
	const nos = [no - 1, no, 39999999];
	const r2 = await sub(S1, 'club', 'club_beatus', null, '기장 인증', nos, [`${S1}/club00001.jpg`, `${S1}/club00002.png`]);
	check('★ 동아리 기장 — 부원 학번까지 한 번에', r2.status === 'ok', JSON.stringify(r2));
	check('동아리 제출은 동아리 뱃지 또는 새 동아리 이름 하나만', (await sub(S1, 'club', 'msmp_gold', null, '', [], ph(S1))).status === 'bad_input' && (await sub(S1, 'club', 'club_beatus', '새동아리', '', [], ph(S1))).status === 'bad_input');
	const r3 = await sub(S1, 'new', null, '로봇 동아리 뱃지', '은색 톱니 모양', [], ph(S1, 'new000001'));
	check('★ 앱에 없는 뱃지 추가 요청', r3.status === 'ok');
	check('★ 기다리는 요청은 3개까지', (await sub(S1, 'new', null, '하나 더', '', [], ph(S1))).status === 'too_many');
	const mine = await rpcAs(S1, 'my_badge_requests');
	check('내가 보낸 요청 — 상태 · 뱃지 이름 · 부원 수 (사진 경로는 안 준다)', mine.length === 3 && mine[1].title === 'Beatus' && mine[1].members === 3 && mine.every((m) => m.status === 'pending' && !('photos' in m)), JSON.stringify(mine));
	const cancel = await rpcAs(S1, 'badge_request_cancel', r3.id);
	check('★ 기다리는 요청 거두기 — 지울 사진 경로를 돌려준다', cancel.status === 'ok' && cancel.photos[0] === `${S1}/new000001.jpg`, JSON.stringify(cancel));
	check('남의 요청 · 끝난 요청은 거둘 수 없다', (await rpcAs(U, 'badge_request_cancel', r1.id)).status === 'not_found' && (await rpcAs(S1, 'badge_request_cancel', r3.id)).status === 'not_found');

	console.log('  [운영진 검토]');
	const mod = (await one(`select user_id from private.staff where role = 'moderator' order by created_at desc limit 1`)).user_id;
	const adm = (await one(`select user_id from private.staff where role = 'admin' order by created_at desc limit 1`)).user_id;
	await expectError('★ 학번 · 이름 · 사진이 보이므로 관리자만', () => svc('admin_badge_requests', mod, true), 'admin_only');
	await expectError('학생은 부를 수 없다', () => rowsAs(S1, `select public.admin_badge_requests($1, true)`, [S1]), 'permission denied');
	const logs0 = Number((await one(`select count(*) n from private.audit_log where action = 'view_identity' and detail->>'via' = 'badge_requests'`)).n);
	const pend = await svc('admin_badge_requests', adm, true);
	const p1 = pend.find((x) => x.id === r1.id), p2 = pend.find((x) => x.id === r2.id);
	check('★ 기다리는 요청 — 이름 · 학번 · 사진 · 부원 학번 (거둔 것은 없다)', p1?.name === '기장' && String(p1.no) === String(no - 2) && p1.photos[0] === `${S1}/proof0001.jpg` && p2?.member_nos.length === 3 && !pend.some((x) => x.id === r3.id), JSON.stringify(p1));
	check('열람은 기록에 남는다', Number((await one(`select count(*) n from private.audit_log where action = 'view_identity' and detail->>'via' = 'badge_requests'`)).n) === logs0 + 1);
	// 사진 한 장 (리뷰 수정 2026-10-04) — 사진마다 목록 RPC를 부르면 열람 기록이 사진 수만큼 쌓였다
	check('★ 사진 한 장 — 기다리는 요청의 경로만 · 범위 밖은 없음', (await svc('admin_badge_request_photo', adm, r1.id, 0)) === `${S1}/proof0001.jpg`
		&& (await svc('admin_badge_request_photo', adm, r1.id, 2)) === null && (await svc('admin_badge_request_photo', adm, r1.id, 3)) === null);
	check('사진 한 장은 열람 기록을 더 남기지 않는다', Number((await one(`select count(*) n from private.audit_log where action = 'view_identity' and detail->>'via' = 'badge_requests'`)).n) === logs0 + 1);
	await expectError('★ 사진 한 장도 관리자만', () => svc('admin_badge_request_photo', mod, r1.id, 0), 'admin_only');
	await expectError('사진 한 장 — 학생은 부를 수 없다', () => rowsAs(S1, `select public.admin_badge_request_photo($1, $2, 0)`, [S1, r1.id]), 'permission denied');
	const d1 = await svc('admin_badge_request_decide', adm, r1.id, true, '확인했어요', null);
	check('★ 승인 — 뱃지를 주고 사진 경로를 돌려준다 · 요청에서는 비운다', d1.status === 'approved' && d1.given === 1 && (await has(S1, 'msmp_gold')) && d1.photos[0] === `${S1}/proof0001.jpg`
		&& (await one('select photos from private.badge_requests where id = $1', [r1.id])).photos.length === 0, JSON.stringify(d1));
	const note = await one(`select title, body from private.personal_notices where id = $1`, [d1.notice]);
	check('결과는 개인 공지로 (운영진 메모 포함)', note.title === '뱃지 요청을 승인했어요' && note.body.includes('MSMP 우수 금뱃지') && note.body.includes('확인했어요'), JSON.stringify(note));
	check('결정한 요청의 사진은 주지 않는다', (await svc('admin_badge_request_photo', adm, r1.id, 0)) === null);
	await expectError('한 번 결정한 요청은 다시 못 한다', () => svc('admin_badge_request_decide', adm, r1.id, false, '', null), 'already_decided');
	const d2 = await svc('admin_badge_request_decide', adm, r2.id, true, '', null);
	check('★ 동아리 승인 — 기장 + 부원 모두에게 · 못 찾은 학번을 돌려준다', d2.given === 3 && (await has(S1, 'club_beatus')) && (await has(n1, 'club_beatus')) && (await has(n2, 'club_beatus'))
		&& JSON.stringify(d2.missing) === '[39999999]', JSON.stringify(d2));
	const r4 = await sub(S1, 'club', null, '로봇동아리', '', [no], ph(S1, 'robot0001'));
	await expectError('★ 앱에 없는 동아리는 뱃지를 먼저 만들어야 승인 (need_code)', () => svc('admin_badge_request_decide', adm, r4.id, true, '', null), 'need_code');
	const d4 = await svc('admin_badge_request_decide', adm, r4.id, false, '사진이 흐려요', null);
	check('★ 반려 — 뱃지는 주지 않고 공지로', d4.status === 'rejected' && d4.given === 0 && (await one(`select body from private.personal_notices where id = $1`, [d4.notice])).body.includes('사진이 흐려요'));
	const done = await svc('admin_badge_requests', adm, false);
	check('결정한 요청 목록 (최근 순)', done[0].id === r4.id && done.some((x) => x.id === r1.id && x.status === 'approved'));
	check('결정 · 반려는 기록에 남는다', Number((await one(`select count(*) n from private.audit_log where action in ('approve_badge_request', 'reject_badge_request') and target_user = $1`, [S1])).n) === 3);

	console.log('  [사진 버킷]');
	const bucket = await one(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'badge-proofs'`);
	check('★ 사진 버킷은 비공개 · 5MB · 사진 형식만', bucket && bucket.public === false && Number(bucket.file_size_limit) === 5242880 && bucket.allowed_mime_types.includes('image/jpeg'), JSON.stringify(bucket));
	await rowsAs(S1, `insert into storage.objects (bucket_id, name) values ('badge-proofs', $1)`, [`${S1}/upload001.jpg`]);
	check('★ 내 폴더에는 올릴 수 있다', !!(await one(`select 1 x from storage.objects where name = $1`, [`${S1}/upload001.jpg`])));
	await expectError('★ 남의 폴더에는 못 올린다', () => rowsAs(S1, `insert into storage.objects (bucket_id, name) values ('badge-proofs', $1)`, [`${U}/upload002.jpg`]), 'row-level security');
	await db.query(`insert into storage.objects (bucket_id, name) values ('badge-proofs', $1)`, [`${U}/other0001.jpg`]);
	const vis = (await rowsAs(S1, `select name from storage.objects where bucket_id = 'badge-proofs'`)).map((r) => r.name);
	check('남의 사진은 읽을 수 없다 (운영진은 운영 서버의 서명 주소로만)', vis.includes(`${S1}/upload001.jpg`) && vis.every((p) => p.startsWith(`${S1}/`)), vis.join());
	await rowsAs(S1, `delete from storage.objects where name = $1`, [`${S1}/upload001.jpg`]);
	check('내 사진은 지울 수 있다', !(await one(`select 1 x from storage.objects where name = $1`, [`${S1}/upload001.jpg`])));
}

console.log('\n[97] 코드 리뷰 회귀 — 익명성 · 차단 · 점검 · 시계 · 감사 · 권한');
{
	await db.exec('update public.app_settings set is_open = true, maintenance = false, maintenance_at = null, letters_gate = false');
	let no = 41000;
	const named = async (name) => {
		const n = ++no;
		await db.query('insert into private.student_roster (student_no, grade, name) values ($1, 1, $2)', [n, name]);
		const id = await signUp(`${n}@cnsa.hs.kr`, true);
		await db.query("update public.profiles set gender = 'm', want = 'any', onboarded = true where id = $1", [id]);
		return id;
	};
	const A = await named('ReviewAlpha'), B = await named('ReviewBeta'), C = await named('ReviewGamma');
	const directory = async (u) => (await rpcAs(u, 'dm_search', 'Review')).map(({ id, name, no }) => ({ id, name, no }));
	const before = await directory(B);
	const original = await rpcAs(A, 'dm_send', B, 'original');
	// 동일 계정 사이의 반대 방향(내가 실명으로 시작한 줄기)도 차단 여부를 probing하는 통로가 되지 않아야 한다.
	const known = await rpcAs(B, 'dm_send', A, 'known person');
	const knownReply = await rpcAs(A, 'dm_reply_to', known.msg_id, 'known reply');
	const known0 = await rpcAs(B, 'dm_open', knownReply.msg_id);
	await db.query('update public.profiles set letters_recommend = false');
	await db.query('update public.profiles set letters_recommend = true where id = any($1)', [[A, C]]);
	const recommended = async (u) => (await rpcAs(u, 'dm_recommend')).map((p) => p.id).sort();
	const rec0 = await recommended(B);
	await rpcAs(B, 'dm_block', original.thread_id);
	check('★ 익명 상대 차단 전후 이름 · 학번 · 계정 검색 결과가 같다', JSON.stringify(await directory(B)) === JSON.stringify(before));
	check('★ 익명 상대 차단 전후 추천 후보도 같다', JSON.stringify(await recommended(B)) === JSON.stringify(rec0));
	const known1 = await rpcAs(B, 'dm_open', knownReply.msg_id);
	const probe = await rpcAs(B, 'dm_reply_to', knownReply.msg_id, 'probe reply');
	check('★ 이미 실명으로 주고받던 다른 줄기의 답장 상태/응답도 차단을 드러내지 않는다', known0.can_reply === true && known1.can_reply === true
		&& probe.status === 'ok' && (await rpcAs(A, 'dm_open', probe.msg_id)).status === 'not_found');
	const got0 = (await one('select counts from private.user_stats where user_id = $1', [B])).counts;
	const unread0 = await rpcAs(B, 'dm_unread');
	const blind = await rpcAs(A, 'dm_send', B, 'quiet one');
	const normal = await rpcAs(C, 'dm_send', B, 'normal one');
	check('★ 차단된 대상도 정상 대상과 같은 발신 결과 (신원 추측 불가)', blind.status === 'ok' && normal.status === 'ok');
	const sent = await rpcAs(A, 'dm_open', blind.msg_id);
	check('★ 발신자 편지 · 읽음 · 줄기 상태는 정상, 차단/전달 표식 없음', sent.status === 'ok' && sent.body === 'quiet one'
		&& sent.role === 'sent' && sent.thread_status === 'open' && sent.opened === false
		&& !JSON.stringify(sent).includes('delivered') && !JSON.stringify(sent).includes('recipient_refused'));
	check('★ 수신자 편지함 · 직접 열기에는 차단된 편지가 없다', !(await rpcAs(B, 'dm_mailbox', 'received')).letters.some((m) => m.id === blind.msg_id)
		&& (await rpcAs(B, 'dm_open', blind.msg_id)).status === 'not_found');
	check('★ 차단된 편지는 안 읽은 수 · 수신 업적 · 푸시를 늘리지 않는다', (await rpcAs(B, 'dm_unread')) === unread0 + 1
		&& Number((await one('select counts from private.user_stats where user_id = $1', [B])).counts.letters_got) === Number(got0.letters_got) + 1
		&& (await svc('dm_push_payload', blind.msg_id, A)).skip === 'no_message');
	const folder = await rpcAs(A, 'dm_folder_put', [blind.msg_id], null, 'Quiet sent');
	check('★ 발신자는 차단된 편지도 정상적으로 보관 · 열기 · 삭제 가능', folder.moved === 1
		&& (await rpcAs(A, 'dm_mailbox', 'sent', null, folder.folder.id)).letters.some((m) => m.id === blind.msg_id)
		&& (await rpcAs(A, 'dm_letter_delete', [blind.msg_id])).moved === 1);
	check('★ 수신자는 차단된 편지 답장 · 폴더 보관도 못 한다', (await rpcAs(B, 'dm_reply_to', blind.msg_id, 'x')).status === 'not_found'
		&& (await rpcAs(B, 'dm_folder_put', [blind.msg_id], null, 'No delivery')).moved === 0);
	for (const u of [A, C]) {
		await rpcAs(u, 'dm_send', B, 'two');
		await rpcAs(u, 'dm_send', B, 'three');
	}
	check('★ 차단 여부와 무관하게 답 없이 3통 한도도 동일', (await rpcAs(A, 'dm_send', B, 'four')).status === 'wait_reply'
		&& (await rpcAs(C, 'dm_send', B, 'four')).status === 'wait_reply');
	await db.query("update public.profiles set status = 'suspended' where id = $1", [A]);
	check('★ 신고 정지로도 검색/추천에서 익명 발신자 계정이 사라지지 않는다', JSON.stringify(await directory(B)) === JSON.stringify(before)
		&& JSON.stringify(await recommended(B)) === JSON.stringify(rec0));
	await db.query("update public.profiles set status = 'active' where id = $1", [A]);

	const F = await named('ReviewFirst'), G = await named('ReviewLast');
	const first = await rpcAs(F, 'dm_send', G, 'first');
	await rpcAs(F, 'dm_close', first.thread_id);
	await rpcAs(G, 'dm_close', first.thread_id);
	check('★ 발신자가 먼저 종료해도 수신 거부는 독립적으로 남는다', (await one('select recipient_refused from private.dm_threads where id = $1', [first.thread_id])).recipient_refused === true);
	const retry = await rpcAs(F, 'dm_send', G, 'retry');
	check('★ 종료 순서와 무관하게 새 편지 응답은 정상, 실제 수신은 거부', retry.status === 'ok'
		&& (await rpcAs(G, 'dm_open', retry.msg_id)).status === 'not_found');

	const makeRoom = async (u, v) => (await one('select private.dev_open_room($1, $2, 10) as id', [
		(await one('select email from auth.users where id = $1', [u])).email,
		(await one('select email from auth.users where id = $1', [v])).email])).id;
	const chat = await makeRoom(A, B);
	await rpcAs(B, 'dm_block', original.thread_id);
	check('★ 편지에서 차단하면 기존 랜덤채팅도 즉시 닫힌다', (await one('select status, close_reason from public.rooms where id = $1', [chat])).close_reason === 'blocked');
	await expectError('★ 차단된 기존 채팅에 메시지는 저장되지 않는다', () => rowsAs(A,
		"insert into public.messages (room_id, sender_seat, body, client_msg_id) values ($1, 1, 'blocked', gen_random_uuid())", [chat]), 'row-level security');
	const H = await named('ReviewReport'), I = await named('ReviewOther');
	const reportedLetter = await rpcAs(H, 'dm_send', I, 'report');
	const reportedChat = await makeRoom(H, I);
	await rpcAs(I, 'dm_report', reportedLetter.thread_id, 'spam', '');
	check('★ 편지 신고도 기존 랜덤채팅을 즉시 닫는다', (await one('select close_reason from public.rooms where id = $1', [reportedChat])).close_reason === 'reported');

	for (const patch of ["is_open = false", "is_open = true, maintenance = true", "maintenance = false, maintenance_at = now() - interval '1 minute'"]) {
		await db.exec(`update public.app_settings set ${patch}`);
		check('★ 서비스 중단 · 즉시/예약 점검은 새 편지와 답장 모두 차단', (await rpcAs(H, 'dm_send', F, 'closed')).status === 'service_closed'
			&& (await rpcAs(B, 'dm_reply_to', normal.msg_id, 'closed reply')).status === 'service_closed');
	}
	await db.exec('update public.app_settings set is_open = true, maintenance = false, maintenance_at = null');
	for (const action of ['sweep', 'close', 'return', 'match']) {
		const r = await makeRoom(F, G);
		await db.query("update public.rooms set armed_at = now() - interval '5 minutes', expires_at = now() - interval '10 seconds' where id = $1", [r]);
		await db.query("update public.room_members set viewing_until = now() - interval '20 seconds' where room_id = $1", [r]);
		if (action === 'sweep') await db.exec('select public.sweep_rooms()');
		if (action === 'close') await rpcAs(F, 'close_if_expired', r);
		if (action === 'return') await rpcAs(F, 'room_view', r, true);
		if (action === 'match') await rpcAs(F, 'request_match');
		const snap = await rpcAs(F, 'room_snapshot', r);
		check(`★ 마지막 접속 TTL이 마감 전에 끝났으면 남은 시간을 보존 (${action})`, snap.status === 'active' && snap.paused);
	}

	const identityOnly = await named('ReviewStaff');
	await db.query("insert into private.staff(user_id, role) values ($1, 'beta')", [identityOnly]);
	await db.exec("delete from private.role_perms where role = 'beta'; insert into private.role_perms(role, perm) values ('beta', 'identity')");
	check('★ identity만 가진 역할도 뱃지 요청 화면의 카탈로그를 볼 수 있다', (await svc('admin_badges', identityOnly)).some((d) => d.code === 'cnsa_student')
		&& Array.isArray(await svc('admin_badge_requests', identityOnly, true)));
	await db.exec("delete from private.role_perms where role = 'beta'");
	await expectError('★ moderate · identity 둘 다 없으면 뱃지 카탈로그 거부', () => svc('admin_badges', identityOnly), 'no_permission');
	const adm = (await one("select user_id from private.staff where role = 'admin' limit 1")).user_id;
	const logs = Number((await one("select count(*) n from private.audit_log where action = 'export_messages'")).n);
	await svc('admin_export_messages', adm, new Date(Date.now() - 3600_000).toISOString(), new Date(Date.now() + 3600_000).toISOString(), 1, 1);
	check('★ 첫 요청이 임의 양수 커서여도 내보내기를 기록한다', Number((await one("select count(*) n from private.audit_log where action = 'export_messages'")).n) === logs + 1);

	await db.exec('update public.app_settings set ai_chat = true, ai_chat_daily_cap = 100000, ai_chat_per_user = 50');
	const ai2 = await rpcAs(F, 'ai_chat_start');
	check('★ 여러 사용자 턴 전체의 금지 정보를 AI 대화 DB가 검사', (await svc('ai_chat_turn', ai2.id, F, 'a'.repeat(500) + '\n01012345678')).status === 'blocked');
	check('AI 검사 입력은 합친 20개 턴 상한까지만', (await svc('ai_chat_turn', ai2.id, F, 'a'.repeat(10020))).status === 'bad_text');
}

console.log('\n[98] 뱃지 코드 msmsp_gold → msmp_gold — 이미 설치된 DB 에서 가진 학생 · 대표 · 숨김 설정이 따라 옮겨진다 (Phase 88)');
{
	const u = await person('m', 'f');
	// 옛 DB 흉내: 옛 코드의 정의와 그 뱃지를 가진 학생
	await db.exec(`insert into private.achievement_defs (code, title, description, icon, category, stat, unit, bronze, silver, gold, lower_better, sort, granted)
		select 'msmsp_gold', title, description, icon, category, 'msmsp_gold', unit, bronze, silver, gold, lower_better, sort, granted from private.achievement_defs where code = 'msmp_gold'`);
	await db.query(`insert into private.user_achievements (user_id, code, tier) values ($1, 'msmsp_gold', 3)`, [u]);
	await db.query(`update public.profiles set featured_badges = array['msmsp_gold'], badge_chat = '{"msmsp_gold": true}'::jsonb where id = $1`, [u]);
	// 스키마의 Phase 88 구역만 다시 실행한다 (전체를 다시 돌리면 앞 구역이 남긴 운영진 역할 때문에 옛 제약에서 멈춘다)
	const schema = readFileSync(SCHEMA, 'utf8');
	await db.exec(schema.slice(schema.lastIndexOf("update private.user_achievements set code = 'msmp_gold'")));
	const p = await one('select featured_badges, badge_chat from public.profiles where id = $1', [u]);
	check('★ 가진 뱃지가 새 코드로 옮겨진다', (await cnt(`select count(*)::int n from private.user_achievements where user_id = $1 and code = 'msmp_gold' and tier = 3`, [u])) === 1);
	check('★ 대표 업적 · 랜덤채팅 숨김 설정도 새 코드로', p.featured_badges.join() === 'msmp_gold' && p.badge_chat['msmp_gold'] === true && !('msmsp_gold' in p.badge_chat), JSON.stringify(p));
	check('옛 코드의 정의는 없어진다', (await cnt(`select count(*)::int n from private.achievement_defs where code = 'msmsp_gold'`)) === 0);
	check('학생 화면에도 새 코드로 보인다', (await rpcAs(u, 'my_achievements')).items.some((a) => a.code === 'msmp_gold' && a.tier === 3));
}



console.log('\n[100] 마이그레이션과 스키마 snapshot 일치');
{
	const defs = async () => (await db.query("select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' name, pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1")).rows;
	const before = JSON.stringify(await defs());
	// 운영에 적용한 순서대로 다시 실행하면 snapshot과 같아야 한다 (뒤 마이그레이션이 앞의 함수를 고쳐 쓴다)
	for (const file of ['20261004020721_project_review_upgrade.sql', '20261004141539_admin_account_deletion.sql', '20261004150534_review_fixes_20261004.sql'])
		await db.exec(readFileSync(here + 'migrations/' + file, 'utf8'));
	check('업그레이드 마이그레이션의 함수가 snapshot과 같음', JSON.stringify(await defs()) === before);
}

console.log('\n[99] 프로젝트 검토 개선 회귀');
{
	const exhausted = (await one("insert into private.mod_queue(kind,ref_id,status,tries,claimed_at) values('message',999999992,'working',3,now()) returning id")).id;
	await svc('mod_release',[exhausted]);
	check('AI 검토는 승인 3회 뒤 오류로 보관', (await one('select status,tries from private.mod_queue where id=$1',[exhausted])).status === 'error');
	const u = await person('m', 'f');
	await db.exec("update public.app_settings set is_open=true,maintenance=false,maintenance_at=null,ai_chat=true,ai_chat_daily_cap=100000,ai_chat_per_user=50");
	const c = await rpcAs(u, 'ai_chat_start'); const rid = crypto.randomUUID();
	const first = await svc('ai_chat_claim', c.id, u, rid, '안녕');
	check('AI 첫 요청은 한 턴만 승인', first.status === 'ok' && first.turns === 1 && !!first.lease);
	check('같은 요청의 진행 중 재전송은 pending', (await svc('ai_chat_claim', c.id, u, rid, '안녕')).status === 'pending');
	check('같은 ID에 다른 입력은 거부', (await svc('ai_chat_claim', c.id, u, rid, '다른말')).status === 'bad_text');
	check('다른 lease가 AI 응답을 덮지 못함', !(await svc('ai_chat_finish', c.id, rid, crypto.randomUUID(), '위조')));
	await svc('ai_chat_finish', c.id, rid, first.lease, '반가워');
	const cached = await svc('ai_chat_claim', c.id, u, rid, '안녕');
	check('성공 응답 재전송은 캐시·같은 턴 수', cached.cached && cached.reply === '반가워' && cached.turns === 1);
	// 15분이 지난 응답은 정기 정리(review_cleanup) 전이라도 돌려주지 않는다 — 승인 함수는 테이블 전체를 고치지 않는다
	await db.query(`update private.ai_requests set completed_at = now() - interval '16 minutes' where request_id = $1`, [rid]);
	check('15분 지난 응답은 정리 전에도 만료', (await svc('ai_chat_claim', c.id, u, rid, '안녕')).status === 'expired'
		&& (await one(`select reply from private.ai_requests where request_id = $1`, [rid])).reply === '반가워');
	await svc('review_cleanup');
	check('정기 정리가 15분 지난 응답을 지운다', (await one(`select reply from private.ai_requests where request_id = $1`, [rid])).reply === null);
	const retryId = crypto.randomUUID(), a = await svc('ai_chat_claim', c.id, u, retryId, '오늘 어때');
	await svc('ai_chat_finish', c.id, retryId, a.lease, null);
	const b = await svc('ai_chat_claim', c.id, u, retryId, '오늘 어때');
	check('AI 실패 재시도는 턴을 추가 소비하지 않음', b.turns === a.turns && b.lease !== a.lease);
	await svc('ai_chat_finish', c.id, retryId, b.lease, null);
	check('같은 턴은 모델 파이프라인 두 번에서 멈춤', (await svc('ai_chat_claim', c.id, u, retryId, '오늘 어때')).status === 'ai_unavailable');
	await db.query("update private.ai_requests set completed_at=now()-interval '16 minutes' where chat_id=$1", [c.id]);
	await svc('review_cleanup');
	check('응답 TTL이 지난 AI 본문은 정리됨', (await one('select count(*)::int n from private.ai_requests where chat_id=$1 and reply is not null',[c.id])).n === 0);
	await db.query("update public.profiles set suspended_until=now()+interval '1 day' where id=$1",[u]);
	check('제재 계정은 기존 AI 대화도 거부', (await svc('ai_chat_claim', c.id, u, crypto.randomUUID(), '안녕')).status === 'restricted');
	await db.query('update public.profiles set suspended_until=null where id=$1',[u]);
	for (let i=0;i<20;i++) check('AI 호출 제한 내 승인 '+i, (await svc('api_rate_take',u,'ai-chat')).allowed);
	check('호출 제한 초과는 대기 시간을 반환', !(await svc('api_rate_take',u,'ai-chat')).allowed);
	await expectError('학생은 호출 제한 승인 RPC를 직접 실행하지 못함', () => rpcAs(u,'api_rate_take',u,'ai-chat'), 'permission denied');
	const staff = (await one("select user_id from private.staff where role='admin' limit 1")).user_id;
	const authId = crypto.randomUUID();
	await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[authId,staff]);
	const sid = await svc('admin_session_issue',staff,authId);
	check('운영자 Auth 세션과 쿠키 세션을 연결', await svc('admin_session_valid',staff,sid));
	await svc('admin_session_revoke',staff,sid);
	check('운영자 로그아웃은 복사한 쿠키도 폐기', !(await svc('admin_session_valid',staff,sid)));
	const sid2 = await svc('admin_session_issue',staff,authId);
	await db.query("update auth.users set encrypted_password='new-hash' where id=$1",[staff]);
	check('비밀번호 변경은 운영자 세션을 무효화', !(await svc('admin_session_valid',staff,sid2)));
	const sid3 = await svc('admin_session_issue',staff,authId);
	await db.query('delete from auth.sessions where id=$1',[authId]);
	check('Auth 세션 폐기도 운영자 쿠키를 무효화', !(await svc('admin_session_valid',staff,sid3)));
	const reserved = (await one("select private.push_reserve('notice',999999,null) p")).p;
	await svc('push_complete',reserved.job,reserved.lease,0,1,false);
	check('실패 푸시는 성공으로 기록되지 않음', (await one('select state from private.push_outbox where job_key=$1',[reserved.job])).state === 'failed');
	await db.query("update private.push_outbox set next_attempt=now()-interval '1 second' where job_key=$1",[reserved.job]);
	const retry = (await one("select private.push_reserve('notice',999999,null) p")).p;
	check('재시도는 새 lease를 가지며 중복 예약 불가', retry.lease !== reserved.lease && !(await one("select private.push_reserve('notice',999999,null) p")).p);
	await svc('push_complete',reserved.job,reserved.lease,1,0,false);
	check('늦은 완료는 새 예약을 덮지 못함', (await one('select state from private.push_outbox where job_key=$1',[reserved.job])).state === 'pending');
	await svc('push_complete',retry.job,retry.lease,1,0,false);
	check('성공한 푸시는 다시 예약하지 않음', !(await one("select private.push_reserve('notice',999999,null) p")).p);
	const job = await svc('admin_export_start',staff,new Date(Date.now()-3600_000).toISOString(),new Date(Date.now()+3600_000).toISOString());
	check('CSV 추출 작업은 범위 상한을 고정', Number.isFinite(job.upper_id) && !!job.id);
	await expectError('다른 운영자 ID는 작업을 이어받지 못함', () => svc('admin_export_chunk',u,job.id,0), 'not_staff');
	await expectError('CSV 역순 날짜는 거부', () => svc('admin_export_start',staff,new Date().toISOString(),new Date(Date.now()-1).toISOString()), 'bad_range');
	await expectError('학생은 signup_stats를 TRUNCATE하지 못함', () => as(u,()=>db.exec('truncate public.signup_stats')), 'permission denied');
	await db.exec('delete from public.signup_stats');
	check('통계 행이 없으면 편지는 잠김', (await one('select private.letters_locked() v')).v === true);
	await db.query("update public.profiles set onboarded=onboarded where id=$1",[u]);
	check('다음 프로필 갱신은 누락된 통계 행 복구', (await one('select count(*)::int n from public.signup_stats')).n === 1);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
