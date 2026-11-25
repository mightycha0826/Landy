import { ROOT, CHROME, OUT } from './_env.mjs';
import { spawn, stopProcess } from './_process.mjs';
import { chromium, webkit } from 'playwright-core';
// 줄바꿈 · 폭 (Phase 46) — 폭 280 ~ 520 의 모든 화면에서 글이 낱말 중간에서 끊기거나, 칸 밖으로 넘치거나, 잘리지 않는지.
// 280 = 폭 360 폰 + 안드로이드 큰 글꼴(약 130%) — 기기 글꼴을 키우면 웹 화면의 폭이 그만큼 좁아진다.
// 찾는 것:
//   넘침     화면 가로 스크롤 · 글이 있는 요소가 화면 밖으로
//   잘림     overflow 로 잘린 글 (말줄임표 … 가 아닌데 칸보다 길다)
//   끊김     낱말 중간에서 줄이 바뀜 (띄어쓰기 없이 칸보다 긴 낱말) — "이야기할까/요"
//   두 줄    짧은 이름표(6자 이하, 단추 · 링크 · 탭 · 칩 · 제목은 14자 이하)가 두 줄로 — "글자/크기"
//   외톨이   여러 줄 글의 마지막 줄에 한두 글자 낱말 하나만 ("요", "공개")
// 일부러 자유롭게 흐르는 글(사람이 쓴 긴 글 등)은 data-wrap-free, 화면 밖 장식은 data-wrap-exempt 로 뺀다.
// WRAP_REPORT=1 이면 전부 늘어놓기만 하고 실패로 세지 않는다. SHOTS=1 이면 화면마다 스크린샷.
// WRAP_ENGINE=webkit 이면 사파리 엔진으로 (Phase 47-4 — 사용자 대부분이 아이폰 · 아이패드. `npx playwright-core install webkit` 한 번 필요)
const PORT = 5186;
const ENGINE = process.env.WRAP_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const BASE = `http://localhost:${PORT}`;
const REPORT = !!process.env.WRAP_REPORT;
const env = { ...process.env, PUBLIC_SUPABASE_URL: 'https://fake-proj.supabase.co', PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_testtesttesttesttest' };
const vite = spawn('npx', ['vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
let out = ''; vite.stdout.on('data', (d) => (out += d));
for (let i = 0; i < 120 && !out.includes('ready'); i++) await new Promise((r) => setTimeout(r, 500));

const WIDTHS = (process.env.WRAP_WIDTHS ?? '280,320,344,360,375,390,412,430,480,520').split(',').map(Number);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 36000, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 36000, expires_at: now + 36000, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '29999@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const iso = (s = 0) => new Date(Date.now() + s * 1000).toISOString();
const R = (n) => `cccccccc-cccc-4ccc-8ccc-cccccccccc${String(n).padStart(2, '0')}`;
const rooms = [
	{ room_id: R(1), status: 'active', my_seat: 1, partner_alias: '새벽수달', expires_at: iso(420), round: 1, joined: true, partner_online: true, last_body: '안녕하세요! 혹시 요즘 뭐 듣는 노래 있어요? 저는 요즘 밴드 음악만 들어요', last_seat: 2, last_at: iso(), unread: 2 },
	{ room_id: R(2), status: 'active', my_seat: 1, partner_alias: '고정고래', expires_at: iso(86400), round: 3, joined: true, partner_online: false, last_body: '내일 봐', last_seat: 1, last_at: iso(-600), unread: 0, pinned: true },
	{ room_id: R(3), status: 'pending', my_seat: 2, partner_alias: '졸린판다', expires_at: iso(50), round: 1, joined: false, partner_online: false, last_body: null, last_seat: null, last_at: iso(-30), unread: 0 }
];
const letters = [
	{ id: 70, thread_id: 7, box: 'received', from_gender: 'f', from_name: null, from_nick: null, opened: false, is_reply: false, body: '안녕! 너 그림 진짜 잘 그리더라\n나중에 누군지 알려 줄게 ㅎㅎ 그때까지 기다려 줄 수 있지?', created_at: iso(-300) },
	{ id: 60, thread_id: 8, box: 'received', from_gender: 'm', from_name: null, from_nick: '노란우산을든사람', opened: true, is_reply: false, body: '시험 잘 봐! 너라면 할 수 있어', created_at: iso(-5400) },
	{ id: 50, thread_id: 9, box: 'sent', to_name: '박받음', to_grade: 2, opened: true, replied: true, is_reply: false, body: '발표 멋있었어', created_at: iso(-3600) }
];
const pub = (l) => { const { box, body, ...rest } = l; return { ...rest, removed: false, thread_status: 'open' }; };
const folder = { id: 1, name: '고마웠던 편지들 모아 두기', count: 2, received: 1, sent: 1 };
const MAINT = { maintenance: true, maintenance_msg: '새 기능을 준비하고 있어요.\n오후 세 시에 다시 만나요!', maintenance_until: new Date(Date.now() + 95 * 60_000).toISOString() };
const notices = [{ id: 1, title: '11월 정기 점검 안내 — 토요일 새벽 두 시부터 네 시까지 잠깐 쉬어요', body: '점검하는 동안에는 대화와 편지를 쓸 수 없어요.\n점검이 끝나면 알림으로 알려 드릴게요. 불편을 드려 죄송해요!', created_at: iso(-60) }];

let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const launchBrowser = () => ENGINE === 'webkit' ? webkit.launch() : chromium.launch({ executablePath: CHROME });
let browser = await launchBrowser();

async function context(width, { gate = false, maint = false, signed = false } = {}) {
	const ctx = await browser.newContext({ viewport: { width, height: Math.round(width * 2.05) }, hasTouch: true, isMobile: ENGINE === 'chromium', deviceScaleFactor: 2 });
	await ctx.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request(); const p = new URL(req.url()).pathname;
		const a = req.method() === 'POST' ? req.postDataJSON() ?? {} : {};
		const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
		const rpc = p.startsWith('/rest/v1/rpc/') ? p.slice('/rest/v1/rpc/'.length) : null;
		if (p === '/auth/v1/token') return json(session);
		if (p.startsWith('/auth/v1/')) return json({});
		if (rpc === 'my_account') return json({ has_password: true, name: '김보냄', grade: 1, name_source: 'roster' });
		if (rpc === 'my_rooms') return json({ rooms, server_now: iso() });
		if (rpc === 'my_notices') return json({ notices, last_seen: 0, personal: [] });
		if (rpc === 'my_achievements') return json({ items: [], featured: [], chosen: [] });
		if (rpc === 'achievement_catalog') return json([]);
		// 폴더 하나 (Phase 47) — 받은 · 보낸 편지가 섞여서
		if (rpc === 'dm_mailbox') return json(a.p_folder != null
			? { letters: letters.filter((l) => l.id !== 70).map((l) => ({ ...pub(l), box: l.box })), folder, server_now: iso() }
			: { letters: letters.filter((l) => l.box === a.p_box).map(pub), folders: [folder], server_now: iso() });
		if (rpc === 'dm_unread') return json(1);
		if (rpc === 'dm_open') { const l = letters.find((x) => x.id === a.p_msg); return json({ status: 'ok', ...pub(l), role: l.box, body: l.body, fmt: null, closed_by: null, can_reply: l.box === 'received', wait_reply: false, first_open: false, server_now: iso() }); }
		if (rpc === 'dm_search') return json([{ id: 'u-b', name: '박받음', grade: 2, no: 20314, checked: true }, { id: 'u-c', name: '남궁받음', grade: 3, no: 30522, checked: false }]);
		if (p === '/rest/v1/profiles') return json({ id: uid, nickname: '푸른고래', bio: '밴드 음악 좋아해요 · 주말엔 러닝', interests: ['음악', '러닝', '보드게임'], mbti: 'INFP', gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true, allow_rematch: true, letters_open: true, manner_temp: 36.5, featured_badges: [] });
		if (p === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 5, extend_minutes: 10, vote_window_sec: 90, join_grace_sec: 60, max_rounds: 0, heartbeat_sec: 15, presence_ttl_sec: 45, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300, ai_moderation: false, ai_chat: true, letters_gate: gate, letters_gate_min: 100, ...(maint ? MAINT : {}) });
		// 서버 점검 (Phase 52) — 박동 대답에도
		if (rpc === 'heartbeat') return json(maint ? { server_now: iso(), maintenance: { msg: MAINT.maintenance_msg, until: MAINT.maintenance_until } } : { server_now: iso() });
		if (p === '/rest/v1/signup_stats') return json({ students: 17 });
		if (rpc) return json(null);
		return json([]);
	});
	await ctx.addInitScript(({signed,session}) => {
		try {
			localStorage.setItem('push-asked-v1', '1');
			if (signed) localStorage.setItem('sb-fake-proj-auth-token',JSON.stringify(session));
		} catch {}
	},{signed,session});
	return ctx;
}

