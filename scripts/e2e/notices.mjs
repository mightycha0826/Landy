import { ROOT, CHROME, OUT } from './_env.mjs';
import { chromium } from 'playwright-core';
// 학생 앱 공지 — 하트 · 빨간 점 · 알림 화면에 다른 알림과 섞여 나온다 (Phase 40) · 공지 한 개 화면 (가짜 Supabase 를 브라우저 요청 가로채기로)
const SP = OUT;
const BASE = 'http://localhost:5199';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();

let notices = [
	{ id: 2, title: '시험 기간 운영 안내', body: '시험 기간에는 밤 10시에 닫아요.\n둘째 줄', created_at: ago(30) },
	{ id: 1, title: '처음 공지', body: '', created_at: ago(60 * 30) }
];
let lastSeen = 1;
const marks = [];

const browser = await chromium.launch({ executablePath: CHROME });
try {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
	const page = await ctx.newPage();
	const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
	await page.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request(); const u = new URL(req.url());
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (u.pathname === '/auth/v1/token') return json(session);
		if (u.pathname.startsWith('/auth/v1/')) return json({});
		if (u.pathname === '/rest/v1/rpc/my_account') return json({ has_password: true });
		if (u.pathname === '/rest/v1/rpc/my_rooms') return json({ rooms: [], server_now: new Date().toISOString() });
		if (u.pathname === '/rest/v1/rpc/my_notices') return json({ notices, last_seen: lastSeen });
		if (u.pathname === '/rest/v1/rpc/mark_notices_seen') { const p = req.postDataJSON().p_id; marks.push(p); lastSeen = Math.max(lastSeen, p); return json(lastSeen); }
		if (u.pathname === '/rest/v1/profiles') return json({ id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true });
		if (u.pathname === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 30, join_grace_sec: 30, max_rounds: 99, heartbeat_sec: 30, presence_ttl_sec: 70, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300 });
		if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
		return json([]);
	});
	await page.addInitScript(() => { try { localStorage.setItem('push-asked-v1', '1'); } catch {} });

	await page.goto(`${BASE}/login`);
	await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
	await page.getByPlaceholder('비밀번호').fill('abcd1234');
	await page.getByRole('button', { name: '로그인', exact: true }).click();
	await page.waitForURL(`${BASE}/`, { timeout: 8000 }).catch(() => {});
	const bell = page.locator('button.heart');
	await bell.waitFor({ timeout: 8000 });
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SP}/notice-1-home.png` });

	console.log('[홈]');
	const box = async (sel) => page.locator(sel).first().boundingBox();
	const b = await box('button.heart'), me = await box('button.settings');
	check('하트는 설정 톱니 왼쪽', b && me && b.x + b.width <= me.x, JSON.stringify({ b, me }));
	check('★ 안 본 공지 → 하트 오른쪽 위 빨간 점', (await page.locator('button.heart .dot').count()) === 1);
	const dot = await box('button.heart .dot');
	check('점 위치: 하트의 오른쪽 위', dot && dot.x + dot.width / 2 > b.x + b.width / 2 && dot.y + dot.height / 2 < b.y + b.height / 2, JSON.stringify({ dot, b }));
	check('점 색은 새 것 점(두 번째 색 청록)', (await page.locator('button.heart .dot').evaluate((e) => getComputedStyle(e).backgroundColor)) === 'rgb(0, 184, 148)');

	console.log('[알림 화면 — 공지도 다른 알림과 같은 줄]');
	await bell.click();
	await page.waitForURL('**/activity');
	const row = page.locator('button.row', { hasText: '시험 기간 운영 안내' });
	await row.waitFor({ timeout: 4000 });
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${SP}/notice-2-activity.png` });
	check('★ 하트 → 알림에 새 공지 — "공지 ·" 머리말 없이, 새 알림 칸에', (await row.innerText()).startsWith('시험 기간 운영 안내') && (await page.getByText('공지 · ').count()) === 0
		&& (await row.evaluate((e) => e.classList.contains('unread'))));
	check('★ "공지사항" 따로 가는 링크 없음', (await page.locator('a.all').count()) === 0 && (await page.getByText('공지사항').count()) === 0);
	check('공지 줄도 다른 알림처럼 내용 한 줄 · 시간', (await row.locator('.body').innerText()).includes('밤 10시') && /30분 전/.test(await row.innerText()));
	check('지난 공지는 지난 알림 칸에', (await page.locator('button.row:not(.unread)', { hasText: '처음 공지' }).count()) === 1);
	check('★ 알림을 열면 맨 위 공지까지 봤다고 저장', marks.at(-1) === 2, JSON.stringify(marks));

	console.log('[공지 내용]');
	await row.click();
	await page.waitForURL('**/notices/2');
	await page.locator('article h1').waitFor();
	await page.screenshot({ path: `${SP}/notice-2b-detail.png` });
	check('★ 누르면 제목 · 시간 · 내용', (await page.locator('article h1').innerText()) === '시험 기간 운영 안내'
		&& (await page.locator('article .body').innerText()).includes('밤 10시') && /30분 전/.test(await page.locator('article .when').innerText()));
	check('줄바꿈 유지', (await page.locator('article .body').innerText()).includes('\n'));
	check('내용 화면에서도 탭바는 숨김', (await page.locator('nav.tabbar').count()) === 0);
	await page.locator('button.back').click();
	await page.waitForURL(/\/activity$/);
	await page.locator('button.row').first().waitFor(); await page.waitForTimeout(300);
	check('★ 뒤로 → 알림, 방금 본 공지는 이번엔 새 알림 칸 그대로', await page.locator('button.row', { hasText: '시험 기간 운영 안내' }).evaluate((e) => e.classList.contains('unread')));
	await page.goto(`${BASE}/notices/1`);
	await page.locator('article h1').waitFor({ timeout: 8000 }).catch(() => {});
	check('바로 들어와도 보인다 (내용 없는 공지는 제목만)', (await page.locator('article h1').innerText().catch(() => '')) === '처음 공지' && (await page.locator('article .body').count()) === 0);
	await page.goto(`${BASE}/notices/99`);
	await page.getByText('공지를 찾을 수 없어요').waitFor({ timeout: 8000 }).catch(() => {});
	check('없는 공지', await page.getByText('공지를 찾을 수 없어요').isVisible());
	// 앱이 공지 목록을 기억하는 동안 새 공지가 올라오고, 알림을 눌러(앱 안 이동) 그 공지로 — 기억한 목록만 보고 "없다"고 하지 않는다
	const seenBefore = lastSeen; // 이 묶음이 5번을 본 것으로 저장한다 — 끝나면 되돌려 아래 "새 공지" 검사에 남기지 않는다
	notices = [{ id: 5, title: '방금 올린 공지', body: '알림으로 들어옴', created_at: ago(0) }, ...notices];
	await page.evaluate(() => { const a = document.createElement('a'); a.href = '/notices/5'; document.body.append(a); a.click(); });
	await page.waitForURL('**/notices/5');
	await page.locator('article h1').waitFor({ timeout: 8000 }).catch(() => {});
	check('★ 기억한 목록에 없던 새 공지도 열면 새로 읽어 보여 준다', (await page.locator('article h1').innerText().catch(() => '')) === '방금 올린 공지');
	notices = notices.filter((n) => n.id !== 5);
	lastSeen = seenBefore;
	// 못 불러오면 뼈대만 계속 띄우지 않는다 — 이유와 다시 시도
	await page.route('https://fake-proj.supabase.co/rest/v1/rpc/my_notices', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"down"}' }));
	await page.goto(`${BASE}/notices/1`);
	await page.getByText('공지를 불러오지 못했어요').waitFor({ timeout: 8000 }).catch(() => {});
	check('★ 공지를 못 불러오면 "불러오지 못했어요 · 다시 시도" (끝없는 불러오는 중 · "없음" 아님)',
		await page.getByText('공지를 불러오지 못했어요').isVisible() && (await page.getByText('공지를 찾을 수 없어요').count()) === 0);
	await page.unroute('https://fake-proj.supabase.co/rest/v1/rpc/my_notices');
	await page.getByRole('button', { name: '다시 시도' }).click();
	await page.locator('article h1').waitFor({ timeout: 8000 }).catch(() => {});
	check('★ 다시 시도하면 공지가 보인다', (await page.locator('article h1').innerText().catch(() => '')) === '처음 공지');
	await page.goto(`${BASE}/notices`);
	await page.waitForURL('**/activity', { timeout: 4000 }).catch(() => {});
	check('★ 예전 공지사항 주소(푸시 알림) → 알림 화면', page.url().endsWith('/activity'), page.url());
	await page.goto(`${BASE}/`); await page.locator('button.heart').waitFor(); await page.waitForTimeout(400);

	check('★ 돌아오면 빨간 점 꺼짐', (await page.locator('button.heart .dot').count()) === 0);

	console.log('[새 공지]');
	notices = [{ id: 3, title: '새로 올린 공지', body: '내용', created_at: ago(0) }, ...notices];
	await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
	await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
	await page.waitForTimeout(800);
	check('★ 새 공지가 오면 다시 빨간 점 (앱으로 돌아오면 바로 확인)', (await page.locator('button.heart .dot').count()) === 1);

	await page.locator('a.tab', { hasText: '익명편지' }).click();
	await page.waitForURL('**/letters');
	await page.waitForTimeout(500);
	await page.screenshot({ path: `${SP}/notice-3-letters.png` });
	check('익명편지 화면에도 하트 + 점', (await page.locator('button.heart .dot').count()) === 1);
	await page.locator('button.heart').click();
	await page.waitForURL('**/activity');
	await page.locator('button.row', { hasText: '새로 올린 공지' }).waitFor();
	await page.waitForTimeout(300);
	check('이번엔 3번만 새 알림 칸', (await page.locator('button.row.unread').count()) === 1 && (await page.locator('button.row.unread').innerText()).includes('새로 올린 공지'));
	check('탭바는 숨김', (await page.locator('nav.tabbar').count()) === 0);
	await page.locator('button.back').click();
	await page.waitForTimeout(500);
	check('뒤로 → 익명편지로', page.url().endsWith('/letters'), page.url());

	console.log('[공지 없음]');
	notices = []; lastSeen = 0;
	await page.goto(`${BASE}/activity`);
	await page.getByText('새 알림을 모두 확인했어요').waitFor({ timeout: 8000 }).catch(() => {});
	check('빈 화면 안내', await page.getByText('새 알림을 모두 확인했어요').isVisible());
	await page.goto(`${BASE}/`); await page.locator('button.heart').waitFor(); await page.waitForTimeout(400);
	check('공지가 없으면 점 없음', (await page.locator('button.heart .dot').count()) === 0);
	check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} finally { await browser.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
