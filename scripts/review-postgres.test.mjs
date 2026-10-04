// 전용 빈 로컬 테스트 DB에서만 실행한다. 운영 프로젝트에 연결하지 않는다.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
if (process.env.PGDATABASE !== 'landy_review_test' || !['localhost', '127.0.0.1'].includes(process.env.PGHOST)) throw new Error('전용 로컬 landy_review_test DB가 필요합니다');
const base = ['-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'];
const sql = async (query) => (await exec('psql', [...base, '-c', query], { maxBuffer: 10 * 1024 * 1024, windowsHide: true })).stdout.trim();
const file = async (path) => exec('psql', [...base, '-f', path], { maxBuffer: 10 * 1024 * 1024, windowsHide: true });
await file('supabase/test-bootstrap.sql');
await file('supabase/schema.sql');
await file('supabase/migrations/20261004020721_project_review_upgrade.sql');
await file('supabase/migrations/20261004141539_admin_account_deletion.sql');
await file('supabase/migrations/20261004150534_review_fixes_20261004.sql');

const uid = (await sql("insert into auth.users(email,email_confirmed_at) values('review-concurrency@cnsa.hs.kr',now()) returning id")).split('\n').at(-1);
assert.match(uid, /^[0-9a-f-]{36}$/);
await sql(`update public.profiles set gender='m',want='any',onboarded=true where id='${uid}'`);
await sql(`insert into private.dm_folders(owner_id,name) select '${uid}', 'folder-'||n from generate_series(1,29) n`);
const runAs = (user, query) => sql(`begin; select set_config('test.uid','${user}',true); set local role authenticated; ${query}; commit`);
const jobs = await Promise.all(['last-a', 'last-b'].map((name) => runAs(uid, `select public.dm_folder_put(array[-1::bigint],null,'${name}'); select pg_sleep(0.15)`)));
const statuses = jobs.map((out) => JSON.parse(out.split('\n').find((line) => line.startsWith('{'))).status).sort();
assert.deepEqual(statuses, ['ok', 'too_many']);
assert.equal(await sql(`select count(*) from private.dm_folders where owner_id='${uid}'`), '30');
console.log('PASS 폴더 29개에서 동시 생성 두 건 → 30개 상한');

const users = [];
for (let i = 0; i < 4; i++) {
	const id = (await sql(`insert into auth.users(email,email_confirmed_at) values('review-match-${i}@cnsa.hs.kr',now()) returning id`)).split('\n').at(-1);
	await sql(`update public.profiles set gender='${i % 2 ? 'f' : 'm'}',want='any',onboarded=true where id='${id}'`); users.push(id);
}
await Promise.all(users.map((id) => runAs(id, 'select public.request_match()')));
await Promise.all(users.map((id) => runAs(id, 'select public.request_match()')));
assert.equal(await sql('select count(*) from (select user_id from public.room_members where open group by user_id having count(*)>1) x'), '0');
assert.equal(await sql('select count(*) from (select room_id from public.room_members where open group by room_id having count(*)<>2) x'), '0');
assert.ok(Number(await sql('select count(*) from public.room_members where open')) >= 2);
console.log('PASS 실제 다중 연결 매칭 → 중복 열린 방 없음');

const funcs = [...readFileSync('supabase/migrations/20261004020721_project_review_upgrade.sql', 'utf8').matchAll(/create or replace function ([\w.]+)/g)].map((m) => m[1]);
assert.ok(funcs.includes('public.ai_chat_claim'));
console.log('PASS 실제 PostgreSQL에서 snapshot·업그레이드 마이그레이션 실행');
