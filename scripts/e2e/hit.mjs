import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';
// 누름 영역 (docs/UX-GUIDELINES.md G1) — 화면마다 보이는 모든 누를 것이 가운데 44×44 를 자기 것으로 갖는지.
// 가운데와 ±21px 네 점을 elementFromPoint 로 찍어 그 요소(또는 자손)가 잡혀야 통과. 360 · 390 폭 두 가지.
// 아직 못 고친 화면은 BUDGET(허용 개수)으로 묶어 두고, 고칠 때마다 줄인다 — 늘어나면 실패 (새로 만든 작은 버튼을 잡는다).
const PORT = 5181;
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 120 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

/** 화면별 허용 개수 (폭마다 따로 세지 않고 두 폭 중 큰 쪽) — Phase 39 웨이브마다 0 으로 줄인다 */
const BUDGET = {
	// Phase 39 W1: 전 화면 0. 연장 투표 막대(그만하기 · 더 얘기하기)는 W3 에서 입력창 위로 옮기며 고친다
	'chat-vote': 2
};

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 36000, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 36000, expires_at: now + 36000, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const iso = (s = 0) => new Date(Date.now() + s * 1000).toISOString();
const R = (n) => `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(n).padStart(2, '0')}`;
const rooms = [
	{ room_id: R(1), status: 'active', my_seat: 1, partner_alias: '새벽수달', expires_at: iso(420), round: 1, joined: true, partner_online: true, last_body: '안녕', last_seat: 2, last_at: iso(), unread: 2 },
	{ room_id: R(2), status: 'active', my_seat: 1, partner_alias: '고정고래', expires_at: iso(86400), round: 3, joined: true, partner_online: false, last_body: '내일 봐', last_seat: 1, last_at: iso(-600), unread: 0, pinned: true }
];

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const browser = await chromium.launch({ executablePath: CHROME });

async function context(width, height) {
	const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: true });
	await ctx.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request(); const p = new URL(req.url()).pathname;
		const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
		if (p === '/auth/v1/token') return json(session);
		if (p.startsWith('/auth/v1/')) return json({});
		if (p.endsWith('rpc/my_account')) return json({ has_password: true });
		if (p.endsWith('rpc/my_rooms')) return json({ rooms, server_now: iso() });
		if (p.endsWith('rpc/my_notices')) return json({ notices: [{ id: 1, title: '공지', body: '본문', created_at: iso(-60) }], last_seen: 0, personal: [] });
		if (p.endsWith('rpc/my_achievements')) return json({ items: [], featured: [], chosen: [] });
		if (p === '/rest/v1/profiles') return json({ id: uid, nickname: '푸른고래', bio: '안녕', interests: ['음악'], mbti: 'INFP', gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true, allow_rematch: true, letters_open: true, manner_temp: 36.5 });
		if (p === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 90, join_grace_sec: 60, max_rounds: 0, heartbeat_sec: 15, presence_ttl_sec: 45, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300, ai_moderation: false, ai_chat: true });
		if (p.startsWith('/rest/v1/rpc/')) return json(null);
		return json([]);
	});
	await ctx.addInitScript(() => { try { localStorage.setItem('push-asked-v1', '1'); } catch {} });
	return ctx;
}