/** 지금 화면의 줄바꿈 문제 — 글(텍스트 노드)마다 글자 단위로 재서 줄을 나눈다 */
const analyze = (page) =>
	page.evaluate(() => {
		const vw = document.documentElement.clientWidth;
		const res = { 넘침: [], 잘림: [], 끊김: [], '두 줄': [], 외톨이: [] };
		const hidden = (el) => {
			if (el.closest('[aria-hidden="true"], [inert], .sr-only, [data-wrap-exempt]')) return true;
			const r = el.getBoundingClientRect();
			if (r.width < 1 || r.height < 1) return true;
			for (let p = el; p; p = p.parentElement) {
				const cs = getComputedStyle(p);
				if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) return true;
			}
			return false;
		};
		const say = (el) => `${el.tagName.toLowerCase()}${el.classList.length ? '.' + [...el.classList].filter((c) => !c.startsWith('s-') && !c.startsWith('svelte-')).slice(0, 2).join('.') : ''} "${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)}"`;
		const WORD = /[\p{L}\p{N}]/u;
		// 한 줄이어야 하는 짧은 이름표 — 단추 · 링크 · 탭 · 칩 · 제목 · 굵은 글
		const LABEL = 'button, a, [role="tab"], [role="radio"], [role="option"], label, .chip, .tag, th, summary, h1, h2, h3, .title, strong, b, dt';
		// 글이 잘리는 조상 — 말줄임표 · 줄 수 제한 · 옆으로 미는 칸은 일부러 자르는 것(skip), 1px 칸은 화면 읽기 전용(skip)
		const clipper = (el) => {
			for (let p = el; p && p !== document.body; p = p.parentElement) {
				const cs = getComputedStyle(p);
				if (cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') return 'skip';
				const o = [cs.overflowX, cs.overflowY];
				if (o.some((x) => x === 'auto' || x === 'scroll')) return 'skip';
				if (o.some((x) => x === 'hidden' || x === 'clip')) {
					const r = p.getBoundingClientRect();
					if (r.width <= 2 || r.height <= 2) return 'skip';
					// 자르는 방향만 본다 — overflow-x: clip 은 옆으로만 자르고 아래로는 그대로 흐른다 (학생 앱 #app, Phase 54)
					const cuts = (x) => x === 'hidden' || x === 'clip';
					return { el: p, x: cuts(cs.overflowX), y: cuts(cs.overflowY) };
				}
			}
			return null;
		};

		if (document.documentElement.scrollWidth > vw + 1) res.넘침.push(`화면이 옆으로 밀린다 (${document.documentElement.scrollWidth} > ${vw})`);

		const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
		const range = document.createRange();
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			const el = n.parentElement;
			if (!el || el.closest('script, style, textarea, [contenteditable="true"], svg, [data-wrap-free]') || hidden(el)) continue;
			const text = n.textContent;
			const c = clipper(el);
			const skip = c === 'skip';
			const clip = skip ? null : c;
			const cr = clip?.el.getBoundingClientRect();
			const lines = [];
			let lastTop = null, clipped = false, out = false;
			for (let i = 0; i < text.length; i++) {
				if (/\s/.test(text[i])) continue;
				range.setStart(n, i); range.setEnd(n, i + 1);
				const r = range.getClientRects()[0];
				if (!r || r.width === 0) continue;
				if (lastTop === null || r.top > lastTop + r.height * 0.6) { lines.push({ from: i, to: i }); lastTop = r.top; }
				else lines.at(-1).to = i;
				// 굵은 글꼴의 획이 글자 칸 밖으로 조금 나오는 것(3px)은 봐준다
				if (!clip && !skip && (r.right > vw + 0.5 || r.left < -0.5)) out = true;
				if (cr && ((clip.x && (r.right > cr.right + 3 || r.left < cr.left - 3)) || (clip.y && (r.bottom > cr.bottom + 3 || r.top < cr.top - 3)))) clipped = true;
			}
			if (out) res.넘침.push(say(el));
			if (clipped) res.잘림.push(say(el));
			for (let k = 1; k < lines.length; k++) {
				const a = text[lines[k - 1].to], b = text[lines[k].from];
				const between = text.slice(lines[k - 1].to + 1, lines[k].from);
				if (!/\s/.test(between) && WORD.test(a) && WORD.test(b)) res.끊김.push(`${say(el)} — "${text.slice(Math.max(0, lines[k - 1].to - 5), lines[k - 1].to + 1)}/${text.slice(lines[k].from, lines[k].from + 5)}"`);
			}
			// 줄 수를 정해 둔 글(line-clamp) · 말줄임 · 옆으로 미는 칸은 일부러 그렇게 흐른다 — 끊김만 본다
			if (lines.length >= 2 && !skip) {
				const len = [...text.trim()].length;
				if (len <= 6 || (len <= 14 && el.matches(LABEL))) res['두 줄'].push(say(el));
				// 외톨이 — 끝줄에 한 글자만, 또는 두 글자 낱말 하나인데 앞줄에서 낱말을 하나 더 내려 받을 수 있었을 때("… 디플로마 / 공개")
				const last = text.slice(lines.at(-1).from, lines.at(-1).to + 1).trim();
				const prev = text.slice(lines.at(-2).from, lines.at(-2).to + 1).trim();
				const n = [...last.replace(/[.,!?…·)\]'"』」]/g, '')].length;
				if (!/\s/.test(last) && (n <= 1 || (n === 2 && /\s/.test(prev)))) res.외톨이.push(`${say(el)} — 끝줄 "${last}"`);
			}
		}
		for (const k of Object.keys(res)) res[k] = [...new Set(res[k])];
		return res;
	});

