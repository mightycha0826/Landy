import { ROOT, CHROME, OUT, answerDialogs } from './_env.mjs';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn, stopProcess } from './_process.mjs';
import { chromium } from 'playwright-core';

/**
 * 서비스워커(static/sw.js)가 켜진 상태에서 운영자 화면이 최신 데이터를 보여주는지.
 * 가짜 Supabase 의 상태를 바꾸고 → 메뉴·탭·폼으로 이동했을 때 화면이 바뀌는지 본다.
 */
const SP = OUT;
const SECRET = 'e2e-secret-'.padEnd(48, 'z');
const SB = 'http://127.0.0.1:54399';
const PORT = 5198;
const STAFF = '11111111-1111-4111-8111-111111111111';
const id = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const [A, B, C] = ['a', 'b', 'c'].map(id);
const t = new Date().toISOString();

let isOpen = true;
let reports = [id('1'), id('2')].map((rid, i) => ({ id: rid, created_at: t, reason: 'harassment', note: `신고메모${i + 1}`, status: 'open', reported_id: A, reporter_id: B, reported_30d: 1, evidence_count: 3, reported_status: 'active' }));
let world = [{ id: A, nickname: '푸른고래', status: 'active', suspended_until: null, onboarded: true, staff_role: null, online: true, last_seen: t, seeking: false, room_count: 0, rooms: [] }];
const liveRoom = { id: id('d'), status: 'active', created_at: t, closed_at: null, close_reason: null, round: 1, live: true, members: [{ seat: 1, user_id: A, nickname: '푸른고래' }, { seat: 2, user_id: B, nickname: '작은별' }], message_count: 5 };
const oldRoom = { ...liveRoom, id: id('e'), status: 'closed', live: false, close_reason: 'expired', members: [{ seat: 1, user_id: C, nickname: '노란우산' }, { seat: 2, user_id: B, nickname: '작은별' }] };
const settings = () => ({ is_open: isOpen, notice: '', room_minutes: 10, extend_minutes: 5, vote_window_sec: 60, max_rounds: 0, rematch_cooldown_days: 7, auto_suspend_reports: 3, max_open_rooms: 3 });

