import { CHROME, OUT } from './_env.mjs';
import { chromium } from 'playwright-core';
// 업데이트 소식 (Phase 94) — 안 본 업데이트 공지가 여럿이면 앱에 들어올 때 한 창에 모아 한 번 (가짜 Supabase 를 브라우저 요청 가로채기로)
const BASE = 'http://localhost:5199';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556677';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29998@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();

const notices = [
	{ id: 4, title: '업데이트 소식', body: '사진을 보낼 수 있어요', created_at: ago(10), release: true },
	{ id: 3, title: '편지 개선', body: '편지함이 빨라졌어요', created_at: ago(60 * 24), release: true },
	{ id: 2, title: '시험 기간 안내', body: '보통 공지', created_at: ago(60 * 30), release: false },
	{ id: 1, title: '예전 업데이트', body: '이미 본 것', created_at: ago(60 * 48), release: true }
];
let lastSeen = 2, updateSeen = 1;
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
		if (u.pathname === '/rest/v1/rpc/my_notices') return json({ notices, last_seen: lastSeen, update_seen: updateSeen });
		if (u.pathname === '/rest/v1/rpc/mark_updates_seen') { const p = req.postDataJSON().p_id; marks.push(p); updateSeen = Math.max(updateSeen, p); lastSeen = Math.max(lastSeen, p); return json(lastSeen); }
		if (u.pathname === '/rest/v1/profiles') return json({ id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true });
		if (u.pathname === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 30, join_grace_sec: 30, max_rounds: 99, heartbeat_sec: 30, presence_ttl_sec: 70, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300 });
		if (u.pathname.startsWith('/rest/v1/rpc/')) return json(null);
		return json([]);
	});
	// 알림 권한 안내 · 사용법 안내는 본 것으로 — 이 테스트는 업데이트 창만 본다
	await page.addInitScript(() => { try { localStorage.setItem('push-asked-v1', '1'); for (const k of ['tour-v1', 'tour-me-v1', 'tour-letters-v1']) localStorage.setItem(k, '1'); } catch {} });

	await page.goto(`${BASE}/login`);
	await page.getByPlaceholder('학교 이메일 앞부분').fill('29998');
	await page.getByPlaceholder('비밀번호').fill('abcd1234');
	await page.getByRole('button', { name: '로그인', exact: true }).click();
	await page.waitForURL(`${BASE}/`, { timeout: 8000 }).catch(() => {});
	const sheet = page.getByRole('dialog', { name: '업데이트 소식' });
	await sheet.waitFor({ timeout: 8000 }).catch(() => {});
	await page.waitForTimeout(400);
	await page.screenshot({ path: `${OUT}/update-notes.png` });

	const text = await sheet.innerText().catch(() => '');
	check('★ 밀린 업데이트 2번 → 한 창에 "그동안 2번 업데이트됐어요"', text.includes('그동안 2번 업데이트됐어요'), text);
	check('★ 오래된 것부터 · 둘 다', text.indexOf('편지함이 빨라졌어요') >= 0 && text.indexOf('편지함이 빨라졌어요') < text.indexOf('사진을 보낼 수 있어요'), text);
	check('이미 본 업데이트 · 보통 공지는 빠진다', !text.includes('이미 본 것') && !text.includes('보통 공지'));
	await sheet.getByRole('button', { name: '확인' }).click();
	await page.waitForTimeout(600);
	check('★ 확인 → 맨 마지막 업데이트까지 봤다고 저장', marks.at(-1) === 4 && (await sheet.count()) === 0, JSON.stringify(marks));
	check('★ 하트 빨간 점도 꺼진다 (사이에 안 본 보통 공지 없음)', (await page.locator('button.heart .dot').count()) === 0);

	await page.reload();
	await page.locator('button.heart').waitFor({ timeout: 8000 });
	await page.waitForTimeout(1200);
	check('★ 다시 들어오면 안 뜬다 (한 번만)', (await sheet.count()) === 0);
	check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} finally { await browser.close(); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
