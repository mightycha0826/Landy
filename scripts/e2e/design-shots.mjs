import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 디자인 미리보기 스크린샷 — 가짜 서버 응답으로 로그인한 탭 화면 · 설정 · 미리보기 화면을 라이트 · 다크로 찍어 OUT/design-* 에 남긴다.
// 실제 계정 · DB 에는 요청을 보내지 않는다 (product.mjs 와 같은 가짜 응답)
const PORT = 5186;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt', user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const iso = (s = 0) => new Date(Date.now() + s * 1000).toISOString();
const profile = { id: uid, nickname: '푸른고래', bio: '밴드 음악 좋아해요', interests: ['음악', '운동'], mbti: 'ENFP', gender: 'm', want: 'f', status: 'active', verified: true, onboarded: true, letters_open: true, letters_recommend: true };
const rooms = [
	{ room_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc01', partner_alias: '새벽수달', status: 'active', joined: true, last_body: '공연도 가봤어요?', last_at: iso(-60), unread: 2, expires_at: iso(420), pinned: false },
	{ room_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccc02', partner_alias: '노란고양이', status: 'closed', joined: true, last_body: '다음에 또 얘기해요', last_at: iso(-7200), unread: 0, expires_at: iso(-3600), pinned: false }
];

const browser = await chromium.launch({ executablePath: CHROME });
try {
	for (const scheme of ['light', 'dark']) {
		const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
		const page = await ctx.newPage();
		await page.addInitScript(() => {
			localStorage.setItem('push-asked-v1', '1');
			for (const k of ['tour-v1', 'tour-home-v1', 'tour-me-v1', 'tour-letters-v1', 'cnsa-badge-tour-v1']) localStorage.setItem(k, '1');
		});
		await page.route('https://fake-proj.supabase.co/**', async (route) => {
			const req = route.request(), p = new URL(req.url()).pathname;
			const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
			if (p === '/auth/v1/token') return json(session);
			if (p === '/auth/v1/user') return json(session.user);
			if (p.startsWith('/auth/v1/')) return json({});
			if (p === '/rest/v1/profiles') return req.method() === 'PATCH' ? route.fulfill({ status: 204 }) : json(profile);
			if (p === '/rest/v1/app_settings') return json({ is_open: true, heartbeat_sec: 30, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, letters_gate: false, ai_chat: true, ai_moderation: false });
			if (p.endsWith('/my_account')) return json({ has_password: true, name: '샘플학생', grade: 1, name_source: 'roster' });
			if (p.endsWith('/my_rooms')) return json({ rooms, server_now: iso() });
			if (p.endsWith('/dm_mailbox')) return json({ items: [], has_more: false });
			if (p.endsWith('/my_notices')) return json({ notices: [], last_seen: 0 });
			if (p.startsWith('/rest/v1/rpc/')) return json(null);
			return json([]);
		});
		// NOLOGIN=1 — 로그인 전 화면(/login · /welcome)을 찍을 때
		if (!process.env.NOLOGIN) {
			await page.goto(`${BASE}/login`);
			await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
			await page.getByPlaceholder('비밀번호').fill('abcd1234');
			await page.getByRole('button', { name: '로그인', exact: true }).click();
			await page.waitForURL(`${BASE}/`).catch(() => {});
		}
		const shots = (process.env.SHOTS ?? '/,/letters,/me,/settings,/activity,/dev/chat,/dev/letters').split(',');
		for (const path of shots) {
			await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' }).catch(() => {});
			await page.waitForTimeout(1500);
			// 처음 안내(투어)가 떠 있으면 닫는다
			for (const name of ['건너뛰기', '닫기']) {
				const b = page.getByRole('button', { name, exact: true });
				if (await b.first().isVisible().catch(() => false)) await b.first().click().catch(() => {});
			}
			await page.waitForTimeout(400);
			const file = `${OUT}/design-${scheme}-${path === '/' ? 'home' : path.replaceAll('/', '_').slice(1)}.png`;
			await page.screenshot({ path: file, fullPage: !!process.env.FULL });
			console.log(file);
		}
		await ctx.close();
	}
} finally {
	await browser.close();
	stopProcess(vite);
}
