import { CHROME, OUT } from './_env.mjs';
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
// 익명편지 (Phase 32 · 35) — 편지함(새 편지 + 책상 위 보관함) · 보관함(받은 · 보낸) → 봉투 열기 연출 → 편지로 답장 · 새 편지(찾기 → 서명 → 봉투에 담아 보내기) · 메뉴 · 설정 · 이름 적기
// 가짜 Supabase 를 브라우저 요청 가로채기로 (서버: run.mjs 가 5199 에 띄운다)
const SP = OUT;
const BASE = 'http://localhost:5199';
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + d}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const uid = '3f1c2b4a-1111-4222-8333-944455556666';
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', aud: 'authenticated', exp: now + 3600, iat: now, email: 'x@cnsa.hs.kr' })}.sig`;
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt',
	user: { id: uid, aud: 'authenticated', role: 'authenticated', email: '10101@cnsa.hs.kr', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const ago = (m) => new Date(Date.now() - m * 60_000).toISOString();

/** 가짜 서버 상태 — 편지 한 통씩 (box: 내 입장에서 받은/보낸) */
function world({ named = true } = {}) {
	return {
		account: named ? { has_password: true, name: '김보냄', grade: 1, name_source: 'roster' } : { has_password: true, name: null, grade: null, name_source: null },
		prof: { id: uid, nickname: '푸른고래', bio: '', interests: [], mbti: null, gender: 'm', want: 'f', status: 'active', suspended_until: null, verified: true, onboarded: true, allow_rematch: false, letters_open: true, manner_temp: 40 },
		calls: [],
		patches: [],
		letters: [
			{ id: 70, thread_id: 7, box: 'received', from_gender: 'f', from_name: null, opened: false, is_reply: false, body: '안녕! 너 그림 진짜 잘 그리더라\n나중에 누군지 알려 줄게 ㅎㅎ', created_at: ago(5) },
			{ id: 60, thread_id: 8, box: 'received', from_gender: 'm', from_name: null, opened: true, is_reply: false, body: '시험 잘 봐!', created_at: ago(90) },
			{ id: 55, thread_id: 9, box: 'received', from_gender: 'f', from_name: '박받음', opened: false, is_reply: true, body: '편지 고마워 누구야?', created_at: ago(30) },
			{ id: 50, thread_id: 9, box: 'sent', to_name: '박받음', to_grade: 2, opened: true, replied: true, is_reply: false, body: '발표 멋있었어', created_at: ago(60) }
		],
		rooms: [{ room_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'active', my_seat: 1, partner_alias: '새벽수달', expires_at: new Date(Date.now() + 600_000).toISOString(), round: 1, joined: true, partner_online: false, last_body: '안녕', last_seat: 2, last_at: ago(1), unread: 0 }],
		hidden: new Set(),
		wait: false,
		nextId: 100,
		// 편지 폴더 (Phase 47) — 폴더 목록 · 편지 id → 폴더 id
		folders: [],
		filed: new Map()
	};
}
const pub = (l) => { const { body, ...rest } = l; return { ...rest, removed: false, thread_status: 'open' }; };
// 폴더의 편지 수 — 전체 · 받은 편지 · 보낸 편지 (Phase 47-3)
const folderCounts = (w, id) => {
	const ls = w.letters.filter((l) => !w.hidden.has(l.thread_id) && w.filed.get(l.id) === id);
	return { count: ls.length, received: ls.filter((l) => l.box === 'received').length, sent: ls.filter((l) => l.box === 'sent').length };
};
const folderList = (w) => w.folders.map((f) => ({ ...f, ...folderCounts(w, f.id) }));
const mailbox = (w, box, folder = null) => {
	const seen = w.letters.filter((l) => !w.hidden.has(l.thread_id)).sort((a, b) => b.id - a.id);
	if (folder != null) {
		const f = w.folders.find((x) => x.id === folder);
		return { letters: f ? seen.filter((l) => w.filed.get(l.id) === folder).map(pub) : [], folder: f ? { id: f.id, name: f.name, ...folderCounts(w, f.id) } : null, server_now: new Date().toISOString() };
	}
	return { letters: seen.filter((l) => l.box === box && !w.filed.has(l.id)).map(pub), folders: folderList(w), server_now: new Date().toISOString() };
};
function open(w, id) {
	const l = w.letters.find((x) => x.id === id && !w.hidden.has(x.thread_id));
	if (!l) return { status: 'not_found' };
	const first = l.box === 'received' && !l.opened;
	if (l.box === 'received') l.opened = true;
	return { status: 'ok', ...pub(l), role: l.box, body: l.body, fmt: l.fmt ?? null, closed_by: null, can_reply: l.box === 'received', wait_reply: w.wait, first_open: first, server_now: new Date().toISOString() };
}

async function openApp(browser, w, opts = {}) {
	const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...opts });
	const page = await ctx.newPage();
	const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
	await page.route(`${BASE}/api/**`, (r) => { w.calls.push(['api', new URL(r.request().url()).pathname, r.request().postDataJSON()]); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"claimed":0}' }); });
	await page.route('https://fake-proj.supabase.co/**', async (route) => {
		const req = route.request(); const u = new URL(req.url());
		const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		const rpc = u.pathname.startsWith('/rest/v1/rpc/') ? u.pathname.slice('/rest/v1/rpc/'.length) : null;
		// 뱃지 사진 (Phase 84) — Storage 올리기 · 지우기. 몸이 사진(이진)이라 JSON 으로 읽기 전에
		if (u.pathname.startsWith('/storage/v1/')) {
			w.calls.push(['storage', req.method(), u.pathname]);
			return json(req.method() === 'DELETE' ? [] : { Key: u.pathname.replace('/storage/v1/object/', ''), Id: 'obj' });
		}
		const a = req.method() === 'POST' ? req.postDataJSON() ?? {} : {};
		if (rpc) w.calls.push([rpc, a]);
		if (u.pathname === '/auth/v1/token') return json(session);
		if (u.pathname.startsWith('/auth/v1/')) return json({});
		if (rpc === 'my_account') return json(w.account);
		if (rpc === 'set_my_name') { w.account = { ...w.account, name: a.p_name, name_source: 'self' }; return json({ status: 'ok' }); }
		if (rpc === 'my_rooms') return json({ rooms: w.rooms, server_now: new Date().toISOString() });
		if (rpc === 'leave_room' || rpc === 'block_partner' || rpc === 'report_partner') { w.rooms = w.rooms.filter((r) => r.room_id !== a.p_room); return json({ snap: {}, status: 'ok' }); }
		if (rpc === 'my_notices') return json({ notices: [], last_seen: 0 });
		if (rpc === 'dm_mailbox') return json(mailbox(w, a.p_box, a.p_folder ?? null));
		if (rpc === 'dm_folder_put') {
			let f = a.p_folder != null ? w.folders.find((x) => x.id === a.p_folder) : w.folders.find((x) => x.name === String(a.p_name).trim());
			if (!f) { f = { id: w.folders.length + 1, name: String(a.p_name).trim() }; w.folders.push(f); }
			for (const id of a.p_msgs) w.filed.set(id, f.id);
			return json({ status: 'ok', folder: { id: f.id, name: f.name }, moved: a.p_msgs.length, offer: w.offer ?? [] });
		}
		if (rpc === 'dm_folder_rule') return json({ status: 'ok' });
		if (rpc === 'dm_folder_take') { for (const id of a.p_msgs) w.filed.delete(id); return json({ status: 'ok', moved: a.p_msgs.length }); }
		// 편지 지우기 (Phase 69) — 내 편지함에서만, 받은 편지는 열어 본 것만
		if (rpc === 'dm_letter_delete') {
			const gone = w.letters.filter((l) => a.p_msgs.includes(l.id) && (l.box === 'sent' || l.opened));
			w.letters = w.letters.filter((l) => !gone.includes(l));
			for (const l of gone) w.filed.delete(l.id);
			return json({ status: 'ok', moved: gone.length });
		}
		if (rpc === 'dm_folder_rename') { const f = w.folders.find((x) => x.id === a.p_folder); f.name = a.p_name; return json({ status: 'ok', folder: f }); }
		if (rpc === 'dm_folder_delete') {
			w.folders = w.folders.filter((x) => x.id !== a.p_folder);
			for (const [k, v] of w.filed) if (v === a.p_folder) w.filed.delete(k);
			return json({ status: 'ok' });
		}
		if (rpc === 'dm_unread') return json(w.letters.filter((l) => l.box === 'received' && !l.opened && !w.hidden.has(l.thread_id)).length);
		if (rpc === 'dm_open') return json(open(w, a.p_msg));
		if (rpc === 'dm_search') {
			const q = String(a.p_q ?? '');
			return json(q.length >= 2 && '박받음'.includes(q) ? [{ id: 'u-b', name: '박받음', grade: 2, no: 20314, checked: true, badges: [{ code: 'fun', title: '이야기꾼', icon: '🎉', tier: 3 }, { code: 'club_beatus', title: 'Beatus', icon: '💻', tier: 3 }] }, { id: 'u-c', name: '박받음', grade: 2, no: 20522, checked: true, badges: [] }] : []);
		}
		// 추천 5명 (Phase 84) — 가짜로 둘
		if (rpc === 'dm_recommend') return json([
			{ id: 'u-r1', name: '최추천', grade: 1, no: 10233, checked: true, badges: [{ code: 'heart', title: '공감 부자', icon: '❤️', tier: 2 }, { code: 'cnsa_student', title: 'CNSA 뱃지', icon: '🏫', tier: 3 }] },
			{ id: 'u-r2', name: '정추천', grade: 3, no: 30101, checked: true, badges: [] }
		]);
		if (rpc === 'dm_send') {
			const id = w.nextId++;
			w.letters.push({ id, thread_id: 9, box: 'sent', to_name: '박받음', to_grade: 2, opened: false, replied: false, is_reply: false, body: a.p_body, fmt: a.p_fmt ?? null, created_at: new Date().toISOString() });
			return json({ status: 'ok', thread_id: 9, msg_id: id });
		}
		if (rpc === 'dm_reply_to') {
			if (w.wait) return json({ status: 'wait_reply' });
			const src = w.letters.find((x) => x.id === a.p_msg);
			const id = w.nextId++;
			w.letters.push({ id, thread_id: src.thread_id, box: 'sent', to_name: src.from_name, to_gender: src.from_gender, opened: false, replied: false, is_reply: true, body: a.p_body, fmt: a.p_fmt ?? null, created_at: new Date().toISOString() });
			return json({ status: 'ok', thread_id: src.thread_id, msg_id: id });
		}
		if (rpc === 'dm_close' || rpc === 'dm_block' || rpc === 'dm_report') { w.hidden.add(a.p_thread); return json({ status: 'ok' }); }
		if (u.pathname === '/rest/v1/profiles') {
			if (req.method() === 'PATCH') { Object.assign(w.prof, req.postDataJSON()); w.patches.push(req.postDataJSON()); return route.fulfill({ status: 204 }); }
			return json(w.prof);
		}
		if (u.pathname === '/rest/v1/app_settings') return json({ is_open: true, notice: '', room_minutes: 10, extend_minutes: 10, vote_window_sec: 30, join_grace_sec: 30, max_rounds: 99, heartbeat_sec: 30, presence_ttl_sec: 70, msg_max_len: 500, max_open_rooms: 5, letter_max_len: 1000, comment_max_len: 300, ai_moderation: true, ai_chat: false });
		if (rpc) return json(null);
		return json([]);
	});
	await page.addInitScript(() => { try { localStorage.setItem('push-asked-v1', '1'); } catch {} });
	await page.goto(`${BASE}/login`);
	await page.getByPlaceholder('학교 이메일 앞부분').fill('10101');
	await page.getByPlaceholder('비밀번호').fill('abcd1234');
	await page.getByRole('button', { name: '로그인', exact: true }).click();
	await page.waitForTimeout(1500);
	return { page, errors, ctx };
}
const called = (w, fn) => w.calls.filter((c) => c[0] === fn);
const phase = (page) => page.locator('[data-phase]').first().getAttribute('data-phase').catch(() => null);

