import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

/**
 * 보안 회귀 테스트: 합성 계정 · PGlite · SDK 장애만 사용한다.
 * Supabase 프로젝트를 건드리지 않고 스키마·트리거·권한을 검증한다.
 *
 *   npm run test:security
 *
 * ⚠️ PGlite 는 단일 커넥션이라 동시 트랜잭션을 재현할 수 없다.
 *    매칭 advisory lock / 연장 투표 경쟁은 `supabase start`(로컬 Docker Postgres)에서 따로 검증한다.
 */
const here = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA = new URL('../supabase/schema.sql', import.meta.url);

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
await db.exec(`
	create role anon;
	create role authenticated;
	create role service_role;

	create schema auth;
	create table auth.sessions(id uuid primary key, user_id uuid, not_after timestamptz);
	create table auth.users (
		id                 uuid primary key default gen_random_uuid(),
		email              text unique,
		email_confirmed_at timestamptz,
		encrypted_password text,
		raw_user_meta_data jsonb not null default '{}'::jsonb,
		created_at         timestamptz not null default now()
	);
	create or replace function auth.uid() returns uuid
		language sql stable as $x$
		select nullif(current_setting('test.uid', true), '')::uuid
	$x$;
	-- Supabase 기본 권한: 정책 식에서 auth.uid() 를 부를 수 있어야 한다
	grant usage on schema auth to anon, authenticated;
	grant execute on function auth.uid() to anon, authenticated;
	grant usage on schema public to anon, authenticated, service_role;
	-- Supabase 기본 권한 그대로: public 에 새로 만든 표 · 함수 · 시퀀스는 anon · authenticated 에게 전부 열린다
	-- (schema.sql 이 필요한 만큼 직접 닫아야 한다 — 이걸 흉내 내지 않으면 권한 시험이 거짓으로 통과한다)
	alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
	alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
	alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

	-- Supabase Realtime 흉내 (Phase 55) — realtime.send 는 realtime.messages 에 한 줄 넣는다(실제도 그렇다).
	-- 비공개 채널 권한은 Realtime 이 채널 이름을 realtime.topic 설정에 넣고 학생 권한으로 이 표를 읽고 · 써 보는 것으로 확인한다
	create schema realtime;
	create table realtime.messages (
		id          bigint generated always as identity primary key,
		topic       text not null,
		extension   text not null default 'broadcast',
		event       text,
		payload     jsonb,
		private     boolean default false,
		inserted_at timestamptz not null default now()
	);
	alter table realtime.messages enable row level security;
	create function realtime.topic() returns text language sql stable as $x$
		select nullif(current_setting('realtime.topic', true), '')
	$x$;
	create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
		language sql as $x$
		insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private)
	$x$;
	grant usage on schema realtime to anon, authenticated;
	grant select, insert on realtime.messages to anon, authenticated;
	grant execute on function realtime.topic() to anon, authenticated;

	-- Supabase Storage 흉내 (Phase 84 — 뱃지 사진 버킷 · 자기 폴더 권한)
	create schema storage;
	create table storage.buckets (
		id                 text primary key,
		name               text not null,
		public             boolean not null default false,
		file_size_limit    bigint,
		allowed_mime_types text[]
	);
	create table storage.objects (
		id        uuid primary key default gen_random_uuid(),
		bucket_id text references storage.buckets(id),
		name      text not null,
		owner     uuid default auth.uid()
	);
	alter table storage.objects enable row level security;
	create function storage.foldername(name text) returns text[] language sql immutable as $x$
		select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
	$x$;
	grant usage on schema storage to anon, authenticated;
	grant select, insert, delete on storage.objects to authenticated;
	grant execute on function storage.foldername(text) to anon, authenticated;
`);

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


