import { ROOT, CHROME, OUT } from './_env.mjs';
import { chromium } from 'playwright-core';

const SP = OUT;
const BASE = 'http://localhost:5199';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = (email) => ({
	access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
});

async function newPage(browser, log) {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	page.on('pageerror', (e) => log.errors.push(String(e)));
	await page.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (u.pathname === '/auth/v1/otp') {
			const body = req.postDataJSON();
			log.otp.push(body);
			if (!body.create_user && body.email.startsWith('39997')) return json(422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
			return json(200, {});
		}
		if (u.pathname === '/auth/v1/verify') { log.verify++; return json(200, session(req.postDataJSON().email)); }
		if (u.pathname === '/auth/v1/token') return json(200, session(req.postDataJSON().email));
		if (u.pathname.startsWith('/auth/v1/')) return json(200, {});
		if (u.pathname === '/rest/v1/rpc/my_account') return json(200, { has_password: true });
		if (u.pathname === '/rest/v1/profiles') return json(200, { id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true });
		if (u.pathname === '/rest/v1/app_settings') return json(200, { is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 30, join_grace_sec: 30, max_rounds: 99, heartbeat_sec: 30, presence_ttl_sec: 70, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300 });
		if (u.pathname.startsWith('/rest/v1/rpc/')) return json(200, null);
		return json(200, []);
	});
	return page;
}

const browser = await chromium.launch({ executablePath: CHROME });
try {
	// ── 1. 기본 화면 + 비밀번호 찾기 (없는 계정 / 있는 계정)
	console.log('\n[1] 기본 화면 · 비밀번호 찾기');
	{
		const log = { otp: [], verify: 0, errors: [] };
		const page = await newPage(browser, log);
		await page.goto(`${BASE}/login`);
		await page.getByRole('button', { name: '로그인', exact: true }).waitFor();
		await page.screenshot({ path: `${SP}/login-1-main.png` });
		check('기본 화면: 비밀번호 입력칸', await page.getByPlaceholder('비밀번호').isVisible());
		check('기본 화면: 인증 코드 버튼 없음', (await page.getByRole('button', { name: '인증 코드 받기' }).count()) === 0);
		check('기본 화면: 가입하기 링크', await page.getByRole('button', { name: '처음이에요 · 가입하기' }).isVisible());
		check('기본 화면: 비밀번호 찾기 링크', await page.getByRole('button', { name: '비밀번호를 잊었어요' }).isVisible());

		await page.getByRole('button', { name: '비밀번호를 잊었어요' }).click();
		await page.screenshot({ path: `${SP}/login-2-reset.png` });
		check('비밀번호 찾기 화면 제목', await page.getByRole('heading', { name: '비밀번호 찾기' }).isVisible());
		await page.getByPlaceholder('학교 이메일 앞부분').fill('39997'); // 가입하지 않은 학번
		await page.getByRole('button', { name: '인증 코드 받기' }).click();
		await page.getByLabel('인증 코드').waitFor();
		check('★ 비밀번호 찾기는 새 계정을 만들지 않는다 (create_user=false)', log.otp.at(-1)?.create_user === false, JSON.stringify(log.otp.at(-1)));
		check('★ 없는 계정이어도 똑같이 "발송" 화면 (가입 여부 비노출)', await page.getByText('인증 코드 6자리를 보냈어요').isVisible());

		await page.getByRole('button', { name: '로그인으로 돌아가기' }).click();
		await page.getByRole('button', { name: '비밀번호를 잊었어요' }).click();
		await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
		await page.getByRole('button', { name: '인증 코드 받기' }).click();
		await page.getByLabel('인증 코드').fill('123456');
		await page.screenshot({ path: `${SP}/login-3-code.png` });
		await page.getByRole('button', { name: '확인', exact: true }).click();
		await page.waitForURL('**/settings#password', { timeout: 8000 }).catch(() => {});
		check('★ 비밀번호 찾기 인증 후 → /settings#password', page.url().endsWith('/settings#password'), page.url());
		await page.getByText('새 비밀번호를 정해 주세요').waitFor({ timeout: 5000 }).catch(() => {});
		await page.screenshot({ path: `${SP}/login-4-newpw.png` });
		check('★ 기존 비밀번호 확인 없이 바로 새 비밀번호 입력', await page.getByText('새 비밀번호를 정해 주세요').isVisible());
		check('페이지 오류 없음', log.errors.length === 0, log.errors.join(' / '));
	}

	// ── 2. 처음 가입
	console.log('\n[2] 처음 가입');
	{
		const log = { otp: [], verify: 0, errors: [] };
		const page = await newPage(browser, log);
		await page.goto(`${BASE}/login`);
		await page.getByRole('button', { name: '처음이에요 · 가입하기' }).click();
		check('가입 화면 제목', await page.getByRole('heading', { name: '처음 가입' }).isVisible());
		// 학번만 (Phase 44) — 영어가 섞이면 선생님 안내, 숫자가 모자라면 형식 안내. 둘 다 코드를 보내지 않는다
		const sendBtn = page.getByRole('button', { name: '인증 코드 받기' });
		await page.getByPlaceholder('학교 이메일 앞부분').fill('kimteacher');
		check('★ 영어 아이디 → "선생님이신가요?" 학생 전용 안내 · 코드 받기 꺼짐', (await page.getByRole('alert').innerText()).includes('학생들을 위한') && await sendBtn.isDisabled());
		await page.screenshot({ path: `${SP}/login-teacher.png` });
		await page.getByPlaceholder('학교 이메일 앞부분').fill('2010');
		check('★ 학번이 모자라면 형식 안내 · 코드 받기 꺼짐', (await page.getByRole('status').innerText()).includes('학번 5자리') && await sendBtn.isDisabled());
		await page.getByPlaceholder('학교 이메일 앞부분').fill('40101');
		check('학년이 1~3 이 아니면 안 된다', await sendBtn.isDisabled());
		check('여기까지 인증 코드는 한 번도 안 보냄', log.otp.length === 0);
		await page.getByPlaceholder('학교 이메일 앞부분').fill('19998');
		await page.getByRole('button', { name: '인증 코드 받기' }).click();
		await page.getByLabel('인증 코드').fill('123456');
		check('★ 가입은 계정 생성 허용 (create_user=true)', log.otp.at(-1)?.create_user === true, JSON.stringify(log.otp.at(-1)));
		await page.getByRole('button', { name: '시작하기' }).click();
		await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8000 }).catch(() => {});
		check('가입 인증 후 → 홈', new URL(page.url()).pathname === '/', page.url());
		check('페이지 오류 없음', log.errors.length === 0, log.errors.join(' / '));
	}

	// ── 3. 비밀번호 찾기에서 실패한 뒤 일반 로그인은 홈으로 (목적지가 남지 않는다)
	console.log('\n[3] 비밀번호 로그인');
	{
		const log = { otp: [], verify: 0, errors: [] };
		const page = await newPage(browser, log);
		await page.goto(`${BASE}/login`);
		await page.getByRole('button', { name: '비밀번호를 잊었어요' }).click();
		await page.getByRole('button', { name: '로그인으로 돌아가기' }).click();
		await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
		await page.getByPlaceholder('비밀번호').fill('abcd1234');
		await page.getByRole('button', { name: '로그인', exact: true }).click();
		await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 8000 }).catch(() => {});
		check('비밀번호 로그인 → 홈', new URL(page.url()).pathname === '/' && !page.url().includes('#password'), page.url());
		check('인증 코드는 한 번도 안 보냄', log.otp.length === 0);
	}
} finally {
	await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