/** 지금 화면에서 누름 영역이 44 에 못 미치는 것들 */
const audit = (page) =>
	page.evaluate(async () => {
		const SEL = 'button:not([disabled]), a[href], [role="button"], [role="tab"], [role="radio"], [role="switch"], summary, input[type="checkbox"], input[type="radio"], select';
		const vw = innerWidth, vh = innerHeight;
		const visible = (el) => {
			if (el.closest('[inert], [aria-hidden="true"], [data-hit-exempt]')) return false;
			const shut = el.closest('details:not([open])');
			if (shut && !el.closest('summary')) return false; // 닫힌 접기 안의 링크는 누를 수 없다 (Chrome 은 상자 크기를 그대로 준다)
			const r = el.getBoundingClientRect();
			if (r.width < 1 || r.height < 1) return false;
			const cs = getComputedStyle(el);
			return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.05;
		};
		const owns = (el, x, y) => {
			const hit = document.elementFromPoint(Math.min(vw - 1, Math.max(1, x)), Math.min(vh - 1, Math.max(1, y)));
			return !!hit && (hit === el || el.contains(hit) || (hit.tagName === 'LABEL' && hit.control === el));
		};
		const label = (el) =>
			(el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24) || `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`;
		const bad = [];
		for (const el of document.querySelectorAll(SEL)) {
			if (!visible(el)) continue;
			el.scrollIntoView({ block: 'center', inline: 'center' });
			await new Promise((r) => requestAnimationFrame(() => r()));
			const r = el.getBoundingClientRect();
			const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
			// 가운데가 다른 것(고정 머리글 · 탭바)에 가려 있으면 이 요소 탓이 아니다
			if (!owns(el, cx, cy)) {
				const top = document.elementFromPoint(cx, cy);
				if (top && getComputedStyle(top.closest('.topbar, .tabbar, .dock-action, .toasts') ?? document.body).position !== 'static') continue;
			}
			const pts = [[cx - 21, cy], [cx + 21, cy], [cx, cy - 21], [cx, cy + 21], [cx, cy]];
			const miss = pts.filter(([x, y]) => !owns(el, x, y)).length;
			if (miss) bad.push(`${label(el)} (${Math.round(r.width)}×${Math.round(r.height)})`);
		}
		window.scrollTo(0, 0);
		return bad;
	});

/** [이름, 경로, 준비(선택)] */
const SCREENS = [
	['login', '/login', null, false],
	['home', '/', null, true],
	['letters', '/letters', null, true],
	['archive', '/letters/archive', null, true],
	['letters-new', '/letters/new', null, true],
	['me', '/me', null, true],
	['achievements', '/me/achievements', null, true],
	['settings', '/settings', null, true],
	['activity', '/activity', null, true],
	['notice', '/notices/1', null, true],
	['chat', '/dev/chat?s=chat', null, false],
	['chat-menu', '/dev/chat?s=chat&sheet=menu', null, false],
	['chat-vote', '/dev/chat?s=vote', null, false]
];

const worst = {};
try {
	for (const [w, h] of [[360, 740], [390, 844]]) {
		console.log(`[${w}×${h}]`);
		const ctx = await context(w, h);
		const page = await ctx.newPage();
		// 로그인 화면은 로그인 전에
		await page.goto(`${BASE}/login`);
		await page.getByPlaceholder('학교 이메일 앞부분').waitFor({ timeout: 20000 });
		await page.waitForTimeout(500);
		const loginBad = await audit(page);
		worst.login = Math.max(worst.login ?? 0, loginBad.length);
		console.log(`  login: ${loginBad.length}${loginBad.length ? ' — ' + loginBad.join(' · ') : ''}`);
		await page.getByPlaceholder('학교 이메일 앞부분').fill('29999');
		await page.getByPlaceholder('비밀번호').fill('abcd1234');
		await page.getByRole('button', { name: '로그인', exact: true }).click();
		await page.locator('button.heart').waitFor({ timeout: 15000 });
		for (const [name, path] of SCREENS.slice(1)) {
			await page.goto(`${BASE}${path}`);
			// 화면이 다 그려지고 들어오는 연출이 끝난 뒤에 잰다 — 고정 1.6초는 느린 PC 에서 아직 그리는 중이거나 미끄러져 들어오는 중이라 실행마다 결과가 달랐다
			await page.waitForLoadState('networkidle').catch(() => {});
			await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), null, { timeout: 6000 }).catch(() => {});
			await page.waitForTimeout(600);
			if (process.env.SHOTS) await page.screenshot({ path: `${OUT}/hit-${name}-${w}.png` }); // SHOTS=1 이면 화면마다 스크린샷 (눈으로 확인)
			const bad = await audit(page);
			worst[name] = Math.max(worst[name] ?? 0, bad.length);
			console.log(`  ${name}: ${bad.length}${bad.length ? ' — ' + bad.join(' · ') : ''}`);
		}
		await ctx.close();
	}
	console.log('[허용 개수]');
	for (const [name, n] of Object.entries(worst)) {
		const budget = BUDGET[name] ?? 0;
		check(`${name}: ${n} ≤ ${budget}${n < budget ? ` (허용치를 ${n} 으로 줄일 수 있다)` : ''}`, n <= budget);
	}
} catch (e) { fail++; console.error(e); }
finally {
	await browser.close();
	stopProcess(vite);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