/** [이름, 경로, 준비] */
const SCREENS = [
	['home', '/'],
	['tour', '/?tour', async (p) => { await p.locator('.tour').waitFor({ timeout: 4000 }).catch(() => {}); }],
	['letters', '/letters'],
	['archive', '/letters/archive'],
	['folder', '/letters/f/1'],
	['letters-new', '/letters/new', async (p) => { await p.getByRole('searchbox').fill('받음'); await p.waitForTimeout(700); }],
	['letter', '/letters/m/60'],
	['letter-sent', '/letters/m/50'],
	['me', '/me'],
	['achievements', '/me/achievements'],
	['settings', '/settings'],
	['contact', '/settings/contact'],
	['privacy', '/settings/privacy'],
	['activity', '/activity'],
	['notice', '/notices/1'],
	['chat', '/dev/chat?s=chat'],
	['chat-fresh', '/dev/chat?s=fresh'],
	['chat-menu', '/dev/chat?s=chat&sheet=menu'],
	['chat-vote', '/dev/chat?s=vote'],
	['chat-hints', '/dev/chat?s=hints'],
	['chat-pin', '/dev/chat?s=pin'],
	['chat-pending', '/dev/chat?s=pending'],
	['chat-ended', '/dev/chat?s=ended'],
	['chat-rate', '/dev/chat?s=rate'],
	['bot', '/dev/bot?fast'],
	['dev-letters', '/dev/letters'],
	['dev-achievements', '/dev/achievements']
];

