import { ROOT, CHROME } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';

/**
 * 처음 가입한 날 — 저절로 뜨는 창(사용법 안내 · 새 업적 축하 · 알림 받기)은 한 번에 하나, 시작하기(온보딩)를 마친 뒤에만.
 * 이어서 익명 친구에게 연락해보기 — 대화방으로 가는 길과 기다리는 동안의 머리글 시간.
 * 가짜 Supabase: 가입 직후 첫 박동(heartbeat)이 "새 업적 있음"이라고 답한다 (실서버도 첫 접속에 개근 · 개척자 업적을 준다).
 * 화면에 무엇이 떠 있는지 30ms 마다 적어 두고(__tl) 순서를 본다.
 *
 *   npm run test:ui -- first-run
 */
const PORT = 5184;
const BASE = `http://localhost:${PORT}`;
const env = {
	...process.env,
	PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co',
	PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest',
	PUBLIC_VAPID_KEY: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM' // 알림 받기 안내가 뜨려면 있어야 한다 (값은 쓰이지 않는다)
};
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 120 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const ROOM = '7a000000-0000-4000-8000-00000000000a';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = (email) => ({
	access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
});

const browser = await chromium.launch({ executablePath: CHROME });
try {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e)));
	// 가짜 서버 상태 — 시작하기를 마쳤는지 · 새 업적을 봤는지
	const db = { onboarded: false, seen: false };
	await page.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request();
		const u = new URL(req.url());
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		const fn = u.pathname.replace('/rest/v1/rpc/', '');
		if (u.pathname === '/auth/v1/verify' || u.pathname === '/auth/v1/token') return json(session(req.postDataJSON().email));
		if (u.pathname.startsWith('/auth/v1/')) return json({});
		if (u.pathname === '/rest/v1/profiles') {
			if (req.method() === 'PATCH') { db.onboarded = true; return json([]); }
			return json({ id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'x', want: 'any', status: 'active', suspended_until: null, verified: true, onboarded: db.onboarded });
		}
		if (u.pathname === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 30, join_grace_sec: 30, max_rounds: 99, heartbeat_sec: 30, presence_ttl_sec: 70, msg_max_len: 500, max_open_rooms: 5 });
		if (fn === 'my_account') return json({ has_password: true, name: '홍길동', grade: 1, name_source: 'roster' });
		if (fn === 'heartbeat') return json({ server_now: new Date().toISOString(), maintenance: null, maintenance_at: null, ach_new: !db.seen });
		if (fn === 'new_achievements') return json(db.seen ? [] : [{ code: 'streak', title: '개근', icon: 'flame', tier: 1 }]);
		if (fn === 'mark_achievements_seen') { db.seen = true; return json(null); }
		if (fn === 'my_rooms') return json({ rooms: [], server_now: new Date().toISOString() });
		// 익명 친구에게 연락해보기 (Phase 95) — 상대가 열 때까지 하루를 기다리는 대기 대화
		if (fn === 'anon_friends') return json([{ token: 't1', nickname: '새벽수달', bio: '안녕', interests: [], mbti: null, online: true, manner_temp: 40, badges: [], badge_count: 0 }]);
		if (fn === 'friend_contact') return json({ status: 'ok', room_id: ROOM });
		if (['ack_room', 'room_snapshot', 'close_if_expired', 'room_view'].includes(fn)) return json({
			room_id: ROOM, status: 'pending', my_seat: 1, my_alias: '푸른고래', partner_alias: '새벽수달', expires_at: new Date(Date.now() + 86_400_000).toISOString(),
			round: 1, max_rounds: 99, extend_minutes: 10, vote_window_sec: 30, my_vote: null, partner_vote: null, partner_joined: false, partner_online: true,
			their_read_id: null, close_reason: null, server_now: new Date().toISOString()
		});
		if (fn === 'partner_profile') return json({ nickname: '새벽수달', bio: '안녕', interests: [], mbti: null, online: true });
		if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
		return json([]);
	});
	await page.addInitScript(() => {
		// 진짜 학생 기기처럼 — 알림 권한은 아직 안 물었고, 자동 테스트 표시가 없다 (사용법 안내가 저절로 뜬다)
		Object.defineProperty(Notification, 'permission', { get: () => 'default' });
		Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
		const tl = (window.__tl = []);
		setInterval(() => {
			const open = [
				document.querySelector('.tour[role="dialog"]') && '안내',
				document.querySelector('[role="dialog"][aria-label="새 업적"]') && '축하',
				document.querySelector('#push-title') && '알림'
			].filter(Boolean).join('+');
			const now = `${location.pathname} ${open || '-'}`;
			if (tl.at(-1) !== now) tl.push(now);
		}, 30);
	});
	const timeline = () => page.evaluate(() => window.__tl.slice());
	const windows = (tl) => tl.map((s) => s.split(' ')).filter(([, open]) => open !== '-');

	console.log('\n[1] 가입 → 시작하기');
	await page.goto(`${BASE}/login`);
	await page.getByRole('button', { name: '가입하기', exact: true }).click();
	await page.getByPlaceholder('학교 이메일 앞부분').fill('19998');
	await page.getByRole('button', { name: '인증 코드 받기' }).click();
	await page.getByLabel('인증 코드').fill('123456');
	await page.getByRole('button', { name: '시작하기' }).click();
	await page.waitForURL('**/onboarding', { timeout: 20000 });
	await page.getByRole('button', { name: '남자' }).first().waitFor();
	await page.waitForTimeout(1500); // 첫 박동의 대답(새 업적)이 올 시간
	const before = windows(await timeline());
	check('★ 시작하기(온보딩) 전에는 어떤 창도 뜨지 않는다', before.length === 0, JSON.stringify(before));

	await page.getByRole('button', { name: '남자' }).first().click();
	await page.getByRole('button', { name: '상관없어요' }).click();
	await page.getByRole('button', { name: '동의하고 시작하기' }).click();
	await page.waitForURL(`${BASE}/`, { timeout: 20000 });

	console.log('\n[2] 홈 — 안내 → 축하 → 알림 받기, 한 번에 하나');
	await page.locator('.tour[role="dialog"]').waitFor({ timeout: 10000 });
	await page.waitForTimeout(800);
	check('★ 먼저 사용법 안내만', (await timeline()).at(-1) === '/ 안내', (await timeline()).at(-1));
	await page.getByRole('button', { name: '건너뛰기' }).click();
	await page.locator('[role="dialog"][aria-label="새 업적"]').waitFor({ timeout: 10000 }).catch(() => {});
	await page.waitForTimeout(800);
	check('★ 안내를 닫으면 새 업적 축하만 (알림 받기는 아직)', (await timeline()).at(-1) === '/ 축하', (await timeline()).at(-1));
	await page.keyboard.press('Escape');
	await page.locator('#push-title').waitFor({ timeout: 10000 }).catch(() => {});
	await page.waitForTimeout(800);
	check('★ 축하를 닫으면 알림 받기', (await timeline()).at(-1) === '/ 알림', (await timeline()).at(-1));
	await page.getByRole('button', { name: '나중에' }).click();
	await page.waitForTimeout(600);

	const all = windows(await timeline());
	check('★ 두 창이 겹쳐 뜬 적이 없다', all.every(([, open]) => !open.includes('+')), JSON.stringify(all));
	check('★ 창은 홈에서만 떴다', all.every(([path]) => path === '/'), JSON.stringify(all));
	check('다 닫힌 뒤 남은 창 없음', (await timeline()).at(-1) === '/ -', (await timeline()).at(-1));

	console.log('\n[3] 연락해보기 — 대화방으로 한 칸만, 기다리는 동안 머리글은 대화 시간');
	const at = () => page.evaluate(() => navigation.currentEntry.index); // 기록에서 지금 몇 번째 칸인가
	const depth = await at();
	await page.getByRole('button', { name: '익명 친구들 보기' }).click();
	await page.getByRole('button', { name: '새벽수달 크게 보기' }).click();
	await page.getByRole('button', { name: '연락해보기' }).click();
	await page.waitForURL(`**/chat/${ROOM}`, { timeout: 20000 });
	await page.locator('.topbar .timer').waitFor({ timeout: 20000 });
	const timer = (await page.locator('.topbar .timer').innerText()).trim();
	check('★ 상대를 기다리는 동안 머리글 시간은 대화 시간 (1440:00 이 아니다)', timer === '10:00', timer);
	check('★ 시트의 뒤로가기 칸이 남지 않는다 (기록은 대화방 한 칸만 늘었다)', (await at()) === depth + 1, `${depth} → ${await at()}`);
	await page.goBack();
	await page.waitForURL(`${BASE}/`, { timeout: 10000 });
	await page.waitForTimeout(400);
	check('★ 뒤로 한 번에 홈 — 시트가 다시 뜨거나 빈 칸에 걸리지 않는다',
		(await page.getByRole('button', { name: '연락해보기' }).count()) === 0 && !/"ov":\["/.test(await page.evaluate(() => JSON.stringify(history.state))),
		await page.evaluate(() => JSON.stringify(history.state)));
	check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
	if (fail) console.log('\n화면 기록:\n  ' + (await timeline()).join('\n  '));
} finally {
	await browser.close();
	stopProcess(vite);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