await db.exec(readFileSync(SCHEMA, 'utf8'));
try {
  const uid = await signUp('security-audit1@cnsa.hs.kr', true);
  await db.query("update public.profiles set gender='m',want='any',onboarded=true where id=$1",[uid]);
  await db.exec("update public.app_settings set ai_chat=true, ai_chat_per_user=5, ai_chat_daily_cap=100 where id");
  const chat = (await as(uid, () => one("select public.ai_chat_start() as r"))).r;
  await db.query("update public.profiles set status='banned' where id=$1", [uid]);
  const deniedStart = (await as(uid, () => one("select public.ai_chat_start() as r"))).r;
  await db.exec('set role service_role');
  const afterBan = (await one("select public.ai_chat_turn($1,$2,'Hello friend') as r", [chat.id,uid])).r;
  await db.exec('reset role');
  console.log('AI_AFTER_BAN', JSON.stringify({newChat:deniedStart.status,existingTurn:afterBan.status}));
  assert.equal(deniedStart.status, 'restricted');
  assert.equal(afterBan.status, 'restricted');
  await assert.rejects(as(uid, () => db.query("insert into storage.objects (bucket_id,name) values ('badge-proofs',$1)", [uid+'/banned001.jpg'])), /badge_photo_restricted/);
  const turn = async () => (await one("select public.ai_chat_turn($1,$2,'Hello friend') as r", [chat.id,uid])).r;
  await db.query("update public.profiles set status='active', suspended_until=now()+interval '1 day' where id=$1", [uid]);
  assert.equal((await turn()).status, 'restricted');
  await assert.rejects(as(uid, () => db.query("insert into storage.objects (bucket_id,name) values ('badge-proofs',$1)", [uid+'/unattached1.jpg'])), /badge_photo_restricted/);
  await db.query('update public.profiles set suspended_until=null where id=$1', [uid]);
  assert.equal((await turn()).status, 'ok');
  await db.exec('update public.app_settings set is_open=false where id');
  assert.equal((await turn()).status, 'off');
  await db.exec('update public.app_settings set is_open=true where id');

  const quota = await signUp('security-quota@cnsa.hs.kr', true);
  const upload = (id, name) => as(id, () => db.query("insert into storage.objects(bucket_id,name) values('badge-proofs',$1)",[id+'/'+name+'.jpg']));
  for (let i=0;i<12;i++) await upload(quota, 'upload00'+i);
  await assert.rejects(upload(quota,'overflow1'), /badge_photo_storage_limit/);
  await as(quota, () => db.query('delete from storage.objects where owner=$1',[quota]));
  for (let i=12;i<15;i++) await upload(quota, 'upload00'+i);
  await as(quota, () => db.query('delete from storage.objects where owner=$1',[quota]));
  await assert.rejects(upload(quota,'overflow2'), /badge_photo_daily_limit/);
  // 한 INSERT의 여러 행에도 제한이 적용되고, 거절되면 객체와 원장이 함께 롤백된다.
  const bulk = await signUp('security-bulk@cnsa.hs.kr', true);
  await assert.rejects(as(bulk, () => db.query("insert into storage.objects(bucket_id,name) select 'badge-proofs',$1||'/bulk0000'||i||'.jpg' from generate_series(1,13) i",[bulk])), /badge_photo_storage_limit/);
  assert.equal(Number((await one('select count(*) n from private.badge_photos where user_id=$1',[bulk])).n),0);
  console.log('PASS account sanctions, storage live/daily quotas, bulk rollback');

  const other = await signUp('security-audit2@cnsa.hs.kr', true);
  const path = other + '/proof0001.jpg';
  await as(other, () => db.query("insert into storage.objects(bucket_id,name) values('badge-proofs',$1)",[path]));
  const request = (await as(other, () => one("select public.badge_request_submit('new',null,'audit badge','',array[]::int[],array[$1]::text[]) as r",[path]))).r;
  assert.equal(request.status,'ok');
  const submit = paths => as(other, () => one("select public.badge_request_submit('new',null,'audit badge','',array[]::int[],$1::text[]) as r",[paths]));
  assert.equal((await submit([path])).r.status,'bad_input');
  assert.equal((await submit([other+'/missing01.jpg'])).r.status,'bad_input');
  await db.query("update public.profiles set status='banned' where id=$1",[other]);
  assert.equal((await submit([path])).r.status,'restricted');
  await db.query("update public.profiles set status='active' where id=$1",[other]);
  globalThis.auditFixture = {
    rpc: async (fn,args) => (await as(other, () => one('select public.' + fn + '($1) as r',[args.p_id]))).r,
    remove: async () => ({data:null,error:{message:'simulated storage outage'}})
  };
  const { stripTypeScriptTypes } = await import('node:module');
  const dataUrl = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
  const rpcUrl = dataUrl('export const rpc = (...args) => globalThis.auditFixture.rpc(...args);');
  const supabaseUrl = dataUrl('export const supabase = {storage:{from:()=>({remove:(...args)=>globalThis.auditFixture.remove(...args)})}};');
  const source = stripTypeScriptTypes(readFileSync(new URL('../src/lib/badgeRequests.ts',import.meta.url),'utf8'))
    .replace("'./rpc'",JSON.stringify(rpcUrl)).replace("'./supabase'",JSON.stringify(supabaseUrl));
  const {cancelBadgeRequest} = await import(dataUrl(source));
  const success = await cancelBadgeRequest(request.id);
  const row = await one('select status,cardinality(photos) as tracked from private.badge_requests where id=$1',[request.id]);
  const stored = !!(await one('select 1 as ok from storage.objects where name=$1',[path]));
  assert.equal(success,true);
  assert.equal(row.status,'canceled');
  assert.equal(stored,true);
  assert.ok((await one('select delete_after from private.badge_photos where path=$1',[path])).delete_after);

  const {cleanupBadgePhotos} = await import(dataUrl(stripTypeScriptTypes(readFileSync(new URL('../src/lib/server/badgePhotoCleanup.ts',import.meta.url),'utf8'))));
  let completeCalls=0;
  const worker = {
    rpc: async (name,args) => {
      await db.exec('set role service_role');
      try {
        if(name==='admin_badge_photo_claim') return {data:(await one('select public.admin_badge_photo_claim() r')).r,error:null};
        completeCalls++;
        await db.query('select public.admin_badge_photo_complete($1,$2)',[args.p_paths,args.p_lease]);
        return {data:null,error:null};
      } finally { await db.exec('reset role'); }
    },
    storage:{from:()=>({remove:async()=>({data:null,error:{message:'outage'}})})}
  };
  await assert.rejects(cleanupBadgePhotos(worker),/사진 삭제 실패/);
  assert.equal(completeCalls,0);
  assert.ok((await one('select lease from private.badge_photos where path=$1',[path])).lease);
  await db.query("update private.badge_photos set lease_until=now()-interval '1 second' where path=$1",[path]);
  worker.storage.from = () => ({remove:async paths => {
    await db.query("delete from storage.objects where bucket_id='badge-proofs' and name=any($1::text[])",[paths]);
    return {data:[],error:null};
  }});
  assert.equal(await cleanupBadgePhotos(worker),1);
  assert.ok((await one('select deleted_at from private.badge_photos where path=$1',[path])).deleted_at);
  assert.equal(await one('select 1 x from storage.objects where name=$1',[path]),undefined);
  assert.equal(await cleanupBadgePhotos(worker),0);

  // 제출하지 않은 사진은 기한 뒤 정리하고, 대기 중인 신청 사진은 지키는지 확인한다.
  const orphan = other+'/orphan001.jpg';
  await upload(other,'orphan001');
  const keep = other+'/pending01.jpg';
  await upload(other,'pending01');
  assert.equal((await submit([keep])).r.status,'ok');
  await db.query("update private.badge_photos set delete_after=now()-interval '1 hour' where path=any($1::text[])",[[orphan,keep]]);
  assert.equal(await cleanupBadgePhotos(worker),1);
  assert.ok(await one('select 1 x from storage.objects where name=$1',[keep]));
  assert.equal(await one('select 1 x from storage.objects where name=$1',[orphan]),undefined);
  await assert.rejects(as(other,()=>db.query('select public.admin_badge_photo_claim()')),/permission denied/);
  await assert.rejects(as(other,()=>db.query('select * from private.badge_photos')),/permission denied/);
  console.log('PASS photo ownership, durable deletion failure/retry, orphan cleanup, pending photo protection, service permissions');
  // 기존 DB에서의 업그레이드: 예전 정책이 허용하던 임의 파일명도 정리 원장에 복구한다.
  await db.exec('drop trigger badge_photo_insert on storage.objects');
  const legacy = other+'/old arbitrary filename.jpg';
  await db.query("insert into storage.objects(bucket_id,name) values('badge-proofs',$1)",[legacy]);
  const migration = readFileSync(new URL('../supabase/migrations/20261004020711_security_hardening_20261002.sql',import.meta.url),'utf8');
  const functions = () => db.query("select proname,prosrc from pg_proc join pg_namespace on pg_namespace.oid=pronamespace where nspname='public' and proname=any($1::text[]) order by proname",[['mod_claim','ai_chat_start','ai_chat_turn','badge_request_submit','admin_ai_usage']]);
  const expectedFunctions = (await functions()).rows;
  await db.query('update private.badge_photos set delete_after=null where path=$1',[keep]);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(readFileSync(new URL('../supabase/migrations/20261004020721_project_review_upgrade.sql',import.meta.url),'utf8'));
  assert.deepEqual((await functions()).rows,expectedFunctions);
  assert.ok((await one('select delete_after from private.badge_photos where path=$1',[legacy])).delete_after);
  assert.equal((await one('select delete_after from private.badge_photos where path=$1',[keep])).delete_after,null);
  await db.query("update public.profiles set status='banned' where id=$1",[uid]);
  await assert.rejects(upload(uid,'badagain1'),/badge_photo_restricted/);
  console.log('PASS idempotent deployment migration, existing photo backfill, source/migration parity');
  console.log('Security regressions passed');
} finally { delete globalThis.auditFixture; await db.close(); }