const found = {}; // 문제 → Set(폭)
const note = (screen, kind, msg, w) => {
	const key = `${screen} · ${kind} · ${msg}`;
	(found[key] ??= []).push(w);
};
try {
	const runWidth = async (w) => {
		console.log(`[폭 ${w}]`);
		// 로그인 전 화면
		const pre = await context(w);
		const p0 = await pre.newPage();
		for (const [name, path] of [['login', '/login'], ['install', '/install']]) {
			// 처음 한 번은 vite 가 화면을 만드느라 늦다 — 화면이 뜰 때까지 기다린다
			await p0.goto(`${BASE}${path}`); await p0.locator('.page').first().waitFor({ timeout: 30000 }).catch(() => {}); await p0.waitForTimeout(1200);
			if (process.env.SHOTS) await p0.screenshot({ path: `${OUT}/wrap-${ENGINE}-${name}-${w}.png`, fullPage: true }).catch(() => {});
			const r = await analyze(p0);
			for (const [k, list] of Object.entries(r)) for (const m of list) note(name, k, m, w);
		}
		await pre.close();

		const ctx = await context(w, {signed:true});
		const page = await ctx.newPage();
		const errs = []; page.on('pageerror', (e) => errs.push(String(e)));
		await page.goto(`${BASE}/`);
		await page.locator('button.heart').waitFor({ timeout: 15000 });
		for (const [name, path, prep] of SCREENS) {
			await page.goto(`${BASE}${path}`);
			await page.waitForTimeout(1300);
			if (prep) await prep(page);
			if (process.env.SHOTS) await page.screenshot({ path: `${OUT}/wrap-${ENGINE}-${name}-${w}.png`, fullPage: true }).catch(() => {});
			const r = await analyze(page);
			for (const [k, list] of Object.entries(r)) for (const m of list) note(name, k, m, w);
		}
		// 화면을 옮기며 끊긴 요청(WebKit 은 "access control checks" 로 알린다)은 오류가 아니다
		for (const e of errs) if (!/Failed to fetch dynamically imported module|Importing a module script failed|due to access control checks/.test(e)) note('*', '오류', e, w);
		await ctx.close();

		// 익명편지 잠금 화면
		const gctx = await context(w, { gate: true, signed:true });
		const gp = await gctx.newPage();
		await gp.goto(`${BASE}/`);
		await gp.locator('button.heart').waitFor({ timeout: 15000 });
		await gp.goto(`${BASE}/letters`); await gp.waitForTimeout(1300);
		if (process.env.SHOTS) await gp.screenshot({ path: `${OUT}/wrap-${ENGINE}-gate-${w}.png`, fullPage: true }).catch(() => {});
		const gr = await analyze(gp);
		for (const [k, list] of Object.entries(gr)) for (const m of list) note('gate', k, m, w);
		await gctx.close();

		// 서버 점검 화면 (Phase 52) — 로그인하면 앱 전체가 점검 화면
		const mctx = await context(w, { maint: true, signed:true });
		const mp = await mctx.newPage();
		await mp.goto(`${BASE}/`);
		const shown = await mp.locator('.maint').waitFor({ timeout: 15000 }).then(() => true, () => false);
		if (w === WIDTHS[0]) {
			const txt = shown ? (await mp.locator('.maint').innerText()).replace(/\s+/g, ' ') : '';
			check('★ 서버 점검 중이면 앱 전체가 점검 화면 · 안내 문구 · 끝나는 시각 · 탭바 없음', shown && txt.includes('서버 점검 중이에요') && txt.includes('오후 세 시에') && /쯤 끝나요/.test(txt) && (await mp.locator('nav.tabbar, .tabbar').count()) === 0, txt);
		}
		if (process.env.SHOTS) await mp.screenshot({ path: `${OUT}/wrap-${ENGINE}-maint-${w}.png`, fullPage: true }).catch(() => {});
		const mr = await analyze(mp);
		for (const [k, list] of Object.entries(mr)) for (const m of list) note('maint', k, m, w);
		await mctx.close();
	};
	// 폭별 브라우저 저장소·RPC 가짜 응답은 독립적이다. 두 폭씩 검사하며 모든 기준을 유지한다.
	for (let i = 0; i < WIDTHS.length; i += 2) {
		await Promise.all(WIDTHS.slice(i, i + 2).map(runWidth));
		// 많은 격리 컨텍스트의 폰트·네트워크 자원을 다음 폭 묶음에 남기지 않는다.
		if (i + 2 < WIDTHS.length) { await browser.close(); browser = await launchBrowser(); }
	}
	console.log('[결과]');
	const keys = Object.keys(found).sort();
	if (REPORT) for (const k of keys) console.log(`  ${k}  @ ${found[k].join(',')}`);
	else {
		check('모든 폭 · 모든 화면에서 넘침 · 잘림 · 낱말 끊김 · 두 줄 · 외톨이 없음', keys.length === 0, '\n' + keys.map((k) => `      ${k}  @ ${found[k].join(',')}`).join('\n'));
	}
} catch (e) { fail++; console.error(e); }
finally {
	await browser.close();
	stopProcess(vite);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