const browser = await chromium.launch({ executablePath: CHROME });
try {
	console.log('[편집기 지연 로딩]');
	{
		const lazy = await openApp(browser, world(), { reducedMotion: 'reduce' });
		let requests = 0, release;
		const gate = new Promise(resolve => { release = resolve; });
		await lazy.page.route('**/src/lib/letters/EnvelopeCompose.svelte*', async route => {
			requests++;
			await gate;
			await route.continue().catch(() => {});
		});
		await lazy.page.goto(`${BASE}/letters/new`);
		await lazy.page.locator('.recs .person').first().waitFor();
		check('받는 사람을 고르기 전에는 편집기 모듈을 요청하지 않음', requests === 0);
		await lazy.page.locator('.recs .person').first().click();
		await lazy.page.getByRole('status').filter({ hasText: '편지지를 준비' }).waitFor();
		check('편집기 다운로드 중에는 준비 상태와 돌아가기 표시', requests === 1 && await lazy.page.getByRole('button', { name: '받는 사람 다시 고르기' }).isVisible());
		await lazy.page.getByRole('button', { name: '받는 사람 다시 고르기' }).click();
		const loaded = lazy.page.waitForResponse(response => response.url().includes('/src/lib/letters/EnvelopeCompose.svelte') && response.status() === 200);
		release();
		await loaded;
		await lazy.page.locator('.recs .person').first().waitFor();
		check('다운로드 중 돌아가면 늦은 응답이 편지 쓰기를 다시 열지 않음', await lazy.page.getByRole('searchbox').isVisible() && await lazy.page.locator('.compose').count() === 0);
		await lazy.page.locator('.recs .person').first().click();
		await lazy.page.getByRole('textbox', { name: '편지 내용' }).waitFor({ timeout: 10000 });
		check('다시 고르면 지연 로딩한 편집기로 작성 가능', await lazy.page.getByRole('textbox', { name: '편지 내용' }).isVisible() && lazy.errors.length === 0);
		await lazy.ctx.close();
	}
	{
		const failed = await openApp(browser, world(), { reducedMotion: 'reduce' });
		await failed.page.route('**/src/lib/letters/EnvelopeCompose.svelte*', route => route.abort());
		await failed.page.goto(`${BASE}/letters/new`);
		await failed.page.locator('.recs .person').first().click();
		await failed.page.getByRole('alert').filter({ hasText: '편지지를 불러오지 못했어요' }).waitFor();
		check('편집기 다운로드 실패는 빈 화면 대신 안내·재시도 표시', await failed.page.getByRole('button', { name: '다시 불러오기' }).isVisible() && await failed.page.locator('.compose').count() === 0);
		await failed.ctx.close();
	}
	const w = world();
	const { page, errors } = await openApp(browser, w);
	await page.locator('a.logo').waitFor({ timeout: 8000 });

	console.log('[편지함]');
	await page.waitForTimeout(600);
	check('★ 안 연 편지 → 하단 익명편지 탭에 빨간 점', (await page.locator('a.tab', { hasText: '익명편지' }).locator('.tab-dot').count()) === 1);
	await page.locator('a.tab', { hasText: '익명편지' }).click(); await page.waitForURL('**/letters');
	const dropping = await page.waitForFunction(() => document.querySelector('.post .falling')?.getAnimations().length > 0, null, { timeout: 4000, polling: 16 }).then(() => true, () => false);
	const dotEarly = await page.locator('.post .dot').count();
	check('★ 새 편지는 투입구로 떨어지고 — 들어간 다음에 빨간 점', dropping && dotEarly === 0, JSON.stringify({ dropping, dotEarly }));
	await page.locator('.post .dot').waitFor({ timeout: 4000 }); await page.waitForTimeout(500);
	check('★ 안 읽은 편지는 우체통 안에 — 책상 위에 봉투가 없다 (Phase 79)', (await page.locator('.surface .stack .item').count()) === 0);
	const dot = await page.evaluate(() => {
		const b = document.querySelector('.post .postbox').getBoundingClientRect(), d = document.querySelector('.post .dot').getBoundingClientRect();
		return { x: (d.left + d.right) / 2 - b.left - b.width * 0.85, y: (d.top + d.bottom) / 2 - b.top - b.height * 0.2, size: d.width, fill: getComputedStyle(document.querySelector('.post .dot circle:not(.ping)')).fill };
	});
	check('★ 편지가 왔다 = 우체통 오른쪽 위 빨간 점 (숫자 대신)', dot.x > 0 && dot.y < 0 && dot.size > 10 && dot.fill.includes('255, 45, 63') && (await page.locator('.post .count').count()) === 0, JSON.stringify(dot));
	check('★ 우체통 — 읽는 사람용 이름에는 새 편지 수', (await page.locator('button.post').getAttribute('aria-label')).includes('새 편지 2통'));
	check('★ 투입구에 봉투 끝이 보이지 않는다 — 빨간 점만', (await page.locator('.post svg g[clip-path]').count()) === 0 && (await page.locator('.post svg rect[fill="#fffaf0"]').count()) === 1);
	check('채팅 말풍선은 없다 (편지만)', (await page.locator('.bubble').count()) === 0 && (await page.getByRole('textbox', { name: '메시지' }).count()) === 0);
	check('"새로 온 편지가 없어요" 문구는 없다', (await page.getByText('새로 온 편지가 없어요').count()) === 0);
	const scene = await page.evaluate(() => {
		const r = (q) => document.querySelector(q)?.getBoundingClientRect();
		const box = r('.wall .post .postbox'), wall = r('.wall'), surf = r('.surface');
		return { boxW: box.width, boxH: box.height, wallL: wall.left, wallR: wall.right - innerWidth, touch: Math.abs(wall.bottom - surf.top),
			desk: !!document.querySelector('.surface .desk-area .desk') };
	});
	check('★ 한 장면 — 벽에 걸린 2D 네모 우체통 → 바로 아래 책상 한 장에 서류 더미 (Phase 73)', scene.boxW > scene.boxH * 1.3 && scene.wallL <= 0 && scene.wallR >= 0 && scene.touch < 1 && scene.desk, JSON.stringify(scene));
	const rowOf = (pg) => pg.evaluate(() => {
		const p = document.querySelector('.desk .plate').getBoundingClientRect(), f = document.querySelector('.desk-area .fab').getBoundingClientRect();
		return { dy: Math.abs(p.top - f.top) + Math.abs(p.bottom - f.bottom), gap: f.left - p.right, plateW: p.width, fabW: f.width };
	});
	const row1 = await rowOf(page);
	check('★ 편지 보관함 이름표 · 편지 쓰기 단추가 한 줄 · 같은 높이', row1.dy < 1.5 && row1.gap > 0 && row1.gap < 20 && row1.fabW > 100, JSON.stringify(row1));
	const bleed = await page.evaluate(() => {
		const r = document.querySelector('.desk .wood').getBoundingClientRect();
		return { l: r.left, r: r.right - innerWidth, pressed: r.width * 0.985 - innerWidth, sx: document.documentElement.scrollWidth - innerWidth };
	});
	check('★ 책상은 화면보다 양옆으로 넓다 — (Phase 71) 모서리에 바깥 바탕이 비치지 않는다 · 가로 스크롤 없음', bleed.l <= -8 && bleed.r >= 8 && bleed.pressed > 0 && bleed.sx <= 0, JSON.stringify(bleed));
	// 누른 것만 반응 (Phase 82) — 책상이 통째로 줄지 않는다
	const pressAt = async (sel) => {
		const b = await page.locator(sel).boundingBox();
		await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(350);
		const st = await page.evaluate(() => {
			const sc = (q) => getComputedStyle(document.querySelector(q)).scale;
			return { desk: getComputedStyle(document.querySelector('button.desk')).transform, pile: sc('.desk .pile'), plate: sc('.desk .plate'), mug: getComputedStyle(document.querySelector('.desk .mug')).transform };
		});
		await page.mouse.move(5, 5); await page.mouse.up(); await page.waitForTimeout(300);
		return st;
	};
	const onPile = await pressAt('.desk .pile .top-env'), onPlate = await pressAt('.desk .plate');
	check('★ 편지 더미를 누르면 더미만 눌린다 — 책상 · 물건 · 이름표는 그대로', onPile.desk === 'none' && onPile.pile === '0.95' && onPile.plate === 'none' && onPile.mug === 'none', JSON.stringify(onPile));
	check('★ 이름표를 누르면 이름표만 눌린다', onPlate.desk === 'none' && onPlate.plate === '0.97' && onPlate.pile === 'none', JSON.stringify(onPlate));
	await page.locator('.desk .mug').click(); await page.waitForTimeout(80);
	const mugTap = { anim: await page.locator('.desk .mug').evaluate((e) => e.getAnimations().length), others: await page.locator('.desk .pen').evaluate((e) => e.getAnimations().length) };
	await page.waitForTimeout(500);
	check('★ 물건(머그)을 누르면 그것만 톡 튀어 오르고 보관함으로 가지 않는다', mugTap.anim > 0 && mugTap.others === 0 && new URL(page.url()).pathname === '/letters', JSON.stringify(mugTap));
	const desk = page.locator('button.desk');
	check('★ 아래 책상 위 서류 더미 = 편지 보관함 (읽은 편지 · 보낸 편지)', (await desk.getAttribute('aria-label')) === '편지 보관함 — 받은 편지 1통, 보낸 편지 1통' && (await desk.locator('.layer').count()) >= 3 && (await desk.locator('.top-env .env').count()) === 1,
		await desk.getAttribute('aria-label'));
	await page.screenshot({ path: `${SP}/letters-1-inbox.png`, fullPage: true });

	await desk.click(); await page.waitForURL('**/letters/archive'); await page.locator('.archive .stack .item').first().waitFor(); await page.waitForTimeout(700);
	const recvRows = (await page.locator('.archive .stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))));
	check('★ 보관함 받은 편지: 편지함처럼 큰 봉투 — 전부 (안 연 편지는 봉인 · "새 편지")', recvRows.length === 3 && recvRows[0] === '익명의 여학생에게서 온 편지, 안 읽음'
		&& (await page.locator('.archive .stack .new').count()) === 2 && (await page.locator('.archive .stack .seal').count()) === 2
		&& (await page.locator('.archive .stack .item').first().evaluate((e) => e.getBoundingClientRect().width)) > 280, JSON.stringify(recvRows));
	check('★ 모르는 사람은 "익명의 여학생" (성별만) · 내 편지의 답장은 이름', recvRows.includes('익명의 여학생에게서 온 편지, 안 읽음') && recvRows.includes('박받음에게서 온 답장, 안 읽음'), JSON.stringify(recvRows));
	check('봉투 뒷면에 손글씨 From.', (await page.locator('.archive .stack .item').first().locator('.back .back-from').innerText()).includes('익명의 여학생'));
	check('보관함 봉투도 보낸 사람 성별 색', (await page.locator('.archive .stack .env.b-f').count()) === 1 && (await page.locator('.archive .stack .env.b-m').count()) === 1);
	await page.screenshot({ path: `${SP}/letters-2-archive.png`, fullPage: true });
	await page.getByRole('tab', { name: '보낸 편지' }).click(); await page.waitForTimeout(700);
	const sentRow = await page.locator('.archive .stack .item').first().innerText();
	check('★ 보관함 보낸 편지: 주소 쪽 큰 봉투 — To. 이름 · 학년 · "답장 옴" 스티커', (await page.locator('.archive .stack .item').first().getAttribute('aria-label')) === '박받음에게 보낸 편지, 답장 옴'
		&& sentRow.includes('박받음') && sentRow.includes('2학년') && (await page.locator('.archive .stack .front .sticker').first().innerText()) === '답장 옴', sentRow);
	await page.screenshot({ path: `${SP}/letters-2-sent.png` });
	await page.getByRole('tab', { name: '받은 편지' }).click(); await page.waitForTimeout(200);
	await page.locator('button.back').click(); await page.waitForURL(/\/letters$/); await page.locator('.post .dot').waitFor(); await page.waitForTimeout(500);

	console.log('[봉투 열기 — 우체통을 눌러 꺼낸다]');
	let detailRequests = 0;
	const detailModule = url => decodeURIComponent(url.pathname).endsWith('/letters/m/[id]/+page.svelte');
	await page.route(detailModule, async route => {
		detailRequests++;
		await page.waitForTimeout(2600);
		await route.continue();
	});
	const before = await page.locator('.wall button.post').boundingBox();
	await page.locator('button.post').click(); await page.waitForURL('**/letters/m/70');
	await page.locator('.stage').waitFor();
	const after = await page.locator('.stage span.post').boundingBox();
	const knocking = await page.locator('.stage .post .postbox').evaluate((e) => e.getAnimations().length);
	check('★ 편지 화면이 같은 자리 · 같은 크기의 우체통으로 이어 받는다 (넘김 없이)', Math.abs(before.x - after.x) < 1.5 && Math.abs(before.y - after.y) < 1.5 && Math.abs(before.width - after.width) < 1.5 && !(await page.evaluate(() => document.documentElement.dataset.nav)), JSON.stringify({ before, after }));
	check('화면 코드 다운로드가 2.6초 지연돼도 우체통 연결 유지', detailRequests >= 1, String(detailRequests));
	await page.unroute(detailModule);
	check('★ 누르면 우체통이 덜컹 덜컹 · 빨간 점은 그대로', knocking > 0 && (await page.locator('.stage .post .dot').count()) === 1, String(knocking));
	await page.waitForTimeout(250);
	const p0 = await phase(page), cap = (await page.locator('.stage').innerText()).trim();
	check('★ 처음 여는 편지는 연출: 우체통에서 나와 주소 면부터 · 우체통 아래 문구는 없다 (2026-10-06)', ['slot', 'emerge', 'land', 'front'].includes(p0) && !/편지가 왔어요|여는 중|건너뛰기/.test(cap), `${p0} | ${cap}`);
	// 덜컹이 다 잦아든 뒤(투입구가 제자리) — 봉투는 아직 투입구 자리에서 빠져나오는 중
	await page.waitForFunction(() => document.querySelector('.stage')?.getAttribute('data-phase') === 'emerge' && document.querySelector('.stage .post .postbox').getAnimations().length === 0, null, { timeout: 2000, polling: 16 }).catch(() => {});
	const out0 = await page.evaluate(() => { const e = document.querySelector('.stage .env-wrap').getBoundingClientRect(), s = document.querySelector('.stage .post .slot').getBoundingClientRect(); return { dx: Math.abs((e.left + e.right) / 2 - (s.left + s.right) / 2), dy: Math.abs(e.bottom - (s.top + s.bottom) / 2), small: e.width <= s.width }; });
	check('★ 받은 편지는 우체통 투입구에서 빠져나온다 (편지 쓰기의 반대 — Phase 77)', out0.dx < 3 && out0.dy < 3 && out0.small, JSON.stringify(out0));

	check('★ 덜컹이 끝날 즈음 투입구에서 편지가 나온다 · 우체통 안엔 1통 남아 점은 그대로', (await phase(page)) === 'emerge' && (await page.locator('.stage .post .dot').count()) === 1);
	await page.waitForFunction(() => document.querySelector('.stage')?.getAttribute('data-phase') === 'front', null, { timeout: 3000 }).catch(() => {});
	const land = await page.evaluate(() => { const e = document.querySelector('.stage .env-wrap').getBoundingClientRect(), wall = document.querySelector('.stage .scene .wall').getBoundingClientRect(), st = document.querySelector('.stage').getBoundingClientRect(); return { top: e.top - wall.bottom, mid: Math.abs((e.top + e.bottom) / 2 - (wall.bottom + st.bottom) / 2) }; });
	check('★ 책상 한가운데에 내려앉는다 — 우체통 · 벽을 가리지 않는다', land.top > 0 && land.mid < 12, JSON.stringify(land));
	await page.screenshot({ path: `${SP}/letters-3a-front.png` });
	await page.waitForFunction(() => ['back', 'crack'].includes(document.querySelector('.stage')?.getAttribute('data-phase')), null, { timeout: 3000 }).catch(() => {});
	check('뒤집어 덮개 쪽 · 봉인에 금이 간다 (두 쪽으로 날아가지 않는다)', ['back', 'crack'].includes(await phase(page)) && (await page.locator('.stage .seal').count()) === 1 && (await page.locator('.stage .half').count()) === 0);
	await page.screenshot({ path: `${SP}/letters-3b-crack.png` });
	await page.waitForFunction(() => ['open', 'out'].includes(document.querySelector('.stage')?.getAttribute('data-phase')), null, { timeout: 3000 }).catch(() => {});
	check('덮개가 열리고 편지지가 나온다 — 봉인은 덮개에 붙어 함께 들린다', ['open', 'out'].includes(await phase(page)) && (await page.locator('.stage .flap .seal.cracked').count()) === 1);
	await page.screenshot({ path: `${SP}/letters-3c-out.png` });
	await page.locator('.letter-paper').waitFor({ timeout: 4000 }); await page.waitForTimeout(700);
	check('★ 펼치면 편지지: To. 내 이름 · From. 익명의 여학생 · 본문', (await page.locator('.letter-paper .lp-to').innerText()) === 'To. 김보냄'
		&& (await page.locator('.letter-paper .lp-from').innerText()) === 'From. 익명의 여학생' && (await page.locator('.letter-paper .lp-body').innerText()).includes('그림 진짜 잘 그리더라'));
	check('dm_open 으로 이 편지 한 통을 연다', JSON.stringify(called(w, 'dm_open').at(-1)?.[1]) === '{"p_msg":70}');
	check('편지 글은 선택 · 복사 가능', await page.locator('.letter-paper .lp-body').evaluate((e) => getComputedStyle(e).userSelect !== 'none'));
	check('★ 본문도 To. 와 같은 손글씨 · 줄 간격 = 편지지 줄 (34px)', await page.locator('.letter-paper .lp-body').evaluate((e) => {
		const s = getComputedStyle(e); const to = getComputedStyle(document.querySelector('.letter-paper .lp-to'));
		return s.fontFamily === to.fontFamily && s.lineHeight === '34px' && s.backgroundImage.includes('repeating-linear-gradient');
	}));
	check('★ 글줄마다 줄 위에 앉는다 (줄 칸의 아래 선과 글줄 아래가 같은 자리)', await page.locator('.letter-paper .lp-body').evaluate((e) => {
		const box = e.getBoundingClientRect(); const r = document.createRange(); r.selectNodeContents(e);
		const rects = [...r.getClientRects()].filter((c) => c.width > 0);
		// 글줄마다 줄 칸(34px) 안에서 같은 자리 · 글자 아래가 그 칸의 선(칸 맨 아래)을 넘지 않는다
		const offs = rects.map((c) => (c.top - box.top) % 34);
		return rects.length > 1 && Math.max(...offs) - Math.min(...offs) < 1.5 && rects.every((c) => ((c.top - box.top) % 34) + c.height <= 34.5);
	}));
	check('받은 편지 → "편지로 답장 쓰기" (채팅하기 없음)', (await page.getByRole('button', { name: '편지로 답장 쓰기' }).count()) === 1 && (await page.getByText('채팅하기').count()) === 0);
	await page.screenshot({ path: `${SP}/letters-3d-read.png`, fullPage: true });
	await page.goto(`${BASE}/letters/m/70`); await page.locator('.letter-paper').waitFor({ timeout: 2000 });
	check('★ 이미 연 편지는 연출 없이 바로 편지지', (await page.locator('.stage').count()) === 0);

	console.log('[편지로 답장]');
	await page.getByRole('button', { name: '편지로 답장 쓰기' }).click(); await page.waitForURL('**/letters/m/70/reply');
	await page.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'write', null, { timeout: 4000 });
	await page.waitForTimeout(400);
	check('★ 쓰는 동안 우체통은 숨는다 — 색 고르기 줄 · 편지지 사이로 비쳐 겹치지 않게 (Phase 80)', await page.locator('.compose .post .postbox').evaluate((e) => getComputedStyle(e).opacity === '0'));
	check('★ 봉투에서 편지지가 나와 쓰는 칸이 된다 — To. 익명의 여학생 · From. 내 이름', (await page.locator('.letter-paper .lp-to').innerText()).startsWith('To. 익명의 여학생')
		&& (await page.locator('.letter-paper .lp-from').innerText()) === 'From. 김보냄');
	check('비어 있으면 못 보낸다', await page.getByRole('button', { name: '봉투에 넣어 보내기' }).isDisabled());
	await page.getByRole('textbox', {name:'편지 내용'}).fill('버릴 초안');
	await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('landy-draft-v1:') && localStorage.getItem(key).includes('버릴 초안')));
	await page.getByRole('button', {name:'초안 버리기'}).click();
	await page.waitForFunction(() => !Object.keys(localStorage).some(key => key.startsWith('landy-draft-v1:')));
	check('초안 버리기는 본문과 기기 저장 항목을 모두 제거', (await page.getByRole('textbox', {name:'편지 내용'}).textContent()) === '');
	await page.getByRole('textbox', { name: '편지 내용' }).fill('고마워! 너도 잘 지내');
	await page.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('landy-draft-v1:') && localStorage.getItem(key).includes('고마워! 너도 잘 지내')));
	await page.reload();
	await page.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'write');
	check('답장 본문은 새로고침 뒤 기기 초안에서 복원', (await page.getByRole('textbox', {name:'편지 내용'}).innerText()) === '고마워! 너도 잘 지내');
	await page.screenshot({ path: `${SP}/letters-4a-reply.png` });
	await page.getByRole('button', { name: '봉투에 넣어 보내기' }).click();
	await page.waitForTimeout(1500);
	check('보내면 편지지가 봉투로 → 덮개 · 봉인', ['close', 'seal'].includes(await phase(page)), await phase(page));
	await page.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'seal', null, { timeout: 2000 }).catch(() => {});
	check('★ 봉인은 도장으로 쿵 — 놋쇠 도장 · 충격 파문 · 봉투가 눌린다', (await page.locator('.compose .seal.stamping .stamper').count()) === 1
		&& (await page.locator('.compose .seal .shock').count()) === 1 && (await page.locator('.compose .env.thud').count()) === 1);
	const onDesk = await page.evaluate(() => { const e = document.querySelector('.compose .env-wrap').getBoundingClientRect(), wall = document.querySelector('.compose .desk .wall').getBoundingClientRect(); return { top: e.top - wall.bottom, mid: Math.abs((e.top + e.bottom) / 2 - (wall.bottom + innerHeight) / 2) }; });
	check('★ 봉투는 책상 한가운데에서 접고 봉인한다 — 우체통 · 벽을 가리지 않는다 (Phase 77)', onDesk.top > 0 && onDesk.mid < 12, JSON.stringify(onDesk));
	await page.screenshot({ path: `${SP}/letters-4b-seal.png` });
	await page.waitForFunction(() => ['flip', 'aim', 'post'].includes(document.querySelector('.compose')?.getAttribute('data-phase')), null, { timeout: 3000 }).catch(() => {});
	check('봉투를 뒤집어 소인 "보냄"', ['flip', 'aim', 'post'].includes(await phase(page)) && (await page.locator('.compose .ring b').innerText()) === '보냄');
	await page.screenshot({ path: `${SP}/letters-4c-flip.png` });
	await page.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'post', null, { timeout: 3000 }).catch(() => {});
	await page.waitForTimeout(150);
	const posted = await page.evaluate(() => {
		const e = document.querySelector('.compose .env-wrap').getBoundingClientRect(), s = document.querySelector('.compose .post .slot').getBoundingClientRect();
		return { up: !!document.querySelector('.compose .post .postbox'), dx: Math.abs((e.left + e.right) / 2 - (s.left + s.right) / 2), dy: Math.abs(e.bottom - (s.top + s.bottom) / 2), fits: e.width <= s.width };
	});
	check('★ 화면 위쪽 우체통 — 봉투가 작아져 투입구에 맞춰 들어간다 (Phase 71 · 72)', posted.up && posted.dx < 3 && posted.dy < 3 && posted.fits, JSON.stringify(posted));
	await page.screenshot({ path: `${SP}/letters-4d-post.png` });
	await page.waitForURL(/\/letters$/, { timeout: 8000 }); await page.waitForTimeout(500);
	const back = await page.evaluate(() => ({ plus: document.querySelector('.post .plus')?.getAnimations().length ?? 0, land: !!document.querySelector('.desk .top-env.land') }));
	check('★ 보내고 돌아오면 우체통 위 "+✉" · 보낸 편지가 책상 더미에 내려앉는다 (Phase 72)', back.plus > 0 && back.land, JSON.stringify(back));
	check('★ 답장 → dm_reply_to (받은 편지 한 통에 · 이름으로 받은 쪽은 서명 없음)', JSON.stringify(called(w, 'dm_reply_to').at(-1)?.[1]) === JSON.stringify({ p_msg: 70, p_body: '고마워! 너도 잘 지내', p_fmt: null, p_nick: null }));
	check('보내기 성공 후 답장 초안 삭제', !(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('landy-draft-v1:') && localStorage.getItem(key).includes('고마워! 너도 잘 지내')))));
	await page.locator('button.desk').click(); await page.waitForURL('**/letters/archive'); await page.locator('.archive .stack .item').first().waitFor(); await page.waitForTimeout(300);
	check('★ 날아간 뒤 보관함은 보낸 편지 칸 — 맨 위에 방금 답장 (To. 익명의 여학생)', (await page.getByRole('tab', { name: '보낸 편지' }).getAttribute('aria-selected')) === 'true'
		&& (await page.locator('.archive .stack .item').first().getAttribute('aria-label')) === '익명의 여학생에게 보낸 답장');

	console.log('[새 편지]');
	await page.locator('button.back').click(); await page.waitForURL(/\/letters$/); await page.waitForTimeout(300);
	await page.getByRole('link', { name: '편지 쓰기' }).click(); await page.waitForURL('**/letters/new');
	const search = page.getByRole('searchbox', { name: '편지 받을 학생 찾기' });
	check('찾기 화면에 설명 문구 없음 (처음 사용법 안내가 알려 준다, Phase 44)', (await page.locator('.pick .hint').count()) === 0);
	await page.locator('.recs .person').first().waitFor({ timeout: 3000 });
	const recRows = await page.locator('.recs .person .who').allInnerTexts();
	check('★ 찾기 전에는 아래에 추천 (Phase 84) — 이름 · 학년 · 대표 뱃지', recRows.length === 2 && recRows[0].includes('최추천') && recRows[0].includes('1학년')
		&& (await page.locator('.recs .person').first().locator('.badges .medal').count()) === 2 && called(w, 'dm_recommend').length === 1, JSON.stringify([recRows, await page.locator('.recs .person').first().locator('.badges .medal').count(), called(w, 'dm_recommend').length]));
	await page.getByRole('button', { name: '다른 추천' }).click(); await page.waitForTimeout(300);
	check('"다른 추천"을 누르면 다시 받는다 (그때만)', called(w, 'dm_recommend').length === 2);
	await search.fill('박'); await page.waitForTimeout(400);
	check('한 글자로는 찾지 않는다 (추천은 그대로)', called(w, 'dm_search').length === 0 && (await page.locator('.recs .person').count()) === 2);
	await search.fill('박받'); await page.waitForTimeout(600);
	const people = await page.locator('.person .who').allInnerTexts();
	check('★ 이름으로 찾기 — 동명이인은 학년 · 학번으로 구분', people.length === 2 && people[0].includes('2학년') && people[0].includes('학번 20314') && people[1].includes('학번 20522'), JSON.stringify(people));
	check('★ 찾기 결과에 대표 뱃지 (Phase 84) · 찾으면 추천은 걷힌다', (await page.locator('.person').first().locator('.badges .medal').count()) === 2 && (await page.locator('.person').nth(1).locator('.badges').count()) === 0 && (await page.locator('.recs').count()) === 0);
	await page.locator('.person').first().click();
	await page.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'write', null, { timeout: 4000 });
	check('마우스 · 키보드가 있는 기기는 편지지에 바로 커서', await page.evaluate(() => !!document.activeElement?.closest('.le-doc')));
	check('★ 편지지: To. 박받음 2학년 · From. 서명 칸 (비우면 익명의 남학생)', (await page.locator('.letter-paper .lp-to').innerText()).replace(/\s+/g, '').startsWith('To.박받음2학년')
		&& (await page.locator('.letter-paper .nick').getAttribute('placeholder')) === '익명의 남학생');
	await page.waitForTimeout(700);
	check('★ 쓰는 동안 봉투는 화면에서 치운다 (키보드가 올라와도 가리지 않게)', await page.locator('.env-wrap').evaluate((e) => getComputedStyle(e).opacity === '0'));
	await page.locator('.letter-paper .nick').fill('  노란   우산 ');
	check('서식 도구 막대', (await page.getByRole('toolbar', { name: '서식' }).getByRole('button').count()) >= 10);
	const editor = page.getByRole('textbox', { name: '편지 내용' });
	await editor.fill('안녕 박받음! 오늘 발표 멋있었어');
	await editor.evaluate((el) => {
		const node = el.querySelector('p').firstChild, i = node.textContent.indexOf('발표');
		const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 2);
		const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
	});
	await page.waitForTimeout(100);
	await page.getByRole('button', { name: '굵게' }).click();
	await page.getByRole('button', { name: '형광펜', exact: true }).click();
	await page.getByRole('button', { name: '형광펜 노랑' }).click();
	await page.waitForTimeout(100);
	await page.screenshot({ path: `${SP}/letters-5a-compose.png` });
	await page.getByRole('button', { name: '봉투에 넣어 보내기' }).click();
	await page.waitForURL(/\/letters$/, { timeout: 8000 });
	const sent = called(w, 'dm_send').at(-1)?.[1];
	check('★ 고른 사람(계정 id)에게 · 서명(앞뒤 공백 정리) · 서식은 본문과 따로', sent?.p_to === 'u-b' && sent?.p_body === '안녕 박받음! 오늘 발표 멋있었어' && sent?.p_nick === '노란   우산'
		&& JSON.stringify(sent?.p_fmt?.m?.slice().sort()) === JSON.stringify([[11, 13, 'b'], [11, 13, 'h:yellow']]), JSON.stringify(sent));
	await page.waitForTimeout(1600);
	check('보낸 뒤 알림 · AI 검토 요청', w.calls.some((c) => c[0] === 'api' && c[1] === '/api/push' && c[2]?.dm_msg_id) && w.calls.some((c) => c[0] === 'api' && c[1] === '/api/moderate'));
	await page.goto(`${BASE}/letters/archive`); await page.locator('.archive .stack .item').first().waitFor();
	await page.getByRole('tab', { name: '보낸 편지' }).click(); await page.waitForTimeout(700);
	await page.locator('.archive .stack .item').first().click(); await page.waitForURL(/\/letters\/m\/\d+$/); await page.locator('.letter-paper').waitFor();
	check('★ 보낸 편지 열기: 연출 없이 · To. 박받음 2학년 · 서식 그대로 · 아직 안 읽음', (await page.locator('.stage').count()) === 0 && (await page.locator('.letter-paper .rt-b').innerText()) === '발표'
		&& (await page.locator('.note').innerText()).includes('아직 봉투를 열지 않았어요'));
	await page.screenshot({ path: `${SP}/letters-5b-sent-read.png` });

	console.log('[메뉴 · 신고]');
	await page.goto(`${BASE}/letters/m/60`); await page.locator('.letter-paper').waitFor();
	await page.getByRole('button', { name: '메뉴' }).click(); await page.waitForTimeout(300);
	check('★ 편지 화면 ⋯: 편지 버리기 · 차단 · 신고 · 취소 (채팅식 "나가기" 없음)', (await page.locator('.sheet .item').allInnerTexts()).map((t) => t.trim()).join(',') === '편지 버리기,차단하기,신고하기,취소');
	await page.locator('.sheet .item', { hasText: '편지 버리기' }).click(); await page.waitForTimeout(200);
	check('모르는 사람의 편지를 버리면 "앞으로 나에게 편지를 보낼 수 없어요" (조사도 맞게)', (await page.locator('.sheet .warn').innerText()).includes('익명의 남학생은 앞으로 나에게 편지를 보낼 수 없어요'), await page.locator('.sheet .warn').innerText());
	await page.locator('.sheet .item', { hasText: '돌아가기' }).click(); await page.waitForTimeout(200);
	check('돌아가기 → 메뉴 처음으로', (await page.locator('.sheet .item', { hasText: '편지 버리기' }).count()) === 1);
	await page.locator('.sheet .item', { hasText: '취소' }).click(); await page.waitForTimeout(300);
	await page.getByRole('button', { name: '메뉴' }).click(); await page.waitForTimeout(200);
	await page.locator('.sheet .item', { hasText: '신고하기' }).click(); await page.waitForTimeout(300);
	check('신고 시트: 사유 7개', (await page.locator('.reason').count()) === 7);
	await page.locator('.reason', { hasText: '욕설' }).click();
	await page.locator('.sheet .item.danger', { hasText: '신고하기' }).click();
	await page.waitForURL(/\/letters$/, { timeout: 8000 }); await page.waitForTimeout(500);
	check('★ 신고 → 편지 줄기로 신고 · 편지함에서 사라진다', JSON.stringify(called(w, 'dm_report').at(-1)?.[1]) === JSON.stringify({ p_thread: 8, p_reason: 'harassment', p_note: '' })
		&& !(await page.locator('.stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).some((l) => l.includes('익명의 남학생')));

	console.log('[길게 누르기 · 편지 버리기]');
	await page.goto(`${BASE}/letters/archive`); await page.locator('.archive .stack .item').first().waitFor();
	await page.getByRole('tab', { name: '보낸 편지' }).click(); await page.waitForTimeout(800);
	const row = page.locator('.archive .stack .item').last();
	const box = await row.boundingBox();
	const at = { clientX: box.x + 60, clientY: box.y + box.height / 2, pointerType: 'touch', button: 0, isPrimary: true, pointerId: 5 };
	await row.dispatchEvent('pointerdown', at); await page.waitForTimeout(650);
	await row.dispatchEvent('pointerup', at); await row.dispatchEvent('click'); await page.waitForTimeout(300);
	check('★ 길게 누르면 봉투 메뉴 (열리지 않는다) — 편지 읽기 · 버리기 · 차단 · 신고', new URL(page.url()).pathname === '/letters/archive'
		&& (await page.locator('.sheet .item').allInnerTexts()).map((t) => t.trim()).join(',') === '편지 읽기,편지 버리기,차단하기,신고하기,취소', (await page.locator('.sheet .item').allInnerTexts()).join(','));
	check('메뉴 머리: 받는 사람 · 보낸 날', (await page.locator('.sheet .who').innerText()).includes('박받음') && (await page.locator('.sheet .who').innerText()).includes('에 보낸 편지'));
	await page.locator('.sheet .item', { hasText: '편지 버리기' }).click(); await page.waitForTimeout(200);
	check('내가 이름으로 보낸 편지를 버릴 땐 "다시 못 보냄" 없음 · 주고받은 수', !(await page.locator('.sheet .warn').innerText()).includes('보낼 수 없어요') && (await page.locator('.sheet .warn').innerText()).includes('박받음과 주고받은 편지'), await page.locator('.sheet .warn').innerText());
	await page.locator('.sheet .item.danger', { hasText: '버리기' }).click(); await page.waitForTimeout(700);
	check('★ 버리면 그 사람과의 편지가 보관함에서 사라진다', called(w, 'dm_close').at(-1)?.[1]?.p_thread === 9 && !(await page.locator('.archive .stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).some((l) => l.includes('박받음')));

	console.log('[예전 주소 · 대화 목록 길게 누르기]');
	await page.goto(`${BASE}/letters/7`); await page.waitForURL(/\/letters$/, { timeout: 5000 }).catch(() => {});
	check('예전 편지 주소(/letters/7) → 편지함', new URL(page.url()).pathname === '/letters');
	await page.goto(`${BASE}/`); await page.locator('button.room').first().waitFor({ timeout: 8000 });
	await page.locator('button.room').first().click({ button: 'right' }); await page.waitForTimeout(300);
	check('대화 줄 오른쪽 클릭 → 신고 · 차단 · 나가기', (await page.locator('.sheet .item').allInnerTexts()).join(',') === '신고하기,차단하기,대화 나가기,취소');
	await page.keyboard.press('Escape');

	console.log('[설정 · 편지 받기]');
	await page.goto(`${BASE}/settings`);
	const sw = page.getByRole('switch', { name: '편지 받기' });
	await sw.waitFor();
	check('편지 받기 — 기본 켜짐', await sw.isChecked());
	await sw.click(); await page.waitForTimeout(500);
	check('★ 끄면 letters_open = false 로 저장', JSON.stringify(w.patches.at(-1)) === '{"letters_open":false}' && !(await sw.isChecked()));
	await page.locator('a.legal-row', { hasText: '개인정보 처리방침' }).click(); await page.waitForURL('**/settings/privacy'); await page.locator('article h1').waitFor();
	check('개인정보 처리방침: 편지 받는 사람에게 성별이 보임', (await page.locator('article').innerText()).includes('성별'));
	check('페이지 오류 없음', errors.length === 0, errors.join(' / '));

	console.log('[동작 줄이기]');
	const w3 = world();
	const r3 = await openApp(browser, w3, { reducedMotion: 'reduce' });
	await r3.page.goto(`${BASE}/letters/m/70`); await r3.page.locator('.letter-paper').waitFor({ timeout: 3000 });
	check('★ 동작 줄이기: 처음 여는 편지도 연출 없이 바로 편지지', (await r3.page.locator('.stage').count()) === 0);
	await r3.page.getByRole('button', { name: '편지로 답장 쓰기' }).click();
	await r3.page.getByRole('textbox', { name: '편지 내용' }).waitFor({ timeout: 3000 });
	check('동작 줄이기: 바로 쓰는 칸', (await phase(r3.page)) === 'write');
	await r3.page.getByRole('textbox', { name: '편지 내용' }).fill('짧게');
	await r3.page.getByRole('button', { name: '봉투에 넣어 보내기' }).click();
	await r3.page.waitForURL(/\/letters$/, { timeout: 3000 });
	check('동작 줄이기: 보내면 바로 편지함', called(w3, 'dm_reply_to').length === 1);
	check('페이지 오류 없음 (동작 줄이기)', r3.errors.length === 0, r3.errors.join(' / '));
	await r3.ctx.close();

	console.log('[당겨서 새로고침]');
	const w4 = world();
	const r4 = await openApp(browser, w4);
	const pg = r4.page;
	await pg.goto(`${BASE}/letters`); await pg.locator('.post .dot').waitFor(); await pg.waitForTimeout(400);
	const cdp = await pg.context().newCDPSession(pg);
	const drag = async (dist) => {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 160 }] });
		for (let i = 1; i <= 12; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 160 + (dist * i) / 12 }] });
	};
	let reloaded = false; pg.once('load', () => (reloaded = true));
	await drag(60);
	check('조금 당기면 동그라미만 따라온다 (새로고침 아님)', (await pg.locator('.ptr.dragging').count()) === 1 && (await pg.locator('.ptr.ready').count()) === 0);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await pg.waitForTimeout(500);
	check('놓으면 제자리로 · 새로고침 안 함', !reloaded && (await pg.locator('.ptr.busy').count()) === 0);
	await drag(320);
	check('★ 충분히 당기면 준비 표시', (await pg.locator('.ptr.ready').count()) === 1);
	const load = pg.waitForEvent('load', { timeout: 8000 }).then(() => true, () => false);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	check('★ 맨 위에서 당겼다 놓으면 앱을 다시 불러온다', await load);
	await pg.locator('.post .dot').waitFor(); await pg.waitForTimeout(400);
	check('다시 불러와도 편지함 그대로 (로그인 유지)', new URL(pg.url()).pathname === '/letters' && (await pg.locator('button.post').getAttribute('aria-label')).includes('새 편지 2통'));
	check('페이지 오류 없음 (새로고침)', r4.errors.length === 0, r4.errors.join(' / '));
	await r4.ctx.close();

	console.log('[알림에서 편지 — 우체통에서 꺼낸다 (Phase 80) · 로고]');
	{
		const w9 = world();
		const r9 = await openApp(browser, w9);
		const p9 = r9.page;
		await p9.locator('a.logo').waitFor({ timeout: 8000 }); await p9.waitForTimeout(600);
		// 로고 — 그라디언트를 칠하는 칸이 y 꼬리(줄 높이 1 에서 글자 칸 아래로 0.175em)까지 덮는다
		const logo = await p9.locator('a.logo').evaluate(async (el) => {
			await document.fonts.load('100px "Lotteria Chab"', 'Landy');
			const c = document.createElement('canvas').getContext('2d'); c.font = '100px "Lotteria Chab"';
			const m = c.measureText('Landy'), cs = getComputedStyle(el), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight);
			const base = (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) * fs / 100) / 2 + m.fontBoundingBoxAscent * fs / 100;
			const r = el.getBoundingClientRect();
			return { inkBottom: r.top + parseFloat(cs.paddingTop) + base + m.actualBoundingBoxDescent * fs / 100, boxBottom: r.bottom };
		});
		check('★ 머리글 Landy 의 y 꼬리가 잘리지 않는다 (그라디언트 칸이 글자 아래 끝까지)', logo.boxBottom >= logo.inkBottom + 0.5, JSON.stringify(logo));
		const font9 = await p9.locator('a.logo').evaluate((el) => ({ fam: getComputedStyle(el).fontFamily, ok: document.fonts.check('27px "Lotteria Chab"', 'Landy'), tab: getComputedStyle(document.querySelector('a.tab .label, a.tab span') ?? document.body).fontFamily }));
		check('★ 로고 글꼴만 롯데리아 촵땡겨체 (Phase 83)', font9.fam.startsWith('"Lotteria Chab"') && font9.ok, JSON.stringify(font9));
		const splash = await p9.evaluate(() => {
			const d = document.createElement('div'); d.className = 'splash'; d.innerHTML = '<span class="wordmark">Landy</span>'; document.body.append(d);
			const w = d.querySelector('.wordmark'), cs = getComputedStyle(w), ds = getComputedStyle(d);
			const out = { bg: ds.backgroundColor, fill: cs.webkitTextFillColor, img: cs.backgroundImage, fixed: ds.position };
			d.remove(); return out;
		});
		check('★ 시작 화면(아이콘 + 이름)은 늘 어두운 바탕에 흰 이름', splash.bg === 'rgb(12, 10, 11)' && splash.fill === 'rgb(255, 255, 255)' && splash.img === 'none' && splash.fixed === 'fixed', JSON.stringify(splash));
		await p9.locator('a.logo').screenshot({ path: `${SP}/logo.png` });

		// 앱이 떠 있을 때 온 편지 푸시 → 위에서 알림 띠 → 누르면 편지함 우체통에서 꺼낸다
		await p9.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'push', note: { kind: 'letter', title: '새 편지가 왔어요', body: '봉투를 열어 확인해 보세요', url: '/letters/m/70', tag: 'dm-70' } } })));
		const banner = p9.locator('.inapp .card'); await banner.waitFor({ timeout: 3000 });
		await banner.click();
		await p9.waitForURL(/\/letters(\?take=70)?$/, { timeout: 4000 });
		const trail = [];
		const seen = await p9.waitForFunction(() => location.pathname === '/letters' && !location.search && !!document.querySelector('.wall .post .dot'), null, { timeout: 4000, polling: 16 }).then(() => true, async () => (trail.push(p9.url(), await p9.locator('.wall .post .dot').count()), false));
		const before9 = await p9.locator('.wall button.post').boundingBox();
		await p9.waitForURL('**/letters/m/70', { timeout: 5000 }); await p9.locator('.stage').waitFor();
		const after9 = await p9.locator('.stage span.post').boundingBox();
		const knock9 = await p9.locator('.stage .post .postbox').evaluate((e) => e.getAnimations().length);
		check('★ 알림 띠를 누르면 편지함 우체통이 먼저 보이고 → 스스로 눌러 같은 우체통이 덜컹 덜컹', seen && knock9 > 0 && Math.abs(before9.y - after9.y) < 1.5 && Math.abs(before9.width - after9.width) < 1.5, JSON.stringify({ seen, trail, knock9, before9, after9 }));
		await p9.waitForFunction(() => document.querySelector('.stage')?.getAttribute('data-phase') === 'emerge', null, { timeout: 2500 }).catch(() => {});
		check('★ 그다음 투입구에서 편지가 나온다', (await phase(p9)) === 'emerge');
		await p9.goBack(); await p9.waitForTimeout(1600);
		check('편지에서 뒤로 오면 편지함 그대로 — 주소에 take 가 남지 않아 다시 꺼내지 않는다', new URL(p9.url()).pathname === '/letters' && !new URL(p9.url()).search, p9.url());

		// 편지함을 보고 있을 때는 편지 알림 띠를 띄우지 않는다 (우체통에 바로 보인다)
		await p9.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'push', note: { kind: 'letter', title: '새 편지가 왔어요', body: '또 왔어요', url: '/letters/m/55', tag: 'dm-55' } } })));
		await p9.waitForTimeout(400);
		check('편지함에서는 편지 알림 띠를 띄우지 않는다', (await p9.locator('.inapp .card').count()) === 0);

		// 시스템 알림을 누름 (서비스워커가 "열어 줘") — 다른 화면에 있어도 편지함 우체통을 거친다
		await p9.goto(`${BASE}/`); await p9.locator('a.logo').waitFor({ timeout: 8000 });
		await p9.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open', url: '/letters/m/55' } })));
		await p9.waitForURL('**/letters/m/55', { timeout: 6000 }).catch(() => {});
		await p9.locator('.stage').waitFor({ timeout: 2000 }).catch(() => {});
		check('★ 시스템 알림을 눌러도 편지함 우체통에서 꺼낸다 (같은 자리 · 크기로 이어 받음)', new URL(p9.url()).pathname === '/letters/m/55'
			&& (await p9.locator('.stage').getAttribute('style').catch(() => ''))?.includes('--mb-w'), p9.url());
		check('페이지 오류 없음 (알림 → 우체통)', r9.errors.length === 0, r9.errors.join(' / '));
		await r9.ctx.close();
	}

	// 앱이 꺼져 있을 때 알림을 누르면 서비스워커가 /letters?take=번호 로 연다
	{
		const w9 = world();
		const r9 = await openApp(browser, w9);
		await r9.page.locator('a.logo').waitFor({ timeout: 8000 });
		await r9.page.goto(`${BASE}/letters?take=70`);
		await r9.page.waitForURL('**/letters/m/70', { timeout: 6000 }).catch(() => {});
		check('★ 앱을 새로 열며 온 알림(/letters?take=번호)도 우체통을 거쳐 그 편지로', new URL(r9.page.url()).pathname === '/letters/m/70' && (await r9.page.locator('.stage').count()) === 1, r9.page.url());
		check('페이지 오류 없음 (새로 열기)', r9.errors.length === 0, r9.errors.join(' / '));
		await r9.ctx.close();
	}

	console.log('[다크 모드 우체통 (Phase 81)]');
	{
		const look = async (scheme) => {
			const r = await openApp(browser, world(), { colorScheme: scheme });
			await r.page.locator('a.logo').waitFor({ timeout: 8000 });
			await r.page.locator('a.tab', { hasText: '익명편지' }).click(); await r.page.waitForURL('**/letters');
			await r.page.locator('.post .dot').waitFor({ timeout: 4000 }); await r.page.waitForTimeout(600);
			const c = await r.page.evaluate(() => [...document.querySelectorAll('.post linearGradient')[0].querySelectorAll('stop')].map((e) => getComputedStyle(e).stopColor));
			if (scheme === 'dark') await r.page.screenshot({ path: `${SP}/letters-dark.png` });
			const errs = r.errors.slice();
			await r.ctx.close();
			return { c, errs };
		};
		const lum = (rgb) => { const [r, g, b] = rgb.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
		const L = await look('light'), D = await look('dark');
		check('라이트 모드 우체통은 연한 붉은색 (테마 색과 상관없이)', L.c.join('|') === 'rgb(255, 158, 148)|rgb(248, 128, 127)|rgb(236, 100, 112)', L.c.join('|'));
		check('★ 다크 모드 우체통은 라이트보다 어둡다 (세 색 모두)', D.c.length === 3 && D.c.every((x, i) => lum(x) < lum(L.c[i]) - 15), D.c.join('|'));
		check('페이지 오류 없음 (다크 우체통)', L.errs.length + D.errs.length === 0, [...L.errs, ...D.errs].join(' / '));
	}

	console.log('[CNSA 뱃지 — 안내 · 제출 · 어디에 보일지 · 5칸 (Phase 84)]');
	{
		const w11 = world();
		Object.assign(w11.prof, { letters_recommend: true, letter_badge_order: 'mine' });
		const r11 = await openApp(browser, w11);
		const p11 = r11.page;
		const def = (code, title, category, tier, extra = {}) => ({ code, title, icon: '', tier, category, tiers: [1, 1, 1], value: 0, description: title, unit: '', lower_better: false, earned_at: null, new: false, granted: category === 'cnsa', ...extra });
		const ach = {
			items: [
				def('fun', '이야기꾼', 'manner', 3, { granted: false }),
				def('cnsa_student', 'CNSA 뱃지', 'cnsa', 3),
				def('msmp_gold', 'MSMP 우수 금뱃지', 'cnsa', 0),
				def('club_beatus', 'Beatus', 'cnsa', 0),
				def('club_geukjakso', '극작소', 'cnsa', 0)
			],
			featured: [{ code: 'fun', title: '이야기꾼', icon: '', tier: 3 }], chosen: [], slots: 3, golds: 1, chat: { fun: true, cnsa_student: false }
		};
		const reqs = [];
		await p11.route('https://fake-proj.supabase.co/rest/v1/rpc/my_achievements', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ach) }));
		await p11.route('https://fake-proj.supabase.co/rest/v1/rpc/set_badge_chat', (rt) => { w11.calls.push(['set_badge_chat', rt.request().postDataJSON()]); return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok"}' }); });
		await p11.route('https://fake-proj.supabase.co/rest/v1/rpc/my_badge_requests', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reqs) }));
		await p11.route('https://fake-proj.supabase.co/rest/v1/rpc/badge_request_submit', (rt) => {
			const a = rt.request().postDataJSON();
			w11.calls.push(['badge_request_submit', a]);
			reqs.unshift({ id: 1, kind: a.p_kind, code: a.p_code, title: 'MSMP 우수 금뱃지', members: 0, status: 'pending', staff_note: null, created_at: new Date().toISOString(), decided_at: null });
			return rt.fulfill({ status: 200, contentType: 'application/json', body: '{"status":"ok","id":1}' });
		});

		// 업적 화면 — 금 뱃지 진행도 · CNSA 탭의 안내 · 제출. CNSA 뱃지 안내는 여기서 저절로 뜨지 않는다 (Phase 89 — 프로필 안내의 끝으로 옮겼다) → CNSA 탭의 단추로
		await p11.goto(`${BASE}/me/achievements?tour`);
		const tour = p11.getByRole('dialog', { name: 'CNSA 뱃지 안내' });
		await p11.getByRole('button', { name: 'CNSA', exact: true }).waitFor({ timeout: 4000 }); await p11.waitForTimeout(1000);
		check('★ CNSA 뱃지를 가졌어도 업적 화면에서 안내가 저절로 뜨지 않는다 (Phase 89)', (await tour.count()) === 0);
		await p11.getByRole('button', { name: 'CNSA', exact: true }).click(); await p11.getByRole('button', { name: 'CNSA 뱃지 안내' }).click();
		await tour.waitFor({ timeout: 4000 });
		check('★ CNSA 탭 "CNSA 뱃지 안내" → 다섯 장', (await tour.locator('.dots i').count()) === 5 && (await tour.locator('h2').innerText()) === 'CNSA 뱃지란?'
			&& (await tour.locator('.pins .medal').count()) === 4);
		await tour.getByRole('button', { name: '다음' }).click(); await p11.waitForTimeout(200);
		const how = await tour.innerText();
		check('★ 얻는 법 — 기본 뱃지는 Landy 금 뱃지로 · 나머지는 학번 · 이름과 함께 찍어 운영진에게 · 인스타는 준비 중', how.includes('금 뱃지를 처음 따면') && how.includes('학번 · 이름') && how.includes('인스타그램 DM · 준비 중'), how);
		await tour.getByRole('button', { name: '다음' }).click(); await p11.waitForTimeout(200);
		const club = await tour.innerText();
		check('★ 앱에 없는 뱃지는 추가 요청 · 동아리 뱃지는 기장이 부원까지', club.includes('추가 요청') && club.includes('기장만') && club.includes('부원 학번'), club);
		await tour.getByRole('button', { name: '다음' }).click(); await p11.waitForTimeout(400);
		const sw = tour.getByRole('switch', { name: 'CNSA 뱃지 랜덤채팅에 보이기' });
		check('★ 어디에 보일지 — 뱃지마다 랜덤채팅 스위치 (CNSA 는 꺼져 있음)', !(await sw.isChecked()) && (await tour.getByRole('switch', { name: '이야기꾼 랜덤채팅에 보이기' }).isChecked()));
		await sw.click(); await p11.waitForTimeout(300);
		check('켜면 set_badge_chat 으로 저장 · 바로 켜져 보인다', JSON.stringify(called(w11, 'set_badge_chat').at(-1)?.[1]) === '{"p_code":"cnsa_student","p_show":true}' && (await sw.isChecked()));
		await tour.getByRole('radio', { name: '무작위' }).click(); await p11.waitForTimeout(400);
		check('★ 편지 찾기에서 내 뱃지 순서 — 무작위로 저장', w11.patches.some((x) => x.letter_badge_order === 'random'), JSON.stringify(w11.patches));
		await tour.getByRole('button', { name: '다음' }).click(); await p11.waitForTimeout(200);
		check('★ 마지막 장 — 금 뱃지 5개면 칸 5개 · 지금 1/5', (await tour.locator('h2').innerText()) === '금 뱃지 5개면 칸이 5개' && (await tour.innerText()).includes('1/5'));
		await p11.screenshot({ path: `${SP}/cnsa-tour.png` });
		await tour.getByRole('button', { name: '확인' }).click(); await p11.waitForTimeout(300);
		check('닫으면 이 기기에 "봤음" — 프로필 안내에서 다시 잇지 않는다', (await p11.evaluate(() => localStorage.getItem('cnsa-tour-v1'))) === '1');
		// 다시 열어 마지막 장의 "뱃지 제출하기" — 창을 닫으며 제출 화면으로, 뒤로 오면 업적 화면
		await p11.getByRole('button', { name: 'CNSA 뱃지 안내' }).click();
		for (let i = 0; i < 4; i++) { await tour.getByRole('button', { name: '다음' }).click(); await p11.waitForTimeout(150); }
		await tour.getByRole('button', { name: '뱃지 제출하기' }).click();
		await p11.waitForURL('**/me/achievements/submit', { timeout: 4000 }).catch(() => {});
		await p11.waitForTimeout(500);
		check('★ 안내 마지막 장 "뱃지 제출하기" → 제출 화면 (안내는 닫힌다)', new URL(p11.url()).pathname === '/me/achievements/submit' && (await tour.count()) === 0, p11.url());
		await p11.goBack(); await p11.waitForURL('**/me/achievements', { timeout: 4000 }).catch(() => {}); await p11.waitForTimeout(400);
		check('뒤로 오면 업적 화면 (안내가 다시 뜨지 않는다)', new URL(p11.url()).pathname === '/me/achievements' && (await tour.count()) === 0, p11.url());
		check('★ 업적 화면: 대표 업적 1/3 · Landy 금 뱃지 1/5', (await p11.locator('.feat-head h2').innerText()).includes('1/3') && (await p11.locator('.five').innerText()).includes('1/5'));
		await p11.getByRole('button', { name: 'CNSA', exact: true }).click(); await p11.waitForTimeout(200);
		check('CNSA 탭 위에 "CNSA 뱃지 안내" · "뱃지 제출하기"', (await p11.getByRole('button', { name: 'CNSA 뱃지 안내' }).count()) === 1 && (await p11.getByRole('link', { name: '뱃지 제출하기' }).getAttribute('href')) === '/me/achievements/submit');

		console.log('  [뱃지 제출]');
		await p11.getByRole('link', { name: '뱃지 제출하기' }).click(); await p11.waitForURL('**/me/achievements/submit');
		await p11.locator('.pick').first().waitFor();
		const picks = await p11.locator('.picks .pick').allInnerTexts();
		check('★ 내 뱃지 인증 — 고를 수 있는 뱃지는 동아리 · 기본 CNSA 뱃지 · 가진 것 빼고', picks.length === 1 && picks[0].includes('MSMP'), JSON.stringify(picks));
		const sendBtn = p11.getByRole('button', { name: '운영진에게 보내기' });
		await p11.locator('.picks .pick').first().click();
		check('사진이 없으면 보낼 수 없다', await sendBtn.isDisabled());
		// 진짜 사진처럼 — 브라우저에서 그린 PNG (줄여서 JPEG 로 올라가는지 본다)
		const png = Buffer.from(await p11.evaluate(() => { const c = document.createElement('canvas'); c.width = 2400; c.height = 1800; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 2400, 1800); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
		await p11.locator('input[type=file]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: png });
		await p11.locator('.photos .ph img').first().waitFor({ timeout: 3000 });
		check('★ 고른 사진이 바로 보인다 (이 기기에서 줄여서)', (await p11.locator('.photos .ph img').count()) === 1 && !(await sendBtn.isDisabled()));
		await sendBtn.click(); await p11.waitForTimeout(800);
		const up = w11.calls.filter((c) => c[0] === 'storage' && c[1] === 'POST');
		const sub = called(w11, 'badge_request_submit').at(-1)?.[1];
		check('★ 사진은 내 폴더(badge-proofs/내 id/)에 올리고 그 경로로 요청', up.length === 1 && up[0][2].startsWith(`/storage/v1/object/badge-proofs/${uid}/`) && sub?.p_kind === 'proof' && sub.p_code === 'msmp_gold'
			&& sub.p_photos.length === 1 && sub.p_photos[0].startsWith(`${uid}/`) && sub.p_photos[0].endsWith('.jpg'), JSON.stringify({ up, sub }));
		check('★ 보낸 요청 목록에 "확인 중"', (await p11.locator('.mine li').first().innerText()).includes('확인 중') && (await p11.getByRole('button', { name: '거두기' }).count()) === 1);
		await p11.getByRole('tab', { name: '동아리 기장 제출' }).click(); await p11.waitForTimeout(200);
		const clubs = await p11.locator('.picks .pick').allInnerTexts();
		check('★ 동아리 기장 — 동아리 뱃지 + "목록에 없는 동아리"', clubs.length === 3 && clubs.some((t) => t.includes('Beatus')) && clubs.at(-1).includes('목록에 없는 동아리'), JSON.stringify(clubs));
		await p11.locator('#nos').fill('20701, 20702\n20815 20701');
		check('부원 학번은 쉼표 · 띄어쓰기 · 줄바꿈 어느 것으로 나눠도 (같은 학번은 한 번)', (await p11.locator('.lbl small').first().innerText()).startsWith('3명'));
		await p11.screenshot({ path: `${SP}/badge-submit.png`, fullPage: true });

		console.log('  [설정 · 뱃지]');
		await p11.goto(`${BASE}/settings`); await p11.getByRole('heading', { name: '뱃지' }).waitFor();
		const rec = p11.getByRole('switch', { name: '추천에 나오기' });
		check('★ 편지 › 추천에 나오기 (기본 켜짐)', await rec.isChecked());
		await rec.click(); await p11.waitForTimeout(500);
		check('끄면 letters_recommend = false 로 저장', w11.patches.some((x) => x.letters_recommend === false), JSON.stringify(w11.patches));
		await p11.getByRole('button', { name: '랜덤채팅에서 보일 뱃지' }).click();
		const sheet = p11.getByRole('dialog', { name: '랜덤채팅에서 보일 뱃지' });
		await sheet.getByRole('switch').first().waitFor({ timeout: 3000 });
		check('★ 설정 › 뱃지 › 랜덤채팅에서 보일 뱃지 — 가진 뱃지마다 스위치', (await sheet.getByRole('switch').count()) === 2);
		check('편지 찾기의 뱃지 순서 · CNSA 뱃지 안내 · 뱃지 제출하기', (await p11.getByRole('radio', { name: '내 순서' }).count()) >= 1
			&& (await p11.getByRole('button', { name: 'CNSA 뱃지 안내' }).count()) === 1 && (await p11.getByRole('link', { name: '뱃지 제출하기' }).count()) === 1);
		check('페이지 오류 없음 (CNSA 뱃지)', r11.errors.length === 0, r11.errors.join(' / '));
		await r11.ctx.close();
	}

	console.log('[명단에 없는 학생 — 이름 적기]');
	const w2 = world({ named: false });
	const two = await openApp(browser, w2);
	await two.page.waitForURL('**/onboarding', { timeout: 8000 }).catch(() => {});
	check('★ 이름이 없으면 시작 화면으로 (이미 가입했어도)', new URL(two.page.url()).pathname === '/onboarding', two.page.url());
	await two.page.getByRole('textbox', { name: '내 이름' }).fill('이외부');
	await two.page.getByRole('button', { name: '저장' }).click();
	await two.page.waitForURL(`${BASE}/`, { timeout: 8000 }).catch(() => {});
	check('★ 적으면 저장하고 홈으로', called(w2, 'set_my_name').at(-1)?.[1]?.p_name === '이외부' && new URL(two.page.url()).pathname === '/', two.page.url());
	check('페이지 오류 없음 (둘째)', two.errors.length === 0, two.errors.join(' / '));

	console.log('[편지 폴더 — 여러 통 골라 폴더에 (Phase 47)]');
	const w7 = world();
	const r7 = await openApp(browser, w7);
	const p7 = r7.page;
	await p7.goto(`${BASE}/letters`); await p7.locator('button.desk').waitFor(); await p7.waitForTimeout(400);
	const counts7 = { plate: (await p7.locator('.plate .muted').innerText()).replace(/\s+/g, ' '), label: await p7.locator('button.desk').getAttribute('aria-label') };
	await p7.locator('button.desk').click(); await p7.waitForURL('**/letters/archive'); await p7.locator('.archive .stack .item').first().waitFor(); await p7.waitForTimeout(500);
	check('보관함에 "선택" · 폴더가 없으면 서랍 줄도 없다 (Phase 69 — "고르기"에서 이름 바꿈)', (await p7.getByRole('button', { name: '선택', exact: true }).count()) === 1 && (await p7.getByRole('button', { name: '고르기' }).count()) === 0 && (await p7.locator('.folders').count()) === 0);
	await p7.getByRole('button', { name: '선택', exact: true }).click(); await p7.waitForTimeout(250);
	const putBtn = p7.getByRole('button', { name: '폴더에 넣기' });
	check('★ 선택: 제목 "편지 선택" · 아래 막대 · 아직 못 넣고 못 지운다', (await p7.locator('.topbar .title').innerText()) === '편지 선택' && (await p7.locator('.bar .count').innerText()) === '편지를 선택해 주세요' && await putBtn.isDisabled()
		&& await p7.locator('.bar').getByRole('button', { name: '삭제' }).isDisabled());
	const env = (label) => p7.locator(`.archive .stack .item[aria-label^="${label}"]`);
	await env('익명의 여학생에게서 온 편지, 안 읽음').click(); await p7.waitForTimeout(200);
	check('★ 안 연 편지는 선택할 수 없다 (봉투를 열어 본 것만)', (await env('익명의 여학생에게서 온 편지, 안 읽음').getAttribute('aria-pressed')) === 'false' && (await p7.getByText('봉투를 열어 본 편지만 선택할 수 있어요').count()) >= 1);
	await env('익명의 남학생에게서 온 편지').click(); await p7.waitForTimeout(150);
	check('누르면 선택된다 (체크 · 테두리)', (await env('익명의 남학생에게서 온 편지').getAttribute('aria-pressed')) === 'true' && (await p7.locator('.bar .count').innerText()) === '1통 선택했어요');
	await p7.getByRole('tab', { name: '보낸 편지' }).click(); await p7.waitForTimeout(500);
	await p7.locator('.archive .stack .item').first().click(); await p7.waitForTimeout(150);
	check('★ 받은 편지 · 보낸 편지를 함께 선택할 수 있다', (await p7.locator('.bar .count').innerText()) === '2통 선택했어요' && !(await putBtn.isDisabled()));
	await p7.screenshot({ path: `${SP}/letters-folder-1-select.png` });
	await putBtn.click(); await p7.waitForTimeout(300);
	check('폴더에 넣기 시트: 새 폴더 이름 칸', (await p7.getByRole('textbox', { name: '새 폴더 이름' }).count()) === 1);
	await p7.getByRole('textbox', { name: '새 폴더 이름' }).fill('소중한 편지');
	await p7.screenshot({ path: `${SP}/letters-folder-2-picker.png` });
	await p7.getByRole('button', { name: '만들고 넣기' }).click();
	await p7.waitForFunction(() => !document.querySelector('.bar'), null, { timeout: 4000 }).catch(() => {}); await p7.waitForTimeout(600);
	check('★ 새 폴더를 만들고 넣는다 — dm_folder_put (고른 편지 · 이름)', JSON.stringify(called(w7, 'dm_folder_put').at(-1)?.[1]) === JSON.stringify({ p_msgs: [60, 50], p_folder: null, p_name: '소중한 편지' }), JSON.stringify(called(w7, 'dm_folder_put')));
	check('넣으면 선택이 끝나고 알림', (await p7.locator('.topbar .title').innerText()) === '편지 보관함' && (await p7.getByText("'소중한 편지' 폴더에 2통을 넣었어요").count()) === 1);
	check('★ 폴더 서랍에 "소중한 편지" · 받은 · 보낸 편지 수를 나눠서 · 넣은 편지는 목록에서 빠진다', (await p7.locator('.folders .folder').getAttribute('aria-label')) === '소중한 편지 폴더 — 편지 2통 (받은 편지 1 · 보낸 편지 1)'
		&& (await p7.locator('.folders .fcount').innerText()) === '받은 1 · 보낸 1'
		&& (await p7.locator('.archive .stack .item').count()) === 0, await p7.locator('.folders').innerText().catch(() => ''));
	await p7.screenshot({ path: `${SP}/letters-folder-3-shelf.png` });
	await p7.goBack(); await p7.waitForTimeout(600);
	check('★ 뒤로가기 한 번이면 편지함 — 시트 · 선택 기록이 남지 않는다', new URL(p7.url()).pathname === '/letters', p7.url());
	check('편지함 책상 이름표에 폴더 수', (await p7.locator('.plate .muted').innerText()).includes('폴더 1'));
	const after7 = { plate: (await p7.locator('.plate .muted').innerText()).replace(/\s+/g, ' '), label: await p7.locator('button.desk').getAttribute('aria-label') };
	check('★ 폴더에 넣어도 받은 · 보낸 편지 수는 그대로 (폴더에 든 편지도 센다)', after7.plate === `${counts7.plate} · 폴더 1` && after7.label === `${counts7.label}, 폴더 1개`, JSON.stringify({ counts7, after7 }));
	await p7.locator('button.desk').click(); await p7.waitForURL('**/letters/archive'); await p7.waitForTimeout(500);

	await p7.locator('.folders .folder').click(); await p7.waitForURL('**/letters/f/1'); await p7.locator('.stack .item').first().waitFor(); await p7.waitForTimeout(500);
	check('★ 폴더 화면: 폴더 이름 · 받은 편지와 보낸 편지가 섞여 최근 것부터', (await p7.locator('.topbar .title').innerText()) === '소중한 편지'
		&& (await p7.locator('.stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).join('|') === '익명의 남학생에게서 온 편지|박받음에게 보낸 편지, 답장 옴',
		(await p7.locator('.stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).join('|'));
	await p7.screenshot({ path: `${SP}/letters-folder-4-folder.png` });
	// 받은 · 보낸 편지 나눠 보기 (Phase 47-3)
	const dirs = await p7.locator('.stack .item .dir').evaluateAll((els) => els.map((e) => `${e.textContent.trim()}${e.classList.contains('out') ? ':out' : ''}`));
	check('★ 섞인 폴더: 봉투마다 "받은 편지" · "보낸 편지" 딱지 (보낸 편지는 다른 색)', dirs.join('|') === '받은 편지|보낸 편지:out', dirs.join('|'));
	const tabs7 = await p7.getByRole('tab').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}${e.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
	check('★ 섞인 폴더: 전체 · 받은 편지 · 보낸 편지 나눠 보기 (수와 함께)', tabs7.join('|') === '전체 2통*|받은 편지 1통|보낸 편지 1통', tabs7.join('|'));
	await p7.getByRole('tab', { name: '보낸 편지' }).click(); await p7.waitForTimeout(500);
	const sentOnly = await p7.locator('.stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
	check('★ "보낸 편지"를 누르면 보낸 편지만', sentOnly.join('|') === '박받음에게 보낸 편지, 답장 옴', sentOnly.join('|'));
	await p7.setViewportSize({ width: 280, height: 620 }); await p7.waitForTimeout(300);
	const segFits = await p7.locator('.seg button').evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().height < 44));
	await p7.screenshot({ path: `${SP}/letters-folder-4b-kinds-280.png` });
	check('좁은 폰(280)에서도 나눠 보기 세 칸이 한 줄에 넘치지 않고', segFits);
	await p7.setViewportSize({ width: 390, height: 844 });
	await p7.getByRole('tab', { name: '받은 편지' }).click(); await p7.waitForTimeout(500);
	check('"받은 편지"를 누르면 받은 편지만', (await p7.locator('.stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).join('|') === '익명의 남학생에게서 온 편지');
	await p7.getByRole('tab', { name: '전체' }).click(); await p7.waitForTimeout(500);
	await p7.getByRole('button', { name: '선택', exact: true }).click(); await p7.waitForTimeout(200);
	await p7.locator('.stack .item').first().click(); await p7.waitForTimeout(150);
	await p7.getByRole('button', { name: '폴더에서 빼기' }).click(); await p7.waitForTimeout(500);
	check('★ 폴더에서 빼면 보관함으로 — dm_folder_take · 폴더에 한 통 남는다', JSON.stringify(called(w7, 'dm_folder_take').at(-1)?.[1]) === '{"p_msgs":[60]}' && (await p7.locator('.stack .item').count()) === 1);
	check('한 가지만 남으면 나눠 보기는 걷히고 딱지는 그대로', (await p7.getByRole('tab').count()) === 0 && (await p7.locator('.stack .item .dir.out').count()) === 1);
	await p7.getByRole('button', { name: '폴더 메뉴' }).click(); await p7.waitForTimeout(250);
	await p7.locator('.sheet .item', { hasText: '이름 바꾸기' }).click(); await p7.waitForTimeout(150);
	await p7.getByRole('textbox', { name: '새 폴더 이름' }).fill('추억');
	await p7.locator('.sheet .item', { hasText: '바꾸기' }).last().click(); await p7.waitForTimeout(500);
	check('이름 바꾸기', (await p7.locator('.topbar .title').innerText()) === '추억' && called(w7, 'dm_folder_rename').at(-1)?.[1]?.p_name === '추억');
	await p7.getByRole('button', { name: '선택', exact: true }).click(); await p7.waitForTimeout(200);
	await p7.goBack(); await p7.waitForTimeout(400);
	check('★ 선택 중 뒤로가기 = 선택만 끝낸다 (화면은 그대로)', new URL(p7.url()).pathname === '/letters/f/1' && (await p7.locator('.bar').count()) === 0 && (await p7.locator('.topbar .title').innerText()) === '추억');
	await p7.getByRole('button', { name: '폴더 메뉴' }).click(); await p7.waitForTimeout(250);
	await p7.locator('.sheet .item', { hasText: '폴더 지우기' }).click(); await p7.waitForTimeout(150);
	check('지우기 확인: 편지는 보관함으로 돌아간다고 알림', (await p7.locator('.sheet .warn').innerText()).includes('보관함'));
	await p7.locator('.sheet .item.danger', { hasText: '폴더 지우기' }).click();
	await p7.waitForURL('**/letters/archive', { timeout: 4000 }).catch(() => {}); await p7.waitForTimeout(600);
	await p7.getByRole('tab', { name: '보낸 편지' }).click(); await p7.waitForTimeout(500);
	const back7 = await p7.locator('.archive .stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
	check('★ 폴더를 지우면 보관함으로 · 서랍에서 사라지고 안의 편지(보낸 편지)는 돌아온다', new URL(p7.url()).pathname === '/letters/archive' && (await p7.locator('.folders').count()) === 0
		&& called(w7, 'dm_folder_delete').length === 1 && back7.includes('박받음에게 보낸 편지, 답장 옴'), `${p7.url()} | folders ${await p7.locator('.folders').count()} | ${back7.join(',')}`);
	// 폴더 자동 넣기 (2026-10-06) — 한 사람의 받은 편지가 모두 한 폴더에 들어가면(서버의 offer) 아래에서 올라와 묻는다
	w7.offer = [{ thread_id: 8, from_gender: 'm', from_name: null, from_nick: null }];
	await p7.getByRole('tab', { name: '받은 편지' }).click(); await p7.waitForTimeout(500);
	await p7.getByRole('button', { name: '선택', exact: true }).click(); await p7.waitForTimeout(200);
	await env('익명의 남학생에게서 온 편지').click(); await p7.waitForTimeout(150);
	await putBtn.click(); await p7.waitForTimeout(300);
	await p7.getByRole('textbox', { name: '새 폴더 이름' }).fill('남학생');
	await p7.getByRole('button', { name: '만들고 넣기' }).click();
	const ask7 = p7.getByRole('dialog', { name: '폴더 자동 넣기' });
	await ask7.waitFor({ timeout: 4000 }).catch(() => {}); await p7.waitForTimeout(500);
	await p7.screenshot({ path: `${SP}/letters-folder-5-rule.png` });
	check("★ 한 사람의 편지를 모두 한 폴더에 넣으면 아래에서 묻는다 — \"앞으로 '익명의 남학생'님의 모든 편지를 이 폴더 안에 넣을까요?\"", (await ask7.locator('.ask').innerText().catch(() => '')) === "앞으로 '익명의 남학생'님의 모든 편지를 이 폴더 안에 넣을까요?"
		&& called(w7, 'dm_folder_rule').length === 0 && (await p7.getByText("'남학생' 폴더에 1통을 넣었어요").count()) === 0, await ask7.innerText().catch(() => '시트 없음'));
	await ask7.getByRole('button', { name: '네, 넣을게요' }).click(); await p7.waitForTimeout(700);
	check('★ 그러겠다고 하면 dm_folder_rule (그 줄기 · 그 폴더) · 시트가 닫히고 알림', JSON.stringify(called(w7, 'dm_folder_rule').at(-1)?.[1]) === JSON.stringify({ p_thread: 8, p_folder: w7.folders.at(-1).id })
		&& (await ask7.count()) === 0 && (await p7.getByText("앞으로 '익명의 남학생'님의 편지는 열어 보면 이 폴더로 들어가요").count()) === 1, JSON.stringify(called(w7, 'dm_folder_rule')));
	check('페이지 오류 없음 (폴더)', r7.errors.length === 0, r7.errors.join(' / '));
	await r7.ctx.close();

	console.log('[편지 삭제 — 선택한 편지를 내 편지함에서만 (Phase 69)]');
	const w8 = world();
	w8.letters.push({ id: 45, thread_id: 10, box: 'sent', to_name: null, to_gender: 'f', opened: false, replied: false, is_reply: true, body: '폴더의 편지', created_at: ago(200) });
	w8.folders = [{ id: 1, name: '추억' }];
	w8.filed.set(45, 1);
	w8.filed.set(50, 1);
	const r8 = await openApp(browser, w8);
	const p8 = r8.page;
	await p8.goto(`${BASE}/letters`); await p8.locator('button.desk').waitFor(); await p8.waitForTimeout(400);
	await p8.locator('button.desk').click(); await p8.waitForURL('**/letters/archive'); await p8.locator('.archive .stack .item').first().waitFor(); await p8.waitForTimeout(500);
	await p8.getByRole('button', { name: '선택', exact: true }).click(); await p8.waitForTimeout(250);
	const env8 = (label) => p8.locator(`.archive .stack .item[aria-label^="${label}"]`);
	await env8('익명의 남학생에게서 온 편지').click(); await p8.waitForTimeout(150);
	const delBtn = p8.locator('.bar').getByRole('button', { name: '삭제' });
	check('★ 선택하면 "삭제" · "폴더에 넣기"', !(await delBtn.isDisabled()) && !(await p8.getByRole('button', { name: '폴더에 넣기' }).isDisabled()));
	await delBtn.click(); await p8.waitForTimeout(300);
	const ask8 = p8.getByRole('dialog', { name: '편지 삭제' });
	check('★ 누르면 바로 지우지 않고 확인 — 상대에게는 남고 되돌릴 수 없다고 알림', (await ask8.locator('.ask').innerText()) === '편지 1통을 삭제할까요?'
		&& (await ask8.locator('.warn').innerText()).includes('상대에게는 그대로') && (await ask8.locator('.warn').innerText()).includes('되돌릴 수 없어요') && called(w8, 'dm_letter_delete').length === 0);
	await p8.screenshot({ path: `${SP}/letters-delete-1-confirm.png` });
	await ask8.getByRole('button', { name: '취소' }).click(); await p8.waitForTimeout(300);
	check('확인에서 취소하면 선택은 그대로', called(w8, 'dm_letter_delete').length === 0 && (await p8.locator('.bar .count').innerText()) === '1통 선택했어요');
	await delBtn.click(); await p8.waitForTimeout(300);
	await p8.getByRole('dialog', { name: '편지 삭제' }).getByRole('button', { name: '삭제' }).click();
	await p8.waitForFunction(() => !document.querySelector('.bar'), null, { timeout: 4000 }).catch(() => {}); await p8.waitForTimeout(500);
	const left8 = await p8.locator('.archive .stack .item').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
	check('★ 삭제 — dm_letter_delete (선택한 편지) · 목록에서 사라지고 선택이 끝난다', JSON.stringify(called(w8, 'dm_letter_delete').at(-1)?.[1]) === '{"p_msgs":[60]}'
		&& !left8.some((l) => l.startsWith('익명의 남학생에게서 온 편지')) && (await p8.locator('.topbar .title').innerText()) === '편지 보관함'
		&& (await p8.getByText('편지 1통을 삭제했어요').count()) === 1, left8.join(','));
	await p8.goBack(); await p8.waitForTimeout(600);
	check('★ 뒤로가기 한 번이면 편지함 — 확인 시트 · 선택 기록이 남지 않는다', new URL(p8.url()).pathname === '/letters', p8.url());

	await p8.goto(`${BASE}/letters/f/1`); await p8.locator('.stack .item').first().waitFor(); await p8.waitForTimeout(500);
	await p8.getByRole('button', { name: '선택', exact: true }).click(); await p8.waitForTimeout(200);
	await p8.locator('.stack .item').first().click(); await p8.waitForTimeout(150);
	// 폴더 화면은 단추 셋 — 좁은 폰(320)에서도 한 줄에, 글자가 잘리지 않고 화면 안에
	const barFit = async () => p8.locator('.bar .acts button').evaluateAll((els) => {
		const rs = els.map((e) => e.getBoundingClientRect());
		return { n: els.length, row: rs.every((r) => Math.abs(r.top - rs[0].top) < 1), inside: rs.every((r) => r.left >= 0 && r.right <= innerWidth), clip: els.some((e) => e.scrollWidth > e.clientWidth + 1), labels: els.map((e) => e.textContent.trim()),
			gapAfterDelete: Math.round(rs[1].left - rs[0].right) };
	});
	const fits = [];
	for (const w of [390, 320]) { await p8.setViewportSize({ width: w, height: 700 }); await p8.waitForTimeout(250); fits.push(await barFit()); }
	await p8.screenshot({ path: `${SP}/letters-delete-2-folder-320.png` });
	await p8.setViewportSize({ width: 390, height: 844 }); await p8.waitForTimeout(200);
	check('★ 폴더 화면: 삭제 · 폴더에서 빼기 · 다른 폴더로 — 좁은 폰(320)에서도 한 줄에 · 잘리지 않고 · 삭제 옆은 12 띄운다 (G1.4)', fits.every((f) => f.n === 3 && f.row && f.inside && !f.clip && f.gapAfterDelete >= 12) && fits[0].labels.join('|') === '삭제|폴더에서 빼기|다른 폴더로', JSON.stringify(fits));
	await p8.locator('.bar').getByRole('button', { name: '삭제' }).click(); await p8.waitForTimeout(300);
	await p8.getByRole('dialog', { name: '편지 삭제' }).getByRole('button', { name: '삭제' }).click(); await p8.waitForTimeout(700);
	check('★ 폴더에서도 삭제 — 폴더에 한 통 남는다', called(w8, 'dm_letter_delete').length === 2 && (await p8.locator('.stack .item').count()) === 1 && (await p8.locator('.bar').count()) === 0);
	check('페이지 오류 없음 (삭제)', r8.errors.length === 0, r8.errors.join(' / '));
	await r8.ctx.close();

	console.log('[아이패드 사파리 — 책상이 폭을 채운다 (Phase 59)]');
	{
		const r9 = await openApp(browser, world(), { viewport: { width: 1180, height: 820 } });
		const p9 = r9.page;
		await p9.goto(`${BASE}/letters`); await p9.locator('button.desk').waitFor(); await p9.waitForTimeout(500);
		// 사파리 18 까지의 기본 스타일(button { align-items: flex-start })을 흉내 — :where() 라 앱의 button 초기화보다 약하다(기본 스타일처럼)
		await p9.addStyleTag({ content: ':where(button) { align-items: flex-start; }' }); await p9.waitForTimeout(300);
		const fill = await p9.evaluate(() => {
			const w = (s) => document.querySelector(s).getBoundingClientRect().width;
			return { desk: w('button.desk'), wood: w('.desk .wood'), plate: w('.desk .plate'), fab: w('.desk-area .fab') };
		});
		await p9.screenshot({ path: `${SP}/letters-ipad-safari.png` });
		// 이름표 + 틈 10 + 편지 쓰기 = 책상 폭 - 양옆(화면 여백 16 + 넓힌 14)
		check('★ 사파리 기본 스타일에서도 책상 판자 · [이름표 | 편지 쓰기] 줄이 폭을 채운다', Math.abs(fill.wood - fill.desk) < 1 && Math.abs(fill.plate + 10 + fill.fab - (fill.desk - 60)) < 2, JSON.stringify(fill));
		await r9.ctx.close();
	}

	console.log('[내 프로필 — 낮은 이름 카드 · 교복 (Phase 60)]');
	for (const gender of ['m', 'f']) {
		const w10 = world();
		w10.prof.gender = gender;
		const r10 = await openApp(browser, w10);
		const p10 = r10.page;
		const fun = { code: 'fun', title: '이야기꾼', icon: '', tier: 3 };
		await p10.route('https://fake-proj.supabase.co/rest/v1/rpc/my_achievements', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
			items: [
				{ ...fun, category: 'manner', tiers: [10, 50, 200], value: 210, description: '"대화가 재밌어요" 받기', unit: '번', lower_better: false, earned_at: null, new: false, granted: false },
				{ code: 'kind', title: '친절왕', icon: '', tier: 0, category: 'manner', tiers: [10, 50, 200], value: 4, description: '"친절해요" 받기', unit: '번', lower_better: false, earned_at: null, new: false, granted: false }
			], featured: [fun], chosen: [] }) }));
		await p10.goto(`${BASE}/me`); await p10.locator('.uniform').waitFor(); await p10.waitForTimeout(400);
		if (gender === 'm') {
			const card = await p10.locator('.who').boundingBox();
			check('★ 이름 카드: 표지 위에 이름 · "업적 1/2 ›" (누르면 업적 화면) · 낮게', (await p10.locator('.who .nick').innerText()) === '푸른고래' && (await p10.locator('.who .ach-link').innerText()).includes('업적 1/2')
				&& (await p10.locator('.who .ach-link').getAttribute('href')) === '/me/achievements' && card.height < 200, JSON.stringify(card));
			check('★ 남학생 교복 = 넥타이 · 대표 업적 1개는 깃의 배지, 남은 2칸은 "+"', (await p10.locator('.uniform').getAttribute('data-neck')) === 'tie'
				&& (await p10.locator('.uniform button.pin').count()) === 1 && (await p10.locator('.uniform a.empty').count()) === 2);
			check('"명성" 카드는 없다', (await p10.locator('.fame').count()) === 0);
			await p10.screenshot({ path: `${SP}/me-uniform-m.png` });
			await p10.emulateMedia({ reducedMotion: 'reduce' }); // 교복 배지는 숨 쉬듯 움직인다 — 멈추고 누른다 (Phase 62)
			await p10.getByRole('button', { name: '이야기꾼 업적 자세히' }).click(); await p10.waitForTimeout(300);
			check('★ 배지를 누르면 업적 자세히 · 대표에서 내리기', (await p10.getByRole('dialog', { name: '이야기꾼' }).getByRole('button', { name: '대표 업적에서 내리기' }).count()) === 1);
		} else {
			check('★ 여학생 교복 = 리본', (await p10.locator('.uniform').getAttribute('data-neck')) === 'ribbon');
			await p10.screenshot({ path: `${SP}/me-uniform-f.png` });
			// Phase 69 — 배지를 끌어 다른 칸에: 바로 옮겨 보이고 set_featured_badges 에 새 순서. 서버가 거절하면 되돌린다
			const good = { code: 'good', title: '호평 수집가', icon: '', tier: 1 };
			const saved = [];
			let reject = false;
			await p10.route('https://fake-proj.supabase.co/rest/v1/rpc/my_achievements', (rt) => rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
				items: [
					{ ...fun, category: 'manner', tiers: [10, 50, 200], value: 210, description: '', unit: '번', lower_better: false, earned_at: null, new: false, granted: false },
					{ ...good, category: 'manner', tiers: [10, 50, 200], value: 12, description: '', unit: '번', lower_better: false, earned_at: null, new: false, granted: false }
				], featured: [fun, good], chosen: [] }) }));
			await p10.route('https://fake-proj.supabase.co/rest/v1/rpc/set_featured_badges', (rt) => {
				const codes = rt.request().postDataJSON().p_codes;
				saved.push(codes);
				const byCode = { fun, good };
				return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reject ? { status: 'not_owned' } : { status: 'ok', featured: codes.map((c) => byCode[c]) }) });
			});
			await p10.goto(`${BASE}/letters`); await p10.waitForTimeout(300);
			await p10.goto(`${BASE}/me`); await p10.locator('.uniform button.pin').nth(1).waitFor(); await p10.waitForTimeout(400);
			await p10.emulateMedia({ reducedMotion: 'reduce' });
			const pins = () => p10.locator('.uniform button.pin').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
			const dragPin = async (from, to) => {
				const a = await p10.locator(`.uniform [data-drop-slot="${from}"]`).boundingBox(), b = await p10.locator(`.uniform [data-drop-slot="${to}"]`).boundingBox();
				await p10.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p10.mouse.down();
				await p10.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await p10.mouse.up(); await p10.waitForTimeout(500);
			};
			await dragPin(0, 1);
			check('★ 내 프로필: 배지를 끌어 다른 칸에 — 자리가 바뀌고 서버에 새 순서 (set_featured_badges)', JSON.stringify(saved.at(-1)) === '["good","fun"]'
				&& (await pins()).join('|') === '호평 수집가 업적 자세히|이야기꾼 업적 자세히' && (await p10.getByRole('dialog').count()) === 0, JSON.stringify({ saved, pins: await pins() }));
			reject = true;
			await dragPin(0, 1);
			check('서버가 거절하면 원래 자리로 되돌리고 알림', (await pins()).join('|') === '호평 수집가 업적 자세히|이야기꾼 업적 자세히' && (await p10.getByText('아직 딴 업적이 아니에요').count()) === 1, JSON.stringify({ saved, pins: await pins() }));
			reject = false;
			await dragPin(0, 2);
			check('★ 빈 칸(업적 화면 링크)에 놓으면 맨 뒤로 — 링크로 넘어가지 않는다', new URL(p10.url()).pathname === '/me' && JSON.stringify(saved.at(-1)) === '["fun","good"]'
				&& (await pins()).join('|') === '이야기꾼 업적 자세히|호평 수집가 업적 자세히', JSON.stringify({ url: p10.url(), saved, pins: await pins() }));
		}
		check(`페이지 오류 없음 (프로필 ${gender})`, r10.errors.length === 0, r10.errors.join(' / '));
		await r10.ctx.close();
	}

	console.log('[낮은 화면 편지 쓰기 단추 · 인터넷 끊김 띠 (Phase 54)]');
	{
		const w8 = world();
		const r8 = await openApp(browser, w8, { viewport: { width: 280, height: 574 } });
		const p8 = r8.page;
		await p8.goto(`${BASE}/letters`); await p8.locator('button.desk').waitFor(); await p8.waitForTimeout(700);
		// 큰 글꼴 안드로이드(≈280×574): 편지 쓰기는 연필만 있는 네모 단추 — 이름표 옆 한 줄, 이름표 글을 가리지 않는다 (Phase 71)
		await p8.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p8.waitForTimeout(300);
		const row8 = await rowOf(p8);
		check('★ 좁은 화면 — 편지 쓰기는 연필 네모 단추로 이름표 옆 한 줄 (겹치지 않음)', row8.dy < 1.5 && row8.gap > 0 && row8.fabW <= 64 && row8.plateW >= 150, JSON.stringify(row8));
		check('단추 이름은 그대로 "편지 쓰기"', (await p8.getByRole('link', { name: '편지 쓰기' }).count()) === 1);
		await p8.screenshot({ path: `${SP}/letters-fab-280.png` });
		await r8.ctx.setOffline(true); await p8.waitForTimeout(300);
		check('★ 인터넷이 끊기면 위쪽 띠', (await p8.locator('.offline').innerText()).includes('인터넷 연결이 끊겼어요'));
		await r8.ctx.setOffline(false); await p8.waitForTimeout(400);
		check('다시 이어지면 띠가 걷히고 "다시 연결됐어요"', (await p8.locator('.offline').count()) === 0 && (await p8.getByText('다시 연결됐어요').count()) >= 1);
		check('페이지 오류 없음 (Phase 54)', r8.errors.length === 0, r8.errors.join(' / '));
		await r8.ctx.close();
	}

	console.log('[폰 키보드 — 찾기 → 고르기 (Phase 46)]');
	const w6 = world();
	const r6 = await openApp(browser, w6, { isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
	const p6 = r6.page;
	await p6.goto(`${BASE}/letters/new`);
	const s6 = p6.getByRole('searchbox', { name: '편지 받을 학생 찾기' });
	await s6.waitFor(); await s6.fill('박받'); await p6.waitForTimeout(700);
	check('폰 흉내: 손가락 기기 (hover 없음 · 굵은 포인터)', await p6.evaluate(() => !matchMedia('(hover: hover) and (pointer: fine)').matches));
	check('찾는 동안 찾기 칸에 초점 (키보드가 떠 있다)', await s6.evaluate((e) => e === document.activeElement));
	await s6.press('Enter'); await p6.waitForTimeout(100);
	check('★ 키보드의 "검색"을 누르면 키보드를 내린다 (결과가 가려지지 않게)', await p6.evaluate(() => document.activeElement === document.body) && (await p6.locator('.person').count()) === 2);
	await s6.focus();
	// 아이폰은 버튼을 눌러도 입력칸에서 초점이 빠지지 않는다 — 초점을 옮기지 않는 click 으로 흉내
	await p6.locator('.person').first().evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
	await p6.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'write', null, { timeout: 4000 });
	await p6.waitForTimeout(400);
	check('★ 받는 사람을 고르면 찾기 키보드가 내려가고, 폰은 편지지에 저절로 커서를 두지 않는다', await p6.evaluate(() => document.activeElement === document.body),
		await p6.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
	await p6.getByRole('textbox', { name: '편지 내용' }).tap(); await p6.waitForTimeout(150);
	check('편지지를 누르면 그때 쓴다', await p6.evaluate(() => !!document.activeElement?.closest('.le-doc')));
	await p6.getByRole('button', { name: '굵게' }).evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
	check('서식 단추는 키보드를 내리지 않는다 (data-keep-kb)', await p6.evaluate(() => !!document.activeElement?.closest('.le-doc')));
	await p6.goto(`${BASE}/me`); await p6.locator('textarea.area').waitFor();
	await p6.locator('textarea.area').focus();
	await p6.locator('.mbti .chip', { hasText: 'INFP' }).evaluate((b) => b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
	check('★ 입력 중 다른 버튼을 누르면 키보드를 내린다 (프로필 소개 → MBTI)', await p6.evaluate(() => document.activeElement === document.body));
	await p6.locator('textarea.area').focus();
	await p6.locator('a.tab[href="/letters"]').evaluate((a) => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
	await p6.waitForURL('**/letters'); await p6.waitForTimeout(200);
	check('★ 입력 중 다른 화면으로 가면 키보드를 내린다', await p6.evaluate(() => !document.activeElement || document.activeElement === document.body));
	check('페이지 오류 없음 (폰 키보드)', r6.errors.length === 0, r6.errors.join(' / '));
	await r6.ctx.close();

	console.log('[폰 키보드 — 편지지 머리가 서식 막대 밑으로 숨지 않는다 (Phase 77)]');
	{
		const rk = await openApp(browser, world(), { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
		const pk = rk.page;
		await pk.goto(`${BASE}/letters/m/70/reply`);
		await pk.waitForFunction(() => document.querySelector('.compose')?.getAttribute('data-phase') === 'write', null, { timeout: 8000 });
		await pk.waitForTimeout(700);
		await pk.getByRole('textbox', { name: '편지 내용' }).tap(); await pk.keyboard.type('테스트');
		await pk.setViewportSize({ width: 412, height: 380 }); // 안드로이드 키보드 — 화면이 줄어든다
		// 안드로이드 크롬처럼 커서 쪽으로 스크롤하며 편지지 머리를 서식 막대 밑으로 밀어 올린다
		// 밀어 올린 직후를 같은 호출에서 잰다 — 따로 재면 그 사이에 앱이 이미 바로잡아 before 가 음수로 나온다
		const before = await pk.evaluate(() => { const b = document.querySelector('.le .bar').getBoundingClientRect(), p = document.querySelector('.letter-paper').getBoundingClientRect(); scrollBy(0, p.top - b.bottom + 70); return document.querySelector('.le .bar').getBoundingClientRect().bottom - document.querySelector('.letter-paper').getBoundingClientRect().top; });
		await pk.waitForTimeout(900);
		const after = await pk.evaluate(() => ({ gap: document.querySelector('.letter-paper').getBoundingClientRect().top - document.querySelector('.le .bar').getBoundingClientRect().bottom, kb: document.documentElement.classList.contains('kb-open') }));
		check('★ 키보드가 올라와 편지지 머리(To.)가 가려지면 다시 서식 막대 아래로', before > 20 && after.kb && after.gap >= 0, JSON.stringify({ before, after }));
		check('페이지 오류 없음 (키보드)', rk.errors.length === 0, rk.errors.join(' / '));
		await rk.ctx.close();
	}

	console.log('[인스타 스토리]');
	const w5 = world();
	const lines14 = Array.from({ length: 14 }, (_, i) => `${i + 1}번째 줄 — 너랑 얘기하면 하루가 금방 가`).join('\n');
	w5.letters.push(
		{ id: 61, thread_id: 11, box: 'received', from_gender: 'f', from_name: null, from_nick: '비밀친구', opened: true, is_reply: false, body: lines14,
			fmt: { m: [[0, 6, 'b'], [9, 11, 'h:yellow'], [24, 30, 'c:blue'], [35, 38, 'z:xl'], [40, 44, 'u']], a: [[1, 'center'], [2, 'right']] }, created_at: ago(20) },
		{ id: 62, thread_id: 12, box: 'received', from_gender: 'm', from_name: null, opened: true, is_reply: false, body: '가나다라마바사아 '.repeat(110).trim(), created_at: ago(25) }
	);
	const r5 = await openApp(browser, w5);
	const p5 = r5.page;
	const ig = p5.getByRole('button', { name: '인스타그램 스토리에 공유' });
	// 공유 창 · 캔버스 글씨를 가로챈다 — 그림에 무엇을 그렸는지(상대 이름이 실리지 않는지) 본다
	const hook = () => p5.evaluate(() => {
		window.__texts = []; window.__shared = null; window.__deny = 0;
		const orig = CanvasRenderingContext2D.prototype.fillText;
		CanvasRenderingContext2D.prototype.fillText = function (t, ...rest) { window.__texts.push(String(t)); return orig.call(this, t, ...rest); };
		Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!d?.files?.length });
		Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => {
			if (window.__deny > 0) { window.__deny--; throw new DOMException('no activation', 'NotAllowedError'); }
			window.__shared = d.files[0];
		} });
	});
	const openAt = async (id) => {
		await p5.goto(`${BASE}/letters/m/${id}`);
		await p5.locator('.stage').click({ timeout: 1500 }).catch(() => {}); // 처음 여는 편지는 연출을 건너뛴다
		await p5.locator('.letter-paper').waitFor({ timeout: 6000 }); await p5.waitForTimeout(300);
		await hook();
	};
	const shared = () => p5.waitForFunction(() => window.__shared, null, { timeout: 8000 }).then(() => p5.evaluate(async () => {
		const f = window.__shared; const bmp = await createImageBitmap(f);
		const url = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
		return { type: f.type, name: f.name, w: bmp.width, h: bmp.height, url, texts: window.__texts };
	}));
	const saveImg = (url, name) => writeFileSync(`${SP}/${name}`, Buffer.from(url.split(',')[1], 'base64'));

	await openAt(60);
	const rb = await p5.getByRole('button', { name: '편지로 답장 쓰기' }).boundingBox(), ib = await ig.boundingBox();
	check('★ 받은 편지: 답장 버튼 오른쪽에 작은 인스타 버튼 한 줄 (답장이 넓게)', !!ib && ib.x >= rb.x + rb.width && Math.abs(ib.y + ib.height / 2 - (rb.y + rb.height / 2)) < 2
		&& ib.width === 54 && ib.height === 54 && rb.width > ib.width * 3, JSON.stringify({ rb, ib }));
	await p5.screenshot({ path: `${SP}/letters-story-0-row.png` });
	await ig.click();
	const s1 = await shared();
	check('★ 누르면 공유 창에 스토리 그림 한 장 — PNG 1080×1920', s1.type === 'image/png' && s1.name === 'landy-letter.png' && s1.w === 1080 && s1.h === 1920, JSON.stringify({ ...s1, url: '', texts: '' }));
	check('그림에 편지 그대로 — To. 내 이름 · 본문 · From. 익명의 남학생 · Landy', s1.texts.includes('To. 김보냄') && s1.texts.some((t) => t.includes('시험'))
		&& s1.texts.includes('From. 익명의 남학생') && s1.texts.includes('Landy'), JSON.stringify(s1.texts));
	saveImg(s1.url, 'letters-story-1-short.png');

	await openAt(55);
	await ig.click();
	const s2 = await shared();
	check('★ 이름으로 온 답장이어도 스토리에는 상대 이름을 싣지 않는다 (From. 익명의 여학생)', (await p5.locator('.letter-paper .lp-from').innerText()) === 'From. 박받음'
		&& s2.texts.includes('From. 익명의 여학생') && !s2.texts.some((t) => t.includes('박받음')), JSON.stringify(s2.texts));
	saveImg(s2.url, 'letters-story-2-named.png');

	await openAt(61);
	await ig.click();
	const s3 = await shared();
	check('서명이 있으면 서명 · 긴 편지는 글씨를 줄여 끝줄까지 한 장에', s3.texts.includes('From. 비밀친구') && s3.texts.some((t) => t.includes('14번째')) && !s3.texts.includes('…'), JSON.stringify(s3.texts.slice(-6)));
	saveImg(s3.url, 'letters-story-3-format.png');

	await openAt(62);
	await ig.click();
	const s4 = await shared();
	check('그래도 넘치는 편지는 끝을 "…" 로 자른다', s4.texts.includes('…') && s4.h === 1920);
	saveImg(s4.url, 'letters-story-4-long.png');

	await openAt(60);
	await p5.evaluate(() => (window.__deny = 1));
	await ig.click();
	await p5.getByText('한 번 더 누르면').waitFor({ timeout: 5000 }).catch(() => {});
	const drawn = await p5.evaluate(() => window.__texts.length);
	check('그리는 사이 손길이 식어 공유 창이 막히면 "한 번 더" 안내', drawn > 0 && !(await p5.evaluate(() => window.__shared)) && (await p5.getByText('한 번 더 누르면').count()) === 1);
	await ig.click();
	const s5 = await shared();
	check('★ 다시 누르면 그려 둔 그림으로 바로 공유 (다시 그리지 않는다)', s5.texts.length === drawn && s5.w === 1080);

	await p5.evaluate(() => Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined }));
	const dl = p5.waitForEvent('download', { timeout: 8000 });
	await ig.click();
	const file = await dl.catch(() => null);
	await p5.getByText('스토리 그림을 저장했어요').waitFor({ timeout: 3000 }).catch(() => {});
	check('★ 파일 공유가 안 되는 곳(데스크톱 등)은 그림을 저장 + 안내', file?.suggestedFilename() === 'landy-letter.png' && (await p5.getByText('스토리 그림을 저장했어요').count()) === 1);

	w5.wait = true;
	await openAt(60);
	check('답장을 못 쓸 때도 안내 옆에 인스타 버튼', (await p5.locator('.actions .row .note').count()) === 1 && (await ig.count()) === 1);
	w5.wait = false;
	await openAt(50);
	check('보낸 편지에는 인스타 버튼 없음', (await ig.count()) === 0);
	check('페이지 오류 없음 (스토리)', r5.errors.length === 0, r5.errors.join(' / '));
	await r5.ctx.close();
} finally {
	await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
