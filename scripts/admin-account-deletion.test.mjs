import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const code = stripTypeScriptTypes(readFileSync(new URL('../src/lib/server/accountDeletion.ts', import.meta.url), 'utf8'));
const { deleteRequestedAccount } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const input = { staff: 'operator', inquiry: 7, user: 'untrusted-input', confirmation: '삭제 7', note: '학생 요청 확인' };
function fixture(failure, exists = true) {
	const calls = [];
	const client = {
		rpc: async (name, args) => {
			calls.push([name, args]);
			if (name.endsWith('prepare')) return { data: { user_id: 'db-verified-target', lease: 'lease', auth_exists: exists, assets: [{ bucket: 'badge-proofs', path: 'target/photo' }] }, error: failure === 'prepare' ? { message: 'denied' } : null };
			return { error: failure === 'record' && !args.p_stage ? { message: 'outage' } : null };
		},
		auth: { admin: {
			updateUserById: async (id, opts) => { calls.push(['ban', id, opts]); return { error: failure === 'auth_lock' ? {} : null }; },
			deleteUser: async (id, soft) => { calls.push(['auth', id, soft]); return { error: failure === 'auth' ? {} : null }; }
		} },
		storage: { from: (bucket) => ({ remove: async (paths) => { calls.push(['storage', bucket, paths]); return { error: failure === 'storage' ? {} : null }; } }) }
	};
	return { client, calls };
}
test('DB로 확인한 대상만 잠금→Storage API→Auth API→완료 확인 순서로 삭제한다', async () => {
	const { client, calls } = fixture();
	assert.ok('done' in await deleteRequestedAccount(client, input));
	assert.deepEqual(calls.map((c) => c[0]), ['admin_account_delete_prepare', 'ban', 'storage', 'auth', 'admin_account_delete_finish']);
	assert.equal(calls[1][1], 'db-verified-target');
	assert.deepEqual(calls[3].slice(1), ['db-verified-target', false]);
});
test('권한/확인 실패는 Auth와 Storage에 도달하지 않는다', async () => {
	const { client, calls } = fixture('prepare');
	await assert.rejects(deleteRequestedAccount(client, input), /denied/);
	assert.equal(calls.length, 1);
});
test('각 단계 실패를 성공으로 표시하지 않고 재시도 가능한 중단 단계로 기록한다', async () => {
	for (const stage of ['auth_lock', 'storage', 'auth', 'record']) {
		const { client, calls } = fixture(stage);
		assert.ok('error' in await deleteRequestedAccount(client, input));
		assert.equal(calls.at(-1)[1].p_stage, stage);
		if (stage === 'storage' || stage === 'auth_lock') assert.equal(calls.some((c) => c[0] === 'auth'), false);
	}
});
test('Auth 삭제 후 기록만 실패한 재시도는 존재하지 않는 인증 계정을 다시 삭제하지 않는다', async () => {
	const { client, calls } = fixture(null, false);
	assert.ok('done' in await deleteRequestedAccount(client, input));
	assert.equal(calls.some((c) => ['ban', 'auth'].includes(c[0])), false);
});

