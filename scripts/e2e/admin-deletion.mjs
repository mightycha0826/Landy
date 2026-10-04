import { ROOT, CHROME, OUT, answerDialogs } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const STAFF = '11111111-1111-4111-8111-111111111111', USER = '22222222-2222-4222-8222-222222222222', OTHER = '33333333-3333-4333-8333-333333333333';
const SECRET = 'deletion-test-only-secret'.padEnd(48, 'x'), SB = 'http://127.0.0.1:54397', PORT = 5197, BASE = `http://localhost:${PORT}`;
let role = 'admin', failure = '', exists = true, jobs = [], calls = [], answers = true;
const stamp = () => new Date().toISOString();
const deletion = { id: 1, user_id: USER, kind: 'account', body: '[계정 삭제 요청]\n삭제를 요청합니다.', created_at: stamp(), answered_at: null, answer: null };
const normal = { ...deletion, id: 2, user_id: OTHER, body: '학교 이메일을 변경할 수 있나요?' };
let items = [deletion, normal];
const error = (message) => { throw { message }; };
const RPC = {
	admin_session_valid: () => true,
	admin_staff_touch: () => ({ role, perms: ['inquiry'], team: [] }),
	admin_inquiries: () => ({ open: items.length, items }),
	admin_student_labels: () => ({ [USER]: '29993 가상 학생' }),
	admin_account_deletions: () => failure === 'history' ? error('mock unavailable') : jobs,
	admin_account_delete_prepare: (a) => {
		calls.push(['prepare', a]);
		if (a.p_user !== USER || a.p_id !== 1) error('deletion_target_mismatch');
		jobs = [{ user_id: USER, inquiry_id: 1, staff_id: STAFF, note: a.p_note, status: 'processing', lease_until: new Date(Date.now() + 600_000).toISOString(), created_at: stamp(), updated_at: stamp(), completed_at: null, failure_stage: null }];
		return { user_id: USER, lease: '44444444-4444-4444-8444-444444444444', auth_exists: exists, assets: exists ? [{ bucket: 'badge-proofs', path: `${USER}/sample.jpg` }] : [] };
	},
	admin_account_delete_finish: (a) => {
		calls.push(['finish', a]);
		if (a.p_stage) { jobs[0] = { ...jobs[0], status: 'failed', failure_stage: a.p_stage, updated_at: stamp() }; return null; }
		assert.equal(exists, false);
		jobs[0] = { ...jobs[0], status: 'deleted', completed_at: stamp(), updated_at: stamp() };
		return null;
	}
};
const sb = http.createServer((req, res) => {
	let raw = '';
	req.on('data', (part) => raw += part);
	req.on('end', async () => {
		const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
		try {
			const args = raw ? JSON.parse(raw) : {};
			if (req.url.startsWith('/auth/v1/admin/users/')) {
				if (req.method === 'PUT') { calls.push(['ban', req.url, args]); return send(200, { id: USER, aud: 'authenticated' }); }
				if (req.method === 'DELETE') { calls.push(['auth', req.url, args]); exists = false; items = items.filter((q) => q.user_id !== USER); return send(200, { id: USER }); }
			}
			if (req.url.startsWith('/storage/v1/object/')) { calls.push(['storage', req.url, args]); return send(failure === 'storage' ? 400 : 200, failure === 'storage' ? { message: 'mock outage' } : []); }
			const fn = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
			if (!RPC[fn]) return send(404, { message: 'missing mock' });
			send(200, await RPC[fn](args));
		} catch (e) { send(400, { message: e.message ?? 'mock failure' }); }
	});
}).listen(54397);
const env = { ...process.env, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'fake-service-key', PUBLIC_SUPABASE_URL: SB, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest', ADMIN_SESSION_SECRET: SECRET };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; vite.stdout.on('data', (d) => output += d); vite.stderr.on('data', (d) => output += d);
for (let n = 0; n < 120 && !output.includes('ready') && vite.exitCode === null; n++) await new Promise((r) => setTimeout(r, 500));
assert.ok(output.includes('ready'), output);
const browser = await chromium.launch({ executablePath: CHROME });
let passed = 0;
const check = (label, ok) => { assert.ok(ok, label); passed++; console.log(`PASS ${label}`); };
try {
	const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
	const payload = `${STAFF}.00000000-0000-4000-8000-000000000009.${Math.floor(Date.now() / 1000) + 3600}`;
	await context.addCookies([{ name: 'simbun_admin', value: `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`, domain: 'localhost', path: '/admin', httpOnly: true, sameSite: 'Strict' }]);
	const page = await context.newPage(), errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	await answerDialogs(page, () => answers);
	const open = async () => { await page.goto(`${BASE}/admin/inquiries`); await page.waitForLoadState('networkidle'); };
	const values = { id: '1', user: USER, confirmation: '삭제 1', note: '요청자와 처리 범위 확인', acknowledged: 'yes' };
	const post = async (form) => (await page.request.post(`${BASE}/admin/inquiries?/deleteAccount`, { form, headers: { origin: BASE } })).json();
	role = 'moderator'; await open();
	check('운영자는 삭제 실행 버튼을 받지 않는다', await page.locator('.delete-account').count() === 0);
	const denied = await post(values);
	check('운영자는 직접 POST해도 액션이 403으로 거절한다', denied.status === 403 && calls.length === 0);
	role = 'admin'; await open();
	check('관리자는 삭제 요청에만 실행 폼을 받는다', await page.locator('.delete-account').count() === 1);
	check('삭제 범위와 되돌릴 수 없음이 보인다', (await page.locator('.delete-account').innerText()).includes('요청한 계정 삭제'));
	check('확인 체크 누락은 서버에서 400', (await post({ ...values, acknowledged: '' })).status === 400 && calls.length === 0);
	check('확인 문구가 다르면 서버에서 400', (await post({ ...values, confirmation: '삭제 2' })).status === 400 && calls.length === 0);
	const mismatch = await post({ ...values, user: OTHER });
	check('요청과 계정 불일치는 인증 삭제까지 도달하지 않는다', mismatch.status === 403 && !calls.some((c) => c[0] === 'auth'));
	calls = [];
	const fill = async () => {
		await page.locator('.delete-account summary').click();
		await page.locator('[name=note]').fill(values.note);
		await page.locator('[name=confirmation]').fill(values.confirmation);
		await page.locator('[name=acknowledged]').check();
	};
	await fill(); answers = false; await page.getByRole('button', { name: '계정 영구 삭제', exact: true }).click();
	await page.waitForTimeout(600);
	check('최종 확인창 취소는 서버 요청을 보내지 않는다', calls.length === 0);
	answers = true; failure = 'storage';
	await page.getByRole('button', { name: '계정 영구 삭제', exact: true }).click();
	await page.getByText('처리 실패 · 재시도 필요', { exact: true }).waitFor();
	check('파일 삭제 실패는 계정 삭제 완료로 표시하지 않는다', jobs[0].status === 'failed' && exists && !calls.some((c) => c[0] === 'auth'));
	check('중단 단계와 계정 제한을 안내한다', (await page.locator('main').innerText()).includes('첨부 파일 삭제'));
	failure = ''; calls = []; await fill();
	await page.getByRole('button', { name: '삭제 처리 다시 시도', exact: true }).click();
	await page.getByText('계정 삭제 완료', { exact: true }).waitFor();
	check('재시도는 파일 삭제 후 실제 Auth API를 호출한다', calls.findIndex((c) => c[0] === 'storage') < calls.findIndex((c) => c[0] === 'auth') && !exists);
	check('성공한 요청은 삭제됐지만 완료 내역이 남는다', !items.some((q) => q.id === 1) && jobs[0].status === 'deleted');
	await open();
	check('새로고침해도 완료 내역이 보이며 실행 폼은 사라진다', await page.getByText('계정 삭제 완료', { exact: true }).count() === 1 && await page.locator('.delete-account').count() === 0);
	await page.screenshot({ path: `${OUT}/admin-account-deleted.png`, fullPage: true });
	jobs[0] = { ...jobs[0], status: 'failed', failure_stage: 'record' }; calls = []; await open(); await fill();
	await page.getByRole('button', { name: '삭제 처리 다시 시도', exact: true }).click();
	await page.getByText('계정 삭제 완료', { exact: true }).waitFor();
	check('인증 삭제 후 기록 실패는 Auth 재삭제 없이 완료 기록을 복구한다', !calls.some((c) => c[0] === 'auth' || c[0] === 'ban') && jobs[0].status === 'deleted');
	jobs = []; items = [deletion, normal]; failure = 'history'; await open();
	check('내역 조회 실패 시 실행을 막고 복구 안내를 보여준다', await page.locator('.delete-account').count() === 0 && (await page.locator('main').innerText()).includes('삭제 실행을 잠시 막았어요'));
	failure = ''; await open();
	await page.setViewportSize({ width: 390, height: 844 }); await fill();
	check('모바일 관리자 화면에 가로 넘침이 없다', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
	await page.screenshot({ path: `${OUT}/admin-account-delete-mobile.png`, fullPage: true });
	check('브라우저 오류 없음', errors.length === 0);
} finally { await browser.close(); stopProcess(vite); sb.close(); }
console.log(`${passed} passed, 0 failed`);