const RPC = {
	admin_session_valid: () => true,
	admin_staff_role: () => 'admin',
	admin_staff_touch: () => ({ role: 'admin', team: [] }),
	// 개요 (Phase 96) — 첫 화면. 서비스 상태가 여기 보인다
	admin_overview: () => ({
		now: new Date().toISOString(),
		todo: { chat_reports: reports.filter((r) => r.status === 'open').length, letter_reports: 0, reviewing: 0, inquiries: 0, badge_requests: 0 },
		live: { online: 1, seeking: 0, active_rooms: 1, is_open: isOpen, maintenance: false },
		totals: { students: 3, active_today: 1, restricted: 0 },
		days: Array.from({ length: 14 }, (_, i) => ({ d: new Date(Date.now() + 9 * 3600_000 - (13 - i) * 86_400_000).toISOString().slice(0, 10), signups: 0, rooms: i % 3, letters: 0, reports: 0 })),
		system: { mod_pending: 0, mod_errors_24h: 0, mod_checked_today: 0, ai_chats_today: 0, push_sent_24h: 0, push_failed_24h: 0, push_devices: 0 }
	}),
	admin_list_reports: (a) => reports.filter((r) => a.p_status === 'all' || r.status === a.p_status),
	admin_list_letter_reports: () => [],
	admin_get_settings: settings,
	admin_update_settings: (a) => { if ('is_open' in a.p_patch) isOpen = a.p_patch.is_open; return settings(); },
	admin_live_users: () => world,
	admin_student_labels: () => ({}),
	admin_rooms: (a) => (a.p_filter === 'all' ? [liveRoom, oldRoom] : [liveRoom]),
	admin_find_users: () => [{ id: A, nickname: '푸른고래', status: 'active', suspended_until: null, strikes: 0, verified: true, onboarded: true, created_at: t, online: false, last_seen: null, staff_role: null, reports_received: 0 }],
	admin_audit: () => []
};
const sb = http.createServer((req, res) => {
	let body = '';
	req.on('data', (c) => (body += c));
	req.on('end', () => {
		const fn = req.url.match(/^\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
		const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
		if (!fn || !RPC[fn]) return send(404, { message: `no mock ${req.url}` });
		try { send(200, RPC[fn](body ? JSON.parse(body) : {})); } catch (e) { send(e.status ?? 500, e.body ?? { message: String(e) }); }
	});
}).listen(54399);

const env = { ...process.env, SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: 'service-key-xxxxxxxxxxxx', PUBLIC_SUPABASE_URL: SB, PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest', ADMIN_SESSION_SECRET: SECRET };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
vite.stdout.on('data', (d) => (out += d));
vite.stderr.on('data', (d) => (out += d));
for (let i = 0; i < 60 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const payload = `${STAFF}.00000000-0000-4000-8000-000000000009.${Math.floor(Date.now() / 1000) + 3600}`;
const cookie = `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
const browser = await chromium.launch({ executablePath: CHROME });
const U = (p) => `http://localhost:${PORT}${p}`;
try {
	const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
	await ctx.addCookies([{ name: 'simbun_admin', value: cookie, domain: 'localhost', path: '/admin', httpOnly: true, sameSite: 'Strict' }]);
	const page = await ctx.newPage();
	const errs = [];
	page.on('pageerror', (e) => errs.push(String(e)));
	await answerDialogs(page, () => true);
	const text = async () => (await page.locator('main').innerText()).replace(/\s+/g, ' ');
	const nav = async (label) => {
		await page.locator('.side nav a', { hasText: label }).click();
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(300);
	};

	// 운영 배포와 같게: 서비스워커를 등록하고 이 페이지를 그 워커가 맡게 한다
	await page.goto(U('/admin'));
	await page.waitForLoadState('networkidle');
	await page.evaluate(async () => {
		await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await page.waitForLoadState('networkidle');
	check('서비스워커가 페이지를 맡음', await page.evaluate(() => !!navigator.serviceWorker.controller));

	// 한 바퀴 돌아서 데이터 응답이 (예전 워커라면) 캐시에 들어가게 한다
	for (const l of ['운영 설정', '실시간', '전체 대화', '신고']) {
		await nav(l);
		if (l === '실시간') await page.waitForTimeout(11_000); // 자동 갱신 응답까지 한 번 받아 둔다
	}
	check('처음: 미처리 신고 2건', /신고메모1/.test(await text()) && /신고메모2/.test(await text()));

	// ── ② DB 에서 신고 2건 삭제 → 메뉴로 다시 오면 사라져야 한다
	reports = [];
	await nav('운영 설정');
	await nav('신고');
	let tx = await text();
	check('★② DB 에서 지운 신고가 화면에서도 사라짐', !/신고메모/.test(tx) && /처리할 신고가 없어요/.test(tx), tx.slice(0, 200));

	// ── ⑤ 서비스 닫기 → 다시 여는 버튼이 보여야 한다
	await nav('운영 설정');
	await page.getByRole('button', { name: '서비스 닫기' }).click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(300);
	check('서버에서 실제로 닫힘', isOpen === false);
	check('★⑤ 닫은 뒤 "서비스 열기" 버튼', (await page.getByRole('button', { name: '서비스 열기' }).count()) === 1, await text());

	// ── ⑥ 개요(첫 화면)의 서비스 상태도 닫힘
	await nav('개요');
	check('★⑥ 개요에 "서비스 닫힘"', /서비스 닫힘/.test(await text()), (await text()).slice(0, 200));

	// 다시 열기
	await nav('운영 설정');
	await page.getByRole('button', { name: /서비스 (열기|닫기)/ }).click({ timeout: 5000 }).catch(() => {});
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(300);
	check('★⑤ 다시 열림 → "서비스 닫기" 버튼으로', isOpen === true &&  (await page.getByRole('button', { name: '서비스 닫기' }).count()) === 1);
	await nav('개요');
	check('★⑥ 개요에 "서비스 운영 중"', /서비스 운영 중/.test(await text()));

	// ── ④ 전체 대화 탭
	await nav('전체 대화');
	check('전체 대화: 진행 중만', /푸른고래/.test(await text()) && !/노란우산/.test(await text()));
	await page.locator('nav.a-tabs a', { hasText: '최근 전체' }).click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(300);
	check('★④ "최근 전체" 누르면 끝난 대화까지', /노란우산/.test(await text()) && page.url().includes('filter=all'), await text());
	await page.locator('nav.a-tabs a', { hasText: '진행 중' }).click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(300);
	check('★④ "진행 중" 누르면 다시 진행 중만', !/노란우산/.test(await text()));

	// ── ③ 메뉴마다 다른 화면
	await nav('사용자');
	const usersH = await page.locator('main h1').first().innerText().catch(() => '');
	await nav('신고');
	await page.getByRole('group', { name: '신고 종류' }).getByRole('link', { name: '편지', exact: true }).click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(300);
	const lettersTx = await text();
	check('★③ 신고 메뉴의 편지 칸은 편지 신고 목록', /처리할 편지 신고가 없어요/.test(lettersTx) && page.url().includes('kind=letter') && usersH === '사용자', `${usersH} / ${lettersTx.slice(0, 120)}`);

	// ── ① 실시간: 새 사용자가 생기면 자동 갱신 뒤에도 사라지지 않는다
	await nav('사용자');
	world = [...world, { ...world[0], id: B, nickname: '작은별' }];
	await nav('실시간');
	check('실시간: 새로 들어온 사용자 보임 (메뉴로 들어옴)', /작은별/.test(await text()));
	await page.waitForTimeout(11_000); // 자동 갱신 한 번
	check('★① 자동 갱신 뒤에도 사라지지 않음', /작은별/.test(await text()) && /푸른고래/.test(await text()), await text());

	check('페이지 오류 없음', errs.length === 0, errs.join(' / '));
	console.log('   끝 워커 상태:', await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return JSON.stringify({ active: r?.active?.state, url: r?.active?.scriptURL, waiting: r?.waiting?.state, keys: await caches.keys() }); }));
	const cached = await page.evaluate(async () => {
		const out = [];
		for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
		return out;
	});
	check('★ 캐시에 운영자 데이터가 없음', !cached.some((p) => p.startsWith('/admin')), cached.filter((p) => p.startsWith('/admin')).join(', '));

	// ── 알림: 배지 · 설치한 앱 창 기억
	check('알림 배지를 미리 받아 둠', cached.includes('/badge-96.png'), cached.join(', '));
	const badge = await page.evaluate(async () => {
		const img = new Image(); img.src = '/badge-96.png'; await img.decode();
		const c = document.createElement('canvas'); c.width = c.height = 96; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
		const d = g.getImageData(0, 0, 96, 96).data;
		let clear = 0, solid = 0, colored = 0;
		for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) clear++; else if (d[i + 3] === 255) solid++; if (d[i + 3] > 0 && (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250)) colored++; }
		return { clear, solid, colored };
	});
	check('★ 배지 = 흰 로고 + 투명 바탕 (컬러 사각형이면 안드로이드에서 흰 네모)', badge.clear > 96 * 96 * 0.3 && badge.solid > 96 * 96 * 0.2 && badge.colored === 0, JSON.stringify(badge));
	const meta = await page.evaluate(async () => {
		const r = await navigator.serviceWorker.ready;
		r.active.postMessage({ type: 'standalone' });
		for (let i = 0; i < 30; i++) {
			const hit = await (await caches.open('landy-meta')).match('/__app');
			if (hit) return hit.json();
			await new Promise((ok) => setTimeout(ok, 100));
		}
		return null;
	});
	check('★ 앱 창이 알리면 "앱으로 쓰는 기기" · 창 id 를 기억 (알림은 이 창/앱으로)', meta?.app === true && meta.ids.length === 1, JSON.stringify(meta));
} finally {
	await browser.close();
	stopProcess(vite);
	sb.close();

}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