test('실제 PostgreSQL에서 권한·요청 연결·중복 실행·부분 실패·계정 cascade·완료 원장을 검증한다', async () => {
	const db = new PGlite();
	const sql = async (q, p = []) => (await db.query(q, p)).rows;
	const one = async (q, p = []) => (await sql(q, p))[0];
	try {
		await db.exec(readFileSync(new URL('../supabase/test-bootstrap.sql', import.meta.url), 'utf8'));
		await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
		// 전체 스키마 뒤에 운영 순서대로 다시 실행해도 안전하고, 결과 함수가 스키마와 같다
		const defs = async () => JSON.stringify(await sql("select p.oid::regprocedure::text name, pg_get_functiondef(p.oid) body from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' order by 1"));
		const before = await defs();
		for (const file of ['20261004141539_admin_account_deletion.sql', '20261004150534_review_fixes_20261004.sql'])
			await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
		assert.equal(await defs(), before);
		const user = async (email) => (await one('insert into auth.users(email,email_confirmed_at) values($1,now()) returning id', [email])).id;
		const admin = await user('29991@cnsa.hs.kr'), mod = await user('29992@cnsa.hs.kr'), target = await user('29993@cnsa.hs.kr'), other = await user('29994@cnsa.hs.kr');
		await sql("insert into private.staff(user_id,role) values($1,'admin'),($2,'moderator')", [admin, mod]);
		const inquiry = async (u, body = '[계정 삭제 요청]\n삭제해 주세요') => (await one("insert into private.inquiries(user_id,kind,body) values($1,'account',$2) returning id", [u, body])).id;
		const id = await inquiry(target), normal = await inquiry(other, '설정 사용 방법을 알려주세요');
		const prepare = (staff = admin, i = id, u = target, confirm = `삭제 ${i}`) => one('select public.admin_account_delete_prepare($1,$2,$3,$4,$5) result', [staff, i, u, confirm, '본인 삭제 요청 확인']);
		await assert.rejects(prepare(mod), /admin_only/);
		await assert.rejects(prepare(admin, id, other), /deletion_target_mismatch/);
		await assert.rejects(prepare(admin, normal, other), /not_deletion_request/);
		await assert.rejects(prepare(admin, id, target, '삭제'), /bad_delete_confirmation/);
		await assert.rejects(prepare(admin, await inquiry(mod), mod), /staff_delete_forbidden/);
		await assert.rejects(prepare(admin, await inquiry(admin), admin), /staff_delete_forbidden/);
		// 안내 답변을 먼저 보낸 요청도 삭제할 수 있다 (삭제 뒤에는 학생이 앱에서 답변을 볼 수 없다)
		await sql("update private.inquiries set answered_at=now(), answer='처리 안내' where id=$1", [id]);
		for (const role of ['anon', 'authenticated']) {
			await db.exec(`set role ${role}`);
			try { await assert.rejects(prepare(), /permission denied/); } finally { await db.exec('reset role'); }
		}
		const room = (await one("select private.dev_open_room('29993@cnsa.hs.kr','29994@cnsa.hs.kr') id")).id;
		await sql("insert into private.dm_threads(sender_id,recipient_id,sender_alias) values($1,$2,'가짜 우표'),($2,$1,'가짜 우표')", [target, other]);
		const path = `${target}/testphoto.jpg`;
		await sql("insert into storage.objects(bucket_id,name,owner) values('badge-proofs',$1,$2)", [path, target]);
		const plan = (await prepare()).result;
		assert.equal(plan.auth_exists, true);
		assert.deepEqual(plan.assets, [{ bucket: 'badge-proofs', path }]);
		assert.equal((await one('select status from public.profiles where id=$1', [target])).status, 'banned');
		assert.equal((await one('select status from public.rooms where id=$1', [room])).status, 'closed');
		await assert.rejects(prepare(), /deletion_busy/);
		const finish = (lease, stage = null) => sql('select public.admin_account_delete_finish($1,$2,$3,$4)', [admin, target, lease, stage]);
		await assert.rejects(finish(plan.lease), /deletion_not_complete/);
		await finish(plan.lease, 'storage');
		const next = (await prepare()).result;
		await assert.rejects(finish(plan.lease), /deletion_lease_invalid/);
		// 테스트 DB에서만 Storage API / GoTrue 삭제 결과를 재현한다. 구현은 API를 사용한다.
		await sql('delete from storage.objects where name=$1', [path]);
		await sql('delete from auth.users where id=$1', [target]);
		await finish(next.lease);
		assert.equal((await one('select count(*)::int n from public.profiles where id=$1', [target])).n, 0);
		assert.equal((await one('select count(*)::int n from private.inquiries where user_id=$1', [target])).n, 0);
		assert.equal((await one('select count(*)::int n from private.dm_threads where sender_id=$1 or recipient_id=$1', [target])).n, 0);
		assert.equal((await one('select status from private.account_deletions where user_id=$1', [target])).status, 'deleted');
		assert.equal((await one("select count(*)::int n from private.audit_log where action='account_delete_complete' and target_user=$1", [target])).n, 1);
		assert.equal((await one('select count(*)::int n from public.profiles where id=$1', [other])).n, 1);
		await assert.rejects(prepare(), /already_deleted/);
		const history = (await one('select public.admin_account_deletions($1) result', [admin])).result;
		assert.equal(history[0].status, 'deleted');
		assert.equal('lease' in history[0], false);
	} finally { await db.close(); }
});
